const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

function loadScript(context, file) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

function createSyncHarness() {
    const localOrders = new Map();
    const operations = new Map();
    const meta = new Map();
    const remoteOrders = new Map();
    const postPayloads = [];
    const requestLog = [];
    let revision = 1;
    let failPost = false;

    const storage = {
        async openDatabase() {},
        async migrateLegacy() {},
        async getAllOrders() { return [...localOrders.values()]; },
        async getAllOperations() { return [...operations.values()]; },
        async getMeta(key, fallback) { return meta.has(key) ? meta.get(key) : fallback; },
        async putMeta(key, value) { meta.set(key, value); },
        async putOrders(orders) { orders.forEach(order => localOrders.set(order.id, order)); },
        async deleteOrders(ids) { ids.map(String).forEach(id => localOrders.delete(id)); },
        async putOrderAndOperation(order, operation) {
            localOrders.set(order.id, order);
            operations.set(operation.operationId, operation);
        },
        async replaceStatusOperation(order, operation) {
            localOrders.set(order.id, order);
            [...operations.values()].forEach(item => {
                if (item.orderId === operation.orderId && item.type === 'status') operations.delete(item.operationId);
            });
            operations.set(operation.operationId, operation);
        },
        async deleteOrdersAndQueue(ids, operation, clearAll) {
            if (clearAll) {
                localOrders.clear();
                operations.clear();
            } else {
                ids.map(String).forEach(id => {
                    localOrders.delete(id);
                    [...operations.values()].forEach(item => {
                        if (String(item.orderId) === id) operations.delete(item.operationId);
                    });
                });
            }
            operations.set(operation.operationId, operation);
        },
        async updateOperation(operation) { operations.set(operation.operationId, operation); },
        async removeOperations(ids) { ids.forEach(id => operations.delete(id)); }
    };

    const logic = {
        ACTIVE_STATUSES: new Set(['pendente', 'fazendo']),
        createId: prefix => `${prefix}_${Math.random().toString(16).slice(2)}`,
        isToday: value => new Date(value).toDateString() === new Date().toDateString(),
        isStatusFinal: status => ['enviado', 'buscar', 'cancelado', 'concluido'].includes(status),
        normalizeOrder: order => ({
            id: String(order.id), produto: order.produto || '', status: order.status || 'pendente',
            timestamp: order.timestamp || new Date().toISOString(), finalizadoEm: order.finalizadoEm || '',
            motivo: order.motivo || '', atualizadoEm: order.atualizadoEm || order.timestamp || new Date().toISOString(),
            revisao: Number(order.revisao || 0), operacaoId: order.operacaoId || '',
            areaOrigem: order.areaOrigem || 'panelas', areaDestino: order.areaDestino || 'cozinha',
            syncState: order.syncState || 'confirmed', localOnly: Boolean(order.localOnly)
        })
    };

    const api = {
        async sync() {
            requestLog.push('get');
            return {
                status: 'ok', changed: true, revision,
                capabilities: { novoPedidoLote: true },
                pedidos: [...remoteOrders.values()]
            };
        },
        async post(url, payload) {
            requestLog.push(`post:${payload.action}`);
            postPayloads.push(payload);
            if (failPost) throw new Error('offline');
            if (payload.action === 'novo_pedido') {
                remoteOrders.set(String(payload.id), {
                    id: String(payload.id), produto: payload.produto, status: 'pendente',
                    timestamp: new Date().toISOString(), areaOrigem: payload.areaOrigem,
                    areaDestino: payload.areaDestino, operacaoId: payload.operationId
                });
            } else if (payload.action === 'novo_pedido_lote') {
                payload.pedidos.forEach(order => {
                    remoteOrders.set(String(order.id), {
                        id: String(order.id), produto: order.produto, status: 'pendente', revisao: revision + 1,
                        timestamp: new Date().toISOString(), areaOrigem: order.areaOrigem,
                        areaDestino: order.areaDestino, operacaoId: order.operationId
                    });
                });
            } else if (payload.action === 'atualizar_status_lote') {
                payload.updates.forEach(update => {
                    const order = remoteOrders.get(String(update.id));
                    if (!order) return;
                    if (update.expectedStatus && order.status !== update.expectedStatus) return;
                    if (update.expectedOrderRevision !== undefined && Number(order.revisao || 0) > Number(update.expectedOrderRevision)) return;
                    remoteOrders.set(String(update.id), {
                        ...order,
                        status: update.novoStatus,
                        motivo: update.motivo || '',
                        operacaoId: update.operationId,
                        revisao: revision + 1
                    });
                });
            } else if (payload.action === 'excluir_pedido') {
                remoteOrders.delete(String(payload.id));
            } else if (payload.action === 'excluir_hoje' || payload.action === 'excluir_tudo') {
                payload.ids.forEach(id => remoteOrders.delete(String(id)));
            }
            revision += 1;
        }
    };

    const context = vm.createContext({
        console,
        setTimeout,
        clearTimeout,
        Math,
        Date,
        navigator: { onLine: true },
        document: { visibilityState: 'visible', addEventListener() {} },
        addEventListener() {},
        AloStorage: storage,
        AloLogic: logic,
        AloApi: api
    });
    context.window = context;
    loadScript(context, 'sync.js');

    const manager = new context.AloSync({ getUrl: () => 'https://server.test', onOrders() {}, onState() {} });
    manager.schedule = () => {};

    return {
        manager,
        localOrders,
        operations,
        remoteOrders,
        postPayloads,
        requestLog,
        setFailPost(value) { failPost = value; }
    };
}

