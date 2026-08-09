(function (global) {
    const STORAGE_ACTIVITIES = 'alo_tasks_activities_v2';
    const STORAGE_OUTBOX = 'alo_tasks_outbox_v2';
    const STORAGE_REVISION = 'alo_tasks_revision_v2';
    const STORAGE_SELECTED_AREA = 'alo_tasks_selected_area_v2';
    const SOUND_FILES = {
        beep: './assets/sounds/beep-classico.ogg',
        alarme: './assets/sounds/alarme-curto.ogg',
        sino_forte: './assets/sounds/sino-forte.ogg'
    };

    let deps = null;
    let activities = [];
    let outbox = [];
    let revision = localStorage.getItem(STORAGE_REVISION) || '';
    let selectedTab = 'hoje';
    let selectedArea = localStorage.getItem(STORAGE_SELECTED_AREA) || 'todos';
    let activeModule = 'home';
    let syncRunning = false;
    let syncTimer = null;
    let alarmTimer = null;
    let alarmAudio = null;
    let currentAlarmId = '';
    let lastAlarmSoundAt = 0;
    let alarmBannerTimer = null;
    let hiddenAlarmId = '';
    let managerType = '';
    let formState = { type: '', index: -1 };
    let pendingEmployeeAction = null;
    let pendingPopCompletion = null;
    let finishedActivityId = '';
    let rescheduleActivityId = '';
    let reportActivitiesCache = [];
    let initialized = false;

    function db() { return deps.getDatabase(); }
    function nowIso() { return new Date().toISOString(); }
    function todayKey(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    function createId(prefix) {
        if (global.crypto && crypto.randomUUID) return `${prefix}_${crypto.randomUUID()}`;
        return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }
    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>'"]/g, char => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[char]));
    }
    function parseJson(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
        catch (error) { return fallback; }
    }
    function normalizeActivity(activity) {
        return {
            id: String(activity.id || ''),
            tarefaId: String(activity.tarefaId || ''),
            nome: activity.nome || '',
            setorId: String(activity.setorId || ''),
            funcionarioId: String(activity.funcionarioId || ''),
            status: activity.status || 'pendente',
            data: activity.data || todayKey(),
            horario: activity.horario || '00:00',
            iniciadoEm: activity.iniciadoEm || '',
            finalizadoEm: activity.finalizadoEm || '',
            duracaoSegundos: Number(activity.duracaoSegundos || 0),
            alarmeStatus: activity.alarmeStatus || 'aguardando',
            atualizadoEm: activity.atualizadoEm || nowIso(),
            revisao: Number(activity.revisao || 0),
            operacaoId: activity.operacaoId || '',
            prioridade: activity.prioridade || 'normal',
            tempoEsperadoMin: Number(activity.tempoEsperadoMin || 0),
            observacao: activity.observacao || '',
            funcionarioNome: activity.funcionarioNome || '',
            permiteRemarcacao: Boolean(activity.permiteRemarcacao),
            registroPop: Boolean(activity.registroPop),
            procedimento: activity.procedimento || '',
            remarcadoDe: activity.remarcadoDe || '',
            remarcadoEm: activity.remarcadoEm || '',
            syncState: activity.syncState || 'confirmed'
        };
    }
    function normalizeDefinitions() {
        const data = db();
        if (!Array.isArray(data.setoresTarefas) || !data.setoresTarefas.length) {
            data.setoresTarefas = [{ id: 'setor_cozinha', nome: 'Cozinha', emoji: '🧑‍🍳', ativo: true }];
        }
        if (!Array.isArray(data.funcionarios)) data.funcionarios = [];
        data.funcionarios = data.funcionarios.map(employee => ({
            id: employee.id,
            nome: employee.nome || '',
            setorId: employee.setorId || '',
            ativo: employee.ativo !== false
        }));
        if (!Array.isArray(data.tarefas)) data.tarefas = [];
        data.configsTarefas = {
            som: 'beep', volume: '80', repeticaoMinutos: '5',
            ...(data.configsTarefas || {})
        };
    }
    function saveRuntime() {
        localStorage.setItem(STORAGE_ACTIVITIES, JSON.stringify(activities));
        localStorage.setItem(STORAGE_OUTBOX, JSON.stringify(outbox));
        localStorage.setItem(STORAGE_REVISION, revision);
    }
    function getArea(id) {
        return db().setoresTarefas.find(area => area.id === id) || { id, nome: 'Sem setor', emoji: '📍' };
    }
    function getEmployee(id) {
        return db().funcionarios.find(employee => employee.id === id) || null;
    }
    function scheduledDate(activity) {
        return new Date(`${activity.data}T${activity.horario || '00:00'}:00`);
    }
    function appliesToday(template, date = new Date()) {
        if (!template.ativo) return false;
        if (template.recorrencia === 'unica') return template.dataUnica === todayKey(date);
        const days = Array.isArray(template.dias) ? template.dias.map(Number) : [];
        return template.recorrencia === 'diaria' || days.includes(date.getDay());
    }
    function generateToday() {
        const key = todayKey();
        const existing = new Set(activities.map(activity => activity.id));
        db().tarefas.filter(task => appliesToday(task)).forEach(task => {
            const id = `atividade_${task.id}_${key}`;
            if (existing.has(id)) return;
            const activity = normalizeActivity({
                id,
                tarefaId: task.id,
                nome: task.nome,
                setorId: task.setorId,
                funcionarioId: task.funcionarioId || '',
                data: key,
                horario: task.horario,
                prioridade: task.prioridade,
                tempoEsperadoMin: task.tempoEsperadoMin,
                permiteRemarcacao: Boolean(task.permiteRemarcacao),
                registroPop: Boolean(task.registroPop),
                procedimento: task.instrucoes || '',
                alarmeStatus: task.alarme ? 'aguardando' : 'desativado',
                status: 'pendente',
                atualizadoEm: nowIso(),
                syncState: navigator.onLine ? 'queued' : 'offline'
            });
            queueActivity(activity, '', false);
            existing.add(id);
        });
        saveRuntime();
    }
    function upsertActivity(activity) {
        const index = activities.findIndex(item => item.id === activity.id);
        if (index === -1) activities.push(activity);
        else activities[index] = activity;
        activities.sort((a, b) => scheduledDate(a) - scheduledDate(b));
    }
    function queueActivity(activity, expectedStatus, rerender = true) {
        const operationId = createId('atividade');
        const queued = normalizeActivity({
            ...activity,
            expectedStatus: expectedStatus || undefined,
            operacaoId: operationId,
            atualizadoEm: nowIso(),
            syncState: navigator.onLine ? 'queued' : 'offline'
        });
        queued.expectedStatus = expectedStatus || undefined;
        outbox = outbox.filter(item => item.activityId !== queued.id);
        outbox.push({ operationId, activityId: queued.id, payload: { ...queued, syncState: undefined }, createdAt: Date.now() });
        upsertActivity(queued);
        saveRuntime();
        if (rerender) {
            render();
            checkAlarms();
        }
        scheduleSync(0);
        return queued;
    }
    function mergeRemote(remoteActivities) {
        const remoteById = new Map(remoteActivities.map(item => {
            const normalized = normalizeActivity({ ...item, syncState: 'confirmed' });
            return [normalized.id, normalized];
        }));
        const pendingById = new Map(outbox.map(item => [item.activityId, item]));

        outbox = outbox.filter(operation => {
            const remote = remoteById.get(operation.activityId);
            if (!remote) return true;
            const payload = operation.payload;
            const confirmed = remote.status === payload.status && remote.alarmeStatus === payload.alarmeStatus;
            const superseded = payload.expectedStatus && remote.status !== payload.expectedStatus && remote.status !== payload.status;
            return !(confirmed || superseded);
        });

        const stillPending = new Map(outbox.map(item => [item.activityId, item]));
        const localById = new Map(activities.map(item => [item.id, item]));
        remoteById.forEach((remote, id) => {
            if (stillPending.has(id)) return;
            localById.set(id, remote);
        });
        activities = Array.from(localById.values()).sort((a, b) => scheduledDate(a) - scheduledDate(b));
        saveRuntime();
    }
    function setSyncIndicator(state, count = outbox.length) {
        const indicator = document.getElementById('tasksSyncIndicator');
        if (!indicator) return;
        if (syncRunning) { indicator.innerText = '↻'; indicator.title = 'Sincronizando tarefas'; return; }
        if (count) { indicator.innerText = `📤 ${count}`; indicator.title = `${count} alteração(ões) aguardando confirmação`; return; }
        indicator.innerText = state === 'offline' ? '🔴' : '🟢';
        indicator.title = state === 'offline' ? 'Sem conexão' : 'Tarefas sincronizadas';
    }
    async function syncNow(force = false) {
        if (syncRunning) return;
        const url = deps.getUrl();
        if (!url || !navigator.onLine) { setSyncIndicator('offline'); return; }
        syncRunning = true;
        setSyncIndicator('syncing');
        try {
            const sent = outbox.length > 0;
            if (sent) {
                await global.AloApi.post(url, {
                    action: 'salvar_atividades_lote',
                    atividades: outbox.slice(0, 40).map(item => item.payload)
                });
            }
            const response = await global.AloApi.syncActivities(url, sent || force ? '' : revision);
            if (!response || response.status !== 'ok') throw new Error('Resposta inválida.');
            if (response.changed) mergeRemote(Array.isArray(response.atividades) ? response.atividades : []);
            if (response.revision !== undefined) revision = String(response.revision);
            saveRuntime();
            setSyncIndicator('online');
            render();
            checkAlarms();
        } catch (error) {
            activities = activities.map(activity => outbox.some(item => item.activityId === activity.id)
                ? { ...activity, syncState: 'offline' }
                : activity);
            saveRuntime();
            setSyncIndicator('offline');
        } finally {
            syncRunning = false;
            setSyncIndicator(navigator.onLine ? 'online' : 'offline');
            scheduleSync();
        }
    }
    function scheduleSync(delay) {
        if (syncTimer) clearTimeout(syncTimer);
        const wait = delay !== undefined ? delay : (document.visibilityState === 'visible' ? 2000 : 8000);
        syncTimer = setTimeout(() => syncNow(false), wait);
    }

    function renderAreaOptions() {
        const select = document.getElementById('tasksAreaFilter');
        if (!select) return;
        const activeAreas = db().setoresTarefas.filter(area => area.ativo !== false);
        select.innerHTML = '<option value="todos">Todos os setores</option>' + activeAreas.map(area =>
            `<option value="${escapeHtml(area.id)}">${escapeHtml(area.emoji)} ${escapeHtml(area.nome)}</option>`
        ).join('');
        if (!activeAreas.some(area => area.id === selectedArea)) selectedArea = 'todos';
        select.value = selectedArea;
    }
    function taskTiming(activity) {
        const scheduled = scheduledDate(activity);
        const now = new Date();
        const overdue = activity.status === 'pendente' && scheduled < now;
        const future = activity.status === 'pendente' && scheduled > now;
        return { scheduled, overdue, future };
    }
    function isFinalStatus(status) {
        return ['concluida', 'nao_realizada', 'cancelada'].includes(status);
    }
    function sortBySchedule(left, right) {
        return scheduledDate(left) - scheduledDate(right);
    }
    function sortByStarted(left, right) {
        return new Date(left.iniciadoEm || left.atualizadoEm) - new Date(right.iniciadoEm || right.atualizadoEm);
    }
    function sortByFinished(left, right) {
        return new Date(right.finalizadoEm || right.atualizadoEm) - new Date(left.finalizadoEm || left.atualizadoEm);
    }
    function activityGroups() {
        const now = new Date();
        const filtered = activities.filter(activity => selectedArea === 'todos' || activity.setorId === selectedArea);
        const today = filtered.filter(activity => activity.data === todayKey());

        if (selectedTab === 'hoje') {
            return [
                {
                    title: 'Pendentes',
                    items: today.filter(activity => activity.status === 'pendente').sort(sortBySchedule)
                },
                {
                    title: 'Em execução',
                    items: today.filter(activity => activity.status === 'em_execucao').sort(sortByStarted)
                },
                {
                    title: 'Concluídas',
                    items: today.filter(activity => activity.status === 'concluida').sort(sortByFinished)
                },
                {
                    title: 'Não realizadas',
                    items: today.filter(activity => ['nao_realizada', 'cancelada'].includes(activity.status)).sort(sortByFinished)
                }
            ].filter(group => group.items.length);
        }

        if (selectedTab === 'pendentes') {
            return [
                {
                    title: 'Atrasadas',
                    items: today.filter(activity => activity.status === 'pendente' && scheduledDate(activity) < now).sort(sortBySchedule)
                },
                {
                    title: 'Mais tarde',
                    items: today.filter(activity => activity.status === 'pendente' && scheduledDate(activity) >= now).sort(sortBySchedule)
                }
            ].filter(group => group.items.length);
        }

        return [{
            title: 'Concluídas',
            items: today.filter(activity => activity.status === 'concluida').sort(sortByFinished)
        }].filter(group => group.items.length);
    }
    function formatTime(value) { return value || '--:--'; }
    function formatDuration(seconds) {
        const total = Number(seconds || 0);
        if (!total) return 'sem medição';
        if (total < 60) return '< 1 min';
        const minutes = Math.round(total / 60);
        if (minutes < 60) return `${minutes} min`;
        const hours = Math.floor(minutes / 60);
        return `${hours}h ${minutes % 60}min`;
    }
    function procedureHtml(value) {
        const lines = String(value || '').replace(/\r/g, '').split('\n');
        const blocks = [];
        let listType = '';
        let listItems = [];
        const flushList = () => {
            if (!listItems.length) return;
            const tag = listType === 'ordered' ? 'ol' : 'ul';
            blocks.push(`<${tag}>${listItems.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>`);
            listType = '';
            listItems = [];
        };
        lines.forEach(line => {
            const text = line.trim();
            if (!text) {
                flushList();
                return;
            }
            const bullet = text.match(/^[-*•]\s+(.+)$/);
            const numbered = text.match(/^\d+[.)]\s+(.+)$/);
            if (bullet || numbered) {
                const nextType = numbered ? 'ordered' : 'unordered';
                if (listType && listType !== nextType) flushList();
                listType = nextType;
                listItems.push((bullet || numbered)[1]);
                return;
            }
            flushList();
            blocks.push(`<p>${escapeHtml(text)}</p>`);
        });
        flushList();
        return blocks.join('');
    }
    function procedurePreview(value) {
        return String(value || '').replace(/\r/g, '').split('\n').map(line => line.trim().replace(/^([-*•]|\d+[.)])\s+/, '')).find(Boolean) || '';
    }
    function render() {
        if (!initialized) return;
        renderAreaOptions();
        document.querySelectorAll('[data-task-tab]').forEach(button => {
            button.classList.toggle('active', button.dataset.taskTab === selectedTab);
        });
        const list = document.getElementById('tasksList');
        const summary = document.getElementById('tasksSummary');
        if (!list || !summary) return;
        const groups = activityGroups();
        const allToday = activities.filter(item => item.data === todayKey() && (selectedArea === 'todos' || item.setorId === selectedArea));
        const overdueCount = allToday.filter(item => taskTiming(item).overdue).length;
        const runningCount = allToday.filter(item => item.status === 'em_execucao').length;
        summary.innerHTML = `<span>${allToday.length} hoje</span><span>${runningCount} em execução</span>${overdueCount ? `<span class="task-summary-late">${overdueCount} atrasada(s)</span>` : ''}`;
        if (!groups.length) {
            const text = selectedTab === 'hoje' ? 'Nenhuma atividade programada para hoje.' : (selectedTab === 'pendentes' ? 'Nenhuma atividade pendente.' : 'Nenhuma atividade concluída hoje.');
            list.innerHTML = `<li class="tasks-empty">${text}</li>`;
            return;
        }
        const renderCard = activity => {
            const area = getArea(activity.setorId);
            const employee = getEmployee(activity.funcionarioId);
            const timing = taskTiming(activity);
            const template = db().tarefas.find(item => item.id === activity.tarefaId) || {};
            const canReschedule = activity.permiteRemarcacao || template.permiteRemarcacao;
            const stateClass = activity.status === 'em_execucao' ? 'running' : (timing.overdue ? 'late' : activity.status);
            const statusText = activity.status === 'em_execucao' ? 'Em execução' : (timing.overdue ? 'Atrasada' : activity.status === 'concluida' ? 'Concluída' : activity.status === 'nao_realizada' ? 'Não realizada' : activity.status === 'cancelada' ? 'Cancelada' : 'Pendente');
            let actions = '';
            if (activity.status === 'pendente') {
                actions = `<button class="task-primary-action" onclick="event.stopPropagation();AloTasks.startTask('${activity.id}')">▶ Iniciar</button><button class="task-complete-action" onclick="event.stopPropagation();AloTasks.completeTask('${activity.id}', true)">✓ Concluir</button>${canReschedule ? `<button class="task-reschedule-action" onclick="event.stopPropagation();AloTasks.openReschedule('${activity.id}')" aria-label="Remarcar atividade" title="Remarcar">📅</button>` : ''}<button class="task-skip-action" onclick="event.stopPropagation();AloTasks.markTaskNotDone('${activity.id}')" aria-label="Marcar como não realizada" title="Não foi feita">⚠</button>`;
            } else if (activity.status === 'em_execucao') {
                actions = `<button class="task-complete-action" onclick="event.stopPropagation();AloTasks.completeTask('${activity.id}', false)">✓ Concluir</button>${canReschedule ? `<button class="task-reschedule-action" onclick="event.stopPropagation();AloTasks.openReschedule('${activity.id}')" aria-label="Remarcar atividade" title="Remarcar">📅</button>` : ''}`;
            }
            const detailsAction = ` onclick="AloTasks.openTaskDetails('${activity.id}')" onkeydown="if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();AloTasks.openTaskDetails('${activity.id}')}" tabindex="0" aria-label="Abrir detalhes de ${escapeHtml(activity.nome)}"`;
            const preview = procedurePreview(activity.procedimento || template.instrucoes);
            return `<article class="task-card ${stateClass} details-clickable" id="task-${escapeHtml(activity.id)}"${detailsAction}>
                <div class="task-card-main">
                    <div class="task-time">${formatTime(activity.horario)}</div>
                    <div class="task-card-copy"><strong>${escapeHtml(activity.nome)}</strong><span>${escapeHtml(area.emoji)} ${escapeHtml(area.nome)}${employee ? ` · ${escapeHtml(employee.nome)}` : ''}</span>${preview ? `<small>${escapeHtml(preview)}</small>` : ''}</div>
                    <div class="task-card-side"><div class="task-status">${activity.prioridade === 'urgente' ? '<b>URGENTE</b>' : ''}<span>${statusText}</span></div>${actions ? `<div class="task-card-actions">${actions}</div>` : ''}</div>
                </div>
                ${activity.status === 'concluida' ? `<div class="task-completed-meta">${activity.registroPop ? 'POP registrado · ' : ''}${activity.iniciadoEm ? `Tempo: ${formatDuration(activity.duracaoSegundos)}` : 'Concluída sem iniciar'}</div>` : ''}
            </article>`;
        };
        list.innerHTML = groups.map(group => `<li class="task-section"><div class="task-section-title">${group.title}<span>${group.items.length}</span></div><div class="task-section-grid">${group.items.map(renderCard).join('')}</div></li>`).join('');
    }

    function employeesForActivity(activity) {
        return db().funcionarios.filter(employee => employee.ativo !== false && (!employee.setorId || employee.setorId === activity.setorId));
    }
    function requestEmployee(activity, action, direct) {
        const employees = employeesForActivity(activity);
        if (activity.funcionarioId || !employees.length) return false;
        pendingEmployeeAction = { activityId: activity.id, action, direct };
        const select = document.getElementById('taskExecutionEmployee');
        select.innerHTML = '<option value="">Qualquer pessoa da área</option>' + employees.map(employee =>
            `<option value="${escapeHtml(employee.id)}">${escapeHtml(employee.nome)}</option>`
        ).join('');
        document.getElementById('modalTaskEmployee').style.display = 'flex';
        return true;
    }
    function startTask(id, employeeId) {
        const activity = activities.find(item => item.id === id);
        if (!activity || activity.status !== 'pendente') return;
        if (employeeId === undefined && requestEmployee(activity, 'start', false)) return;
        const executorId = employeeId !== undefined ? employeeId : activity.funcionarioId;
        queueActivity({
            ...activity,
            funcionarioId: executorId,
            funcionarioNome: getEmployee(executorId)?.nome || activity.funcionarioNome || '',
            status: 'em_execucao',
            iniciadoEm: nowIso(),
            finalizadoEm: '',
            duracaoSegundos: 0,
            alarmeStatus: 'reconhecido'
        }, activity.status);
    }
    function completeTask(id, direct, employeeId, popRecord) {
        const activity = activities.find(item => item.id === id);
        if (!activity || !['pendente', 'em_execucao'].includes(activity.status)) return;
        const template = db().tarefas.find(item => item.id === activity.tarefaId) || {};
        const requiresPop = activity.registroPop || template.registroPop;
        if (requiresPop && !popRecord) {
            openPopCompletion(activity, direct, employeeId);
            return;
        }
        if (!requiresPop && employeeId === undefined && requestEmployee(activity, 'complete', Boolean(direct))) return;
        const executorId = popRecord?.employeeId || (employeeId !== undefined ? employeeId : activity.funcionarioId);
        const finishedAt = new Date();
        const duration = activity.iniciadoEm ? Math.max(0, Math.round((finishedAt.getTime() - new Date(activity.iniciadoEm).getTime()) / 1000)) : 0;
        queueActivity({
            ...activity,
            funcionarioId: executorId,
            funcionarioNome: getEmployee(executorId)?.nome || activity.funcionarioNome || '',
            status: 'concluida',
            finalizadoEm: finishedAt.toISOString(),
            duracaoSegundos: duration,
            registroPop: requiresPop,
            procedimento: activity.procedimento || template.instrucoes || '',
            observacao: popRecord?.observacao || activity.observacao || '',
            alarmeStatus: 'reconhecido'
        }, activity.status);
    }
    function openPopCompletion(activity, direct, employeeId) {
        const employees = employeesForActivity(activity);
        if (!employees.length) {
            alert('Cadastre um funcionário deste setor para concluir uma atividade com registro POP.');
            return;
        }
        const template = db().tarefas.find(item => item.id === activity.tarefaId) || {};
        const selected = employeeId || activity.funcionarioId || employees[0].id;
        pendingPopCompletion = { activityId: activity.id, direct: Boolean(direct) };
        document.getElementById('taskPopName').innerText = activity.nome;
        document.getElementById('taskPopProcedure').innerHTML = `<strong>Procedimento</strong><div class="task-procedure-content">${procedureHtml(activity.procedimento || template.instrucoes || 'Sem procedimento informado.')}</div>`;
        document.getElementById('taskPopEmployee').innerHTML = employees.map(employee => `<option value="${escapeHtml(employee.id)}" ${employee.id === selected ? 'selected' : ''}>${escapeHtml(employee.nome)}</option>`).join('');
        document.getElementById('taskPopObservation').value = '';
        deps.openModalTop('modalTaskPop');
    }
    function cancelPopCompletion() {
        pendingPopCompletion = null;
        document.getElementById('modalTaskPop').style.display = 'none';
    }
    function confirmPopCompletion() {
        if (!pendingPopCompletion) return;
        const employeeId = document.getElementById('taskPopEmployee').value;
        if (!employeeId) return alert('Escolha quem realizou a atividade.');
        const pending = pendingPopCompletion;
        pendingPopCompletion = null;
        document.getElementById('modalTaskPop').style.display = 'none';
        completeTask(pending.activityId, pending.direct, employeeId, {
            employeeId,
            observacao: document.getElementById('taskPopObservation').value.trim()
        });
    }
    function markTaskNotDone(id) {
        const activity = activities.find(item => item.id === id);
        if (!activity || activity.status !== 'pendente') return;
        if (!confirm(`Marcar "${activity.nome}" como não realizada?`)) return;
        queueActivity({
            ...activity,
            status: 'nao_realizada',
            finalizadoEm: nowIso(),
            duracaoSegundos: 0,
            alarmeStatus: 'reconhecido'
        }, activity.status);
    }
    function formatDateTime(value) {
        if (!value) return 'Não informado';
        const date = new Date(value);
        return isNaN(date.getTime()) ? 'Não informado' : date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    }
    function formatDateKey(value) {
        const parts = String(value || '').split('-');
        return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : String(value || 'Não informado');
    }
    function openTaskDetails(id) {
        const activity = activities.find(item => item.id === id);
        if (!activity) return;
        const template = db().tarefas.find(item => item.id === activity.tarefaId) || {};
        const employee = getEmployee(activity.funcionarioId);
        const area = getArea(activity.setorId);
        const procedure = activity.procedimento || template.instrucoes || '';
        const timing = taskTiming(activity);
        const statusText = activity.status === 'em_execucao' ? 'Em execução' : activity.status === 'concluida' ? 'Concluída' : activity.status === 'nao_realizada' ? 'Não realizada' : activity.status === 'cancelada' ? 'Cancelada' : (timing.overdue ? 'Atrasada' : 'Pendente');
        const isFinished = isFinalStatus(activity.status);
        finishedActivityId = id;
        document.getElementById('taskDetailsTitle').innerText = isFinished ? 'Registro da Atividade' : 'Detalhes da Atividade';
        document.getElementById('taskFinishedChoices').style.display = isFinished ? '' : 'none';
        document.getElementById('taskFinishedContent').innerHTML = `
            <div class="task-finished-summary"><strong>${escapeHtml(activity.nome)}</strong><span>${statusText}</span></div>
            <div class="task-detail-grid">
                <div><small>Setor</small><strong>${escapeHtml(area.emoji)} ${escapeHtml(area.nome)}</strong></div>
                <div><small>Responsável</small><strong>${escapeHtml(activity.funcionarioNome || employee?.nome || 'Qualquer pessoa da área')}</strong></div>
                <div><small>Data programada</small><strong>${escapeHtml(formatDateKey(activity.data))}</strong></div>
                <div><small>Horário programado</small><strong>${escapeHtml(formatTime(activity.horario))}</strong></div>
                ${activity.iniciadoEm ? `<div><small>Iniciada em</small><strong>${escapeHtml(formatDateTime(activity.iniciadoEm))}</strong></div>` : ''}
                ${activity.finalizadoEm ? `<div><small>Finalizada em</small><strong>${escapeHtml(formatDateTime(activity.finalizadoEm))}</strong></div>` : ''}
                ${activity.status === 'concluida' ? `<div><small>Tempo registrado</small><strong>${activity.iniciadoEm ? escapeHtml(formatDuration(activity.duracaoSegundos)) : 'Sem medição'}</strong></div>` : ''}
                ${activity.remarcadoDe ? `<div><small>Remarcada da data</small><strong>${escapeHtml(formatDateKey(activity.remarcadoDe))}</strong></div>` : ''}
            </div>
            ${activity.registroPop ? '<div class="task-pop-badge">POP registrado</div>' : ''}
            ${procedure ? `<div class="task-procedure-box"><strong>Procedimento</strong><div class="task-procedure-content">${procedureHtml(procedure)}</div></div>` : ''}
            ${activity.observacao ? `<div class="task-procedure-box"><strong>Observação</strong><div class="task-procedure-content">${procedureHtml(activity.observacao)}</div></div>` : ''}`;
        deps.openModalTop('modalTaskFinished');
    }
    function openFinishedTask(id) { openTaskDetails(id); }
    function closeFinishedTask() {
        finishedActivityId = '';
        document.getElementById('modalTaskFinished').style.display = 'none';
    }
    function undoFinishedTask(targetStatus) {
        const activity = activities.find(item => item.id === finishedActivityId);
        if (!activity || !isFinalStatus(activity.status) || !['pendente', 'em_execucao'].includes(targetStatus)) return;
        const template = db().tarefas.find(item => item.id === activity.tarefaId) || {};
        const previousStatus = activity.status;
        const previousDuration = Math.max(0, Number(activity.duracaoSegundos || 0));
        const resumeStartedAt = new Date(Date.now() - previousDuration * 1000).toISOString();
        closeFinishedTask();
        queueActivity({
            ...activity,
            status: targetStatus,
            iniciadoEm: targetStatus === 'em_execucao' ? resumeStartedAt : '',
            finalizadoEm: '',
            duracaoSegundos: 0,
            funcionarioId: targetStatus === 'em_execucao' ? activity.funcionarioId : (template.funcionarioId || ''),
            funcionarioNome: targetStatus === 'em_execucao' ? activity.funcionarioNome : '',
            alarmeStatus: targetStatus === 'em_execucao' ? 'reconhecido' : (template.alarme === false ? 'desativado' : 'aguardando')
        }, previousStatus);
    }
    function openReschedule(id) {
        const activity = activities.find(item => item.id === id);
        if (!activity || !['pendente', 'em_execucao'].includes(activity.status)) return;
        const template = db().tarefas.find(item => item.id === activity.tarefaId) || {};
        if (!activity.permiteRemarcacao && !template.permiteRemarcacao) return;
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        rescheduleActivityId = id;
        document.getElementById('taskRescheduleName').innerText = activity.nome;
        const dateInput = document.getElementById('taskRescheduleDate');
        dateInput.min = todayKey();
        dateInput.value = todayKey(tomorrow);
        deps.openModalTop('modalTaskReschedule');
    }
    function cancelReschedule() {
        rescheduleActivityId = '';
        document.getElementById('modalTaskReschedule').style.display = 'none';
    }
    function confirmReschedule() {
        const activity = activities.find(item => item.id === rescheduleActivityId);
        const newDate = document.getElementById('taskRescheduleDate').value;
        if (!activity || !newDate) return;
        if (newDate < todayKey()) return alert('Escolha hoje ou uma data futura.');
        const template = db().tarefas.find(item => item.id === activity.tarefaId) || {};
        const previousStatus = activity.status;
        cancelReschedule();
        queueActivity({
            ...activity,
            data: newDate,
            status: 'pendente',
            iniciadoEm: '',
            finalizadoEm: '',
            duracaoSegundos: 0,
            funcionarioNome: '',
            remarcadoDe: activity.remarcadoDe || activity.data,
            remarcadoEm: nowIso(),
            alarmeStatus: template.alarme === false ? 'desativado' : 'aguardando'
        }, previousStatus);
    }
    function confirmEmployeeSelection() {
        if (!pendingEmployeeAction) return;
        const action = pendingEmployeeAction;
        pendingEmployeeAction = null;
        const employeeId = document.getElementById('taskExecutionEmployee').value;
        document.getElementById('modalTaskEmployee').style.display = 'none';
        if (action.action === 'start') startTask(action.activityId, employeeId);
        else completeTask(action.activityId, action.direct, employeeId);
    }
    function dueAlarmActivities() {
        const now = new Date();
        return activities.filter(activity => activity.data === todayKey() && activity.status === 'pendente'
            && activity.alarmeStatus === 'aguardando' && scheduledDate(activity) <= now)
            .sort((a, b) => {
                if (a.prioridade === 'urgente' && b.prioridade !== 'urgente') return -1;
                if (b.prioridade === 'urgente' && a.prioridade !== 'urgente') return 1;
                return scheduledDate(a) - scheduledDate(b);
            });
    }
    function playAlarm() {
        const config = db().configsTarefas;
        if (config.som === 'sem_som') return;
        const source = SOUND_FILES[config.som] || SOUND_FILES.beep;
        if (alarmAudio) alarmAudio.pause();
        alarmAudio = new Audio(source);
        alarmAudio.volume = Math.max(0, Math.min(100, Number(config.volume || 80))) / 100;
        alarmAudio.play().catch(() => {});
    }
    function checkAlarms() {
        if (!initialized) return;
        const due = dueAlarmActivities();
        const banner = document.getElementById('globalTaskAlarm');
        if (!banner) return;
        if (!due.length) {
            currentAlarmId = '';
            hiddenAlarmId = '';
            if (alarmBannerTimer) clearTimeout(alarmBannerTimer);
            alarmBannerTimer = null;
            banner.style.display = 'none';
            if (alarmAudio) alarmAudio.pause();
            return;
        }
        const activity = due[0];
        const area = getArea(activity.setorId);
        if (currentAlarmId !== activity.id) {
            hiddenAlarmId = '';
            if (alarmBannerTimer) clearTimeout(alarmBannerTimer);
            alarmBannerTimer = null;
        }
        currentAlarmId = activity.id;
        document.getElementById('globalTaskAlarmName').innerText = activity.nome;
        document.getElementById('globalTaskAlarmMeta').innerText = `${area.emoji} ${area.nome} · ${activity.horario}${due.length > 1 ? ` · +${due.length - 1}` : ''}`;
        if (activeModule === 'tasks') {
            banner.style.display = hiddenAlarmId === activity.id ? 'none' : 'flex';
            if (!hiddenAlarmId && !alarmBannerTimer) {
                alarmBannerTimer = setTimeout(() => {
                    banner.style.display = 'none';
                    hiddenAlarmId = activity.id;
                    alarmBannerTimer = null;
                }, 3500);
            }
        } else {
            if (alarmBannerTimer) clearTimeout(alarmBannerTimer);
            alarmBannerTimer = null;
            hiddenAlarmId = '';
            banner.style.display = 'flex';
        }
        const repeatMs = Number(db().configsTarefas.repeticaoMinutos || 5) * 60000;
        if (Date.now() - lastAlarmSoundAt >= repeatMs) {
            lastAlarmSoundAt = Date.now();
            playAlarm();
        }
    }
    function openAlarmTask() {
        if (!currentAlarmId) return;
        const activity = activities.find(item => item.id === currentAlarmId);
        if (activity) selectedArea = activity.setorId;
        selectedTab = 'hoje';
        openModule('tasks');
        requestAnimationFrame(() => document.getElementById(`task-${currentAlarmId}`)?.scrollIntoView({ block: 'center' }));
    }
    function startAlarmTask() { if (currentAlarmId) startTask(currentAlarmId); }
    function completeAlarmTask() { if (currentAlarmId) completeTask(currentAlarmId, true); }
    function dismissAlarm() {
        const activity = activities.find(item => item.id === currentAlarmId);
        if (!activity) return;
        queueActivity({ ...activity, alarmeStatus: 'dispensado' }, activity.status);
    }

    function showHome() {
        activeModule = 'home';
        document.getElementById('moduleHome').style.display = 'flex';
        document.getElementById('kdsModule').style.display = 'none';
        document.getElementById('tasksModule').style.display = 'none';
    }
    function openModule(module) {
        activeModule = module;
        document.getElementById('moduleHome').style.display = 'none';
        document.getElementById('kdsModule').style.display = module === 'kds' ? 'flex' : 'none';
        document.getElementById('tasksModule').style.display = module === 'tasks' ? 'flex' : 'none';
        if (module === 'tasks') {
            generateToday();
            render();
            syncNow(true);
            checkAlarms();
        }
    }
    function setTab(tab) { selectedTab = tab; render(); }
    function setArea(area) {
        selectedArea = area;
        localStorage.setItem(STORAGE_SELECTED_AREA, area);
        render();
    }

    function closeAllSettings() {
        ['modalPainelUnificado', 'modalConfigTasksMenu', 'modalTasksManager', 'modalTaskForm', 'modalTaskReports', 'modalTaskBasicSettings']
            .forEach(id => { const element = document.getElementById(id); if (element) element.style.display = 'none'; });
    }
    function openSettingsMenu() {
        closeAllSettings();
        deps.openModalTop('modalConfigTasksMenu');
    }
    function backToControlPanel() {
        closeAllSettings();
        deps.openModalTop('modalPainelUnificado');
    }
    function backToSettingsMenu(closeId) {
        if (closeId) document.getElementById(closeId).style.display = 'none';
        else document.getElementById('modalTasksManager').style.display = 'none';
        deps.openModalTop('modalConfigTasksMenu');
    }
    function managerItem(title, subtitle, index, active) {
        return `<div class="task-manager-item ${active === false ? 'inactive' : ''}"><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span></div><button onclick="AloTasks.editManagedItem(${index})" aria-label="Editar" title="Editar">✏️</button></div>`;
    }
    function openManager(type) {
        managerType = type;
        document.getElementById('modalConfigTasksMenu').style.display = 'none';
        const title = document.getElementById('tasksManagerTitle');
        const list = document.getElementById('tasksManagerList');
        const button = document.getElementById('tasksManagerNew');
        button.onclick = () => openForm(type, -1);
        if (type === 'areas') {
            title.innerText = 'Setores das Tarefas';
            list.innerHTML = db().setoresTarefas.map((area, index) => managerItem(`${area.emoji} ${area.nome}`, area.ativo === false ? 'Inativo' : 'Ativo', index, area.ativo)).join('');
        } else if (type === 'employees') {
            title.innerText = 'Funcionários';
            list.innerHTML = db().funcionarios.map((employee, index) => managerItem(employee.nome, employee.setorId ? getArea(employee.setorId).nome : 'Todos os setores', index, employee.ativo)).join('');
        } else {
            title.innerText = 'Tarefas Cadastradas';
            list.innerHTML = db().tarefas.map((task, index) => managerItem(task.nome, `${getArea(task.setorId).nome} · ${task.horario} · ${task.recorrencia === 'unica' ? task.dataUnica : task.recorrencia}`, index, task.ativo)).join('');
        }
        if (!list.innerHTML) list.innerHTML = '<div class="tasks-empty">Nenhum cadastro ainda.</div>';
        deps.openModalTop('modalTasksManager');
    }
    function manageTaskAreas() { openManager('areas'); }
    function manageEmployees() { openManager('employees'); }
    function manageTemplates() { openManager('templates'); }
    function editManagedItem(index) { openForm(managerType, index); }
    function areaOptions(selected) {
        return db().setoresTarefas.filter(area => area.ativo !== false || area.id === selected).map(area =>
            `<option value="${escapeHtml(area.id)}" ${area.id === selected ? 'selected' : ''}>${escapeHtml(area.emoji)} ${escapeHtml(area.nome)}</option>`
        ).join('');
    }
    function employeeOptions(selected, areaId) {
        return '<option value="">Qualquer pessoa da área</option>' + db().funcionarios.filter(employee => employee.ativo !== false && (!areaId || !employee.setorId || employee.setorId === areaId)).map(employee =>
            `<option value="${escapeHtml(employee.id)}" ${employee.id === selected ? 'selected' : ''}>${escapeHtml(employee.nome)}</option>`
        ).join('');
    }
    function openForm(type, index) {
        formState = { type, index };
        document.getElementById('modalTasksManager').style.display = 'none';
        const title = document.getElementById('taskFormTitle');
        const body = document.getElementById('taskFormBody');
        if (type === 'areas') {
            const area = index >= 0 ? db().setoresTarefas[index] : { nome: '', emoji: '📍', ativo: true };
            title.innerText = index >= 0 ? 'Editar Setor' : 'Novo Setor';
            body.innerHTML = `<div class="form-group"><label>Nome do setor:</label><input id="taskAreaName" value="${escapeHtml(area.nome)}" placeholder="Ex: Salão"></div><div class="form-group"><label>Emoji:</label><input id="taskAreaEmoji" value="${escapeHtml(area.emoji)}" maxlength="12"></div><label class="task-simple-switch"><input id="taskAreaActive" type="checkbox" ${area.ativo !== false ? 'checked' : ''}><span>Setor ativo</span></label>`;
        } else if (type === 'employees') {
            const employee = index >= 0 ? db().funcionarios[index] : { nome: '', setorId: '', ativo: true };
            title.innerText = index >= 0 ? 'Editar Funcionário' : 'Novo Funcionário';
            body.innerHTML = `<div class="form-group"><label>Nome:</label><input id="taskEmployeeName" value="${escapeHtml(employee.nome)}" placeholder="Nome do funcionário"></div><div class="form-group"><label>Setor principal:</label><select id="taskEmployeeArea"><option value="">Trabalha em vários setores</option>${areaOptions(employee.setorId)}</select></div><label class="task-simple-switch"><input id="taskEmployeeActive" type="checkbox" ${employee.ativo !== false ? 'checked' : ''}><span>Funcionário ativo</span></label>`;
        } else {
            const task = index >= 0 ? db().tarefas[index] : { nome: '', setorId: db().setoresTarefas[0]?.id || '', funcionarioId: '', horario: '09:00', recorrencia: 'diaria', dias: [1,2,3,4,5,6,0], dataUnica: todayKey(), prioridade: 'normal', alarme: true, tempoEsperadoMin: 0, instrucoes: '', permiteRemarcacao: false, registroPop: false, ativo: true };
            title.innerText = index >= 0 ? 'Editar Tarefa' : 'Nova Tarefa';
            const dayNames = ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
            body.innerHTML = `<div class="form-group"><label>Nome curto:</label><input id="taskName" value="${escapeHtml(task.nome)}" placeholder="Ex: Limpar a chapa"></div><div class="task-form-grid"><div class="form-group"><label>Setor:</label><select id="taskArea" onchange="AloTasks.refreshTaskEmployeeOptions()">${areaOptions(task.setorId)}</select></div><div class="form-group"><label>Horário:</label><input id="taskTime" type="time" value="${escapeHtml(task.horario)}"></div></div><div class="form-group"><label>Responsável:</label><select id="taskEmployee">${employeeOptions(task.funcionarioId, task.setorId)}</select></div><div class="task-form-grid"><div class="form-group"><label>Frequência:</label><select id="taskRecurrence" onchange="AloTasks.toggleRecurrenceFields()"><option value="diaria" ${task.recorrencia === 'diaria' ? 'selected' : ''}>Todos os dias</option><option value="semanal" ${task.recorrencia === 'semanal' ? 'selected' : ''}>Dias específicos</option><option value="unica" ${task.recorrencia === 'unica' ? 'selected' : ''}>Uma única vez</option></select></div><div class="form-group"><label>Prioridade:</label><select id="taskPriority"><option value="normal" ${task.prioridade !== 'urgente' ? 'selected' : ''}>Normal</option><option value="urgente" ${task.prioridade === 'urgente' ? 'selected' : ''}>Urgente</option></select></div></div><div id="taskWeekDays" class="task-weekdays">${dayNames.map((name, day) => `<label><input type="checkbox" value="${day}" ${(task.dias || []).map(Number).includes(day) ? 'checked' : ''}><span>${name}</span></label>`).join('')}</div><div id="taskOneDate" class="form-group"><label>Data:</label><input id="taskDate" type="date" value="${escapeHtml(task.dataUnica)}"></div><div class="task-form-grid"><div class="form-group"><label>Tempo esperado (min.):</label><input id="taskExpected" type="number" min="0" value="${Number(task.tempoEsperadoMin || 0)}"></div><label class="task-simple-switch task-alarm-switch"><input id="taskAlarmEnabled" type="checkbox" ${task.alarme !== false ? 'checked' : ''}><span>⏰ Alarme</span></label></div><div class="form-group"><label>Procedimento:</label><textarea id="taskInstructions" rows="6" maxlength="1000" placeholder="Uma orientação por linha. Use - no início para criar marcadores.">${escapeHtml(task.instrucoes)}</textarea></div><label class="task-simple-switch"><input id="taskAllowReschedule" type="checkbox" ${task.permiteRemarcacao ? 'checked' : ''}><span>📅 Permitir remarcar para outro dia</span></label><label class="task-simple-switch"><input id="taskPopRequired" type="checkbox" ${task.registroPop ? 'checked' : ''}><span>📋 Exigir registro POP ao concluir</span></label><label class="task-simple-switch"><input id="taskActive" type="checkbox" ${task.ativo !== false ? 'checked' : ''}><span>Tarefa ativa</span></label>`;
            toggleRecurrenceFields();
        }
        deps.openModalTop('modalTaskForm');
    }
    function toggleRecurrenceFields() {
        const recurrence = document.getElementById('taskRecurrence')?.value;
        const weekdays = document.getElementById('taskWeekDays');
        const date = document.getElementById('taskOneDate');
        if (weekdays) weekdays.style.display = recurrence === 'semanal' ? 'grid' : 'none';
        if (date) date.style.display = recurrence === 'unica' ? 'block' : 'none';
    }
    function refreshTaskEmployeeOptions() {
        const areaId = document.getElementById('taskArea').value;
        document.getElementById('taskEmployee').innerHTML = employeeOptions('', areaId);
    }
    function saveCurrentForm() {
        const { type, index } = formState;
        if (type === 'areas') {
            const nome = document.getElementById('taskAreaName').value.trim();
            const emoji = document.getElementById('taskAreaEmoji').value.trim() || '📍';
            if (!nome) return alert('Informe o nome do setor.');
            const current = index >= 0 ? db().setoresTarefas[index] : null;
            const value = { id: current?.id || createId('setor'), nome, emoji, ativo: document.getElementById('taskAreaActive').checked };
            if (index >= 0) db().setoresTarefas[index] = value; else db().setoresTarefas.push(value);
        } else if (type === 'employees') {
            const nome = document.getElementById('taskEmployeeName').value.trim();
            if (!nome) return alert('Informe o nome do funcionário.');
            const current = index >= 0 ? db().funcionarios[index] : null;
            const value = { id: current?.id || createId('func'), nome, setorId: document.getElementById('taskEmployeeArea').value, ativo: document.getElementById('taskEmployeeActive').checked };
            if (index >= 0) db().funcionarios[index] = value; else db().funcionarios.push(value);
        } else {
            const nome = document.getElementById('taskName').value.trim();
            const setorId = document.getElementById('taskArea').value;
            const horario = document.getElementById('taskTime').value;
            const recurrence = document.getElementById('taskRecurrence').value;
            const dias = Array.from(document.querySelectorAll('#taskWeekDays input:checked')).map(input => Number(input.value));
            if (!nome || !setorId || !horario) return alert('Informe nome, setor e horário.');
            if (recurrence === 'semanal' && !dias.length) return alert('Escolha pelo menos um dia da semana.');
            const current = index >= 0 ? db().tarefas[index] : null;
            const value = {
                id: current?.id || createId('tarefa'), nome, setorId,
                funcionarioId: document.getElementById('taskEmployee').value,
                horario, recorrencia: recurrence,
                dias: recurrence === 'diaria' ? [0,1,2,3,4,5,6] : dias,
                dataUnica: document.getElementById('taskDate').value,
                prioridade: document.getElementById('taskPriority').value,
                alarme: document.getElementById('taskAlarmEnabled').checked,
                tempoEsperadoMin: Number(document.getElementById('taskExpected').value || 0),
                instrucoes: document.getElementById('taskInstructions').value.trim(),
                permiteRemarcacao: document.getElementById('taskAllowReschedule').checked,
                registroPop: document.getElementById('taskPopRequired').checked,
                ativo: document.getElementById('taskActive').checked
            };
            if (index >= 0) db().tarefas[index] = value; else db().tarefas.push(value);
        }
        deps.markDatabaseChanged();
        document.getElementById('modalTaskForm').style.display = 'none';
        generateToday();
        render();
        checkAlarms();
        openManager(type);
    }
    function cancelForm() {
        document.getElementById('modalTaskForm').style.display = 'none';
        openManager(formState.type);
    }
    function openBasicSettings() {
        document.getElementById('modalConfigTasksMenu').style.display = 'none';
        const config = db().configsTarefas;
        document.getElementById('taskConfigSound').value = config.som || 'beep';
        document.getElementById('taskConfigVolume').value = config.volume || '80';
        document.getElementById('taskVolumeLabel').innerText = `${config.volume || 80}%`;
        document.getElementById('taskConfigRepeat').value = config.repeticaoMinutos || '5';
        deps.openModalTop('modalTaskBasicSettings');
    }
    function saveBasicSettings() {
        db().configsTarefas.som = document.getElementById('taskConfigSound').value;
        db().configsTarefas.volume = document.getElementById('taskConfigVolume').value;
        db().configsTarefas.repeticaoMinutos = document.getElementById('taskConfigRepeat').value;
        deps.markDatabaseChanged();
        document.getElementById('modalTaskBasicSettings').style.display = 'none';
        openSettingsMenu();
    }

    async function openReports() {
        document.getElementById('modalConfigTasksMenu').style.display = 'none';
        deps.openModalTop('modalTaskReports');
        await renderReports(7, document.querySelector('#modalTaskReports .task-report-tabs button'));
    }
    async function renderReports(days, button) {
        document.querySelectorAll('#modalTaskReports .task-report-tabs button').forEach(item => item.classList.toggle('active', item === button));
        const content = document.getElementById('taskReportsContent');
        content.innerHTML = '<div class="tasks-empty">Atualizando relatório...</div>';
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - (days - 1));
        let reportActivities = activities.filter(activity => activity.data >= todayKey(start) && activity.data <= todayKey(end));
        if (deps.getUrl() && navigator.onLine) {
            try {
                const response = await global.AloApi.getActivityHistory(deps.getUrl(), todayKey(start), todayKey(end));
                if (response && Array.isArray(response.atividades)) {
                    const map = new Map(reportActivities.map(item => [item.id, item]));
                    response.atividades.map(normalizeActivity).forEach(item => map.set(item.id, item));
                    reportActivities = Array.from(map.values());
                }
            } catch (error) {}
        }
        const completed = reportActivities.filter(item => item.status === 'concluida');
        reportActivitiesCache = reportActivities.slice();
        const measured = completed.filter(item => item.iniciadoEm && item.duracaoSegundos > 0);
        const direct = completed.length - measured.length;
        const avg = measured.length ? Math.round(measured.reduce((sum, item) => sum + item.duracaoSegundos, 0) / measured.length) : 0;
        const late = reportActivities.filter(item => item.status === 'pendente' && scheduledDate(item) < new Date()).length;
        const byTask = new Map();
        completed.forEach(item => {
            const current = byTask.get(item.tarefaId) || { id: item.tarefaId, nome: item.nome, count: 0, seconds: 0, measured: 0 };
            current.count += 1;
            if (item.duracaoSegundos) { current.seconds += item.duracaoSegundos; current.measured += 1; }
            byTask.set(item.tarefaId, current);
        });
        const popRecords = completed.filter(item => item.registroPop).sort(sortByFinished);
        content.innerHTML = `<div class="task-report-summary"><div><strong>${completed.length}</strong><span>Concluídas</span></div><div><strong>${formatDuration(avg)}</strong><span>Tempo médio</span></div><div><strong>${late}</strong><span>Atrasadas</span></div><div><strong>${direct}</strong><span>Sem início</span></div></div><div class="task-report-list">${Array.from(byTask.values()).sort((a,b) => b.count-a.count).map(item => `<button type="button" onclick="AloTasks.openTaskHistory('${escapeHtml(item.id)}')"><span><strong>${escapeHtml(item.nome)}</strong><small>${item.count} conclusão(ões) · ver histórico</small></span><b>${item.measured ? formatDuration(Math.round(item.seconds / item.measured)) : 'sem medição'}</b></button>`).join('') || '<div class="tasks-empty">Nenhuma tarefa concluída no período.</div>'}</div>${popRecords.length ? `<div class="task-report-section-title">Registros POP</div><div class="task-pop-records">${popRecords.map(item => `<button type="button" onclick="AloTasks.openTaskHistory('${escapeHtml(item.tarefaId)}')"><strong>${escapeHtml(item.nome)}</strong><span>${escapeHtml(item.funcionarioNome || getEmployee(item.funcionarioId)?.nome || 'Não informado')} · ${escapeHtml(formatDateTime(item.finalizadoEm))}</span>${item.observacao ? `<small>${escapeHtml(item.observacao)}</small>` : ''}</button>`).join('')}</div>` : ''}`;
    }
    function openTaskHistory(taskId) {
        const records = reportActivitiesCache.filter(item => item.tarefaId === taskId && item.status === 'concluida').sort(sortByFinished);
        const template = db().tarefas.find(item => item.id === taskId) || {};
        const name = records[0]?.nome || template.nome || 'Tarefa';
        document.getElementById('taskHistoryTitle').innerText = `Histórico: ${name}`;
        document.getElementById('taskHistoryContent').innerHTML = records.length ? `<div class="task-history-list">${records.map(item => {
            const employee = item.funcionarioNome || getEmployee(item.funcionarioId)?.nome || 'Não informado';
            const procedure = item.procedimento || template.instrucoes || '';
            return `<article class="task-history-record"><header><strong>${escapeHtml(formatDateTime(item.finalizadoEm))}</strong><span>${item.iniciadoEm ? escapeHtml(formatDuration(item.duracaoSegundos)) : 'Sem medição'}</span></header><div class="task-history-worker">Realizada por: <strong>${escapeHtml(employee)}</strong>${item.registroPop ? '<b>POP</b>' : ''}</div>${procedure ? `<div class="task-procedure-content">${procedureHtml(procedure)}</div>` : ''}${item.observacao ? `<div class="task-history-observation"><strong>Observação</strong><span>${escapeHtml(item.observacao)}</span></div>` : ''}</article>`;
        }).join('')}</div>` : '<div class="tasks-empty">Nenhuma execução registrada neste período.</div>';
        deps.openModalTop('modalTaskHistory');
    }
    function closeTaskHistory() {
        document.getElementById('modalTaskHistory').style.display = 'none';
    }
    function closeReports() {
        document.getElementById('modalTaskReports').style.display = 'none';
        openSettingsMenu();
    }

    function refreshDefinitions() {
        if (!initialized) return;
        normalizeDefinitions();
        generateToday();
        render();
        checkAlarms();
    }
    function init(options) {
        if (initialized) return;
        deps = options;
        normalizeDefinitions();
        activities = parseJson(STORAGE_ACTIVITIES, []).map(normalizeActivity);
        outbox = parseJson(STORAGE_OUTBOX, []);
        initialized = true;
        generateToday();
        render();
        setSyncIndicator(navigator.onLine ? 'online' : 'offline');
        scheduleSync(0);
        checkAlarms();
        alarmTimer = setInterval(checkAlarms, 15000);
        global.addEventListener('online', () => syncNow(true));
        global.addEventListener('offline', () => setSyncIndicator('offline'));
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') { generateToday(); syncNow(true); checkAlarms(); }
            else scheduleSync();
        });
        const unlockAlarm = () => {
            const source = SOUND_FILES[db().configsTarefas.som] || SOUND_FILES.beep;
            const probe = new Audio(source);
            probe.volume = 0;
            probe.play().then(() => { probe.pause(); }).catch(() => {});
        };
        document.addEventListener('click', unlockAlarm, { once: true });
        document.addEventListener('touchstart', unlockAlarm, { once: true });
    }

    global.AloTasks = Object.freeze({
        init, refreshDefinitions, showHome, openModule, setTab, setArea, syncNow,
        startTask, completeTask, markTaskNotDone, confirmEmployeeSelection,
        openTaskDetails, openFinishedTask, closeFinishedTask, undoFinishedTask,
        openReschedule, cancelReschedule, confirmReschedule,
        cancelPopCompletion, confirmPopCompletion,
        openAlarmTask, startAlarmTask, completeAlarmTask, dismissAlarm,
        openSettingsMenu, backToControlPanel, backToSettingsMenu,
        manageTaskAreas, manageEmployees, manageTemplates, editManagedItem,
        cancelForm, saveCurrentForm, toggleRecurrenceFields, refreshTaskEmployeeOptions,
        openBasicSettings, saveBasicSettings, openReports, renderReports, openTaskHistory, closeTaskHistory, closeReports
    });
})(window);
