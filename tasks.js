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
    let selectedTab = 'total';
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
    let reportDays = 7;
    let reportAreaId = 'todos';
    let pendingTaskPhoto = '';
    let removeTaskPhoto = false;
    let hygieneGroupFilter = 'Todos';
    const taskPhotoCache = new Map();
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
    function adjustHeaderAreaName(element, name) {
        if (!element) return;
        const length = Array.from(String(name || '')).length;
        const desktop = length > 30 ? 10 : (length > 24 ? 11 : (length > 17 ? 14 : (length > 11 ? 16 : 18)));
        const mobile = length > 24 ? 10 : (length > 17 ? 11 : (length > 11 ? 12 : 14));
        element.style.setProperty('--area-name-size', `${desktop}px`);
        element.style.setProperty('--area-name-size-mobile', `${mobile}px`);
    }
    function parseJson(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
        catch (error) { return fallback; }
    }
    function normalizeActivity(activity) {
        return {
            id: String(activity.id || ''),
            tarefaId: String(activity.tarefaId || ''),
            programacaoId: String(activity.programacaoId || 'principal'),
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
            procedimentoFormato: hasRichMarkup(activity.procedimento) ? 'rico' : normalizeProcedureFormat(activity.procedimentoFormato),
            remarcadoDe: activity.remarcadoDe || '',
            remarcadoEm: activity.remarcadoEm || '',
            syncState: activity.syncState || 'confirmed'
        };
    }
    function normalizeSchedule(schedule, index = 0, legacy = {}) {
        const source = schedule || legacy;
        const recurrence = ['diaria', 'semanal', 'mensal', 'intervalo_meses', 'unica'].includes(source.recorrencia) ? source.recorrencia : 'diaria';
        return {
            id: String(source.id || (index === 0 ? 'principal' : createId('horario'))),
            horario: source.horario || legacy.horario || '09:00',
            recorrencia: recurrence,
            dias: recurrence === 'diaria' ? [0, 1, 2, 3, 4, 5, 6] : (Array.isArray(source.dias) ? source.dias.map(Number) : []),
            dataUnica: source.dataUnica || legacy.dataUnica || todayKey(),
            diaMes: Math.max(1, Math.min(31, Number(source.diaMes || 1))),
            intervaloMeses: Math.max(1, Math.min(24, Number(source.intervaloMeses || 6))),
            dataInicio: source.dataInicio || todayKey(),
            alarme: source.alarme !== false
        };
    }
    function getTaskSchedules(task) {
        const schedules = Array.isArray(task.programacoes) && task.programacoes.length
            ? task.programacoes
            : [task];
        return schedules.map((schedule, index) => normalizeSchedule(schedule, index, task));
    }
    function scheduleForActivity(activity, task) {
        return getTaskSchedules(task).find(schedule => schedule.id === activity.programacaoId) || getTaskSchedules(task)[0];
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
        data.tarefas = data.tarefas.map(task => {
            const programacoes = getTaskSchedules(task);
            const principal = programacoes[0];
            return {
                ...task,
                programacoes,
                horario: principal.horario,
                recorrencia: principal.recorrencia,
                dias: principal.dias,
                dataUnica: principal.dataUnica,
                diaMes: principal.diaMes,
                intervaloMeses: principal.intervaloMeses,
                dataInicio: principal.dataInicio,
                alarme: principal.alarme,
                procedimentoFormato: hasRichMarkup(task.instrucoes) ? 'rico' : normalizeProcedureFormat(task.procedimentoFormato)
            };
        });
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
    function appliesToday(task, schedule, date = new Date()) {
        if (!task.ativo) return false;
        if (schedule.recorrencia === 'unica') return schedule.dataUnica === todayKey(date);
        if (schedule.recorrencia === 'mensal') return date.getDate() === Number(schedule.diaMes || 1);
        if (schedule.recorrencia === 'intervalo_meses') {
            const start = new Date(`${schedule.dataInicio || todayKey(date)}T00:00:00`);
            if (isNaN(start.getTime()) || date < start || date.getDate() !== start.getDate()) return false;
            const months = (date.getFullYear() - start.getFullYear()) * 12 + date.getMonth() - start.getMonth();
            return months % Number(schedule.intervaloMeses || 1) === 0;
        }
        const days = Array.isArray(schedule.dias) ? schedule.dias.map(Number) : [];
        return schedule.recorrencia === 'diaria' || days.includes(date.getDay());
    }
    function generateToday() {
        const key = todayKey();
        const existing = new Set(activities.map(activity => activity.id));
        db().tarefas.forEach(task => {
            getTaskSchedules(task).forEach((schedule, index) => {
                if (!appliesToday(task, schedule)) return;
                const id = schedule.id === 'principal'
                    ? `atividade_${task.id}_${key}`
                    : `atividade_${task.id}_${schedule.id}_${key}`;
                if (existing.has(id)) return;
                const activity = normalizeActivity({
                    id,
                    tarefaId: task.id,
                    programacaoId: schedule.id,
                    nome: task.nome,
                    setorId: task.setorId,
                    funcionarioId: task.funcionarioId || '',
                    data: key,
                    horario: schedule.horario,
                    prioridade: task.prioridade,
                    tempoEsperadoMin: task.tempoEsperadoMin,
                    permiteRemarcacao: Boolean(task.permiteRemarcacao),
                    registroPop: Boolean(task.registroPop),
                    procedimento: task.instrucoes || '',
                    procedimentoFormato: hasRichMarkup(task.instrucoes) ? 'rico' : normalizeProcedureFormat(task.procedimentoFormato),
                    alarmeStatus: schedule.alarme ? 'aguardando' : 'desativado',
                    status: 'pendente',
                    atualizadoEm: nowIso(),
                    syncState: navigator.onLine ? 'queued' : 'offline'
                });
                queueActivity(activity, '', false);
                existing.add(id);
            });
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
        const options = document.getElementById('tasksAreaPickerOptions');
        const button = document.getElementById('tasksAreaPickerButton');
        if (!select || !options || !button) return;
        const activeAreas = db().setoresTarefas.filter(area => area.ativo !== false);
        select.innerHTML = '<option value="todos">Todos os setores</option>' + activeAreas.map(area =>
            `<option value="${escapeHtml(area.id)}">${escapeHtml(area.emoji)} ${escapeHtml(area.nome)}</option>`
        ).join('');
        if (!activeAreas.some(area => area.id === selectedArea)) {
            selectedArea = 'todos';
            localStorage.setItem(STORAGE_SELECTED_AREA, selectedArea);
        }
        select.value = selectedArea;
        const current = selectedArea === 'todos'
            ? { id: 'todos', nome: 'Todos', emoji: '📍' }
            : getArea(selectedArea);
        document.getElementById('tasksAreaEmoji').textContent = current.emoji;
        const currentName = document.getElementById('tasksAreaName');
        currentName.textContent = current.nome;
        adjustHeaderAreaName(currentName, current.nome);
        const title = document.createElement('div');
        title.className = 'header-area-options-title';
        title.textContent = 'Trocar setor';
        const choices = [{ id: 'todos', nome: 'Todos os setores', emoji: '📍' }, ...activeAreas];
        options.replaceChildren(title, ...choices.map(area => {
            const choice = document.createElement('button');
            choice.type = 'button';
            choice.className = `header-area-option${area.id === selectedArea ? ' selected' : ''}`;
            choice.setAttribute('role', 'option');
            choice.setAttribute('aria-selected', String(area.id === selectedArea));
            const emoji = document.createElement('span');
            emoji.className = 'header-area-option-emoji';
            emoji.textContent = area.emoji;
            const copy = document.createElement('span');
            copy.className = 'header-area-option-copy';
            const name = document.createElement('strong');
            name.textContent = area.nome;
            const role = document.createElement('small');
            role.textContent = area.id === 'todos' ? 'Visão geral das atividades' : 'Atividades deste setor';
            copy.append(name, role);
            const check = document.createElement('b');
            check.setAttribute('aria-hidden', 'true');
            check.textContent = area.id === selectedArea ? '✓' : '';
            choice.append(emoji, copy, check);
            choice.addEventListener('click', () => setArea(area.id));
            return choice;
        }));
    }
    function closeAreaPicker() {
        const options = document.getElementById('tasksAreaPickerOptions');
        const button = document.getElementById('tasksAreaPickerButton');
        if (options) options.classList.remove('open');
        if (button) button.setAttribute('aria-expanded', 'false');
    }
    function toggleAreaPicker() {
        const options = document.getElementById('tasksAreaPickerOptions');
        const button = document.getElementById('tasksAreaPickerButton');
        if (!options || !button) return;
        const opening = !options.classList.contains('open');
        options.classList.toggle('open', opening);
        button.setAttribute('aria-expanded', String(opening));
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

        if (selectedTab === 'total') {
            return [
                {
                    title: 'Pendentes',
                    className: 'pending',
                    items: today.filter(activity => activity.status === 'pendente').sort(sortBySchedule)
                },
                {
                    title: 'Em execução',
                    className: 'running',
                    items: today.filter(activity => activity.status === 'em_execucao').sort(sortByStarted)
                },
                {
                    title: 'Concluídas',
                    className: 'completed',
                    items: today.filter(activity => activity.status === 'concluida').sort(sortByFinished)
                },
                {
                    title: 'Não realizadas',
                    className: 'missed',
                    items: today.filter(activity => ['nao_realizada', 'cancelada'].includes(activity.status)).sort(sortByFinished)
                }
            ].filter(group => group.items.length);
        }

        if (selectedTab === 'pendentes') {
            return [
                {
                    title: 'Atrasadas',
                    className: 'pending',
                    items: today.filter(activity => activity.status === 'pendente' && scheduledDate(activity) < now).sort(sortBySchedule)
                },
                {
                    title: 'Mais tarde',
                    className: 'pending',
                    items: today.filter(activity => activity.status === 'pendente' && scheduledDate(activity) >= now).sort(sortBySchedule)
                }
            ].filter(group => group.items.length);
        }

        if (selectedTab === 'em_execucao') {
            return [{
                title: 'Em execução',
                className: 'running',
                items: today.filter(activity => activity.status === 'em_execucao').sort(sortByStarted)
            }].filter(group => group.items.length);
        }

        return [{
            title: 'Concluídas',
            className: 'completed',
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
    function normalizeProcedureFormat(value) {
        return ['texto', 'bolinhas', 'numeros', 'tracos', 'rico'].includes(value) ? value : 'texto';
    }
    function hasRichMarkup(value) {
        return /<(p|div|br|strong|b|u|ul|ol|li)(\s|>)/i.test(String(value || ''));
    }
    function cleanProcedureLine(value) {
        return String(value || '').trim().replace(/^([-*•–—]|\d+[.)])\s+/, '');
    }
    function procedureHtml(value, requestedFormat = 'texto') {
        const lines = String(value || '').replace(/\r/g, '').split('\n');
        const format = normalizeProcedureFormat(requestedFormat);
        if (format === 'rico' || hasRichMarkup(value)) return sanitizeRichHtml(value);
        const blocks = [];
        let listType = '';
        let listClass = '';
        let listItems = [];
        const flushList = () => {
            if (!listItems.length) return;
            const tag = listType === 'ordered' ? 'ol' : 'ul';
            blocks.push(`<${tag}${listClass ? ` class="${listClass}"` : ''}>${listItems.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>`);
            listType = '';
            listClass = '';
            listItems = [];
        };
        lines.forEach(line => {
            const text = line.trim();
            if (!text) {
                flushList();
                if (blocks.length && !blocks[blocks.length - 1].includes('task-procedure-spacer')) blocks.push('<div class="task-procedure-spacer"></div>');
                return;
            }
            const manualBullet = text.match(/^[-*•–—]\s+(.+)$/);
            const manualNumber = text.match(/^\d+[.)]\s+(.+)$/);
            const forcedList = format !== 'texto';
            if (forcedList || manualBullet || manualNumber) {
                const nextType = format === 'numeros' || (!forcedList && manualNumber) ? 'ordered' : 'unordered';
                const nextClass = format === 'tracos' ? 'procedure-dashes' : '';
                if (listType && listType !== nextType) flushList();
                listType = nextType;
                listClass = nextClass;
                listItems.push(forcedList ? cleanProcedureLine(text) : (manualBullet || manualNumber)[1]);
                return;
            }
            flushList();
            blocks.push(`<p>${escapeHtml(text)}</p>`);
        });
        flushList();
        while (blocks[blocks.length - 1]?.includes('task-procedure-spacer')) blocks.pop();
        return blocks.join('');
    }
    function sanitizeRichHtml(value) {
        const source = String(value || '').trim();
        if (!source) return '';
        if (!/<[a-z][\s\S]*>/i.test(source)) return procedureHtml(source, 'texto');
        const documentValue = new DOMParser().parseFromString(`<div>${source}</div>`, 'text/html');
        const root = documentValue.body.firstElementChild;
        const allowedTags = new Set(['P', 'DIV', 'BR', 'STRONG', 'B', 'U', 'UL', 'OL', 'LI']);
        Array.from(root.querySelectorAll('*')).forEach(node => {
            if (!allowedTags.has(node.tagName)) {
                if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(node.tagName)) node.remove();
                else node.replaceWith(...Array.from(node.childNodes));
                return;
            }
            const alignment = ['left', 'center', 'right', 'justify'].includes(node.style?.textAlign) ? node.style.textAlign : '';
            const dashList = node.tagName === 'UL' && node.classList.contains('procedure-dashes');
            Array.from(node.attributes).forEach(attribute => node.removeAttribute(attribute.name));
            if (alignment) node.style.textAlign = alignment;
            if (dashList) node.classList.add('procedure-dashes');
        });
        return root.innerHTML;
    }
    function richEditorInitialHtml(value, format) {
        const html = normalizeProcedureFormat(format) === 'rico' || hasRichMarkup(value) ? sanitizeRichHtml(value) : procedureHtml(value, format);
        return html.replaceAll('<div class="task-procedure-spacer"></div>', '<p><br></p>');
    }
    function richEditorToolbar(editorId, label) {
        const commandButton = (command, title, content) => `<button type="button" onmousedown="event.preventDefault()" onclick="AloTasks.formatRichEditor('${editorId}','${command}')" aria-label="${title}" title="${title}">${content}</button>`;
        return `<div class="task-rich-toolbar" role="toolbar" aria-label="${label}">
            ${commandButton('bold', 'Negrito', '<b>B</b>')}
            ${commandButton('underline', 'Sublinhar', '<u>S</u>')}
            ${commandButton('insertUnorderedList', 'Lista com bolinhas', '•')}
            ${commandButton('insertOrderedList', 'Lista numerada', '1.')}
            ${commandButton('dashList', 'Lista com traços', '–')}
            <button type="button" class="task-alignment-button" data-alignment="justifyLeft" onmousedown="event.preventDefault()" onclick="AloTasks.cycleRichEditorAlignment('${editorId}',this)" aria-label="Alinhar à esquerda" title="Alinhar à esquerda"><span class="align-lines align-left" aria-hidden="true"><i></i><i></i><i></i><i></i></span></button>
        </div>`;
    }
    function richEditorMarkup(editorId, value, format, placeholder, maxLength) {
        return `<div class="task-rich-shell">${richEditorToolbar(editorId, 'Formatação do procedimento')}<div id="${editorId}" class="task-rich-editor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="${escapeHtml(placeholder)}" oninput="AloTasks.limitRichEditor(this, ${maxLength})">${richEditorInitialHtml(value, format)}</div></div>`;
    }
    function insertEmptyList(editor, command) {
        const list = document.createElement(command === 'insertOrderedList' ? 'ol' : 'ul');
        if (command === 'dashList') list.classList.add('procedure-dashes');
        const item = document.createElement('li');
        item.appendChild(document.createElement('br'));
        list.appendChild(item);
        editor.replaceChildren(list);
        const range = document.createRange();
        range.setStart(item, 0);
        range.collapse(true);
        const selection = global.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }
    function formatRichEditor(editorId, command) {
        const editor = document.getElementById(editorId);
        if (!editor) return;
        editor.focus();
        if (['insertUnorderedList', 'insertOrderedList', 'dashList'].includes(command) && !editor.innerText.trim()) {
            insertEmptyList(editor, command);
            return;
        }
        const selection = global.getSelection();
        const origin = selection?.anchorNode?.nodeType === Node.TEXT_NODE ? selection.anchorNode.parentElement : selection?.anchorNode;
        let currentList = origin?.closest?.('ul, ol');
        if (!currentList && editor.querySelectorAll('ul, ol').length === 1) currentList = editor.querySelector('ul, ol');
        if (command === 'dashList') {
            if (currentList?.tagName === 'UL' && editor.contains(currentList)) {
                currentList.classList.add('procedure-dashes');
                return;
            }
            document.execCommand('insertUnorderedList', false, null);
            const changedSelection = global.getSelection();
            const changedOrigin = changedSelection?.anchorNode?.nodeType === Node.TEXT_NODE ? changedSelection.anchorNode.parentElement : changedSelection?.anchorNode;
            const list = changedOrigin?.closest?.('ul');
            if (list && editor.contains(list)) list.classList.add('procedure-dashes');
        } else {
            if (command === 'insertUnorderedList' && currentList?.tagName === 'UL' && currentList.classList.contains('procedure-dashes')) {
                currentList.classList.remove('procedure-dashes');
                return;
            }
            document.execCommand(command, false, null);
            if (['insertUnorderedList', 'insertOrderedList'].includes(command)) {
                const changedSelection = global.getSelection();
                const changedOrigin = changedSelection?.anchorNode?.nodeType === Node.TEXT_NODE ? changedSelection.anchorNode.parentElement : changedSelection?.anchorNode;
                changedOrigin?.closest?.('ul')?.classList.remove('procedure-dashes');
            }
        }
        normalizeRichEditorLists(editor);
    }
    function cycleRichEditorAlignment(editorId, button) {
        const alignments = [
            { command: 'justifyLeft', className: 'align-left', title: 'Alinhar à esquerda' },
            { command: 'justifyCenter', className: 'align-center', title: 'Centralizar' },
            { command: 'justifyRight', className: 'align-right', title: 'Alinhar à direita' },
            { command: 'justifyFull', className: 'align-justify', title: 'Justificar' }
        ];
        const currentIndex = Math.max(0, alignments.findIndex(item => item.command === button.dataset.alignment));
        const next = alignments[(currentIndex + 1) % alignments.length];
        formatRichEditor(editorId, next.command);
        button.dataset.alignment = next.command;
        button.title = next.title;
        button.setAttribute('aria-label', next.title);
        button.innerHTML = `<span class="align-lines ${next.className}" aria-hidden="true"><i></i><i></i><i></i><i></i></span>`;
    }
    function normalizeRichEditorLists(editor) {
        const selection = global.getSelection();
        const selectionNode = selection?.anchorNode?.nodeType === Node.TEXT_NODE ? selection.anchorNode.parentElement : selection?.anchorNode;
        Array.from(editor.querySelectorAll('ul, ol')).forEach(list => {
            const emptyItem = Array.from(list.children).find(item => item.tagName === 'LI' && !item.textContent.trim());
            if (!emptyItem) return;
            if (selectionNode && emptyItem.contains(selectionNode)) return;
            const trailingItems = [];
            let next = emptyItem.nextElementSibling;
            while (next) {
                const current = next;
                next = next.nextElementSibling;
                trailingItems.push(current);
            }
            const spacer = document.createElement('p');
            spacer.innerHTML = '<br>';
            const trailingList = trailingItems.length ? list.cloneNode(false) : null;
            trailingItems.forEach(item => trailingList.appendChild(item));
            emptyItem.remove();
            list.after(spacer);
            if (trailingList) spacer.after(trailingList);
            if (!list.children.length) list.remove();
        });
    }
    function limitRichEditor(editor, maxLength) {
        const text = editor?.innerText || '';
        if (text.length <= maxLength) return;
        editor.innerText = text.slice(0, maxLength);
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const selection = global.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    }
    function richEditorValue(editorId) {
        const editor = document.getElementById(editorId);
        return editor && editor.innerText.trim() ? sanitizeRichHtml(editor.innerHTML) : '';
    }
    function compressTaskPhoto(file) {
        return new Promise((resolve, reject) => {
            if (!file || !String(file.type || '').startsWith('image/')) { reject(new Error('Escolha uma imagem.')); return; }
            const url = URL.createObjectURL(file);
            const image = new Image();
            image.onload = () => {
                const scale = Math.min(1, 1280 / Math.max(image.width, image.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(url);
                const dataUrl = canvas.toDataURL('image/jpeg', .78);
                if (dataUrl.length > 2400000) reject(new Error('A foto ainda ficou muito grande. Escolha outra imagem.'));
                else resolve(dataUrl);
            };
            image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não foi possível abrir esta imagem.')); };
            image.src = url;
        });
    }
    function showTaskPhotoPreview(url, saved = false) {
        const image = document.getElementById('taskPhotoPreviewImage');
        const empty = document.getElementById('taskPhotoPreviewEmpty');
        const remove = document.getElementById('taskPhotoRemoveButton');
        if (image) { image.src = url || ''; image.style.display = url ? 'block' : 'none'; }
        if (empty) empty.style.display = url ? 'none' : 'grid';
        if (remove) remove.style.display = url ? 'inline-flex' : 'none';
        if (saved && url) taskPhotoCache.set(formState.taskId, url);
    }
    async function resolveTaskPhotoUrl(taskId) {
        if (taskPhotoCache.has(taskId)) return taskPhotoCache.get(taskId);
        const url = deps.getUrl();
        if (!url) return '';
        const response = await global.AloApi.getTaskPhoto(url, taskId);
        const photoUrl = response?.encontrada ? response.url : '';
        if (photoUrl) taskPhotoCache.set(taskId, photoUrl);
        return photoUrl;
    }
    async function loadTaskFormPhoto(taskId) {
        try { showTaskPhotoPreview(await resolveTaskPhotoUrl(taskId), true); }
        catch (error) { showTaskPhotoPreview(''); }
    }
    async function handleTaskPhoto(input) {
        try {
            pendingTaskPhoto = await compressTaskPhoto(input?.files?.[0]);
            removeTaskPhoto = false;
            showTaskPhotoPreview(pendingTaskPhoto);
        } catch (error) {
            alert(error.message || 'Não foi possível preparar a foto.');
        } finally {
            if (input) input.value = '';
        }
    }
    function removeTaskPhotoDraft() {
        pendingTaskPhoto = '';
        removeTaskPhoto = true;
        taskPhotoCache.delete(formState.taskId);
        showTaskPhotoPreview('');
    }
    async function renderTaskPhoto(taskId, targetId) {
        const target = document.getElementById(targetId);
        if (!target) return;
        try {
            const url = await resolveTaskPhotoUrl(taskId);
            if (!url) { target.remove(); return; }
            target.innerHTML = `<strong>Foto de referência</strong><img src="${escapeHtml(url)}" alt="Foto de referência da atividade">`;
        } catch (error) {
            target.remove();
        }
    }
    function render() {
        if (!initialized) return;
        renderAreaOptions();
        document.querySelectorAll('[data-task-tab]').forEach(button => {
            button.classList.toggle('active', button.dataset.taskTab === selectedTab);
        });
        const list = document.getElementById('tasksList');
        if (!list) return;
        const groups = activityGroups();
        const allToday = activities.filter(item => item.data === todayKey() && (selectedArea === 'todos' || item.setorId === selectedArea));
        document.getElementById('taskTabTotalCount').innerText = `(${allToday.length})`;
        document.getElementById('taskTabPendingCount').innerText = `(${allToday.filter(item => item.status === 'pendente').length})`;
        document.getElementById('taskTabRunningCount').innerText = `(${allToday.filter(item => item.status === 'em_execucao').length})`;
        document.getElementById('taskTabCompletedCount').innerText = `(${allToday.filter(item => item.status === 'concluida').length})`;
        if (!groups.length) {
            const text = selectedTab === 'total' ? 'Nenhuma atividade programada para hoje.' : (selectedTab === 'pendentes' ? 'Nenhuma atividade pendente.' : (selectedTab === 'em_execucao' ? 'Nenhuma atividade em execução.' : 'Nenhuma atividade concluída hoje.'));
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
            let actions = '';
            if (activity.status === 'pendente') {
                actions = `<button class="task-primary-action" onclick="event.stopPropagation();AloTasks.startTask('${activity.id}')">▶ Iniciar</button><button class="task-complete-action" onclick="event.stopPropagation();AloTasks.completeTask('${activity.id}', true)">✓ Concluído</button>${canReschedule ? `<button class="task-reschedule-action" onclick="event.stopPropagation();AloTasks.openReschedule('${activity.id}')" aria-label="Remarcar atividade" title="Remarcar">📅</button>` : ''}<button class="task-skip-action" onclick="event.stopPropagation();AloTasks.markTaskNotDone('${activity.id}')" aria-label="Marcar como não realizada" title="Não foi feita">❌</button>`;
            } else if (activity.status === 'em_execucao') {
                actions = `<button class="task-complete-action" onclick="event.stopPropagation();AloTasks.completeTask('${activity.id}', false)">✓ Concluído</button>${canReschedule ? `<button class="task-reschedule-action" onclick="event.stopPropagation();AloTasks.openReschedule('${activity.id}')" aria-label="Remarcar atividade" title="Remarcar">📅</button>` : ''}`;
            }
            const detailsAction = ` onclick="AloTasks.openTaskDetails('${activity.id}')" onkeydown="if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();AloTasks.openTaskDetails('${activity.id}')}" tabindex="0" aria-label="Abrir detalhes de ${escapeHtml(activity.nome)}"`;
            const urgent = activity.prioridade === 'urgente' ? '<b class="task-urgent-label">URGENTE</b>' : '';
            return `<article class="task-card ${stateClass} details-clickable" id="task-${escapeHtml(activity.id)}"${detailsAction}>
                <div class="task-card-main">
                    <div class="task-time">${formatTime(activity.horario)}</div>
                    <div class="task-card-copy"><strong>${escapeHtml(activity.nome)}</strong><span>${escapeHtml(area.emoji)} ${escapeHtml(area.nome)}${employee ? ` · ${escapeHtml(employee.nome)}` : ''}</span></div>
                    ${urgent || actions ? `<div class="task-card-side">${urgent}${actions ? `<div class="task-card-actions">${actions}</div>` : ''}</div>` : ''}
                </div>
            </article>`;
        };
        list.innerHTML = groups.map(group => `<li class="task-section ${group.className || ''}"><div class="task-section-title">${group.title}<span>${group.items.length}</span></div><div class="task-section-grid">${group.items.map(renderCard).join('')}</div></li>`).join('');
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
            procedimentoFormato: hasRichMarkup(activity.procedimento || template.instrucoes) ? 'rico' : (activity.procedimentoFormato || template.procedimentoFormato || 'texto'),
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
        const procedureFormat = activity.procedimentoFormato || template.procedimentoFormato || 'texto';
        document.getElementById('taskPopProcedure').innerHTML = `<strong>Procedimento</strong><div class="task-procedure-content">${procedureHtml(activity.procedimento || template.instrucoes || 'Sem procedimento informado.', procedureFormat)}</div>`;
        document.getElementById('taskPopEmployee').innerHTML = employees.map(employee => `<option value="${escapeHtml(employee.id)}" ${employee.id === selected ? 'selected' : ''}>${escapeHtml(employee.nome)}</option>`).join('');
        document.getElementById('taskPopObservation').innerHTML = '';
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
            observacao: richEditorValue('taskPopObservation')
        });
    }
    async function markTaskNotDone(id) {
        const activity = activities.find(item => item.id === id);
        if (!activity || activity.status !== 'pendente') return;
        const confirmed = await global.AloUiDialog.confirm(`A atividade “${activity.nome}” foi marcada como não realizada?`, {
            title: '', icon: '', tone: 'danger', confirmText: 'Confirmar', compact: true
        });
        if (!confirmed) return;
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
        const procedureFormat = hasRichMarkup(procedure) ? 'rico' : (activity.procedimentoFormato || template.procedimentoFormato || 'texto');
        const timing = taskTiming(activity);
        const statusText = activity.status === 'em_execucao' ? 'Em execução' : activity.status === 'concluida' ? 'Concluída' : activity.status === 'nao_realizada' ? 'Não realizada' : activity.status === 'cancelada' ? 'Cancelada' : (timing.overdue ? 'Atrasada' : 'Pendente');
        const isFinished = isFinalStatus(activity.status);
        const editableStatus = isFinished || activity.status === 'em_execucao';
        const statusClass = activity.status === 'em_execucao' ? 'running' : (activity.status === 'concluida' ? 'completed' : (timing.overdue ? 'late' : 'pending'));
        finishedActivityId = id;
        document.getElementById('taskDetailsTitle').innerText = isFinished ? 'Registro da Atividade' : 'Detalhes da Atividade';
        const choices = document.getElementById('taskFinishedChoices');
        choices.style.display = 'none';
        choices.style.gridTemplateColumns = isFinished ? '' : '1fr';
        document.getElementById('taskResumeButton').style.display = isFinished ? '' : 'none';
        document.getElementById('taskPendingButton').style.display = editableStatus ? '' : 'none';
        const detailActions = document.getElementById('taskDetailActions');
        detailActions.style.gridTemplateColumns = activity.status === 'pendente' ? 'repeat(2, minmax(0, 1fr))' : '1fr';
        detailActions.innerHTML = activity.status === 'pendente'
            ? `<button class="task-primary-action" onclick="AloTasks.runTaskDetailAction('start')">▶ Iniciar</button><button class="task-complete-action" onclick="AloTasks.runTaskDetailAction('complete')">✓ Concluído</button>`
            : (activity.status === 'em_execucao' ? `<button class="task-complete-action" onclick="AloTasks.runTaskDetailAction('complete')">✓ Concluído</button>` : '');
        document.getElementById('taskFinishedContent').innerHTML = `
            <div class="task-finished-summary"><strong>${escapeHtml(activity.nome)}</strong><span class="task-detail-status ${statusClass}">${statusText}${editableStatus ? `<button type="button" class="task-status-edit-button" onclick="AloTasks.toggleTaskStatusEditMenu()" aria-label="Editar estado" title="Editar estado" aria-expanded="false">✎</button>` : ''}</span></div>
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
            ${template.fotoReferencia ? '<div id="taskDetailPhoto" class="task-reference-photo"><span>Carregando foto...</span></div>' : ''}
            ${procedure ? `<div class="task-procedure-box"><strong>Procedimento</strong><div class="task-procedure-content">${procedureHtml(procedure, procedureFormat)}</div></div>` : ''}
            ${activity.observacao ? `<div class="task-procedure-box"><strong>Observação</strong><div class="task-procedure-content">${sanitizeRichHtml(activity.observacao)}</div></div>` : ''}`;
        deps.openModalTop('modalTaskFinished');
        if (template.fotoReferencia) renderTaskPhoto(template.id, 'taskDetailPhoto');
    }
    function openFinishedTask(id) { openTaskDetails(id); }
    function closeFinishedTask() {
        finishedActivityId = '';
        closeTaskStatusEditMenu();
        document.getElementById('modalTaskFinished').style.display = 'none';
    }
    function closeTaskStatusEditMenu() {
        const choices = document.getElementById('taskFinishedChoices');
        const button = document.querySelector('#taskFinishedContent .task-status-edit-button');
        if (choices) {
            choices.style.display = 'none';
            choices.style.visibility = '';
        }
        if (button) button.setAttribute('aria-expanded', 'false');
    }
    function positionTaskStatusEditMenu() {
        const choices = document.getElementById('taskFinishedChoices');
        const button = document.querySelector('#taskFinishedContent .task-status-edit-button');
        if (!choices || !button || choices.style.display === 'none') return;
        const buttonRect = button.getBoundingClientRect();
        const menuRect = choices.getBoundingClientRect();
        const gap = 10;
        const left = Math.min(global.innerWidth - menuRect.width - 10, Math.max(10, buttonRect.right - menuRect.width));
        const roomAbove = buttonRect.top - menuRect.height - gap;
        const top = roomAbove >= 10 ? roomAbove : Math.min(global.innerHeight - menuRect.height - 10, buttonRect.bottom + gap);
        choices.dataset.placement = roomAbove >= 10 ? 'above' : 'below';
        choices.style.left = `${left}px`;
        choices.style.top = `${top}px`;
        choices.style.visibility = 'visible';
    }
    function toggleTaskStatusEditMenu() {
        const choices = document.getElementById('taskFinishedChoices');
        const button = document.querySelector('#taskFinishedContent .task-status-edit-button');
        const opening = choices.style.display === 'none';
        if (!opening) {
            closeTaskStatusEditMenu();
            return;
        }
        choices.style.visibility = 'hidden';
        choices.style.display = 'grid';
        if (button) button.setAttribute('aria-expanded', 'true');
        requestAnimationFrame(positionTaskStatusEditMenu);
    }
    function runTaskDetailAction(action) {
        const activity = activities.find(item => item.id === finishedActivityId);
        if (!activity) return;
        const id = activity.id;
        const direct = activity.status === 'pendente';
        closeFinishedTask();
        if (action === 'start') startTask(id);
        if (action === 'complete') completeTask(id, direct);
    }
    function undoFinishedTask(targetStatus) {
        const activity = activities.find(item => item.id === finishedActivityId);
        if (!activity || !isFinalStatus(activity.status) || !['pendente', 'em_execucao'].includes(targetStatus)) return;
        const template = db().tarefas.find(item => item.id === activity.tarefaId) || {};
        const schedule = scheduleForActivity(activity, template);
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
            alarmeStatus: targetStatus === 'em_execucao' ? 'reconhecido' : (schedule.alarme === false ? 'desativado' : 'aguardando')
        }, previousStatus);
    }
    function returnTaskToPending() {
        const activity = activities.find(item => item.id === finishedActivityId);
        if (!activity) return;
        if (isFinalStatus(activity.status)) {
            undoFinishedTask('pendente');
            return;
        }
        if (activity.status !== 'em_execucao') return;
        const template = db().tarefas.find(item => item.id === activity.tarefaId) || {};
        const schedule = scheduleForActivity(activity, template);
        const previousStatus = activity.status;
        closeFinishedTask();
        queueActivity({
            ...activity,
            status: 'pendente',
            iniciadoEm: '',
            finalizadoEm: '',
            duracaoSegundos: 0,
            funcionarioId: template.funcionarioId || '',
            funcionarioNome: '',
            alarmeStatus: schedule.alarme === false ? 'desativado' : 'aguardando'
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
        const schedule = scheduleForActivity(activity, template);
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
            alarmeStatus: schedule.alarme === false ? 'desativado' : 'aguardando'
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
        document.getElementById('globalTaskAlarmMeta').innerText = `${area.emoji} ${area.nome}\u00a0·\u00a0${activity.horario}${due.length > 1 ? `\u00a0·\u00a0+${due.length - 1}` : ''}`;
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
        selectedTab = 'total';
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
        closeAreaPicker();
        render();
    }

    function closeAllSettings() {
        ['modalPainelUnificado', 'modalConfigTasksMenu', 'modalTasksManager', 'modalTaskForm', 'modalTaskHygieneLibrary', 'modalTaskQr', 'modalTaskReports', 'modalTaskHistory', 'modalTaskBasicSettings']
            .forEach(id => { const element = document.getElementById(id); if (element) element.style.display = 'none'; });
    }
    function openSettingsMenu() {
        closeAllSettings();
        deps.openModalTop('modalConfigTasksMenu');
    }
    function backToControlPanel() {
        closeAllSettings();
        if (typeof global.voltarConfiguracoesTarefas === 'function') global.voltarConfiguracoesTarefas();
        else deps.openModalTop('modalPainelUnificado');
    }
    function backToSettingsMenu(closeId) {
        if (closeId) document.getElementById(closeId).style.display = 'none';
        else document.getElementById('modalTasksManager').style.display = 'none';
        deps.openModalTop('modalConfigTasksMenu');
    }
    function backFromManager() {
        if (managerType === 'employees') {
            document.getElementById('modalTasksManager').style.display = 'none';
            openManager('areas');
            return;
        }
        backToSettingsMenu();
    }
    function managerItem(title, subtitle, index, active, qrId = '') {
        return `<div class="task-manager-item ${active === false ? 'inactive' : ''}"><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span></div><div class="task-manager-actions">${qrId ? `<button onclick="AloTasks.openTaskQr('${escapeHtml(qrId)}')" aria-label="Gerar QR Code" title="Gerar QR Code">▦</button>` : ''}<button onclick="AloTasks.editManagedItem(${index})" aria-label="Editar" title="Editar">✏️</button></div></div>`;
    }
    function openManager(type) {
        managerType = type;
        document.getElementById('modalConfigTasksMenu').style.display = 'none';
        const title = document.getElementById('tasksManagerTitle');
        const list = document.getElementById('tasksManagerList');
        const button = document.getElementById('tasksManagerNew');
        const hygieneButton = document.getElementById('tasksManagerHygiene');
        const employeesButton = document.getElementById('tasksManagerEmployees');
        button.onclick = () => openForm(type, -1);
        if (hygieneButton) hygieneButton.style.display = type === 'templates' ? 'block' : 'none';
        if (employeesButton) employeesButton.style.display = type === 'areas' ? 'block' : 'none';
        if (type === 'areas') {
            title.innerText = 'Setores do Estabelecimento';
            list.innerHTML = db().setoresTarefas.map((area, index) => managerItem(`${area.emoji} ${area.nome}`, area.ativo === false ? 'Inativo' : 'Ativo', index, area.ativo)).join('');
        } else if (type === 'employees') {
            title.innerText = 'Funcionários';
            list.innerHTML = db().funcionarios.map((employee, index) => managerItem(employee.nome, employee.setorId ? getArea(employee.setorId).nome : 'Todos os setores', index, employee.ativo)).join('');
        } else {
            title.innerText = 'Tarefas Cadastradas';
            list.innerHTML = db().tarefas.map((task, index) => {
                const schedules = getTaskSchedules(task);
                const scheduleSummary = schedules.length === 1 ? `${schedules[0].horario} · ${recurrenceLabel(schedules[0])}` : `${schedules.length} horários cadastrados`;
                return managerItem(task.nome, `${getArea(task.setorId).nome} · ${scheduleSummary}`, index, task.ativo, task.id);
            }).join('');
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
    function recurrenceLabel(schedule) {
        if (schedule.recorrencia === 'unica') return `Uma vez · ${formatDateKey(schedule.dataUnica)}`;
        if (schedule.recorrencia === 'mensal') return `Todo mês · dia ${schedule.diaMes}`;
        if (schedule.recorrencia === 'intervalo_meses') return `A cada ${schedule.intervaloMeses} meses`;
        if (schedule.recorrencia === 'semanal') {
            const names = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
            return (schedule.dias || []).map(day => names[Number(day)]).filter(Boolean).join(', ') || 'Dias não definidos';
        }
        return 'Todos os dias';
    }
    function renderTaskSchedules() {
        const list = document.getElementById('taskScheduleList');
        if (!list) return;
        const schedules = formState.schedules || [];
        list.innerHTML = schedules.length ? schedules.map((schedule, index) => `
            <div class="task-schedule-card">
                <div class="task-schedule-time"><span>🕒</span><strong>${escapeHtml(schedule.horario)}</strong></div>
                <div class="task-schedule-copy"><strong>${escapeHtml(recurrenceLabel(schedule))}</strong><small>${schedule.alarme === false ? 'Sem alarme' : 'Com alarme'}</small></div>
                <button type="button" onclick="AloTasks.openScheduleEditor(${index})" aria-label="Editar horário" title="Editar horário">✎</button>
                <button type="button" class="task-schedule-delete" onclick="AloTasks.deleteScheduleDraft(${index})" aria-label="Excluir horário" title="Excluir horário">🗑️</button>
            </div>`).join('') : '<div class="task-schedule-empty">Cadastre pelo menos um horário.</div>';
    }
    function openScheduleEditor(index = -1) {
        const panel = document.getElementById('taskScheduleEditor');
        if (!panel) return;
        const schedule = index >= 0
            ? formState.schedules[index]
            : { horario: '', recorrencia: '', dias: [], dataUnica: '', diaMes: 1, intervaloMeses: 2, dataInicio: todayKey(), alarme: false };
        formState.editingSchedule = index;
        const dayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
        panel.innerHTML = `
            <div class="task-schedule-editor-head"><strong>${index >= 0 ? 'Editar horário' : 'Novo horário'}</strong><button type="button" onclick="AloTasks.cancelScheduleEditor()" aria-label="Fechar">×</button></div>
            <div class="task-form-grid">
                <div class="form-group"><label>Horário:</label><input id="taskScheduleTime" type="time" value="${escapeHtml(schedule.horario)}"></div>
                <div class="form-group"><label>Frequência:</label><select id="taskScheduleRecurrence" onchange="AloTasks.toggleScheduleRecurrenceFields()"><option value="" ${!schedule.recorrencia ? 'selected' : ''} disabled>Selecione</option><option value="diaria" ${schedule.recorrencia === 'diaria' ? 'selected' : ''}>Todos os dias</option><option value="semanal" ${schedule.recorrencia === 'semanal' ? 'selected' : ''}>Dias específicos</option><option value="mensal" ${schedule.recorrencia === 'mensal' ? 'selected' : ''}>Todo mês</option><option value="intervalo_meses" ${schedule.recorrencia === 'intervalo_meses' ? 'selected' : ''}>A cada alguns meses</option><option value="unica" ${schedule.recorrencia === 'unica' ? 'selected' : ''}>Uma única vez</option></select></div>
            </div>
            <div id="taskScheduleWeekDays" class="task-weekdays">${dayNames.map((name, day) => `<label><input type="checkbox" value="${day}" ${(schedule.dias || []).map(Number).includes(day) ? 'checked' : ''}><span>${name}</span></label>`).join('')}</div>
            <div id="taskScheduleOneDate" class="form-group"><label>Data:</label><input id="taskScheduleDate" type="date" value="${escapeHtml(schedule.dataUnica)}"></div>
            <div id="taskScheduleMonthDay" class="form-group"><label>Dia do mês:</label><input id="taskScheduleDayOfMonth" type="number" min="1" max="31" value="${Number(schedule.diaMes || 1)}"></div>
            <div id="taskScheduleMonthInterval" class="task-form-grid"><div class="form-group"><label>Repetir a cada:</label><select id="taskScheduleIntervalMonths"><option value="2" ${Number(schedule.intervaloMeses) === 2 ? 'selected' : ''}>2 meses</option><option value="3" ${Number(schedule.intervaloMeses) === 3 ? 'selected' : ''}>3 meses</option><option value="4" ${Number(schedule.intervaloMeses) === 4 ? 'selected' : ''}>4 meses</option><option value="6" ${Number(schedule.intervaloMeses) === 6 ? 'selected' : ''}>6 meses</option><option value="12" ${Number(schedule.intervaloMeses) === 12 ? 'selected' : ''}>12 meses</option></select></div><div class="form-group"><label>Começando em:</label><input id="taskScheduleStartDate" type="date" value="${escapeHtml(schedule.dataInicio || todayKey())}"></div></div>
            <label class="task-toggle-row task-alarm-toggle"><span class="task-toggle-copy"><b aria-hidden="true">⏰</b><strong>Alarme</strong></span><span class="switch-moderno"><input id="taskScheduleAlarm" type="checkbox" ${schedule.alarme ? 'checked' : ''}><span class="switch-trilho"></span></span></label>
            <div class="task-schedule-editor-actions"><button type="button" class="btn-cancel" onclick="AloTasks.cancelScheduleEditor()">Cancelar</button><button type="button" class="btn-action" onclick="AloTasks.saveScheduleDraft()">Salvar horário</button></div>`;
        panel.style.display = 'block';
        toggleScheduleRecurrenceFields();
        requestAnimationFrame(() => panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
    function toggleScheduleRecurrenceFields() {
        const recurrence = document.getElementById('taskScheduleRecurrence')?.value;
        const weekdays = document.getElementById('taskScheduleWeekDays');
        const date = document.getElementById('taskScheduleOneDate');
        const monthDay = document.getElementById('taskScheduleMonthDay');
        const monthInterval = document.getElementById('taskScheduleMonthInterval');
        if (weekdays) weekdays.style.display = recurrence === 'semanal' ? 'grid' : 'none';
        if (date) date.style.display = recurrence === 'unica' ? 'block' : 'none';
        if (monthDay) monthDay.style.display = recurrence === 'mensal' ? 'block' : 'none';
        if (monthInterval) monthInterval.style.display = recurrence === 'intervalo_meses' ? 'grid' : 'none';
    }
    function saveScheduleDraft() {
        const time = document.getElementById('taskScheduleTime')?.value;
        const recurrence = document.getElementById('taskScheduleRecurrence')?.value;
        const days = Array.from(document.querySelectorAll('#taskScheduleWeekDays input:checked')).map(input => Number(input.value));
        const date = document.getElementById('taskScheduleDate')?.value;
        if (!time) { alert('Informe o horário.'); return false; }
        if (!recurrence) { alert('Escolha a frequência.'); return false; }
        if (recurrence === 'semanal' && !days.length) { alert('Escolha pelo menos um dia da semana.'); return false; }
        if (recurrence === 'unica' && !date) { alert('Informe a data.'); return false; }
        const index = Number(formState.editingSchedule);
        const current = index >= 0 ? formState.schedules[index] : null;
        const value = normalizeSchedule({
            id: current?.id || (formState.schedules.length ? createId('horario') : 'principal'),
            horario: time,
            recorrencia: recurrence,
            dias: recurrence === 'diaria' ? [0, 1, 2, 3, 4, 5, 6] : days,
            dataUnica: date || todayKey(),
            diaMes: Number(document.getElementById('taskScheduleDayOfMonth')?.value || 1),
            intervaloMeses: Number(document.getElementById('taskScheduleIntervalMonths')?.value || 6),
            dataInicio: document.getElementById('taskScheduleStartDate')?.value || todayKey(),
            alarme: document.getElementById('taskScheduleAlarm').checked
        }, index >= 0 ? index : formState.schedules.length);
        if (index >= 0) formState.schedules[index] = value;
        else formState.schedules.push(value);
        cancelScheduleEditor();
        renderTaskSchedules();
        return true;
    }
    function cancelScheduleEditor() {
        const panel = document.getElementById('taskScheduleEditor');
        if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
        formState.editingSchedule = -1;
    }
    function deleteScheduleDraft(index) {
        formState.schedules.splice(index, 1);
        cancelScheduleEditor();
        renderTaskSchedules();
    }
    function openHygieneLibrary() {
        document.getElementById('modalConfigTasksMenu').style.display = 'none';
        document.getElementById('modalTasksManager').style.display = 'none';
        hygieneGroupFilter = 'Todos';
        renderHygieneLibrary(true);
        deps.openModalTop('modalTaskHygieneLibrary');
    }
    function renderHygieneLibrary(renderFilters = false) {
        const list = document.getElementById('taskHygieneLibraryList');
        const filters = document.getElementById('taskHygieneFilters');
        const templates = global.AloTaskTemplates?.templates || [];
        const groups = ['Todos', ...new Set(templates.map(template => template.group || template.category))];
        if (renderFilters) {
            filters.innerHTML = groups.map(group => `<button type="button" data-hygiene-group="${escapeHtml(group)}" class="${group === hygieneGroupFilter ? 'active' : ''}" onclick="AloTasks.setHygieneGroup('${escapeHtml(group)}')">${escapeHtml(group)}</button>`).join('');
        }
        const visible = hygieneGroupFilter === 'Todos' ? templates : templates.filter(template => (template.group || template.category) === hygieneGroupFilter);
        list.innerHTML = visible.map(template => `
            <article class="task-hygiene-template">
                <span class="task-hygiene-template-icon">${escapeHtml(template.icon)}</span>
                <div><small>${escapeHtml(template.group || template.category)}</small><strong>${escapeHtml(template.name)}</strong><span>${template.pop ? 'POP' : 'Registro'} · ${template.schedules.length} ${template.schedules.length === 1 ? 'horário' : 'horários'}</span></div>
                <button type="button" onclick="AloTasks.useHygieneTemplate('${escapeHtml(template.id)}')">Usar modelo</button>
            </article>`).join('');
    }
    function setHygieneGroup(group) {
        hygieneGroupFilter = group;
        document.querySelectorAll('#taskHygieneFilters button').forEach(button => {
            button.classList.toggle('active', button.dataset.hygieneGroup === group);
        });
        renderHygieneLibrary(false);
    }
    function closeHygieneLibrary() {
        document.getElementById('modalTaskHygieneLibrary').style.display = 'none';
        openManager('templates');
    }
    function taskPublicUrl(taskId) {
        const url = new URL(global.location.href);
        url.hash = '';
        url.search = '';
        url.searchParams.set('consulta', 'tarefa');
        url.searchParams.set('id', taskId);
        const apiUrl = deps.getUrl();
        if (apiUrl) url.searchParams.set('api', apiUrl);
        return url.toString();
    }
    function openTaskQr(taskId) {
        const task = db().tarefas.find(item => item.id === taskId);
        if (!task || typeof global.qrcode !== 'function') return alert('Não foi possível gerar o QR Code.');
        const publicUrl = taskPublicUrl(taskId);
        const qr = global.qrcode(0, 'M');
        qr.addData(publicUrl);
        qr.make();
        document.getElementById('taskQrName').textContent = task.nome;
        document.getElementById('taskQrCode').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 4, scalable: true });
        document.getElementById('taskQrLocalWarning').style.display = ['127.0.0.1', 'localhost'].includes(global.location.hostname) || !deps.getUrl() ? 'block' : 'none';
        deps.openModalTop('modalTaskQr');
    }
    function closeTaskQr() { document.getElementById('modalTaskQr').style.display = 'none'; }
    function printTaskQr() {
        document.body.classList.add('printing-task-qr');
        global.print();
        setTimeout(() => document.body.classList.remove('printing-task-qr'), 500);
    }

    async function openPublicTaskFromUrl() {
        const params = new URLSearchParams(global.location.search);
        if (params.get('consulta') !== 'tarefa') return false;
        const taskId = params.get('id') || '';
        const apiUrl = params.get('api') || deps.getUrl();
        const view = document.getElementById('publicTaskView');
        const content = document.getElementById('publicTaskContent');
        document.getElementById('splashScreen').style.display = 'none';
        document.getElementById('moduleHome').style.display = 'none';
        document.getElementById('kdsModule').style.display = 'none';
        document.getElementById('tasksModule').style.display = 'none';
        view.style.display = 'block';
        if (!apiUrl || !taskId) {
            content.innerHTML = '<div class="public-task-error"><strong>Consulta indisponível</strong><span>O QR Code está incompleto. Gere um novo código nas configurações da tarefa.</span></div>';
            return true;
        }
        try {
            const bank = await global.AloApi.getBank(apiUrl);
            const task = (bank.tarefas || []).find(item => String(item.id) === taskId);
            if (!task) throw new Error('Tarefa não encontrada.');
            const area = (bank.setoresTarefas || []).find(item => item.id === task.setorId) || { nome: 'Sem setor', emoji: '📍' };
            const end = new Date();
            const start = new Date();
            start.setDate(start.getDate() - 365);
            const history = await global.AloApi.getActivityHistory(apiUrl, todayKey(start), todayKey(end));
            const records = (history.atividades || []).filter(item => String(item.tarefaId) === taskId && item.status === 'concluida')
                .sort((left, right) => new Date(right.finalizadoEm || 0) - new Date(left.finalizadoEm || 0)).slice(0, 12);
            let photoUrl = '';
            if (task.fotoReferencia) {
                try { const photo = await global.AloApi.getTaskPhoto(apiUrl, taskId); photoUrl = photo?.encontrada ? photo.url : ''; } catch (error) {}
            }
            content.innerHTML = `
                <section class="public-task-summary"><span>${escapeHtml(area.emoji)}</span><div><small>${escapeHtml(area.nome)}</small><h1>${escapeHtml(task.nome)}</h1><p>Consulta do procedimento e das execuções registradas.</p></div></section>
                ${photoUrl ? `<section class="public-task-panel"><h2>Foto de referência</h2><img class="public-task-photo" src="${escapeHtml(photoUrl)}" alt="Foto de referência da atividade"></section>` : ''}
                <section class="public-task-panel"><h2>Procedimento</h2><div class="task-procedure-content">${procedureHtml(task.instrucoes || 'Procedimento não informado.', task.procedimentoFormato || 'rico')}</div></section>
                <section class="public-task-panel"><h2>Últimas execuções</h2>${records.length ? `<div class="public-task-history">${records.map(record => `<article><strong>${escapeHtml(formatDateTime(record.finalizadoEm))}</strong><span>${escapeHtml(record.funcionarioNome || 'Responsável não informado')}</span>${record.observacao ? `<small>${sanitizeRichHtml(record.observacao)}</small>` : ''}</article>`).join('')}</div>` : '<div class="tasks-empty">Nenhuma execução encontrada no último ano.</div>'}</section>
                <p class="public-task-footnote">Registro operacional do Alô Cozinha. Em caso de dúvida, consulte o responsável pelo estabelecimento.</p>`;
        } catch (error) {
            content.innerHTML = `<div class="public-task-error"><strong>Não foi possível carregar</strong><span>${escapeHtml(error.message || 'Verifique a internet e tente novamente.')}</span></div>`;
        }
        return true;
    }
    function useHygieneTemplate(id) {
        const template = (global.AloTaskTemplates?.templates || []).find(item => item.id === id);
        if (!template) return;
        const hint = String(template.areaHint || '').toLocaleLowerCase('pt-BR');
        const area = db().setoresTarefas.find(item => String(item.nome || '').toLocaleLowerCase('pt-BR').includes(hint))
            || db().setoresTarefas.find(item => item.ativo !== false)
            || db().setoresTarefas[0];
        document.getElementById('modalTaskHygieneLibrary').style.display = 'none';
        openForm('templates', -1, {
            id: createId('tarefa'),
            nome: template.name,
            setorId: area?.id || '',
            funcionarioId: '',
            programacoes: template.schedules,
            prioridade: 'normal',
            tempoEsperadoMin: template.expected,
            instrucoes: template.procedure,
            procedimentoFormato: 'rico',
            permiteRemarcacao: template.id === 'higienizar_reservatorio',
            registroPop: template.pop,
            ativo: true
        });
    }
    function openForm(type, index, preset = null) {
        formState = { type, index, schedules: [], editingSchedule: -1 };
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
            const isNewTask = !preset && index < 0;
            const task = preset || (index >= 0 ? db().tarefas[index] : { id: createId('tarefa'), nome: '', setorId: db().setoresTarefas[0]?.id || '', funcionarioId: '', prioridade: 'normal', tempoEsperadoMin: 0, instrucoes: '', procedimentoFormato: 'rico', permiteRemarcacao: false, registroPop: false, ativo: true });
            title.innerText = index >= 0 ? 'Editar Tarefa' : 'Nova Tarefa';
            formState.taskId = task.id;
            formState.schedules = isNewTask ? [] : getTaskSchedules(task);
            formState.hasPhoto = Boolean(task.fotoReferencia);
            pendingTaskPhoto = '';
            removeTaskPhoto = false;
            body.innerHTML = `
                <div class="form-group"><label>Nome curto:</label><input id="taskName" value="${escapeHtml(task.nome)}" placeholder="Ex: Higienizar bancada"></div>
                <div class="task-form-grid"><div class="form-group"><label>Setor:</label><select id="taskArea" onchange="AloTasks.refreshTaskEmployeeOptions()">${areaOptions(task.setorId)}</select></div><div class="form-group"><label>Responsável:</label><select id="taskEmployee">${employeeOptions(task.funcionarioId, task.setorId)}</select></div></div>
                <section class="task-schedule-section"><div class="task-form-section-title"><strong>Horários e frequência</strong><button type="button" class="task-add-schedule" onclick="AloTasks.openScheduleEditor()">＋ Cadastrar horário</button></div><div id="taskScheduleList" class="task-schedule-list"></div><div id="taskScheduleEditor" class="task-schedule-editor" style="display:none"></div></section>
                <div class="task-form-grid"><div class="form-group"><label>Prioridade:</label><select id="taskPriority"><option value="normal" ${task.prioridade !== 'urgente' ? 'selected' : ''}>Normal</option><option value="urgente" ${task.prioridade === 'urgente' ? 'selected' : ''}>Urgente</option></select></div><div class="form-group"><label>Tempo esperado (min.):</label><input id="taskExpected" type="number" min="0" inputmode="numeric" value="${Number(task.tempoEsperadoMin || 0)}" onfocus="this.select()" onclick="this.select()"></div></div>
                <div class="form-group"><label>Procedimento:</label>${richEditorMarkup('taskInstructions', task.instrucoes, task.procedimentoFormato, 'Escreva o procedimento', 1800)}</div>
                <div class="task-photo-field"><div class="task-form-section-title"><strong>Foto de referência</strong><button type="button" class="task-photo-pick" onclick="document.getElementById('taskPhotoInput').click()">📷 Escolher foto</button></div><input id="taskPhotoInput" type="file" accept="image/jpeg,image/png,image/webp" hidden onchange="AloTasks.handleTaskPhoto(this)"><div class="task-photo-preview"><span id="taskPhotoPreviewEmpty">Nenhuma foto cadastrada</span><img id="taskPhotoPreviewImage" alt="Prévia da foto de referência" style="display:none"><button type="button" id="taskPhotoRemoveButton" onclick="AloTasks.removeTaskPhotoDraft()" style="display:none">Remover foto</button></div></div>
                <div class="task-option-grid"><label class="task-toggle-row"><span class="task-toggle-copy"><b aria-hidden="true">📅</b><strong>Permitir remarcar</strong></span><span class="switch-moderno"><input id="taskAllowReschedule" type="checkbox" ${task.permiteRemarcacao ? 'checked' : ''}><span class="switch-trilho"></span></span></label><label class="task-toggle-row"><span class="task-toggle-copy"><b aria-hidden="true">📋</b><strong>Exigir registro POP</strong></span><span class="switch-moderno"><input id="taskPopRequired" type="checkbox" ${task.registroPop ? 'checked' : ''}><span class="switch-trilho"></span></span></label><label class="task-toggle-row"><span class="task-toggle-copy"><b aria-hidden="true">✓</b><strong>Tarefa ativa</strong></span><span class="switch-moderno"><input id="taskActive" type="checkbox" ${task.ativo !== false ? 'checked' : ''}><span class="switch-trilho"></span></span></label></div>`;
            renderTaskSchedules();
        }
        deps.openModalTop('modalTaskForm');
        if (type === 'templates' && formState.hasPhoto) requestAnimationFrame(() => loadTaskFormPhoto(formState.taskId));
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
    async function saveCurrentForm() {
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
            if (document.getElementById('taskScheduleEditor')?.style.display !== 'none' && !saveScheduleDraft()) return;
            if (!nome || !setorId) return alert('Informe nome e setor.');
            if (!formState.schedules.length) return alert('Cadastre pelo menos um horário.');
            const current = index >= 0 ? db().tarefas[index] : null;
            const programacoes = formState.schedules.map((schedule, scheduleIndex) => normalizeSchedule(schedule, scheduleIndex));
            const principal = programacoes[0];
            const value = {
                id: current?.id || formState.taskId || createId('tarefa'), nome, setorId,
                funcionarioId: document.getElementById('taskEmployee').value,
                programacoes,
                horario: principal.horario,
                recorrencia: principal.recorrencia,
                dias: principal.dias,
                dataUnica: principal.dataUnica,
                diaMes: principal.diaMes,
                intervaloMeses: principal.intervaloMeses,
                dataInicio: principal.dataInicio,
                prioridade: document.getElementById('taskPriority').value,
                alarme: principal.alarme,
                tempoEsperadoMin: Number(document.getElementById('taskExpected').value || 0),
                instrucoes: richEditorValue('taskInstructions'),
                procedimentoFormato: 'rico',
                permiteRemarcacao: document.getElementById('taskAllowReschedule').checked,
                registroPop: document.getElementById('taskPopRequired').checked,
                fotoReferencia: removeTaskPhoto ? false : Boolean(pendingTaskPhoto || current?.fotoReferencia || formState.hasPhoto),
                ativo: document.getElementById('taskActive').checked
            };
            if (pendingTaskPhoto || removeTaskPhoto) {
                const serverUrl = deps.getUrl();
                if (!serverUrl) return alert('Configure a URL do servidor antes de salvar uma foto.');
                try {
                    if (pendingTaskPhoto) {
                        await global.AloApi.uploadTaskPhoto(serverUrl, value.id, pendingTaskPhoto);
                        taskPhotoCache.set(value.id, pendingTaskPhoto);
                    } else if (removeTaskPhoto) {
                        await global.AloApi.deleteTaskPhoto(serverUrl, value.id);
                        taskPhotoCache.delete(value.id);
                    }
                } catch (error) {
                    return alert('A foto não foi enviada. Verifique a internet e tente salvar novamente.');
                }
            }
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

    function renderReportAreaOptions() {
        const select = document.getElementById('taskReportsArea');
        if (!select) return;
        const areas = db().setoresTarefas;
        if (reportAreaId !== 'todos' && !areas.some(area => area.id === reportAreaId)) reportAreaId = 'todos';
        select.innerHTML = '<option value="todos">Todas as áreas</option>' + areas.map(area => `<option value="${escapeHtml(area.id)}">${escapeHtml(area.emoji)} ${escapeHtml(area.nome)}</option>`).join('');
        select.value = reportAreaId;
    }
    async function openReports() {
        document.getElementById('modalConfigTasksMenu').style.display = 'none';
        renderReportAreaOptions();
        deps.openModalTop('modalTaskReports');
        await renderReports(7, document.querySelector('#modalTaskReports .task-report-tabs button'));
    }
    async function renderReports(days, button, useCache = false) {
        reportDays = Number(days || 7);
        document.querySelectorAll('#modalTaskReports .task-report-tabs button').forEach(item => item.classList.toggle('active', item === button));
        const content = document.getElementById('taskReportsContent');
        if (!useCache) {
            content.innerHTML = '<div class="tasks-empty">Atualizando relatório...</div>';
            const end = new Date();
            const start = new Date();
            start.setDate(start.getDate() - (reportDays - 1));
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
            reportActivitiesCache = reportActivities.slice();
        }
        const reportActivities = reportActivitiesCache.filter(item => reportAreaId === 'todos' || item.setorId === reportAreaId);
        const completed = reportActivities.filter(item => item.status === 'concluida');
        const measured = completed.filter(item => item.iniciadoEm && item.duracaoSegundos > 0);
        const direct = completed.length - measured.length;
        const avg = measured.length ? Math.round(measured.reduce((sum, item) => sum + item.duracaoSegundos, 0) / measured.length) : 0;
        const late = reportActivities.filter(item => item.status === 'pendente' && scheduledDate(item) < new Date()).length;
        const byArea = new Map();
        completed.forEach(item => {
            if (!byArea.has(item.setorId)) byArea.set(item.setorId, new Map());
            const byTask = byArea.get(item.setorId);
            const current = byTask.get(item.tarefaId) || { id: item.tarefaId, nome: item.nome, count: 0, popCount: 0, seconds: 0, measured: 0 };
            current.count += 1;
            if (item.registroPop) current.popCount += 1;
            if (item.duracaoSegundos) { current.seconds += item.duracaoSegundos; current.measured += 1; }
            byTask.set(item.tarefaId, current);
        });
        const areaSections = Array.from(byArea.entries()).sort((left, right) => getArea(left[0]).nome.localeCompare(getArea(right[0]).nome, 'pt-BR')).map(([areaId, byTask]) => {
            const area = getArea(areaId);
            const tasksHtml = Array.from(byTask.values()).sort((a,b) => b.count-a.count).map(item => `<button type="button" onclick="AloTasks.openTaskHistory('${escapeHtml(item.id)}')"><span><strong>${escapeHtml(item.nome)}</strong><small>${item.count} registro(s)${item.popCount ? ` · ${item.popCount} POP` : ''}</small></span><b>${item.measured ? formatDuration(Math.round(item.seconds / item.measured)) : 'sem medição'}</b></button>`).join('');
            return `<section class="task-report-area-section"><h3>${escapeHtml(area.emoji)} ${escapeHtml(area.nome)}</h3><div class="task-report-list">${tasksHtml}</div></section>`;
        }).join('');
        content.innerHTML = `<div class="task-report-summary"><div><strong>${completed.length}</strong><span>Concluídas</span></div><div><strong>${formatDuration(avg)}</strong><span>Tempo médio</span></div><div><strong>${late}</strong><span>Atrasadas</span></div><div><strong>${direct}</strong><span>Sem início</span></div></div>${areaSections || '<div class="tasks-empty">Nenhuma tarefa concluída no período e na área escolhida.</div>'}`;
    }
    function changeReportArea(value) {
        reportAreaId = value || 'todos';
        renderReports(reportDays, document.querySelector('#modalTaskReports .task-report-tabs button.active'), true);
    }
    function openTaskHistory(taskId) {
        const records = reportActivitiesCache.filter(item => item.tarefaId === taskId && item.status === 'concluida').sort(sortByFinished);
        const template = db().tarefas.find(item => item.id === taskId) || {};
        const name = records[0]?.nome || template.nome || 'Tarefa';
        document.getElementById('taskHistoryTitle').innerText = `Histórico: ${name}`;
        document.getElementById('taskHistoryContent').innerHTML = records.length ? `<div class="task-history-list">${records.map(item => {
            const employee = item.funcionarioNome || getEmployee(item.funcionarioId)?.nome || 'Não informado';
            const area = getArea(item.setorId);
            return `<article class="task-history-record"><header><strong>${escapeHtml(formatDateTime(item.finalizadoEm))}</strong><span>${item.iniciadoEm ? escapeHtml(formatDuration(item.duracaoSegundos)) : 'Sem medição'}</span></header><div class="task-history-worker"><span>${escapeHtml(area.emoji)} ${escapeHtml(area.nome)}</span><span>Realizada por: <strong>${escapeHtml(employee)}</strong>${item.registroPop ? '<b>POP</b>' : ''}</span></div>${item.observacao ? `<div class="task-history-observation"><strong>Observação</strong><div class="task-procedure-content">${sanitizeRichHtml(item.observacao)}</div></div>` : ''}</article>`;
        }).join('')}</div>` : '<div class="tasks-empty">Nenhuma execução registrada neste período.</div>';
        deps.openModalTop('modalTaskHistory');
    }
    function closeTaskHistory() {
        document.getElementById('modalTaskHistory').style.display = 'none';
    }
    function printTaskHistory() { global.print(); }
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
        if (new URLSearchParams(global.location.search).get('consulta') === 'tarefa') {
            openPublicTaskFromUrl();
            return;
        }
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
        document.addEventListener('pointerdown', event => {
            const areaPicker = document.querySelector('.tasks-area-picker');
            if (areaPicker && !areaPicker.contains(event.target)) closeAreaPicker();
            const choices = document.getElementById('taskFinishedChoices');
            const button = document.querySelector('#taskFinishedContent .task-status-edit-button');
            if (!choices || choices.style.display === 'none' || choices.contains(event.target) || button?.contains(event.target)) return;
            closeTaskStatusEditMenu();
        });
        global.addEventListener('resize', positionTaskStatusEditMenu);
    }

    global.AloTasks = Object.freeze({
        init, refreshDefinitions, showHome, openModule, setTab, setArea, toggleAreaPicker, syncNow,
        startTask, completeTask, markTaskNotDone, confirmEmployeeSelection,
        openTaskDetails, openFinishedTask, closeFinishedTask, undoFinishedTask, returnTaskToPending,
        toggleTaskStatusEditMenu, runTaskDetailAction,
        openReschedule, cancelReschedule, confirmReschedule,
        cancelPopCompletion, confirmPopCompletion,
        openAlarmTask, startAlarmTask, completeAlarmTask, dismissAlarm,
        openSettingsMenu, backToControlPanel, backToSettingsMenu, backFromManager,
        manageTaskAreas, manageEmployees, manageTemplates, editManagedItem,
        cancelForm, saveCurrentForm, toggleRecurrenceFields, refreshTaskEmployeeOptions,
        openScheduleEditor, saveScheduleDraft, cancelScheduleEditor, deleteScheduleDraft, toggleScheduleRecurrenceFields,
        formatRichEditor, cycleRichEditorAlignment, limitRichEditor,
        handleTaskPhoto, removeTaskPhotoDraft,
        openHygieneLibrary, closeHygieneLibrary, setHygieneGroup, useHygieneTemplate,
        openTaskQr, closeTaskQr, printTaskQr,
        openBasicSettings, saveBasicSettings, openReports, renderReports, changeReportArea,
        openTaskHistory, closeTaskHistory, printTaskHistory, closeReports
    });
})(window);