async function testAcceptAndConfirm() {
    const harness = createSyncHarness();
    const order = { id: '1', produto: 'Feijão', status: 'pendente', timestamp: new Date().toISOString() };
    harness.manager.orders = [order];
    harness.localOrders.set('1', order);
    harness.remoteOrders.set('1', order);

    await harness.manager.enqueueStatus('1', 'fazendo');
    assert.equal(harness.manager.orders[0].status, 'fazendo');
    await harness.manager.syncNow(true);
    assert.equal(harness.remoteOrders.get('1').status, 'fazendo');
    assert.equal(harness.operations.size, 0);
}

async function testOfflineRetry() {
    const harness = createSyncHarness();
    const order = { id: '2', produto: 'Arroz', status: 'pendente', timestamp: new Date().toISOString() };
    harness.manager.orders = [order];
    harness.localOrders.set('2', order);
    harness.remoteOrders.set('2', order);

    await harness.manager.enqueueStatus('2', 'fazendo');
    harness.setFailPost(true);
    await harness.manager.syncNow(true);
    assert.equal(harness.operations.size, 1);
    assert.equal(harness.manager.orders[0].status, 'fazendo');

    harness.setFailPost(false);
    for (const operation of harness.operations.values()) operation.nextAttemptAt = 0;
    await harness.manager.syncNow(true);
    assert.equal(harness.remoteOrders.get('2').status, 'fazendo');
    assert.equal(harness.operations.size, 0);
}

async function testDeleteDoesNotReturn() {
    const harness = createSyncHarness();
    const order = { id: '3', produto: 'Couve', status: 'pendente', timestamp: new Date().toISOString() };
    harness.manager.orders = [order];
    harness.localOrders.set('3', order);
    harness.remoteOrders.set('3', order);

    await harness.manager.enqueueDelete('3');
    assert.equal(harness.manager.orders.length, 0);
    await harness.manager.syncNow(true);
    assert.equal(harness.remoteOrders.has('3'), false);
    assert.equal(harness.manager.orders.length, 0);
    assert.equal(harness.operations.size, 0);
}

async function testNewOrderKeepsAreaRoute() {
    const harness = createSyncHarness();
    const local = await harness.manager.enqueueNewOrder({
        produto: 'Suco', areaOrigem: 'caixa', areaDestino: 'bar'
    });
    assert.equal(local.areaOrigem, 'caixa');
    assert.equal(local.areaDestino, 'bar');
    const operation = [...harness.operations.values()][0];
    assert.equal(operation.payload.areaOrigem, 'caixa');
    assert.equal(operation.payload.areaDestino, 'bar');
    await harness.manager.syncNow(true);
    const remote = harness.remoteOrders.get(local.id);
    assert.equal(remote.areaOrigem, 'caixa');
    assert.equal(remote.areaDestino, 'bar');

    const second = await harness.manager.enqueueNewOrder({
        produto: 'Suco', areaOrigem: 'panelas', areaDestino: 'bar'
    });
    assert.notEqual(second.id, local.id);
    await harness.manager.syncNow(true);
    assert.equal(harness.remoteOrders.get(second.id).areaOrigem, 'panelas');
    assert.equal(harness.remoteOrders.get(second.id).areaDestino, 'bar');
}

