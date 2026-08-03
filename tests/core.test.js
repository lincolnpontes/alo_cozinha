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
            return { status: 'ok', changed: true, revision, pedidos: [...remoteOrders.values()] };
        },
        async post(url, payload) {
            if (failPost) throw new Error('offline');
            if (payload.action === 'novo_pedido') {
                remoteOrders.set(String(payload.id), {
                    id: String(payload.id), produto: payload.produto, status: 'pendente',
                    timestamp: new Date().toISOString(), areaOrigem: payload.areaOrigem,
                    areaDestino: payload.areaDestino, operacaoId: payload.operationId
                });
            } else if (payload.action === 'atualizar_status_lote') {
                payload.updates.forEach(update => {
                    const order = remoteOrders.get(String(update.id));
                    if (order) remoteOrders.set(String(update.id), { ...order, status: update.novoStatus, motivo: update.motivo || '', operacaoId: update.operationId });
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

(async () => {
    await testAcceptAndConfirm();
    await testOfflineRetry();
    await testDeleteDoesNotReturn();
    await testNewOrderKeepsAreaRoute();
    testAudioMode();
    console.log('Testes críticos da v1.4.3 passaram.');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