async function testNewOrdersUseSingleBatch() {
    const harness = createSyncHarness();
    harness.manager.serverProtocol = 'modern';
    harness.manager.supportsCreateBatch = true;
    await harness.manager.enqueueNewOrder({ produto: 'Feijão', areaOrigem: 'panelas', areaDestino: 'cozinha' });
    await harness.manager.enqueueNewOrder({ produto: 'Arroz', areaOrigem: 'panelas', areaDestino: 'cozinha' });
    await harness.manager.enqueueNewOrder({ produto: 'Couve', areaOrigem: 'panelas', areaDestino: 'cozinha' });

    await harness.manager.syncNow(true, true);

    assert.equal(harness.postPayloads.length, 1, 'pedidos acumulados devem usar uma única chamada');
    assert.equal(harness.postPayloads[0].action, 'novo_pedido_lote');
    assert.equal(harness.postPayloads[0].pedidos.length, 3);
    assert.deepEqual(harness.requestLog.slice(0, 2), ['post:novo_pedido_lote', 'get'], 'o envio deve acontecer antes da confirmação');
    assert.equal(harness.remoteOrders.size, 3);
    assert.equal(harness.operations.size, 0);
}

async function testOldServerFallsBackToIndividualOrders() {
    const harness = createSyncHarness();
    harness.manager.serverProtocol = 'modern';
    harness.manager.supportsCreateBatch = false;
    await harness.manager.enqueueNewOrder({ produto: 'Feijão', areaOrigem: 'panelas', areaDestino: 'cozinha' });
    await harness.manager.enqueueNewOrder({ produto: 'Arroz', areaOrigem: 'panelas', areaDestino: 'cozinha' });

    await harness.manager.syncNow(true, true);

    assert.deepEqual(harness.postPayloads.map(payload => payload.action), ['novo_pedido', 'novo_pedido']);
    assert.equal(harness.remoteOrders.size, 2);
    assert.equal(harness.operations.size, 0);
}

async function testSameStatusFromAnotherDeviceClearsQueue() {
    const harness = createSyncHarness();
    const order = { id: 'multi-1', produto: 'Feijão', status: 'pendente', revisao: 4, timestamp: new Date().toISOString() };
    harness.manager.orders = [order];
    harness.localOrders.set(order.id, order);
    harness.remoteOrders.set(order.id, order);

    await harness.manager.enqueueStatus(order.id, 'fazendo');
    harness.remoteOrders.set(order.id, { ...order, status: 'fazendo', revisao: 5, operacaoId: 'outro_aparelho' });
    await harness.manager.syncNow(false, true);

    assert.equal(harness.operations.size, 0, 'o mesmo estado confirmado por outro aparelho deve limpar a fila');
    assert.equal(harness.manager.orders[0].status, 'fazendo');
    assert.equal(harness.manager.orders[0].syncState, 'confirmed');
}

async function testNewerRemoteActionWinsOverStaleTablet() {
    const harness = createSyncHarness();
    const order = { id: 'multi-2', produto: 'Arroz', status: 'pendente', revisao: 8, timestamp: new Date().toISOString() };
    harness.manager.orders = [order];
    harness.localOrders.set(order.id, order);
    harness.remoteOrders.set(order.id, order);

    await harness.manager.enqueueStatus(order.id, 'fazendo');
    harness.remoteOrders.set(order.id, {
        ...order,
        status: 'enviado',
        revisao: 9,
        operacaoId: 'acao_mais_nova',
        finalizadoEm: new Date().toISOString()
    });
    await harness.manager.syncNow(true, true);

    assert.equal(harness.operations.size, 0, 'uma ação atrasada não deve permanecer reenviando');
    assert.equal(harness.manager.orders[0].status, 'enviado', 'o estado mais novo do servidor deve prevalecer');
    assert.equal(harness.remoteOrders.get(order.id).status, 'enviado');
}

async function testOldOrphanQueueIsCleaned() {
    const harness = createSyncHarness();
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const order = { id: 'orphan-1', produto: 'Chá', status: 'fazendo', revisao: 2, timestamp: yesterday };
    harness.manager.orders = [order];
    harness.localOrders.set(order.id, order);
    harness.operations.set('old-status', {
        operationId: 'old-status',
        type: 'status',
        orderId: order.id,
        payload: { id: order.id, novoStatus: 'fazendo' },
        createdAt: Date.now() - 120000,
        attempts: 3,
        nextAttemptAt: Date.now() + 60000
    });

    await harness.manager.syncNow(false, true);

    assert.equal(harness.operations.size, 0, 'pendência antiga sem pedido no servidor deve ser removida');
    assert.equal(harness.manager.orders.length, 0, 'pedido ativo órfão não deve reaparecer no aparelho');
}

function testAppsScriptRejectsStaleStatus() {
    const context = vm.createContext({ console, Date, Set });
    loadScript(context, 'google-apps-script.gs');
    context.testRow = ['srv-1', 'Feijão', 'fazendo', new Date().toISOString(), '', '', '', 5, 'acao_atual', 'panelas', 'cozinha'];

    const staleApplied = vm.runInContext(
        "applyStatus_(testRow, 'enviado', '', 'acao_atrasada', 'pendente', 4, 6)",
        context
    );
    assert.equal(staleApplied, false);
    assert.equal(context.testRow[2], 'fazendo');

    const currentApplied = vm.runInContext(
        "applyStatus_(testRow, 'enviado', '', 'acao_valida', 'fazendo', 5, 6)",
        context
    );
    assert.equal(currentApplied, true);
    assert.equal(context.testRow[2], 'enviado');
    assert.equal(context.testRow[7], 6);
}

function testAppsScriptAppendsOrderBatchOnce() {
    const properties = new Map([['kds_pedidos_revision', '7']]);
    const writes = [];
    const context = vm.createContext({
        console,
        Date,
        Set,
        PropertiesService: {
            getDocumentProperties() {
                return {
                    getProperty(key) { return properties.get(key) || null; },
                    setProperty(key, value) { properties.set(key, String(value)); }
                };
            }
        }
    });
    loadScript(context, 'google-apps-script.gs');
    context.testSheet = {
        getLastRow() { return 1; },
        getRange(row, column, rowCount, columnCount) {
            return { setValues(values) { writes.push({ row, column, rowCount, columnCount, values }); } };
        }
    };
    context.testBatch = [
        { id: 'lote-1', produto: 'Feijão', areaOrigem: 'panelas', areaDestino: 'cozinha' },
        { id: 'lote-2', produto: 'Arroz', areaOrigem: 'panelas', areaDestino: 'cozinha' },
        { id: 'lote-1', produto: 'Duplicado', areaOrigem: 'panelas', areaDestino: 'cozinha' }
    ];

    const result = vm.runInContext('appendNewOrders_(testSheet, testBatch)', context);
    assert.equal(result.count, 2);
    assert.equal(result.revision, 9);
    assert.equal(writes.length, 1, 'o lote deve gerar uma única gravação na planilha');
    assert.equal(writes[0].values.length, 2);
}

function testAppsScriptKeepsActivityIdempotentAndRejectsStaleStatus() {
    const properties = new Map([['kds_atividades_revision', '0']]);
    const rows = [];
    const context = vm.createContext({
        console,
        Date,
        Set,
        PropertiesService: {
            getDocumentProperties() {
                return {
                    getProperty(key) { return properties.get(key) || null; },
                    setProperty(key, value) { properties.set(key, String(value)); }
                };
            }
        }
    });
    loadScript(context, 'google-apps-script.gs');
    context.testSheet = {
        getLastRow() { return rows.length + 1; },
        getRange(row, column, rowCount) {
            return {
                getValues() { return rows.slice(row - 2, row - 2 + rowCount).map(values => values.slice()); },
                setValues(values) {
                    values.forEach((item, index) => { rows[row - 2 + index] = item.slice(); });
                }
            };
        }
    };
    context.activityPending = {
        id: 'atividade-1', tarefaId: 'tarefa-1', nome: 'Limpar chapa', setorId: 'cozinha',
        status: 'pendente', data: '2026-08-04', horario: '18:00', operacaoId: 'op-1',
        atualizadoEm: '2026-08-04T18:00:00.000Z', permiteRemarcacao: true,
        registroPop: true, procedimento: 'Lavar, aplicar produto e registrar.',
        funcionarioNome: 'Ana', remarcadoDe: '2026-08-03', remarcadoEm: '2026-08-03T12:00:00.000Z'
    };
    context.activityStarted = {
        ...context.activityPending, status: 'em_execucao', expectedStatus: 'pendente',
        operacaoId: 'op-2', iniciadoEm: '2026-08-04T18:01:00.000Z',
        atualizadoEm: '2026-08-04T18:01:00.000Z'
    };
    context.activityStale = {
        ...context.activityPending, status: 'concluida', expectedStatus: 'pendente',
        operacaoId: 'op-3', atualizadoEm: '2026-08-04T18:02:00.000Z'
    };

    const inserted = vm.runInContext('saveActivities_(testSheet, [activityPending])', context);
    assert.equal(inserted.count, 1);
    assert.equal(rows[0][5], 'pendente');
    assert.equal(rows[0][18], true);
    assert.equal(rows[0][19], true);
    assert.equal(rows[0][20], 'Lavar, aplicar produto e registrar.');
    assert.equal(rows[0][21], 'Ana');
    assert.equal(rows[0][22], '2026-08-03');

    const duplicate = vm.runInContext('saveActivities_(testSheet, [activityPending])', context);
    assert.equal(duplicate.count, 0, 'a mesma operacao nao pode duplicar a atividade');

    const started = vm.runInContext('saveActivities_(testSheet, [activityStarted])', context);
    assert.equal(started.count, 1);
    assert.equal(rows[0][5], 'em_execucao');

    const stale = vm.runInContext('saveActivities_(testSheet, [activityStale])', context);
    assert.equal(stale.count, 0, 'status antigo de outro aparelho nao deve sobrescrever o atual');
    assert.equal(rows[0][5], 'em_execucao');
}

function testOldClientPreservesV2TaskCatalog() {
    const originalBank = {
        produtos: [{ nome: 'Feijao' }], categorias: [], obsPedidos: [], obsCancelamentos: [], areas: [],
        setoresTarefas: [{ id: 'cozinha', nome: 'Cozinha' }],
        funcionarios: [{ id: 'ana', nome: 'Ana', cargo: 'Auxiliar' }],
        tarefas: [{ id: 'limpar', nome: 'Limpar chapa' }],
        configsTarefas: { som: 'beep', volume: '80' }, configs: {}
    };
    const properties = new Map([
        ['kds_banco_revision', '9'],
        ['kds_banco', JSON.stringify(originalBank)]
    ]);
    const context = vm.createContext({
        console,
        Date,
        Set,
        PropertiesService: {
            getDocumentProperties() {
                return {
                    getProperty(key) { return properties.get(key) || null; },
                    setProperty(key, value) { properties.set(key, String(value)); }
                };
            }
        }
    });
    loadScript(context, 'google-apps-script.gs');
    context.oldClientBank = {
        produtos: [{ nome: 'Arroz' }], categorias: [], obsPedidos: [], obsCancelamentos: [], areas: [], configs: {}
    };

    const result = vm.runInContext('salvarBanco_(oldClientBank, 9)', context);
    const saved = JSON.parse(properties.get('kds_banco'));
    assert.equal(result.status, 'ok');
    assert.equal(result.revision, 10);
    assert.equal(saved.produtos[0].nome, 'Arroz');
    assert.deepEqual(saved.setoresTarefas, originalBank.setoresTarefas);
    assert.deepEqual(saved.funcionarios, originalBank.funcionarios);
    assert.deepEqual(saved.tarefas, originalBank.tarefas);
    assert.deepEqual(saved.configsTarefas, originalBank.configsTarefas);
}

function testPasswordDialogsHaveExplicitConfirmation() {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    [
        'confirmarSenhaModo()',
        'confirmarSenhaAdmin()',
        'confirmarSenhaAvancada()',
        'confirmarSenhaAcao()'
    ].forEach(handler => {
        assert.equal(html.includes('onclick="' + handler + '"'), true, handler + ' precisa de botao visivel');
        assert.equal(html.includes('event.preventDefault(); ' + handler), true, handler + ' precisa funcionar com Enter');
        assert.equal(app.includes('function ' + handler), true, handler + ' precisa estar implementada');
    });
    assert.equal((html.match(/class="senha-feedback"/g) || []).length, 4);
    assert.equal(app.includes('Senha incorreta. Tente novamente.'), true);
}

function testV207TaskExperience() {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const tasks = fs.readFileSync(path.join(root, 'tasks.js'), 'utf8');
    const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
    const css = fs.readFileSync(path.join(root, 'tasks.css'), 'utf8');
    const ui = fs.readFileSync(path.join(root, 'ui.js'), 'utf8');
    const gas = fs.readFileSync(path.join(root, 'google-apps-script.gs'), 'utf8');
    const panel = html.slice(html.indexOf('id="modalPainelUnificado"'), html.indexOf('id="modalConfigKds"'));
    const kdsSettings = html.slice(html.indexOf('id="modalConfigKds"'), html.indexOf('id="modalConfigTasksMenu"'));

    assert.equal(html.includes('KDS - Sistema de Pedidos'), true);
    assert.equal(html.includes('Pedidos por Área'), false);
    assert.equal(html.includes('Rotinas e tarefas'), false);
    assert.equal((html.match(/class="module-wordmark-button"/g) || []).length, 2);
    assert.equal(panel.includes("abrirGerenciar('areas')"), false);
    assert.equal(kdsSettings.includes("abrirGerenciar('areas')"), true);
    assert.equal(html.includes('data-task-tab="total"'), true);
    assert.equal(html.includes('data-task-tab="pendentes"'), true);
    assert.equal(html.includes('data-task-tab="em_execucao"'), true);
    assert.equal(html.includes('id="modalTaskFinished"'), true);
    assert.equal(html.includes('id="modalTaskPop"'), true);
    assert.equal(html.includes('id="modalTaskReschedule"'), true);
    assert.equal((html.match(/class="module-header-switch/g) || []).length, 2);
    assert.equal(html.includes('aria-label="Trocar de módulo"'), true);
    assert.equal(tasks.includes('function undoFinishedTask(targetStatus)'), true);
    assert.equal(tasks.includes('function openReschedule(id)'), true);
    assert.equal(tasks.includes('function confirmPopCompletion()'), true);
    assert.equal(tasks.includes('onclick="AloTasks.openTaskDetails'), true, 'o corpo do cartao deve abrir somente os detalhes');
    assert.equal(tasks.includes('event.stopPropagation();AloTasks.startTask'), true, 'iniciar nao pode disparar o clique do cartao');
    assert.equal(tasks.includes('event.stopPropagation();AloTasks.completeTask'), true, 'concluir nao pode disparar o clique do cartao');
    assert.equal(tasks.includes('taskEmployeeRole'), false, 'o cadastro nao pode pedir cargo');
    assert.equal(tasks.includes('employee.cargo'), false, 'o cargo nao pode aparecer no modulo de tarefas');
    assert.equal(tasks.includes("const today = filtered.filter(activity => activity.data === todayKey())"), true, 'todas as abas devem partir do mesmo dia');
    assert.equal(tasks.includes("items: today.filter(activity => activity.status === 'pendente'"), true, 'Pendentes deve contar apenas as pendencias de hoje');
    assert.equal(tasks.includes("items: today.filter(activity => activity.status === 'concluida')"), true, 'Concluidas deve contar apenas as conclusoes de hoje');
    assert.equal(tasks.includes('inOneHour'), false, 'Hoje deve mostrar todas as atividades do dia');
    assert.equal(tasks.includes('}, 3500);'), true, 'o lembrete deve desaparecer rapidamente dentro do modulo');
    assert.equal(tasks.includes('remarcadoDe: activity.remarcadoDe || activity.data'), true, 'remarcacoes sucessivas devem preservar a data original');
    assert.equal(tasks.includes("selectedTab = 'total'"), true, 'o lembrete deve abrir a aba Total');
    assert.equal(tasks.includes('function procedureHtml(value, requestedFormat'), true, 'procedimentos devem aceitar formato explicito');
    assert.equal(tasks.includes('function openTaskHistory(taskId)'), true, 'relatorios devem abrir o historico por tarefa');
    assert.equal(tasks.includes('Aguardando confirmação'), false, 'cartoes nao devem ocupar espaco com confirmacao de sincronizacao');
    assert.equal(tasks.includes('function returnTaskToPending()'), true, 'uma tarefa em execucao deve poder voltar para pendente');
    assert.equal(tasks.includes('function procedurePreview'), false, 'procedimento nao deve aparecer nos cartoes operacionais');
    assert.equal(tasks.includes('task-completed-meta'), false, 'duracao e POP nao devem aparecer nos cartoes operacionais');
    assert.equal(tasks.includes('Registros POP'), false, 'POP deve ficar integrado ao historico da tarefa');
    assert.equal(tasks.includes('function changeReportArea(value)'), true, 'relatorios precisam de filtro por area');
    assert.equal(tasks.includes('task-report-area-section'), true, 'relatorios precisam agrupar tarefas por area');
    assert.equal(html.indexOf('id="modalTaskHistory"') > html.indexOf('id="modalTaskReports"'), true, 'historico deve ficar acima do relatorio');
    assert.equal(css.includes('#modalTaskHistory { z-index: 1300; }'), true, 'historico precisa de camada superior');
    assert.equal(gas.includes("'ProcedimentoFormato'"), true, 'o formato do procedimento precisa sincronizar entre aparelhos');
    assert.equal(html.includes('kds-header-title'), true, 'o cabecalho deve identificar o KDS');
    assert.equal(html.includes('id="tasksSummary"'), false, 'a faixa redundante de resumo deve ser removida');
    assert.equal(html.includes('id="taskTabTotalCount"'), true, 'Total deve mostrar sua contagem na aba');
    assert.equal(html.includes('id="taskTabPendingCount"'), true, 'Pendentes deve mostrar sua contagem na aba');
    assert.equal(html.includes('id="taskTabRunningCount"'), true, 'Em execucao deve mostrar sua contagem na aba');
    assert.equal(html.includes('id="taskTabCompletedCount"'), true, 'Concluidas deve mostrar sua contagem na aba');
    assert.equal(html.includes("abrirLoginAdmin('kds')"), true, 'o KDS deve abrir somente suas configuracoes');
    assert.equal(html.includes("abrirLoginAdmin('tasks')"), true, 'Atividades deve abrir somente suas configuracoes');
    assert.equal(html.includes('module-choice-settings'), true, 'a tela inicial deve oferecer o painel completo');
    assert.equal(tasks.includes('function formatRichEditor(editorId, command)'), true, 'o procedimento deve usar editor formatado');
    assert.equal(tasks.includes('function cycleRichEditorAlignment(editorId, button)'), true, 'o editor deve ter um unico controle ciclico de alinhamento');
    assert.equal(tasks.includes("format === 'rico' || hasRichMarkup(value)"), true, 'procedimentos antigos com HTML devem ser reconhecidos');
    assert.equal(tasks.includes('function normalizeRichEditorLists(editor)'), true, 'trocar marcadores nao pode criar itens vazios');
    assert.equal(tasks.includes("procedimentoFormato: 'rico'"), true, 'o formato rico deve ser salvo');
    assert.equal(html.includes('id="taskPopObservation" class="task-rich-editor" contenteditable="true"'), true, 'a observacao POP deve usar o editor fixo');
    assert.equal(html.includes('<textarea id="taskPopObservation"'), false, 'a observacao nao deve ser redimensionavel');
    assert.equal(tasks.includes("title=\"Não foi feita\">❌"), true, 'nao realizada deve usar o X vermelho');
    assert.equal(tasks.includes('function toggleTaskStatusEditMenu()'), true, 'o lapis deve abrir as correcoes de estado');
    assert.equal(tasks.includes('function positionTaskStatusEditMenu()'), true, 'as correcoes devem abrir junto ao lapis');
    assert.equal(tasks.includes("runTaskDetailAction('start')"), true, 'detalhes pendentes devem permitir iniciar');
    assert.equal(tasks.includes("runTaskDetailAction('complete')"), true, 'detalhes devem permitir concluir');
    assert.equal(tasks.includes('const procedure = item.procedimento'), false, 'o historico nao deve repetir o procedimento');
    assert.equal(css.includes('.task-detail-status.running { color: #733fa0; }'), true, 'Em execucao deve aparecer em roxo');
    assert.equal(app.includes("let destinoConfiguracoes = 'painel'"), true, 'o painel deve lembrar de onde as configuracoes foram abertas');
    assert.equal(app.includes("destinoConfiguracoes === 'tasks'"), true, 'as configuracoes de atividades devem voltar ao modulo');
    assert.equal(css.includes('background: #fde8e8'), true);
    assert.equal(css.includes('background: #eee5f6'), true);
    assert.equal(css.includes('background: #e4f3e7'), true);
    assert.equal(html.includes('id="areaPickerOptions"'), true, 'o KDS deve usar seletor de area com emojis');
    assert.equal(app.includes('function selecionarAreaCabecalho(areaId)'), true, 'o seletor visual deve trocar a area');
    assert.equal(ui.includes('global.AloUiDialog'), true, 'dialogos do app devem substituir caixas do navegador');
    const appWithoutDialogApi = app.replaceAll('AloUiDialog.confirm(', '').replaceAll('AloUiDialog.prompt(', '');
    const tasksWithoutDialogApi = tasks.replaceAll('global.AloUiDialog.confirm(', '');
    assert.equal(/\bconfirm\(/.test(appWithoutDialogApi) || /\bprompt\(/.test(appWithoutDialogApi) || /\bconfirm\(/.test(tasksWithoutDialogApi), false, 'nao pode restar dialogo nativo');
}

function testAudioMode() {
    let playCount = 0;
    const classes = new Set();
    class FakeAudio {
        constructor() { this.paused = true; this.src = ''; }
        play() { this.paused = false; playCount += 1; return Promise.resolve(); }
        pause() { this.paused = true; }
    }
    const header = { classList: { add: value => classes.add(value), remove: (...values) => values.forEach(value => classes.delete(value)) } };
    const context = vm.createContext({
        console,
        Audio: FakeAudio,
        Math,
        Date,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        navigator: {},
        document: { getElementById: id => id === 'mainHeader' ? header : null },
        AloLogic: { isToday: () => true }
    });
    context.window = context;
    loadScript(context, 'audio.js');
    context.AloAudio.manage({
        mode: 'cozinha',
        configs: { somCozinha: 'alarme', volumeCozinha: 100 },
        orders: [{ id: '4', status: 'pendente', timestamp: new Date().toISOString() }],
        knownIds: new Set()
    });
    assert.equal(classes.has('alerta-pisca'), true);
    assert.equal(playCount, 1);
    context.AloAudio.stop();

    context.AloAudio.manage({
        mode: 'panelas',
        configs: { somPanelas: 'sem_som', volumePanelas: 70 },
        orders: [{ id: '5', status: 'cancelado', finalizadoEm: new Date().toISOString() }],
        knownIds: new Set()
    });
    assert.equal(classes.has('alerta-pisca-buscar'), true);
    assert.equal(playCount, 2, 'cancelamento novo deve beepar mesmo com o som comum desativado');

    context.AloAudio.manage({
        mode: 'panelas',
        configs: { somPanelas: 'sem_som', volumePanelas: 70 },
        orders: [{ id: '5', status: 'cancelado', finalizadoEm: new Date().toISOString() }],
        knownIds: new Set(['5'])
    });
    assert.equal(classes.has('alerta-pisca-buscar'), false);
    context.AloAudio.stop();
}

async function testCatalogAutoPublish() {
    let revision = 4;
    let postCount = 0;
    let remote = { _revision: revision, produtos: [], categorias: [], obsPedidos: [], obsCancelamentos: [], areas: [], setoresTarefas: [], funcionarios: [], tarefas: [], configsTarefas: {}, configs: {} };
    let conflict = false;
    const context = vm.createContext({ console, setTimeout, clearTimeout });
    context.window = context;
    loadScript(context, 'catalog-sync.js');

    const api = {
        async getBank() { return JSON.parse(JSON.stringify(remote)); },
        async post(url, payload) {
            postCount += 1;
            if (conflict) {
                revision += 1;
                remote = { ...remote, _revision: revision, produtos: [{ nome: 'Outro aparelho' }] };
                return;
            }
            revision += 1;
            remote = { ...JSON.parse(JSON.stringify(payload.dados)), _revision: revision };
        }
    };
    const data = {
        produtos: [{ nome: 'Feijão' }], categorias: [], obsPedidos: [], obsCancelamentos: [], areas: [],
        setoresTarefas: [], funcionarios: [], tarefas: [], configsTarefas: {}, configs: { volumeCozinha: '100' }
    };

    const published = await context.AloCatalogSync.publish({ api, url: 'https://server.test', data, wait: async () => {} });
    assert.equal(published.confirmed, true);
    assert.equal(published.revision, 5);
    assert.equal(postCount, 1);

    const alreadyCurrent = await context.AloCatalogSync.publish({ api, url: 'https://server.test', data, wait: async () => {} });
    assert.equal(alreadyCurrent.confirmed, true);
    assert.equal(alreadyCurrent.sent, false);
    assert.equal(postCount, 1);

    conflict = true;
    const changedData = { ...data, produtos: [{ nome: 'Arroz' }] };
    const conflicted = await context.AloCatalogSync.publish({ api, url: 'https://server.test', data: changedData, wait: async () => {} });
    assert.equal(conflicted.confirmed, false);
}

(async () => {
    await testAcceptAndConfirm();
    await testOfflineRetry();
    await testDeleteDoesNotReturn();
    await testNewOrderKeepsAreaRoute();
    await testNewOrdersUseSingleBatch();
    await testOldServerFallsBackToIndividualOrders();
    await testSameStatusFromAnotherDeviceClearsQueue();
    await testNewerRemoteActionWinsOverStaleTablet();
    await testOldOrphanQueueIsCleaned();
    testAppsScriptRejectsStaleStatus();
    testAppsScriptAppendsOrderBatchOnce();
    testAppsScriptKeepsActivityIdempotentAndRejectsStaleStatus();
    testOldClientPreservesV2TaskCatalog();
    testPasswordDialogsHaveExplicitConfirmation();
    testV207TaskExperience();
    testAudioMode();
    await testCatalogAutoPublish();
    console.log('Testes críticos da v2.0.7 passaram.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
