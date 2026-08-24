let db = carregarBanco();
    let categoriaAtual = null;
    let ordemPopular = false; // FLAG DO FILTRO "TODOS" DINÂMICO
    let pedidosServidor = [];
    let pedidosBloqueados = new Set();
    let pedidosCientes = new Set();
    let pedidosPendentesLocais = [];
    let loopSync = null;
    let wakeLock = null;
    let acaoPendente = null;
    let parametroAcao = null;

    let filaRetentativaStatus = JSON.parse(localStorage.getItem('kds_fila_status') || '[]');
    let processandoFilaStatus = false;
    let bancoPublicacaoTimer = null;
    let estadoSyncPedidosAtual = { pendingCount: 0, online: navigator.onLine };

    // CARREGAR HISTÓRICO SALVO LOCALMENTE (Evita perda de dados em reloads)
    let savedPedidos = localStorage.getItem('kds_pedidos_local');
    if (savedPedidos) { pedidosServidor = JSON.parse(savedPedidos); }
    let savedCientes = localStorage.getItem('kds_cientes_local');
    if (savedCientes) { pedidosCientes = new Set(JSON.parse(savedCientes)); }

    const hierarquiaStatus = { 'pendente': 1, 'fazendo': 2, 'enviado': 3, 'buscar': 3, 'cancelado': 4, 'concluido': 5 };
    const AREAS_PADRAO = [
        { id: 'panelas', nome: 'Panelas', tipo: 'envio', emoji: '🥘' },
        { id: 'cozinha', nome: 'Cozinha', tipo: 'recebimento', emoji: '🧑‍🍳' }
    ];

    function normalizarAreasERotas() {
        const recebidas = Array.isArray(db.areas) ? db.areas : [];
        const porId = new Map();
        [...AREAS_PADRAO, ...recebidas].forEach(area => {
            if (!area || !area.id) return;
            const id = String(area.id);
            const tipo = id === 'panelas' ? 'envio' : (id === 'cozinha' ? 'recebimento' : (area.tipo === 'recebimento' ? 'recebimento' : 'envio'));
            porId.set(String(area.id), {
                id,
                nome: String(area.nome || area.id),
                tipo,
                emoji: area.emoji === '🏺' ? '🥣' : (area.emoji || (tipo === 'recebimento' ? '🧑‍🍳' : '🥘'))
            });
        });
        db.areas = Array.from(porId.values());
        db.produtos = Array.isArray(db.produtos) ? db.produtos : [];
        db.produtos.forEach(produto => {
            const origensRecebidas = Array.isArray(produto.areasOrigem) && produto.areasOrigem.length
                ? produto.areasOrigem
                : [produto.areaOrigem || 'panelas'];
            produto.areasOrigem = [...new Set(origensRecebidas.map(String))]
                .filter(id => db.areas.some(area => area.id === id && area.tipo === 'envio'));
            if (!produto.areasOrigem.length) produto.areasOrigem = ['panelas'];
            produto.areaOrigem = produto.areasOrigem[0];
            if (!db.areas.some(area => area.id === produto.areaDestino && area.tipo === 'recebimento')) produto.areaDestino = 'cozinha';
        });
        const areaSalva = db.areas.find(area => area.id === db.configs.areaAtual);
        const areaLegada = db.areas.find(area => area.id === db.configs.modo);
        db.configs.areaAtual = (areaSalva || areaLegada || db.areas[0]).id;
        const atual = db.areas.find(area => area.id === db.configs.areaAtual);
        db.configs.modo = atual && atual.tipo === 'recebimento' ? 'cozinha' : 'panelas';
    }

    function getAreaAtual() {
        return db.areas.find(area => area.id === db.configs.areaAtual) || db.areas[0];
    }

    function getAreaNome(id) {
        const area = db.areas.find(item => item.id === id);
        return area ? area.nome : id;
    }

    function getEmojiAreaHtml(emoji) {
        return emoji === '🥣' || emoji === '🏺'
            ? '<span class="emoji-panela-barro" role="img" aria-label="Panela de barro">🥣</span>'
            : emoji;
    }

    function getAreasOrigemProduto(produto) {
        if (Array.isArray(produto.areasOrigem) && produto.areasOrigem.length) return produto.areasOrigem;
        return [produto.areaOrigem || 'panelas'];
    }

    function pedidoPertenceArea(pedido, area = getAreaAtual()) {
        if (!area) return true;
        return area.tipo === 'recebimento'
            ? (pedido.areaDestino || 'cozinha') === area.id
            : (pedido.areaOrigem || 'panelas') === area.id;
    }

    function pedidosDaAreaAtual() {
        const area = getAreaAtual();
        return pedidosServidor.filter(pedido => pedidoPertenceArea(pedido, area));
    }

    function renderizarSeletorAreas() {
        const seletor = document.getElementById('seletorModo');
        if (!seletor) return;
        seletor.innerHTML = db.areas.map(area =>
            `<option value="${area.id}">${area.emoji} ${area.nome}</option>`
        ).join('');
        seletor.value = db.configs.areaAtual;
        const areaAtual = getAreaAtual();
        const emojiAtual = document.getElementById('emojiAreaAtual');
        if (emojiAtual) emojiAtual.innerHTML = getEmojiAreaHtml(areaAtual.emoji);
        const nomeAtual = document.getElementById('nomeAreaAtual');
        if (nomeAtual) nomeAtual.innerText = areaAtual.nome;
        const options = document.getElementById('areaPickerOptions');
        if (options) {
            const title = document.createElement('div');
            title.className = 'header-area-options-title';
            title.textContent = 'Trocar área';
            options.replaceChildren(title, ...db.areas.map(area => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = `header-area-option${area.id === areaAtual.id ? ' selected' : ''}`;
                button.setAttribute('role', 'option');
                button.setAttribute('aria-selected', String(area.id === areaAtual.id));
                const emoji = document.createElement('span');
                emoji.className = 'header-area-option-emoji';
                emoji.innerHTML = getEmojiAreaHtml(area.emoji);
                const copy = document.createElement('span');
                copy.className = 'header-area-option-copy';
                const name = document.createElement('strong');
                name.textContent = area.nome;
                const role = document.createElement('small');
                role.textContent = area.tipo === 'recebimento' ? 'Recebe pedidos' : 'Envia pedidos';
                copy.append(name, role);
                const check = document.createElement('b');
                check.setAttribute('aria-hidden', 'true');
                check.textContent = area.id === areaAtual.id ? '✓' : '';
                button.append(emoji, copy, check);
                button.addEventListener('click', () => selecionarAreaCabecalho(area.id));
                return button;
            }));
        }
    }

    function fecharSeletorAreas() {
        const options = document.getElementById('areaPickerOptions');
        const button = document.getElementById('areaPickerButton');
        if (options) options.classList.remove('open');
        if (button) button.setAttribute('aria-expanded', 'false');
    }

    function toggleSeletorAreas() {
        const options = document.getElementById('areaPickerOptions');
        const button = document.getElementById('areaPickerButton');
        if (!options || !button) return;
        const opening = !options.classList.contains('open');
        options.classList.toggle('open', opening);
        button.setAttribute('aria-expanded', String(opening));
    }

    function selecionarAreaCabecalho(areaId) {
        fecharSeletorAreas();
        iniciarTrocaModo(areaId);
    }

    normalizarAreasERotas();
    salvarBancoLocal();

    const sonsDisponiveis = {
        "sem_som": { tipo: "silencio" },
        "alarme": { tipo: "audio", url: "./assets/sounds/alarme-curto.ogg" },
        "beep": { tipo: "audio", url: "./assets/sounds/beep-classico.ogg" },
        "sino_forte": { tipo: "audio", url: "./assets/sounds/sino-forte.ogg" },
        "sirene_cozinha": { tipo: "sintetico", intervalo: 950 },
        "alerta_triplo": { tipo: "sintetico", intervalo: 850 },
        "campainha_forte": { tipo: "sintetico", intervalo: 1000 },
        "toque_urgente": { tipo: "sintetico", intervalo: 750 }
    };

    let playerAlarme = new Audio(); playerAlarme.loop = true; let alarmeTocando = false; let previewAudio = null; let previewTimeout = null;
    let audioCtx = null; let somAtualTocando = "sem_som"; let alarmeSinteticoTimer = null; let envioPedidoEmAndamento = false;
    let filaStatusTimer = null;

    let timerInatividade = null;
    function resetInatividade() {
        document.getElementById('overlayInatividade').style.opacity = '0';
        setTimeout(() => document.getElementById('overlayInatividade').style.display = 'none', 300);
        clearTimeout(timerInatividade);
        let tempoMinutos = parseFloat(db.configs.inatividade || 0);
        if(tempoMinutos > 0) {
            timerInatividade = setTimeout(() => {
                document.getElementById('overlayInatividade').style.display = 'block';
                setTimeout(() => document.getElementById('overlayInatividade').style.opacity = '1', 50);
            }, tempoMinutos * 60000);
        }
    }
    document.addEventListener('touchstart', resetInatividade); document.addEventListener('mousemove', resetInatividade); document.addEventListener('click', resetInatividade);
    document.addEventListener('pointerdown', event => {
        const picker = document.querySelector('.header-area-picker');
        if (picker && !picker.contains(event.target)) fecharSeletorAreas();
    });

    function prepararAudioNoPrimeiroToque() {
        const ctx = getAudioCtx();
        if(!ctx) return;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        const osc = ctx.createOscillator();
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.03);
    }
    document.addEventListener('touchstart', prepararAudioNoPrimeiroToque, { once: true });
    document.addEventListener('click', prepararAudioNoPrimeiroToque, { once: true });

    async function solicitarWakeLock() {
        if(db.configs.telaAtiva === "nao") {
            if(wakeLock !== null) { wakeLock.release(); wakeLock = null; } return;
        }
        try { if ('wakeLock' in navigator) { wakeLock = await navigator.wakeLock.request('screen'); } } catch (err) {}
    }
    document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible') solicitarWakeLock(); });

    function getVolumePorSelect(selectId) {
        const idVolume = selectId === 'configSomPanelas' ? 'configVolumePanelas' : 'configVolumeCozinha';
        const input = document.getElementById(idVolume);
        const valor = input ? parseInt(input.value || '100', 10) : 100;
        return Math.max(0, Math.min(100, valor)) / 100;
    }

    function atualizarLabelsVolume() {
        const volumeCozinha = document.getElementById('configVolumeCozinha');
        const volumePanelas = document.getElementById('configVolumePanelas');
        const labelCozinha = document.getElementById('labelVolumeCozinha');
        const labelPanelas = document.getElementById('labelVolumePanelas');
        if(labelCozinha && volumeCozinha) labelCozinha.innerText = `${volumeCozinha.value}%`;
        if(labelPanelas && volumePanelas) labelPanelas.innerText = `${volumePanelas.value}%`;
    }

    function normalizarSom(valor, fallback) {
        if(valor === "sem_som") return "sem_som";
        return sonsDisponiveis[valor] ? valor : fallback;
    }

    function normalizarSonsConfigurados() {
        db.configs.somCozinha = normalizarSom(db.configs.somCozinha || "sem_som", "sirene_cozinha");
        db.configs.somPanelas = normalizarSom(db.configs.somPanelas || "sem_som", "beep");
    }

    function getAudioCtx() {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if(!AudioContextClass) return null;
        if(!audioCtx) audioCtx = new AudioContextClass();
        if(audioCtx.state === "suspended") audioCtx.resume().catch(()=>{});
        return audioCtx;
    }

    function tocarPulso(freqInicio, freqFim, atraso, duracao, volume, tipoOnda = "square", camadas = 1) {
        const ctx = getAudioCtx();
        if(!ctx || volume <= 0) return;
        const inicio = ctx.currentTime + atraso;
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.setValueAtTime(-24, inicio);
        compressor.knee.setValueAtTime(8, inicio);
        compressor.ratio.setValueAtTime(12, inicio);
        compressor.attack.setValueAtTime(0.003, inicio);
        compressor.release.setValueAtTime(0.12, inicio);
        compressor.connect(ctx.destination);
        setTimeout(() => { try { compressor.disconnect(); } catch(e) {} }, (atraso + duracao + 0.3) * 1000);

        for(let i = 0; i < camadas; i++) {
            const deslocamento = (i - ((camadas - 1) / 2)) * 18;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = tipoOnda;
            osc.frequency.setValueAtTime(freqInicio + deslocamento, inicio);
            osc.frequency.linearRampToValueAtTime(freqFim + deslocamento, inicio + duracao);
            gain.gain.setValueAtTime(0.0001, inicio);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume * 0.75), inicio + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, inicio + duracao);
            osc.connect(gain).connect(compressor);
            osc.start(inicio);
            osc.stop(inicio + duracao + 0.05);
        }
    }

    function tocarRuido(atraso, duracao, volume) {
        const ctx = getAudioCtx();
        if(!ctx || volume <= 0) return;
        const inicio = ctx.currentTime + atraso;
        const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duracao), ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for(let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * 0.55;
        const source = ctx.createBufferSource();
        const gain = ctx.createGain();
        const filter = ctx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.setValueAtTime(1600, inicio);
        filter.Q.setValueAtTime(1.6, inicio);
        gain.gain.setValueAtTime(0.0001, inicio);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume * 0.55), inicio + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, inicio + duracao);
        source.buffer = buffer;
        source.connect(filter).connect(gain).connect(ctx.destination);
        source.start(inicio);
        source.stop(inicio + duracao + 0.05);
        setTimeout(() => {
            try { source.disconnect(); filter.disconnect(); gain.disconnect(); } catch(e) {}
        }, (atraso + duracao + 0.3) * 1000);
    }

    function executarSomSintetico(tipo, volume) {
        const vol = Math.max(0, Math.min(1, volume));
        if(navigator.vibrate) navigator.vibrate(tipo === "toque_urgente" ? [120, 60, 120, 60, 220] : [180, 70, 180]);
        if(tipo === "sirene_cozinha") {
            tocarPulso(560, 1420, 0, 0.34, vol, "square", 3);
            tocarRuido(0.02, 0.18, vol);
            tocarPulso(1420, 560, 0.38, 0.34, vol, "square", 3);
            tocarRuido(0.40, 0.16, vol);
        } else if(tipo === "alerta_triplo") {
            tocarPulso(1180, 1180, 0, 0.16, vol, "square", 3);
            tocarPulso(1480, 1480, 0.22, 0.16, vol, "square", 3);
            tocarPulso(1180, 1180, 0.44, 0.22, vol, "square", 3);
            tocarRuido(0, 0.12, vol);
            tocarRuido(0.22, 0.12, vol);
            tocarRuido(0.44, 0.14, vol);
        } else if(tipo === "campainha_forte") {
            tocarPulso(920, 1620, 0, 0.18, vol, "sine", 4);
            tocarPulso(1620, 920, 0.2, 0.18, vol, "sine", 4);
            tocarPulso(1180, 1180, 0.48, 0.25, vol, "triangle", 4);
        } else if(tipo === "toque_urgente") {
            tocarPulso(780, 780, 0, 0.12, vol, "sawtooth", 3);
            tocarPulso(980, 980, 0.14, 0.12, vol, "sawtooth", 3);
            tocarPulso(1280, 1280, 0.28, 0.18, vol, "sawtooth", 3);
            tocarPulso(1620, 1620, 0.5, 0.22, vol, "square", 3);
            tocarRuido(0.5, 0.16, vol);
        }
    }

    function pararSomSintetico() {
        if(alarmeSinteticoTimer) {
            clearInterval(alarmeSinteticoTimer);
            alarmeSinteticoTimer = null;
        }
    }

    function tocarPreview(selectId) {
        if(previewAudio) { previewAudio.pause(); previewAudio.currentTime = 0; }
        if(previewTimeout) { clearTimeout(previewTimeout); }

        let val = normalizarSom(document.getElementById(selectId).value, selectId === 'configSomPanelas' ? 'beep' : 'alarme');
        if(val === "sem_som") return;

        const som = sonsDisponiveis[val];
        const volume = getVolumePorSelect(selectId);
        if(som.tipo === "audio") {
            previewAudio = new Audio(som.url);
            previewAudio.volume = volume;
            previewAudio.play().catch(()=>{});
            previewTimeout = setTimeout(() => { if(previewAudio) previewAudio.pause(); }, 3000);
        } else if(som.tipo === "sintetico") {
            executarSomSintetico(val, volume);
        }
    }

    function carregarBanco() {
        let defaultDB = {
            produtos: [], categorias: [], obsPedidos: ["Sem sal", "Pouco óleo"],
            obsCancelamentos: ["Falta de insumo", "Queimou"],
            setoresTarefas: [{ id: 'setor_cozinha', nome: 'Cozinha', emoji: '🧑‍🍳', ativo: true }],
            funcionarios: [], tarefas: [],
            configsTarefas: { som: 'beep', volume: '80', repeticaoMinutos: '5' },
            configs: { modo: "panelas", url: "", senhaMestra: "", senhaModo: "", somCozinha: "sem_som", somPanelas: "sem_som", volumeCozinha: "100", volumePanelas: "70", dadosBaixados: false, bancoPendente: false, revisaoBanco: 0, telaAtiva: "sim", inatividade: "0", reenvio: "permitido" }
        };
        let local = JSON.parse(localStorage.getItem('kds_v1_db'));
        if(local) {
            if(!local.configs) local.configs = defaultDB.configs;
            if(typeof local.configs.dadosBaixados === 'undefined') local.configs.dadosBaixados = false;
            if(typeof local.configs.bancoPendente === 'undefined') local.configs.bancoPendente = false;
            if(typeof local.configs.revisaoBanco === 'undefined') local.configs.revisaoBanco = 0;
            if(typeof local.configs.senhaMestra === 'undefined') local.configs.senhaMestra = '1999';
            if(!local.configs.telaAtiva) local.configs.telaAtiva = "sim";
            if(!local.configs.inatividade) local.configs.inatividade = "0";
            if(!local.configs.reenvio) local.configs.reenvio = "permitido";
            if(!local.configs.volumeCozinha) local.configs.volumeCozinha = "100";
            if(!local.configs.volumePanelas) local.configs.volumePanelas = "70";
            if(!Array.isArray(local.setoresTarefas) || !local.setoresTarefas.length) local.setoresTarefas = defaultDB.setoresTarefas;
            if(!Array.isArray(local.funcionarios)) local.funcionarios = [];
            if(!Array.isArray(local.tarefas)) local.tarefas = [];
            local.configsTarefas = { ...defaultDB.configsTarefas, ...(local.configsTarefas || {}) };
            return local;
        }
        return defaultDB;
    }
    function salvarBancoLocal() { localStorage.setItem('kds_v1_db', JSON.stringify(db)); }
    function marcarBancoAlterado() {
        db.configs.bancoPendente = true;
        salvarBancoLocal();
        atualizarIndicadorSincronizacao(estadoSyncPedidosAtual);
        agendarSincronizacaoBanco(450);
    }
    function salvarFilaStatus() { localStorage.setItem('kds_fila_status', JSON.stringify(filaRetentativaStatus)); }

    function salvarHistoricoLocal() {
        localStorage.setItem('kds_pedidos_local', JSON.stringify(pedidosServidor));
        localStorage.setItem('kds_cientes_local', JSON.stringify(Array.from(pedidosCientes)));
    }
    setInterval(salvarHistoricoLocal, 60000);

    function getTempoRelativo(timestamp) {
        const diffEmMs = Date.now() - new Date(timestamp).getTime();
        const minutos = Math.floor(diffEmMs / 60000);
        if (minutos < 1) return "&lt; 1 min";
        if (minutos === 1) return `há 1 min`;
        return `há ${minutos} min`;
    }

    let modoPendente = null; let seletorGlobal = null;
    function iniciarTrocaModo(selectElement) {
        const novoModo = typeof selectElement === 'string' ? selectElement : selectElement.value;
        if (db.configs.senhaModo && db.configs.senhaModo.trim() !== "") {
            modoPendente = novoModo; seletorGlobal = typeof selectElement === 'string' ? null : selectElement; document.getElementById('inputSenhaModo').value = ''; limparErroSenha('erroSenhaModo'); document.getElementById('modalSenhaModo').style.display = 'flex'; setTimeout(() => document.getElementById('inputSenhaModo').focus(), 100); if (seletorGlobal) seletorGlobal.value = db.configs.areaAtual;
        } else { efetivarTrocaModo(novoModo); }
    }

    function limparErroSenha(id) {
        const feedback = document.getElementById(id);
        if (feedback) feedback.innerText = '';
    }

    function senhaIncorreta(inputId, feedbackId) {
        const input = document.getElementById(inputId);
        const feedback = document.getElementById(feedbackId);
        if (feedback) feedback.innerText = 'Senha incorreta. Tente novamente.';
        if (input) {
            input.focus();
            input.select();
        }
    }

    function confirmarSenhaModo() {
        const input = document.getElementById('inputSenhaModo');
        const valor = input.value;
        const senhaValida = (db.configs.senhaModo && valor === db.configs.senhaModo)
            || (db.configs.senhaMestra && valor === db.configs.senhaMestra);
        if (!senhaValida) return senhaIncorreta('inputSenhaModo', 'erroSenhaModo');
        input.blur();
        document.getElementById('modalSenhaModo').style.display = 'none';
        if (seletorGlobal) seletorGlobal.value = modoPendente;
        efetivarTrocaModo(modoPendente);
        input.value = '';
        limparErroSenha('erroSenhaModo');
    }

    function cancelarTrocaModo() { document.getElementById('modalSenhaModo').style.display = 'none'; if (seletorGlobal) seletorGlobal.value = db.configs.areaAtual; modoPendente = null; document.getElementById('inputSenhaModo').value = ''; limparErroSenha('erroSenhaModo'); }
    function efetivarTrocaModo(areaId) {
        const area = db.areas.find(item => item.id === areaId) || getAreaAtual();
        db.configs.areaAtual = area.id;
        db.configs.modo = area.tipo === 'recebimento' ? 'cozinha' : 'panelas';
        salvarBancoLocal();
        aplicarModoVisual(area.id);
    }

    function iniciar() {
        normalizarAreasERotas();
        normalizarSonsConfigurados();
        renderizarSeletorAreas();
        document.getElementById('configSomCozinha').value = db.configs.somCozinha || 'sem_som';
        document.getElementById('configSomPanelas').value = db.configs.somPanelas || 'sem_som';
        document.getElementById('configTelaAtiva').value = db.configs.telaAtiva || "sim";
        document.getElementById('configInatividade').value = db.configs.inatividade || "0";
        document.getElementById('configVolumeCozinha').value = db.configs.volumeCozinha || "100";
        document.getElementById('configVolumePanelas').value = db.configs.volumePanelas || "70";
        atualizarLabelsVolume();
        aplicarModoVisual(db.configs.areaAtual);
        solicitarWakeLock(); resetInatividade();
        const splash = document.getElementById('splashScreen');
        if (!sessionStorage.getItem('splash_v1_shown')) {
            setTimeout(() => { splash.style.opacity = '0'; setTimeout(() => { splash.style.display = 'none'; sessionStorage.setItem('splash_v1_shown', 'true'); }, 500); }, 2000);
        } else { splash.style.display = 'none'; }
    }

    function aplicarModoVisual(areaId) {
        const area = db.areas.find(item => item.id === areaId) || getAreaAtual();
        const modo = area.tipo === 'recebimento' ? 'cozinha' : 'panelas';
        db.configs.areaAtual = area.id;
        db.configs.modo = modo;
        const emojiAtual = document.getElementById('emojiAreaAtual');
        if (emojiAtual) emojiAtual.innerHTML = getEmojiAreaHtml(area.emoji);
        const nomeAtual = document.getElementById('nomeAreaAtual');
        if (nomeAtual) nomeAtual.innerText = area.nome;
        renderizarSeletorAreas();
        const themeColor = document.getElementById('metaThemeColor'); document.body.className = modo === 'panelas' ? 'theme-panelas' : 'theme-cozinha';
        if(loopSync) clearInterval(loopSync);
        loopSync = null;
        if(modo === 'panelas') { if(themeColor) themeColor.content = '#1565C0'; document.getElementById('area-panelas').style.display = 'flex'; document.getElementById('area-cozinha').style.display = 'none'; pararAlarme(); renderizarFiltros(); renderizarListaPanelas(); syncGeral(true); } else { if(themeColor) themeColor.content = '#2e7d32'; document.getElementById('area-panelas').style.display = 'none'; document.getElementById('area-cozinha').style.display = 'flex'; pararAlarme(); syncGeral(true); }
    }

    function renderizarFiltros() {
        let textoTodos = ordemPopular ? 'TODOS 🔥' : 'TODOS';
        let html = `<div class="chip ${categoriaAtual === null ? 'active' : ''}" style="${categoriaAtual === null ? 'background:#ccc; color:#000;' : ''}" onclick="filtrarCategoria(null)">${textoTodos}</div>`;
        db.categorias.forEach(cat => { const isActive = categoriaAtual === cat.nome; html += `<div class="chip ${isActive ? 'active' : ''}" style="background-color: ${cat.cor}; color: ${cat.corTexto};" onclick="filtrarCategoria('${cat.nome}')">${cat.nome}</div>`; });
        document.getElementById('containerFiltros').innerHTML = html;
    }

    function filtrarCategoria(cat) {
        if (cat === null && categoriaAtual === null) {
            ordemPopular = !ordemPopular;
        } else {
            categoriaAtual = cat;
            ordemPopular = false;
        }
        renderizarFiltros();
        renderizarListaPanelas();
    }

    function getPopularidade30d() {
        let pop = {};
        const hoje = new Date();
        hoje.setHours(0,0,0,0);
        const timeHoje = hoje.getTime();
        const time30d = timeHoje - (30 * 86400000);

        pedidosDaAreaAtual().forEach(p => {
            let t = new Date(p.timestamp).getTime();
            if (t >= time30d && t < timeHoje) {
                let nomeBase = p.produto.split(" (Obs:")[0];
                pop[nomeBase] = (pop[nomeBase] || 0) + 1;
            }
        });
        return pop;
    }

    function renderizarListaPanelas() {
        const lista = document.getElementById('listaProdutosPanelas'); lista.innerHTML = '';
        const areaAtual = getAreaAtual();
        const produtosDaArea = db.produtos.filter(p => getAreasOrigemProduto(p).includes(areaAtual.id));
        let filtrados = categoriaAtual === null ? [...produtosDaArea] : produtosDaArea.filter(p => p.categoria === categoriaAtual);

        if (categoriaAtual === null && ordemPopular) {
            let pop = getPopularidade30d();
            filtrados.sort((a, b) => {
                let countA = pop[a.nome] || 0;
                let countB = pop[b.nome] || 0;
                return countB - countA;
            });
        }

        if(filtrados.length === 0) { lista.innerHTML = '<li style="padding: 20px; text-align: center; color: #666;">Nenhum produto cadastrado.</li>'; return; }
        filtrados.forEach(p => {
            const catObj = db.categorias.find(c => c.nome === p.categoria) || {cor:'#eee', corTexto:'#000'};
            const primeiraLetra = p.nome.charAt(0).toUpperCase();
            lista.innerHTML += `<li class="item" onclick="abrirModalPedido('${p.nome}')"><div class="item-avatar" style="background-color: ${catObj.cor}; color: ${catObj.corTexto};">${primeiraLetra}</div><div class="item-info"><div class="item-title">${p.nome}</div><div class="item-subtitle">${p.categoria}</div></div><div class="swipe-hint">➕</div></li>`;
        });
    }

    function getNomeBasePedido(produto) {
        return (produto || '').split(" (Obs:")[0];
    }

    function isPedidoAtivoHoje(pedido) {
        if(!pedido || (pedido.status !== 'pendente' && pedido.status !== 'fazendo')) return false;
        const dataPedido = new Date(pedido.timestamp);
        if(isNaN(dataPedido.getTime())) return false;
        return dataPedido.toDateString() === new Date().toDateString();
    }

    function existeItemEmProducao(nome) {
        const areaAtual = getAreaAtual();
        return pedidosServidor.some(p => getNomeBasePedido(p.produto) === nome &&
            (p.areaOrigem || 'panelas') === areaAtual.id && isPedidoAtivoHoje(p));
    }

    function abrirModalPedido(nomeProduto) {
        if(!db.configs.url) return alert("URL não configurada! Vá na engrenagem ⚙️ > Avançadas");
        document.getElementById('tituloModalPedido').innerText = `Pedir: ${nomeProduto}`; document.getElementById('pedidoItemNome').value = nomeProduto; document.getElementById('pedidoObsText').value = '';
        const btnConfirmar = document.getElementById('btnConfirmarPedido');
        if(btnConfirmar) btnConfirmar.disabled = false;
        const container = document.getElementById('obsChipsContainer'); container.innerHTML = '';

        let pObj = db.produtos.find(p => p.nome === nomeProduto);
        let listaObs = [...db.obsPedidos];
        if(pObj && pObj.obsEspec) listaObs = [...listaObs, ...pObj.obsEspec];

        listaObs.forEach(obs => { container.innerHTML += `<div class="chip" style="font-weight: normal; background-color:#E3F2FD; color:#1565C0; border-color:#1565C0;" onclick="addObsToText('pedidoObsText', '${obs}')">${obs}</div>`; });
        document.getElementById('modalFazerPedido').style.display = 'flex';
        syncGeral();
    }

    function abrirModalCancelamento(id, nomeProduto) {
        document.getElementById('tituloModalCancelar').innerText = `Cancelar: ${nomeProduto}`; document.getElementById('cancelarItemId').value = id; document.getElementById('cancelarObsText').value = '';
        const container = document.getElementById('obsCancelChipsContainer'); container.innerHTML = '';
        db.obsCancelamentos.forEach(obs => { container.innerHTML += `<div class="chip" style="font-weight: normal; background-color:#ffebee; color:#d32f2f; border-color:#d32f2f;" onclick="addObsToText('cancelarObsText', '${obs}')">${obs}</div>`; });
        document.getElementById('modalCancelarPedido').style.display = 'flex';
    }

    function addObsToText(inputID, obsStr) {
        const input = document.getElementById(inputID);
        let parts = input.value.split(',').map(s => s.trim()).filter(s => s !== '');

        let index = parts.indexOf(obsStr);
        if (index > -1) {
            parts.splice(index, 1);
        } else {
            parts.push(obsStr);
        }

        input.value = parts.join(', ');
    }

    function confirmarCancelamento() {
        const id = document.getElementById('cancelarItemId').value;
        const motivo = document.getElementById('cancelarObsText').value.trim();
        if(!id) return;
        document.getElementById('modalCancelarPedido').style.display = 'none';
        alterarStatusPedido(id, 'cancelado', motivo);
    }

    function focarUltimosPedidosPanelas() {
        requestAnimationFrame(() => {
            const lista = document.getElementById('listaUltimosPedidosPanelas');
            const areaScroll = lista ? lista.closest('.scroll-area') : null;
            if(areaScroll) areaScroll.scrollTop = 0;
        });
    }

    async function enviarPedidoConfirmado() {
        if(envioPedidoEmAndamento) return;
        envioPedidoEmAndamento = true;
        const btnConfirmar = document.getElementById('btnConfirmarPedido');
        if(btnConfirmar) btnConfirmar.disabled = true;

        const nome = document.getElementById('pedidoItemNome').value;
        const obsText = document.getElementById('pedidoObsText').value.trim();

        let itemEmProducao = existeItemEmProducao(nome);
        let configReenvio = db.configs.reenvio || 'permitido';

        if (itemEmProducao && configReenvio !== 'permitido') {
            if (configReenvio === 'bloqueado') {
                alert("Esse item está em produção");
                document.getElementById('modalFazerPedido').style.display = 'none';
                envioPedidoEmAndamento = false;
                if(btnConfirmar) btnConfirmar.disabled = false;
                return;
            } else if (configReenvio === 'confirmacao') {
                const confirmed = await AloUiDialog.confirm('Esse item já está em produção. Deseja enviar outro pedido mesmo assim?', {
                    title: 'Pedido repetido', icon: '↻', confirmText: 'Enviar novamente'
                });
                if(!confirmed) {
                    document.getElementById('modalFazerPedido').style.display = 'none';
                    envioPedidoEmAndamento = false;
                    if(btnConfirmar) btnConfirmar.disabled = false;
                    return;
                }
            }
        }

        let nomeParaEnviar = obsText ? `${nome} (Obs: ${obsText})` : nome;
        document.getElementById('modalFazerPedido').style.display = 'none';

        const tempId = Date.now().toString();
        const pedidoTemporario = { id: tempId, produto: nomeParaEnviar, status: 'pendente', timestamp: new Date().toISOString(), finalizadoEm: '', motivo: '', isTemp: true, localTime: Date.now() };

        pedidosPendentesLocais.push(pedidoTemporario);
        pedidosServidor.push(pedidoTemporario);
        renderizarUltimosPedidos();
        focarUltimosPedidosPanelas();
        salvarHistoricoLocal();
        envioPedidoEmAndamento = false;
        if(btnConfirmar) btnConfirmar.disabled = false;

        try {
            await enviarPayloadServidor({ action: 'novo_pedido', produto: nomeParaEnviar });
            setTimeout(syncGeral, 500);
            setTimeout(syncGeral, 1800);
        } catch(e) {
            pedidosPendentesLocais = pedidosPendentesLocais.filter(p => p.id !== tempId);
            pedidosServidor = pedidosServidor.filter(p => p.id !== tempId);
            renderizarUltimosPedidos();
            alert("⚠️ Falha na conexão: Seu pedido não foi enviado.");
        }
    }

    function montarUrlPedidos() {
        let fetchUrl = db.configs.url;
        fetchUrl += fetchUrl.includes('?') ? '&' : '?';
        fetchUrl += "cb=" + Date.now();
        return fetchUrl;
    }

    async function carregarPedidosServidor() {
        const resp = await fetch(montarUrlPedidos());
        const dados = await resp.json();
        return Array.isArray(dados) ? dados : [];
    }

    async function enviarPayloadServidor(payload) {
        await fetch(db.configs.url, { method: 'POST', mode: 'no-cors', body: JSON.stringify(payload) });
    }

    function montarPayloadLoteStatus(itens) {
        return {
            action: 'atualizar_status_lote',
            updates: itens.map(item => ({
                id: item.payload.id,
                novoStatus: item.payload.action === 'cancelar_pedido' ? 'cancelado' : item.payload.novoStatus,
                motivo: item.payload.motivo || ''
            }))
        };
    }

    function payloadConfirmadoNoServidor(payload, dadosServidor) {
        if(payload.action === 'excluir_pedido') {
            return !dadosServidor.some(p => p.id.toString() === payload.id.toString());
        }

        if(payload.action === 'atualizar_status_lote') {
            return payload.updates.every(update => payloadConfirmadoNoServidor({
                action: update.novoStatus === 'cancelado' ? 'cancelar_pedido' : 'atualizar_status',
                id: update.id,
                novoStatus: update.novoStatus,
                motivo: update.motivo || ''
            }, dadosServidor));
        }

        const pedido = dadosServidor.find(p => p.id.toString() === payload.id.toString());
        if(!pedido) return false;

        if(payload.action === 'cancelar_pedido') {
            return pedido.status === 'cancelado';
        }

        if(payload.action === 'atualizar_status') {
            const pesoEsperado = hierarquiaStatus[payload.novoStatus] || 0;
            const pesoServidor = hierarquiaStatus[pedido.status] || 0;
            return pedido.status === payload.novoStatus || pesoServidor >= pesoEsperado;
        }

        return true;
    }

    function enfileirarPayloadStatus(payload) {
        filaRetentativaStatus = filaRetentativaStatus.filter(item => item.payload.id != payload.id);
        filaRetentativaStatus.push({ payload: payload, time: Date.now() });
        salvarFilaStatus();
    }

    function agendarProcessamentoFila(delay = 120) {
        if(filaStatusTimer) clearTimeout(filaStatusTimer);
        filaStatusTimer = setTimeout(() => {
            filaStatusTimer = null;
            processarFilaRetentativas();
        }, delay);
    }

    async function processarFilaRetentativas() {
        if(processandoFilaStatus || filaRetentativaStatus.length === 0 || !db.configs.url) return;
        processandoFilaStatus = true;
        try {
            while(filaRetentativaStatus.length > 0) {
                const agora = Date.now();
                const itensParaEnviar = filaRetentativaStatus.filter(item => !item.lastTry || (agora - item.lastTry) >= 700);

                if(itensParaEnviar.length === 0) break;

                itensParaEnviar.forEach(item => item.lastTry = agora);
                salvarFilaStatus();
                const payloadEnvio = itensParaEnviar.length > 1 ? montarPayloadLoteStatus(itensParaEnviar) : itensParaEnviar[0].payload;
                await enviarPayloadServidor(payloadEnvio);
                await new Promise(resolve => setTimeout(resolve, 500));

                const dadosServidor = await carregarPedidosServidor();
                const tamanhoAntes = filaRetentativaStatus.length;
                filaRetentativaStatus = filaRetentativaStatus.filter(item => !payloadConfirmadoNoServidor(item.payload, dadosServidor));
                salvarFilaStatus();

                if(filaRetentativaStatus.length === tamanhoAntes && itensParaEnviar.length > 1) {
                    await Promise.allSettled(itensParaEnviar.map(item => enviarPayloadServidor(item.payload)));
                    await new Promise(resolve => setTimeout(resolve, 700));
                    const dadosAposFallback = await carregarPedidosServidor();
                    filaRetentativaStatus = filaRetentativaStatus.filter(item => !payloadConfirmadoNoServidor(item.payload, dadosAposFallback));
                    salvarFilaStatus();
                }

                if(filaRetentativaStatus.length === tamanhoAntes) break;
            }
        } catch(e) {
        } finally {
            processandoFilaStatus = false;
        }
    }

    async function alterarStatusPedido(id, novoStatus, motivo = '') {
        pedidosBloqueados.add(id.toString());
        let pedidoLocal = pedidosServidor.find(x => x.id == id);

        if(pedidoLocal) {
            pedidoLocal.status = novoStatus;
            if(novoStatus === 'enviado' || novoStatus === 'buscar' || novoStatus === 'concluido' || novoStatus === 'cancelado') {
                pedidoLocal.finalizadoEm = new Date().toISOString();
            }
            if(motivo) pedidoLocal.motivo = motivo;
        }
        renderizarListaCozinha();
        salvarHistoricoLocal();

        let payload = { action: (novoStatus === 'cancelado' ? 'cancelar_pedido' : 'atualizar_status'), id: id, novoStatus: novoStatus };
        if(motivo) payload.motivo = motivo;

        enfileirarPayloadStatus(payload);
        agendarProcessamentoFila();
        setTimeout(syncGeral, 600);
        setTimeout(syncGeral, 1600);

        setTimeout(() => pedidosBloqueados.delete(id.toString()), 15000);
    }

    function corrigirTemposAbsurdos() {
        let medias = {}; let counts = {};
        pedidosServidor.forEach(p => {
            if ((p.status === 'enviado' || p.status === 'buscar' || p.status === 'concluido') && p.finalizadoEm) {
                let mins = Math.floor((new Date(p.finalizadoEm).getTime() - new Date(p.timestamp).getTime()) / 60000);
                if(mins >= 0 && mins <= 120) {
                    let n = p.produto.split(" (Obs:")[0];
                    medias[n] = (medias[n] || 0) + mins;
                    counts[n] = (counts[n] || 0) + 1;
                }
            }
        });
        Object.keys(medias).forEach(k => medias[k] = Math.round(medias[k] / counts[k]));

        let mudou = false;
        pedidosServidor.forEach(p => {
            if ((p.status === 'enviado' || p.status === 'buscar' || p.status === 'concluido') && p.finalizadoEm) {
                let n = p.produto.split(" (Obs:")[0];
                let media = medias[n];
                if (media !== undefined && media >= 0) {
                    let mins = Math.floor((new Date(p.finalizadoEm).getTime() - new Date(p.timestamp).getTime()) / 60000);
                    if (mins > (media + 60)) {
                        p.finalizadoEm = new Date(new Date(p.timestamp).getTime() + (media * 60000)).toISOString();
                        mudou = true;
                    }
                }
            }
        });
        if(mudou) { salvarHistoricoLocal(); }
    }

    async function syncGeral() {
        if(!db.configs.url) return;
        await processarFilaRetentativas();

        try {
            const dadosServidor = await carregarPedidosServidor();
            document.getElementById('indicadorConexao').innerHTML = '🟢';

            pedidosPendentesLocais = pedidosPendentesLocais.filter(p => (Date.now() - p.localTime) < 20000);
            pedidosPendentesLocais = pedidosPendentesLocais.filter(pTemp => {
                return !dadosServidor.some(pServ => pServ.produto === pTemp.produto && pServ.status === 'pendente' && Math.abs(new Date(pServ.timestamp).getTime() - pTemp.localTime) < 25000);
            });

            let mixPedidos = dadosServidor.concat(pedidosPendentesLocais);

            pedidosServidor = mixPedidos.map(pServ => {
                let pLocal = pedidosServidor.find(x => x.id == pServ.id);
                if (pLocal) {
                    if (pedidosBloqueados.has(pServ.id.toString())) { return pLocal; }
                    let pesoLocal = hierarquiaStatus[pLocal.status] || 0;
                    let pesoServidor = hierarquiaStatus[pServ.status] || 0;
                    let temNaFila = filaRetentativaStatus.some(f => f.payload.id == pServ.id);

                    if (pesoLocal > pesoServidor || temNaFila) {
                        if (pesoLocal > pesoServidor && !temNaFila) {
                            enfileirarPayloadStatus({ action: (pLocal.status === 'cancelado' ? 'cancelar_pedido' : 'atualizar_status'), id: pLocal.id, novoStatus: pLocal.status, motivo: pLocal.motivo || '' });
                        }
                        return pLocal;
                    }
                }
                return pServ;
            });

            corrigirTemposAbsurdos();
            salvarHistoricoLocal();

            if(db.configs.modo === 'cozinha') { renderizarListaCozinha(); } else { renderizarUltimosPedidos(); }
            gerenciarAlarme();
        } catch(e) {
            document.getElementById('indicadorConexao').innerHTML = '🔴';
        }
    }

    function darCiencia(id) { pedidosCientes.add(id.toString()); salvarHistoricoLocal(); renderizarUltimosPedidos(); gerenciarAlarme(); }

    function renderizarUltimosPedidos() {
        const lista = document.getElementById('listaUltimosPedidosPanelas'); const agora = Date.now(); lista.innerHTML = '';
        const dataHoje = new Date().toDateString();
        let todosRecentes = pedidosDaAreaAtual().filter(p => new Date(p.timestamp).toDateString() === dataHoje).filter(p => {
            if(p.status !== 'concluido' && p.status !== 'enviado' && p.status !== 'buscar' && p.status !== 'cancelado') return true;
            return (agora - new Date(p.finalizadoEm).getTime()) < 300000;
        }).reverse();

        let itensAtencao = []; let itensNormais = [];
        todosRecentes.forEach(p => {
            if((p.status === 'buscar' || p.status === 'cancelado') && !pedidosCientes.has(p.id.toString())) { itensAtencao.push(p); } else { itensNormais.push(p); }
        });

        let recentes = [...itensAtencao, ...itensNormais].slice(0, 15);
        if(recentes.length === 0) { lista.innerHTML = `<li style="padding: 15px; text-align: center; color: #999;">Nenhum pedido recente.</li>`; return; }

        recentes.forEach(p => {
            let statusTraduzido = ''; let corStatus = ''; let piscaClass = ''; let onclickHtml = ''; let exibirTempo = true;
            if (p.status === 'pendente') { statusTraduzido = 'Pendente'; corStatus = '#d32f2f'; }
            else if (p.status === 'fazendo') { statusTraduzido = 'Em preparo'; corStatus = '#fbc02d'; }
            else if (p.status === 'enviado') { statusTraduzido = 'Enviado'; corStatus = '#9e9e9e'; exibirTempo = false; }
            else if (p.status === 'cancelado') {
                exibirTempo = false; let motivoTxt = p.motivo ? ` (Motivo: ${p.motivo})` : '';
                if(!pedidosCientes.has(p.id.toString())) { statusTraduzido = 'Cancelado' + motivoTxt; corStatus = '#d32f2f'; piscaClass = 'alerta-pisca-buscar'; onclickHtml = `onclick="darCiencia('${p.id}')"`; } else { statusTraduzido = 'Cancelado' + motivoTxt; corStatus = '#d32f2f'; }
            }
            else if (p.status === 'buscar') {
                exibirTempo = false;
                if(!pedidosCientes.has(p.id.toString())) { statusTraduzido = 'Pode ir buscar'; corStatus = '#d32f2f'; piscaClass = 'alerta-pisca-buscar'; onclickHtml = `onclick="darCiencia('${p.id}')"`; } else { statusTraduzido = 'Pode ir buscar'; corStatus = '#9e9e9e'; }
            } else { statusTraduzido = 'Finalizado'; corStatus = '#9e9e9e'; exibirTempo = false; }

            let textoTempo = exibirTempo ? ` - ${getTempoRelativo(p.timestamp)}` : '';
            let syncTxt = '';
            if (p.syncState === 'offline') syncTxt = '<span class="sync-pendente">Aguardando internet</span>';
            else if (p.syncState === 'queued' || p.syncState === 'retrying') syncTxt = '<span class="sync-pendente">Aguardando envio</span>';
            lista.innerHTML += `<li class="item ${piscaClass}" style="border-left: 5px solid ${corStatus}; padding: 10px 15px;" ${onclickHtml}><div class="item-info" style="font-size: 14px; white-space: normal; word-break: break-word; line-height: 1.4;"><strong>${p.produto}</strong> - <strong style="color:${corStatus}">${statusTraduzido}</strong><span style="color:#666;">${textoTempo}</span>${syncTxt}</div></li>`;
        });
    }

    function renderizarListaCozinha() {
        const lista = document.getElementById('listaPedidosCozinha'); const agora = Date.now(); lista.innerHTML = '';
        const dataHoje = new Date().toDateString();

        const visiveis = pedidosDaAreaAtual().filter(p => new Date(p.timestamp).toDateString() === dataHoje).filter(p => {
            if(p.status !== 'concluido' && p.status !== 'enviado' && p.status !== 'buscar' && p.status !== 'cancelado') return true;
            return (agora - new Date(p.finalizadoEm).getTime()) < 300000;
        }).reverse();

        if (visiveis.length === 0) {
            lista.innerHTML = '<li style="padding: 24px; text-align: center; color: #777;">Nenhum pedido nesta área.</li>';
            return;
        }

        visiveis.forEach(p => {

            let emoji = '🔔'; let isFinal = false;
            const areaOrigemPedido = db.areas.find(area => area.id === (p.areaOrigem || 'panelas')) || AREAS_PADRAO[0];
            let formatProduto = `<strong class="pedido-produto-nome">${p.produto}</strong>`;
            let statusTxt = ""; let tempoStr = ""; let classeRiscar = ""; let acoesHtml = "";

            if (p.status === 'pendente') {
                emoji = '🔔';
                statusTxt = 'Novo pedido';
                tempoStr = getTempoRelativo(p.timestamp);
                acoesHtml = `<button class="btn-pedido-acao acao-aceitar" onclick="executarAcaoPedido(this, '${p.id}', 'fazendo')" aria-label="Aceitar pedido" title="Aceitar"><span>✅</span><span class="acao-label">Aceitar</span></button>`;
            }
            else if (p.status === 'fazendo') {
                emoji = '🔥';
                statusTxt = 'Em preparo';
                tempoStr = getTempoRelativo(p.timestamp);
                acoesHtml = `
                    <button class="btn-pedido-acao acao-enviar" onclick="executarAcaoPedido(this, '${p.id}', 'enviado')" aria-label="Enviar pedido" title="Enviar"><span class="emoji-enviar">⬆</span><span class="acao-label">Enviar</span></button>
                    <button class="btn-pedido-acao acao-buscar" onclick="executarAcaoPedido(this, '${p.id}', 'buscar')" aria-label="Pedir para vir buscar" title="Vir buscar"><span>🏃🏻‍♀️</span><span class="acao-label">Vir buscar</span></button>
                    <button class="btn-pedido-acao acao-cancelar" onclick="cancelarPedidoPeloBotao(this, '${p.id}')" aria-label="Cancelar pedido" title="Cancelar"><span>❌</span></button>`;
            }
            else if (p.status === 'enviado') {
                emoji = '✔️'; isFinal = true; classeRiscar = "riscar";
                statusTxt = 'Enviado';
            }
            else if (p.status === 'buscar') {
                emoji = '✔️'; isFinal = true; classeRiscar = "riscar";
                statusTxt = 'Aguardando retirada';
            }
            else if (p.status === 'cancelado') {
                emoji = '❌'; isFinal = true; classeRiscar = "riscar";
                statusTxt = p.motivo ? `Cancelado: ${p.motivo}` : 'Cancelado';
            }

            if (isFinal) {
                acoesHtml = `<button class="btn-pedido-acao acao-desfazer" onclick="executarAcaoPedido(this, '${p.id}', 'fazendo')" aria-label="Desfazer ação" title="Desfazer"><span>↩️</span><span class="acao-label">Desfazer</span></button>`;
            }

            let cssStatus = isFinal ? (p.status==='cancelado' ? 'cancelado' : 'concluido') : p.status;

            if (isFinal && p.finalizadoEm && p.status !== 'cancelado') {
                tempoStr = `Entregue ${getTempoRelativo(p.finalizadoEm)}`;
            } else if (p.status === 'cancelado') {
                tempoStr = "";
            }

            let subtitleHtml = `<div class="item-subtitle" style="text-decoration: none !important; opacity: 1 !important;">${statusTxt}</div>`;
            const atributosAceitar = p.status === 'pendente'
                ? `class="item pedido-cozinha pedido-aceitavel status-${cssStatus}" role="button" tabindex="0" aria-label="Aceitar pedido" onclick="aceitarPedidoPelaCaixa(event, '${p.id}')" onkeydown="aceitarPedidoPelaCaixa(event, '${p.id}')"`
                : `class="item pedido-cozinha status-${cssStatus}"`;

            lista.innerHTML += `
                <li ${atributosAceitar} id="ped-${p.id}" data-id="${p.id}" data-status="${p.status}">
                    <div class="pedido-conteudo">
                        <div class="item-avatar pedido-status-emoji ${classeRiscar}">${emoji}</div>
                        <div class="item-info" style="display:flex; justify-content:space-between; align-items:center;">
                          <div>
                            <div class="item-title ${classeRiscar}" style="margin: 0; line-height: 1.2;">${formatProduto}</div>
                            ${subtitleHtml}
                          </div>
                          <div style="font-size:13px; color:#888; font-weight:bold; white-space:nowrap; margin-left:10px;">${tempoStr}</div>
                        </div>
                    </div>
                    <div class="pedido-meta-acoes">
                        <div class="pedido-origem" aria-label="Área de origem">${getEmojiAreaHtml(areaOrigemPedido.emoji)}</div>
                        <div class="pedido-acoes">${acoesHtml}</div>
                    </div>
                </li>
            `;
        });
    }

    function desabilitarAcoesPedido(botao) {
        const container = botao && botao.closest('.pedido-acoes');
        if (container) container.querySelectorAll('button').forEach(item => { item.disabled = true; });
    }

    function executarAcaoPedido(botao, id, novoStatus) {
        desabilitarAcoesPedido(botao);
        alterarStatusPedido(id, novoStatus);
    }

    function aceitarPedidoPelaCaixa(event, id) {
        if (!event || event.target.closest('.btn-pedido-acao')) return;
        if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
        if (event.type === 'keydown') event.preventDefault();
        const card = event.currentTarget;
        if (!card || card.dataset.status !== 'pendente') return;
        card.dataset.status = 'processando';
        executarAcaoPedido(card.querySelector('.acao-aceitar'), id, 'fazendo');
    }

    function cancelarPedidoPeloBotao(botao, id) {
        const pedido = pedidosServidor.find(item => item.id === String(id));
        if (!pedido) return;
        abrirModalCancelamento(id, pedido.produto);
    }

    function gerenciarAlarme() {
        let deveTocar = false; let configSom = "sem_som"; const h = document.getElementById('mainHeader'); h.classList.remove('alerta-pisca', 'alerta-pisca-buscar');
        if (db.configs.modo === 'cozinha') {
            const dataHoje = new Date().toDateString();
            if(pedidosServidor.some(p => p.status === 'pendente' && new Date(p.timestamp).toDateString() === dataHoje)) { h.classList.add('alerta-pisca'); if(db.configs.somCozinha !== "sem_som") { deveTocar = true; configSom = db.configs.somCozinha; } }
        } else if (db.configs.modo === 'panelas') {
            const agora = Date.now();
            if(pedidosServidor.some(p => { const ehRecente = (agora - new Date(p.finalizadoEm).getTime()) < 300000; return ehRecente && (p.status === 'buscar' || p.status === 'cancelado') && !pedidosCientes.has(p.id.toString()); })) { h.classList.add('alerta-pisca-buscar'); if(db.configs.somPanelas !== "sem_som") { deveTocar = true; configSom = db.configs.somPanelas; } }
        }
        if (deveTocar) {
            configSom = normalizarSom(configSom, db.configs.modo === 'panelas' ? 'beep' : 'alarme');
            const volume = db.configs.modo === 'panelas' ? parseInt(db.configs.volumePanelas || '70', 10) : parseInt(db.configs.volumeCozinha || '100', 10);
            const volumeNormalizado = Math.max(0, Math.min(100, volume)) / 100;
            const som = sonsDisponiveis[configSom];

            if (som.tipo === "audio") {
                pararSomSintetico();
                playerAlarme.volume = volumeNormalizado;
                if (!alarmeTocando || somAtualTocando !== configSom) {
                    playerAlarme.src = som.url;
                    playerAlarme.play().catch(()=>{});
                    somAtualTocando = configSom;
                }
                alarmeTocando = true;
            } else if (som.tipo === "sintetico") {
                playerAlarme.pause();
                if (!alarmeTocando || somAtualTocando !== configSom) {
                    pararSomSintetico();
                    executarSomSintetico(configSom, volumeNormalizado);
                    alarmeSinteticoTimer = setInterval(() => executarSomSintetico(configSom, volumeNormalizado), som.intervalo || 1400);
                    somAtualTocando = configSom;
                }
                alarmeTocando = true;
            }
        } else { pararAlarme(); }
    }

    function pararAlarme() { document.getElementById('mainHeader').classList.remove('alerta-pisca', 'alerta-pisca-buscar'); playerAlarme.pause(); pararSomSintetico(); alarmeTocando = false; somAtualTocando = "sem_som"; }

    async function executarAcaoPendenteAutorizada() {
        if (acaoPendente === 'zerar_expediente') {
            await excluirHojeConfiavel();
        } else if (acaoPendente === 'excluir_item') {
            await excluirPedidoConfiavel(parametroAcao);
        }
        acaoPendente = null;
        parametroAcao = null;
    }

    async function solicitarAutorizacaoAcao() {
        if (!db.configs.senhaMestra) {
            const descricao = document.getElementById('descModalAcao').innerText;
            const confirmed = await AloUiDialog.confirm(descricao, {
                title: document.getElementById('tituloModalAcao').innerText,
                icon: '🗑️', tone: 'danger', confirmText: 'Excluir'
            });
            if (confirmed) executarAcaoPendenteAutorizada();
            else { acaoPendente = null; parametroAcao = null; }
            return;
        }
        document.getElementById('inputSenhaAcao').value = '';
        limparErroSenha('erroSenhaAcao');
        document.getElementById('modalSenhaAcao').style.display = 'flex';
        setTimeout(() => document.getElementById('inputSenhaAcao').focus(), 100);
    }

    function solicitarExclusaoHistorico(id) {
        acaoPendente = 'excluir_item';
        parametroAcao = id;
        document.getElementById('tituloModalAcao').innerText = "Excluir Pedido?";
        document.getElementById('descModalAcao').innerText = "Isso apagará este pedido do sistema para sempre.";
        solicitarAutorizacaoAcao();
    }

    function limparHistoricoHoje() {
        acaoPendente = 'zerar_expediente';
        document.getElementById('tituloModalAcao').innerText = "Zerar Expediente?";
        document.getElementById('descModalAcao').innerText = "Isso apagará os pedidos de hoje da tela e do servidor.";
        solicitarAutorizacaoAcao();
    }

    function abrirHistorico() {
        const lista = document.getElementById('listaHistorico'); lista.innerHTML = ''; const dataHoje = new Date().toDateString();
        const historicoHoje = pedidosServidor.filter(p => new Date(p.timestamp).toDateString() === dataHoje).reverse();
        if(historicoHoje.length === 0) { lista.innerHTML = '<li style="padding: 15px; text-align: center; color: #999;">Nenhum pedido hoje.</li>'; } else {
            historicoHoje.forEach(p => {
                let statusTxt = p.status === 'pendente' ? 'Pendente' : (p.status === 'fazendo' ? 'Em preparo' : (p.status === 'enviado' ? 'Enviado' : (p.status === 'buscar' ? 'Buscar' : (p.status === 'cancelado' ? 'Cancelado' : 'Finalizado'))));
                if(p.status === 'cancelado' && p.motivo) statusTxt += ` (Motivo: ${p.motivo})`;
                lista.innerHTML += `<li class="item" style="padding: 10px; border-bottom: 1px solid #eee;"><div class="item-info"><div class="item-title" style="font-size: 15px;">${p.produto}</div><div class="item-subtitle">${new Date(p.timestamp).toLocaleTimeString()} - ${statusTxt}</div></div><button class="btn-excluir-historico" onclick="solicitarExclusaoHistorico('${p.id}')" aria-label="Excluir pedido" title="Excluir pedido">🗑️</button></li>`;
            });
        }
        document.getElementById('modalHistorico').style.display = 'flex';
    }

    function fecharModal(id) { document.getElementById(id).style.display = 'none'; }

    function abrirModalNoTopo(id) {
        const overlay = document.getElementById(id);
        if (!overlay) return;
        overlay.style.display = 'flex';
        overlay.scrollTop = 0;
        const modal = overlay.querySelector('.modal');
        if (modal) modal.scrollTop = 0;
        requestAnimationFrame(() => {
            overlay.scrollTop = 0;
            if (modal) modal.scrollTop = 0;
        });
    }

    let destinoConfiguracoes = 'painel';

    function abrirPainelControle() {
        document.getElementById('configUrlApp').value = db.configs.url || '';
        abrirModalNoTopo('modalPainelUnificado');
    }

    function abrirDestinoConfiguracoes() {
        if (destinoConfiguracoes === 'kds') {
            abrirConfiguracoesKds();
            return;
        }
        if (destinoConfiguracoes === 'tasks') {
            AloTasks.openSettingsMenu();
            return;
        }
        abrirPainelControle();
    }

    function abrirConfiguracoesKds() {
        fecharModal('modalPainelUnificado');
        abrirModalNoTopo('modalConfigKds');
    }

    function voltarConfiguracoesKds() {
        fecharModal('modalConfigKds');
        if (destinoConfiguracoes !== 'kds') abrirModalNoTopo('modalPainelUnificado');
    }

    function voltarConfiguracoesTarefas() {
        fecharModal('modalConfigTasksMenu');
        if (destinoConfiguracoes !== 'tasks') abrirModalNoTopo('modalPainelUnificado');
    }

    function abrirLoginAdmin(destino = 'painel') {
        destinoConfiguracoes = ['painel', 'kds', 'tasks'].includes(destino) ? destino : 'painel';
        if (!db.configs.senhaMestra) {
            abrirDestinoConfiguracoes();
            return;
        }
        document.getElementById('senhaAdmin').value = '';
        limparErroSenha('erroSenhaAdmin');
        document.getElementById('modalLoginAdmin').style.display = 'flex';
        setTimeout(()=>document.getElementById('senhaAdmin').focus(), 100);
    }

    function abrirConfiguracoesAvancadas() {
        document.getElementById('configSenhaMestra').value = db.configs.senhaMestra || '';
        document.getElementById('configSenhaFeedback').innerText = '';
        document.getElementById('configUrlApp').value = db.configs.url || '';
        document.getElementById('inputExcluirTudo').value = '';
        abrirModalNoTopo('modalConfigAvancadas');
    }

    function solicitarAcessoAvancado() {
        fecharModal('modalPainelUnificado');
        if (!db.configs.senhaMestra) {
            abrirConfiguracoesAvancadas();
            return;
        }
        document.getElementById('senhaAvancada').value = '';
        limparErroSenha('erroSenhaAvancada');
        document.getElementById('modalSenhaAvancada').style.display = 'flex';
        setTimeout(() => document.getElementById('senhaAvancada').focus(), 100);
    }

    function excluirTodoHistorico() {
        let frase = document.getElementById('inputExcluirTudo').value;
        if (frase === "quero excluir todo o histórico") {
            pedidosServidor = [];
            fetch(db.configs.url, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'excluir_tudo' }) });
            alert("Histórico global apagado!");
            forcarAtualizacao();
        } else { alert("Frase de segurança incorreta."); }
    }

    async function forcarAtualizacao() {
        const confirmed = await AloUiDialog.confirm('Deseja recarregar o aplicativo e limpar os arquivos temporários?', {
            title: 'Atualizar aplicativo', icon: '↻', confirmText: 'Atualizar agora'
        });
        if (confirmed) {
            sessionStorage.clear();

            if ('caches' in window) {
                const names = await caches.keys();
                await Promise.all(names.map(name => caches.delete(name)));
            }

            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                for (let registration of registrations) {
                    await registration.unregister();
                }
            }
            window.location.href = window.location.pathname + '?t=' + new Date().getTime();
        }
    }

    function abrirModalMetricas() {
        fecharModal('modalPainelUnificado');
        fecharModal('modalConfigKds');
        document.getElementById('boxFiltroCustom').style.display = 'none';
        renderizarMetricasDetalhes('hoje');
        document.getElementById('modalMetricas').style.display = 'flex';
    }

    function mostrarCalendarioCustom() {
        document.querySelectorAll('#modalMetricas .btn-tab').forEach(b => b.classList.remove('active'));
        document.getElementById('btnAbaCustom').classList.add('active');
        document.getElementById('boxFiltroCustom').style.display = 'block';
    }

    function renderizarMetricasDetalhes(periodo) {
        if(periodo !== 'custom') {
            document.querySelectorAll('#modalMetricas .btn-tab').forEach(b => b.classList.remove('active'));
            document.getElementById('btnAba' + (periodo === 'hoje' ? 'Hoje' : periodo)).classList.add('active');
            document.getElementById('boxFiltroCustom').style.display = 'none';
        }

        const hoje = new Date();
        hoje.setHours(0,0,0,0);
        let timeInicio = 0; let timeFim = Date.now();

        if (periodo === 'hoje') { timeInicio = hoje.getTime(); }
        else if (periodo === '7d') { timeInicio = hoje.getTime() - (6 * 86400000); }
        else if (periodo === '15d') { timeInicio = hoje.getTime() - (14 * 86400000); }
        else if (periodo === '30d') { timeInicio = hoje.getTime() - (29 * 86400000); }
        else if (periodo === 'custom') {
            const dtIni = document.getElementById('filtroDataInicio').value;
            const dtFim = document.getElementById('filtroDataFim').value;
            if(!dtIni || !dtFim) return alert("Selecione a data de início e fim.");

            let dI = new Date(dtIni); dI.setMinutes(dI.getMinutes() + dI.getTimezoneOffset()); dI.setHours(0,0,0,0);
            let dF = new Date(dtFim); dF.setMinutes(dF.getMinutes() + dF.getTimezoneOffset()); dF.setHours(23,59,59,999);
            timeInicio = dI.getTime(); timeFim = dF.getTime();
        }

        let stats = {};
        let totalGeral = 0;

        pedidosServidor.forEach(p => {
            let dataPedTime = new Date(p.timestamp).getTime();
            if (dataPedTime >= timeInicio && dataPedTime <= timeFim) {
                let nomeBase = p.produto.split(" (Obs:")[0];

                if (!stats[nomeBase]) stats[nomeBase] = { qtd: 0, tempoTotal: 0, countTempo: 0, temposIndividuais: [] };
                stats[nomeBase].qtd++;
                totalGeral++;

                if ((p.status === 'enviado' || p.status === 'buscar' || p.status === 'concluido') && p.finalizadoEm) {
                    let minutos = Math.floor((new Date(p.finalizadoEm).getTime() - dataPedTime) / 60000);
                    stats[nomeBase].tempoTotal += minutos;
                    stats[nomeBase].countTempo++;

                    stats[nomeBase].temposIndividuais.push({
                        minutos: minutos,
                        dataStr: new Date(dataPedTime).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute:'2-digit'})
                    });
                }
            }
        });

        document.getElementById('metricaTotalQtd').innerText = totalGeral;
        const lista = document.getElementById('listaMetricasDetalhes');
        lista.innerHTML = '';

        let arrayStats = Object.keys(stats).map(k => ({ nome: k, ...stats[k] }));
        arrayStats.sort((a, b) => b.qtd - a.qtd);

        if(arrayStats.length === 0) {
            lista.innerHTML = '<li style="padding: 15px; text-align: center; color: #999;">Nenhum dado no período.</li>';
            return;
        }

        arrayStats.forEach((item, idx) => {
            let media = item.countTempo > 0 ? Math.round(item.tempoTotal / item.countTempo) : 0;
            let tempoStr = media < 1 ? "&lt; 1 min" : `${media} min`;
            if(item.countTempo === 0) tempoStr = "-";

            let tagsHtml = item.temposIndividuais.map(t => {
                let corBg = t.minutos <= 15 ? '#c8e6c9' : (t.minutos <= 30 ? '#fff9c4' : '#ffcdd2');
                let corTx = t.minutos <= 15 ? '#2e7d32' : (t.minutos <= 30 ? '#f57f17' : '#c62828');
                let minStr = t.minutos < 1 ? '<1m' : t.minutos + 'm';

                return `
                    <div style="display:flex; justify-content:space-between; align-items:center; background:#fff; padding:6px 10px; margin-bottom: 4px; border-radius: 4px; border: 1px solid #eee;">
                        <span style="font-size:12px; color:#555; font-weight: bold;">📅 ${t.dataStr}</span>
                        <span style="display:inline-block; background:${corBg}; color:${corTx}; border-radius:4px; padding:3px 8px; font-size:12px; font-weight:bold;">⏱️ ${minStr}</span>
                    </div>
                `;
            }).join('');

            if(tagsHtml === '') tagsHtml = '<div style="font-size:12px; color:#999; padding: 5px;">Sem histórico finalizado</div>';

            lista.innerHTML += `
                <li class="item" style="padding: 10px; border-bottom: 1px solid #eee; flex-direction:column; align-items:stretch; cursor:pointer;" onclick="document.getElementById('det-${idx}').style.display = document.getElementById('det-${idx}').style.display === 'none' ? 'block' : 'none'">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="flex:1;">
                            <strong style="font-size:14px; color:#333;">${item.nome}</strong>
                            <div style="font-size:12px; color:#1976D2; margin-top:2px; font-weight: bold;">+ ver tempos</div>
                        </div>
                        <div style="text-align:right; font-size:13px; color:#555;">
                            <span style="display:inline-block; width:40px; text-align:center; background:#e0e0e0; border-radius:10px; padding:2px 5px; font-weight:bold;">${item.qtd}x</span>
                            <span style="display:inline-block; width:65px; text-align:right; color:#2e7d32; font-weight:bold;">⏱️ ${tempoStr}</span>
                        </div>
                    </div>
                    <div id="det-${idx}" style="display:none; margin-top:10px; padding:10px; background: #f9f9f9; border-radius: 5px;">
                        ${tagsHtml}
                    </div>
                </li>
            `;
        });
    }

    var sincronizarPuxarNuvem;

    function exportarDadosFisicos() {
        try {
            const dataToExport = { db: db, pedidos: pedidosServidor, cientes: Array.from(pedidosCientes) };
            const dataStr = JSON.stringify(dataToExport);
            const blob = new Blob([dataStr], { type: "text/plain" });
            const data = new Date();
            const nomeArquivo = `alo_cozinha_backup_${data.getDate()}_${data.getMonth()+1}_${data.getFullYear()}.txt`;

            if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], nomeArquivo, {type: "text/plain"})] })) {
                const file = new File([blob], nomeArquivo, {type: "text/plain"});
                navigator.share({
                    title: 'Backup Alô Cozinha',
                    text: 'Aqui está o arquivo TXT com o cardápio e os pedidos do restaurante.',
                    files: [file]
                }).catch(err => { baixarComoArquivo(blob, nomeArquivo); });
            } else {
                baixarComoArquivo(blob, nomeArquivo);
            }
        } catch(e) { alert("Erro ao exportar: " + e.message); }
    }

    function baixarComoArquivo(blob, nomeArquivo) {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = nomeArquivo;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); window.URL.revokeObjectURL(url); }, 1000);
    }

    function importarDadosFisicos(event) {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const importedData = JSON.parse(e.target.result);

                if (importedData.db && importedData.db.produtos) {
                    db = importedData.db;
                    if(importedData.pedidos) pedidosServidor = importedData.pedidos;
                    if(importedData.cientes) pedidosCientes = new Set(importedData.cientes);
                } else if (importedData.produtos) {
                    db = importedData;
                } else {
                    alert("❌ Arquivo inválido ou corrompido.");
                    return;
                }

                db.configs.dadosBaixados = true;
                marcarBancoAlterado();

                alert("✅ Banco de dados restaurado com sucesso! O aplicativo será recarregado.");
                location.reload();
            } catch(err) {
                alert("❌ Erro ao ler o arquivo TXT.");
            }
        };
        reader.readAsText(file);
    }

    async function salvarURL() {
        const urlInput = document.getElementById('configUrlApp').value.trim();
        if(!urlInput) return alert('Cole a URL do Google Apps Script.');
        if(!ehUrlAppsScript(urlInput)) return alert('URL inválida. Use o endereço de implantação que termina em /exec.');

        const btn = document.getElementById('btnSalvarUrl');
        const textoOriginal = btn ? btn.innerText : '';
        if(btn) { btn.disabled = true; btn.innerText = 'Validando...'; }
        try {
            const [nuvemDB, respostaSync] = await Promise.all([
                AloApi.getBank(urlInput),
                AloApi.sync(urlInput, '')
            ]);
            if(!bancoNuvemValido(nuvemDB) || !respostaSync || respostaSync.status !== 'ok') throw new Error('Servidor incompatível.');

            db.configs.url = urlInput;
            db.configs.dadosBaixados = true;
            db.configs.revisaoBanco = Number(nuvemDB._revision || 0);
            if(Array.isArray(nuvemDB.produtos)) {
                aplicarBancoDaNuvem(nuvemDB);
                iniciar();
            } else {
                db.configs.bancoPendente = true;
                salvarBancoLocal();
                agendarSincronizacaoBanco(0);
            }
            if(syncConfiavel) await syncConfiavel.retryNow();
            alert(Array.isArray(nuvemDB.produtos)
                ? 'URL validada. Cardápio, áreas e pedidos estão sincronizados.'
                : 'URL validada. Os dados deste aparelho serão publicados automaticamente.');
        } catch(error) {
            document.getElementById('configUrlApp').value = db.configs.url || '';
            alert('Não foi possível validar esta URL. Confira se é a implantação correta do Alô Cozinha e se a internet está funcionando.');
        } finally {
            if(btn) { btn.disabled = false; btn.innerText = textoOriginal; }
        }
    }

    function preencherConfiguracoesBasicas() {
        document.getElementById('configSenhaModo').value = db.configs.senhaModo || '';
        document.getElementById('configSomCozinha').value = db.configs.somCozinha || 'sem_som';
        document.getElementById('configSomPanelas').value = db.configs.somPanelas || 'sem_som';
        document.getElementById('configVolumeCozinha').value = db.configs.volumeCozinha || '100';
        document.getElementById('configVolumePanelas').value = db.configs.volumePanelas || '70';
        document.getElementById('configTelaAtiva').value = db.configs.telaAtiva || 'sim';
        document.getElementById('configInatividade').value = db.configs.inatividade || '0';
        document.getElementById('configReenvio').value = db.configs.reenvio || 'permitido';
        atualizarLabelsVolume();
    }

    function abrirConfiguracoesBasicas() {
        preencherConfiguracoesBasicas();
        fecharModal('modalPainelUnificado');
        fecharModal('modalConfigKds');
        abrirModalNoTopo('modalConfigBasicas');
    }

    function salvarConfiguracoesBasicas() {
        const configuracoesAnteriores = JSON.stringify(dadosBancoParaNuvem().configs);
        db.configs.senhaModo = document.getElementById('configSenhaModo').value;
        db.configs.somCozinha = document.getElementById('configSomCozinha').value;
        db.configs.somPanelas = document.getElementById('configSomPanelas').value;
        normalizarSonsConfigurados();
        db.configs.volumeCozinha = document.getElementById('configVolumeCozinha').value;
        db.configs.volumePanelas = document.getElementById('configVolumePanelas').value;
        db.configs.telaAtiva = document.getElementById('configTelaAtiva').value;
        db.configs.inatividade = document.getElementById('configInatividade').value;
        db.configs.reenvio = document.getElementById('configReenvio').value;
        if(configuracoesAnteriores !== JSON.stringify(dadosBancoParaNuvem().configs)) marcarBancoAlterado();
        else salvarBancoLocal();

        solicitarWakeLock();
        resetInatividade();
        gerenciarAlarme();
        if(previewAudio) { previewAudio.pause(); }
        fecharModal('modalConfigBasicas');
        abrirModalNoTopo('modalConfigKds');
    }

    function cancelarConfiguracoesBasicas() {
        if(previewAudio) previewAudio.pause();
        fecharModal('modalConfigBasicas');
        abrirModalNoTopo('modalConfigKds');
    }

    function fecharPainelUnificado() {
        if(previewAudio) previewAudio.pause();
        fecharModal('modalPainelUnificado');
    }

    function abrirMenuProdutos() {
        fecharModal('modalPainelUnificado');
        fecharModal('modalConfigKds');
        abrirModalNoTopo('modalMenuProdutos');
    }

    function voltarDoMenuProdutos() {
        fecharModal('modalMenuProdutos');
        abrirModalNoTopo('modalConfigKds');
    }

    let tipoGerenciamentoAtual = '';
    function voltarDaListagem() {
        fecharModal('modalListagem');
        if(['categorias', 'produtos', 'obsPedidos', 'obsCancelamentos'].includes(tipoGerenciamentoAtual)) abrirModalNoTopo('modalMenuProdutos');
        else if(tipoGerenciamentoAtual === 'areas') abrirModalNoTopo('modalConfigKds');
        else abrirModalNoTopo('modalPainelUnificado');
    }

    function salvarSenhaMestra() {
        const novaSenha = document.getElementById('configSenhaMestra').value.trim();
        const feedback = document.getElementById('configSenhaFeedback');
        if (novaSenha === (db.configs.senhaMestra || '')) {
            feedback.style.color = '#607d8b';
            feedback.innerText = 'A senha mestra não foi alterada.';
            return;
        }
        db.configs.senhaMestra = novaSenha;
        marcarBancoAlterado();
        feedback.style.color = '#2e7d32';
        feedback.innerText = novaSenha ? 'Senha mestra salva neste aparelho.' : 'Senha removida. O aplicativo está sem senha.';
    }

    function moverItem(tipo, index, direcao) { const lista = tipo === 'produtos' ? db.produtos : (tipo === 'categorias' ? db.categorias : (tipo === 'obsPedidos' ? db.obsPedidos : db.obsCancelamentos)); if(direcao === 'cima' && index > 0) { const temp = lista[index]; lista[index] = lista[index - 1]; lista[index - 1] = temp; } else if (direcao === 'baixo' && index < lista.length - 1) { const temp = lista[index]; lista[index] = lista[index + 1]; lista[index + 1] = temp; } marcarBancoAlterado(); iniciar(); abrirGerenciar(tipo); }

    function abrirGerenciar(tipo) {
        tipoGerenciamentoAtual = tipo;
        fecharModal('modalPainelUnificado'); fecharModal('modalConfigKds'); fecharModal('modalMenuProdutos'); fecharModal('modalFormProduto'); fecharModal('modalFormCategoria'); fecharModal('modalFormArea');
        const lista = document.getElementById('conteudoListagem'); const btnNovo = document.getElementById('btnNovoListagem'); const titulo = document.getElementById('tituloListagem'); lista.innerHTML = '';
        if(tipo === 'areas') { titulo.innerText = "Gerenciar Áreas"; btnNovo.onclick = () => abrirFormArea(-1); db.areas.forEach((area, idx) => { const funcao = area.tipo === 'envio' ? 'Envia pedidos' : 'Recebe pedidos'; lista.innerHTML += `<div class="gerenciar-item"><div class="gerenciar-info"><strong>${getEmojiAreaHtml(area.emoji)} ${area.nome}</strong><br><span style="color:#666">${funcao}</span></div><div class="gerenciar-actions"><button onclick="abrirFormArea(${idx})" title="Editar">✏️</button><button onclick="excluirArea(${idx})" title="Excluir">🗑️</button></div></div>`; }); } else if(tipo === 'produtos') { titulo.innerText = "Gerenciar Produtos"; btnNovo.onclick = () => abrirFormProduto(-1); db.produtos.forEach((p, idx) => { const origens = getAreasOrigemProduto(p).map(getAreaNome).join(', '); lista.innerHTML += `<div class="gerenciar-item"><div class="gerenciar-info"><strong>${p.nome}</strong><br><span style="color:#666">${p.categoria} · ${origens} → ${getAreaNome(p.areaDestino || 'cozinha')}</span></div><div class="gerenciar-actions"><button onclick="moverItem('produtos', ${idx}, 'cima')">🔼</button><button onclick="moverItem('produtos', ${idx}, 'baixo')">🔽</button><button onclick="abrirFormProduto(${idx})">✏️</button><button onclick="excluirItem('produtos', ${idx})">🗑️</button></div></div>`; }); } else if (tipo === 'categorias') { titulo.innerText = "Gerenciar Categorias"; btnNovo.onclick = () => abrirFormCategoria(-1); db.categorias.forEach((c, idx) => { lista.innerHTML += `<div class="gerenciar-item"><div class="gerenciar-info"><span class="color-preview" style="background:${c.cor}; color:${c.corTexto}">${c.nome}</span></div><div class="gerenciar-actions"><button onclick="moverItem('categorias', ${idx}, 'cima')">🔼</button><button onclick="moverItem('categorias', ${idx}, 'baixo')">🔽</button><button onclick="abrirFormCategoria(${idx})">✏️</button><button onclick="excluirItem('categorias', '${c.nome}')">🗑️</button></div></div>`; }); } else if (tipo === 'obsPedidos') { titulo.innerText = "Observação dos Produtos"; btnNovo.onclick = () => novaObservacao('obsPedidos'); db.obsPedidos.forEach((obs, idx) => { lista.innerHTML += `<div class="gerenciar-item"><div class="gerenciar-info"><strong>${obs}</strong></div><div class="gerenciar-actions"><button onclick="moverItem('obsPedidos', ${idx}, 'cima')">🔼</button><button onclick="moverItem('obsPedidos', ${idx}, 'baixo')">🔽</button><button onclick="excluirItem('obsPedidos', '${obs}')">🗑️</button></div></div>`; }); } else if (tipo === 'obsCancelamentos') { titulo.innerText = "Motivos Cancelamento"; btnNovo.onclick = () => novaObservacao('obsCancelamentos'); db.obsCancelamentos.forEach((obs, idx) => { lista.innerHTML += `<div class="gerenciar-item"><div class="gerenciar-info"><strong>${obs}</strong></div><div class="gerenciar-actions"><button onclick="moverItem('obsCancelamentos', ${idx}, 'cima')">🔼</button><button onclick="moverItem('obsCancelamentos', ${idx}, 'baixo')">🔽</button><button onclick="excluirItem('obsCancelamentos', '${obs}')">🗑️</button></div></div>`; }); }
        document.getElementById('modalListagem').style.display = 'flex';
    }

    async function novaObservacao(tipo) {
        const isProductNote = tipo === 'obsPedidos';
        const obs = await AloUiDialog.prompt(isProductNote ? 'Cadastre uma observação que poderá ser usada nos pedidos.' : 'Cadastre um motivo para o cancelamento.', {
            title: isProductNote ? 'Nova observação' : 'Novo motivo',
            icon: isProductNote ? '💬' : '🗑️',
            inputLabel: isProductNote ? 'Observação' : 'Motivo do cancelamento',
            placeholder: isProductNote ? 'Ex: Sem cebola' : 'Ex: Produto indisponível'
        });
        if(obs) { db[tipo].push(obs); marcarBancoAlterado(); abrirGerenciar(tipo); }
    }
    async function excluirItem(tipo, id) {
        const confirmed = await AloUiDialog.confirm('Este cadastro será removido. Deseja continuar?', {
            title: 'Excluir cadastro', icon: '🗑️', tone: 'danger', confirmText: 'Excluir'
        });
        if(!confirmed) return;
        if(tipo === 'produtos') db.produtos.splice(id, 1);
        if(tipo === 'categorias') db.categorias = db.categorias.filter(i => i.nome !== id);
        if(tipo === 'obsPedidos') db.obsPedidos = db.obsPedidos.filter(i => i !== id);
        if(tipo === 'obsCancelamentos') db.obsCancelamentos = db.obsCancelamentos.filter(i => i !== id);
        marcarBancoAlterado(); iniciar(); abrirGerenciar(tipo);
    }

    function abrirFormProduto(idx) {
        fecharModal('modalListagem');
        const combo = document.getElementById('prodCategoria'); combo.innerHTML = '';
        db.categorias.forEach(c => combo.innerHTML += `<option value="${c.nome}">${c.nome}</option>`);
        const comboDestino = document.getElementById('prodAreaDestino');
        comboDestino.innerHTML = db.areas.filter(area => area.tipo === 'recebimento').map(area => `<option value="${area.id}">${area.emoji} ${area.nome}</option>`).join('');
        let origensSelecionadas = [];
        if(idx >= 0) {
            const p = db.produtos[idx];
            document.getElementById('prodIndexOriginal').value = idx;
            document.getElementById('prodNome').value = p.nome;
            document.getElementById('prodCategoria').value = p.categoria;
            origensSelecionadas = getAreasOrigemProduto(p);
            comboDestino.value = p.areaDestino || 'cozinha';
            document.getElementById('prodObsEspec').value = p.obsEspec ? p.obsEspec.join(', ') : '';
        } else {
            document.getElementById('prodIndexOriginal').value = '-1';
            document.getElementById('prodNome').value = '';
            origensSelecionadas = [getAreaAtual().tipo === 'envio' ? getAreaAtual().id : 'panelas'];
            comboDestino.value = 'cozinha';
            document.getElementById('prodObsEspec').value = '';
        }
        document.getElementById('prodAreasOrigem').innerHTML = db.areas.filter(area => area.tipo === 'envio').map(area => `
            <label class="area-switch-row">
                <span class="area-switch-identidade"><span class="area-switch-emoji">${getEmojiAreaHtml(area.emoji)}</span><span>${area.nome}</span></span>
                <span class="switch-moderno">
                    <input class="area-origem-checkbox" type="checkbox" value="${area.id}" ${origensSelecionadas.includes(area.id) ? 'checked' : ''}>
                    <span class="switch-trilho"></span>
                </span>
            </label>
        `).join('');
        document.getElementById('modalFormProduto').style.display = 'flex';
    }

    function salvarProduto() {
        const idx = parseInt(document.getElementById('prodIndexOriginal').value);
        const nome = document.getElementById('prodNome').value.trim();
        const cat = document.getElementById('prodCategoria').value;
        const obsStr = document.getElementById('prodObsEspec').value;
        const areasOrigem = Array.from(document.querySelectorAll('#prodAreasOrigem .area-origem-checkbox:checked')).map(input => input.value);
        const areaDestino = document.getElementById('prodAreaDestino').value;
        const obsArray = obsStr.split(',').map(s => s.trim()).filter(s => s !== '');

        if(!nome || !cat) return alert("Preencha o nome e a categoria!");
        if(!areasOrigem.length) return alert("Escolha pelo menos uma área que envia o pedido.");
        const areaOrigem = areasOrigem[0];
        if(idx >= 0) {
            db.produtos[idx] = { nome: nome, categoria: cat, obsEspec: obsArray, areasOrigem, areaOrigem, areaDestino };
        } else {
            db.produtos.push({ nome: nome, categoria: cat, obsEspec: obsArray, areasOrigem, areaOrigem, areaDestino });
        }
        marcarBancoAlterado(); iniciar(); abrirGerenciar('produtos');
    }

    function abrirFormArea(idx) {
        fecharModal('modalListagem');
        document.getElementById('areaIndexOriginal').value = idx;
        if (idx >= 0) {
            const area = db.areas[idx];
            document.getElementById('areaNome').value = area.nome;
            document.getElementById('areaEmoji').value = area.emoji || '';
            document.getElementById('areaTipo').value = area.tipo;
        } else {
            document.getElementById('areaNome').value = '';
            document.getElementById('areaEmoji').value = '🥘';
            document.getElementById('areaTipo').value = 'envio';
        }
        document.getElementById('modalFormArea').style.display = 'flex';
    }

    function selecionarEmojiArea(emoji) {
        document.getElementById('areaEmoji').value = emoji;
    }

    function salvarArea() {
        const idx = parseInt(document.getElementById('areaIndexOriginal').value, 10);
        const nome = document.getElementById('areaNome').value.trim();
        const emoji = document.getElementById('areaEmoji').value.trim();
        const tipo = document.getElementById('areaTipo').value;
        if (!nome) return alert('Preencha o nome da área.');
        if (!emoji) return alert('Escolha ou digite um emoji para a área.');
        if (db.areas.some((area, areaIdx) => areaIdx !== idx && area.nome.toLowerCase() === nome.toLowerCase())) return alert('Já existe uma área com esse nome.');

        if (idx >= 0) {
            const atual = db.areas[idx];
            if ((atual.id === 'panelas' || atual.id === 'cozinha') && atual.tipo !== tipo) return alert('A função das áreas padrão não pode ser alterada.');
            const emUso = db.produtos.some(produto => getAreasOrigemProduto(produto).includes(atual.id) || produto.areaDestino === atual.id);
            if (emUso && atual.tipo !== tipo) return alert('Esta área está ligada a produtos. Altere primeiro a rota desses produtos.');
            db.areas[idx] = { ...atual, nome, tipo, emoji };
        } else {
            db.areas.push({ id: `area_${Date.now()}`, nome, tipo, emoji });
        }
        normalizarAreasERotas(); marcarBancoAlterado(); iniciar(); abrirGerenciar('areas');
    }

    async function excluirArea(idx) {
        const area = db.areas[idx];
        if (!area) return;
        if (area.id === 'panelas' || area.id === 'cozinha') return alert('As áreas padrão Panelas e Cozinha não podem ser excluídas.');
        if (db.produtos.some(produto => getAreasOrigemProduto(produto).includes(area.id) || produto.areaDestino === area.id)) return alert('Esta área está ligada a produtos. Altere primeiro a rota desses produtos.');
        const confirmed = await AloUiDialog.confirm(`Excluir a área “${area.nome}”?`, {
            title: 'Excluir área', icon: '🗑️', tone: 'danger', confirmText: 'Excluir área'
        });
        if (!confirmed) return;
        db.areas.splice(idx, 1);
        if (db.configs.areaAtual === area.id) db.configs.areaAtual = 'panelas';
        normalizarAreasERotas(); marcarBancoAlterado(); iniciar(); abrirGerenciar('areas');
    }

    function abrirFormCategoria(idx) { fecharModal('modalListagem'); if(idx >= 0) { const c = db.categorias[idx]; document.getElementById('catIndexOriginal').value = idx; document.getElementById('catNome').value = c.nome; document.getElementById('catCor').value = c.cor; document.getElementById('catCorTexto').value = c.corTexto || '#000000'; } else { document.getElementById('catIndexOriginal').value = '-1'; document.getElementById('catNome').value = ''; document.getElementById('catCor').value = '#1976D2'; document.getElementById('catCorTexto').value = '#ffffff'; } document.getElementById('modalFormCategoria').style.display = 'flex'; }
    function salvarCategoria() { const idx = parseInt(document.getElementById('catIndexOriginal').value); const nome = document.getElementById('catNome').value.trim(); const cor = document.getElementById('catCor').value; const corTexto = document.getElementById('catCorTexto').value; if(!nome) return alert("Preencha o nome!"); if(idx >= 0) { const nomeAntigo = db.categorias[idx].nome; db.categorias[idx] = { nome, cor, corTexto }; db.produtos.forEach(p => { if(p.categoria === nomeAntigo) p.categoria = nome; }); } else { db.categorias.push({ nome, cor, corTexto }); } marcarBancoAlterado(); iniciar(); abrirGerenciar('categorias'); }

    function confirmarSenhaAdmin() {
        const input = document.getElementById('senhaAdmin');
        if (!db.configs.senhaMestra || input.value !== db.configs.senhaMestra) {
            return senhaIncorreta('senhaAdmin', 'erroSenhaAdmin');
        }
        input.blur();
        fecharModal('modalLoginAdmin');
        input.value = '';
        limparErroSenha('erroSenhaAdmin');
        abrirDestinoConfiguracoes();
    }

    function confirmarSenhaAvancada() {
        const input = document.getElementById('senhaAvancada');
        if (!db.configs.senhaMestra || input.value !== db.configs.senhaMestra) {
            return senhaIncorreta('senhaAvancada', 'erroSenhaAvancada');
        }
        input.blur();
        fecharModal('modalSenhaAvancada');
        input.value = '';
        limparErroSenha('erroSenhaAvancada');
        abrirConfiguracoesAvancadas();
    }

    async function confirmarSenhaAcao() {
        const input = document.getElementById('inputSenhaAcao');
        if (!db.configs.senhaMestra || input.value !== db.configs.senhaMestra) {
            return senhaIncorreta('inputSenhaAcao', 'erroSenhaAcao');
        }
        input.blur();
        fecharModal('modalSenhaAcao');
        input.value = '';
        limparErroSenha('erroSenhaAcao');
        await executarAcaoPendenteAutorizada();
    }

    function cancelarAutorizacaoAcao() {
        fecharModal('modalSenhaAcao');
        document.getElementById('inputSenhaAcao').value = '';
        limparErroSenha('erroSenhaAcao');
        acaoPendente = null;
        parametroAcao = null;
    }

    let syncConfiavel = null;
    let bancoSyncTimer = null;
    let bancoSyncEmAndamento = false;

    function atualizarIndicadorSincronizacao(estado) {
        estadoSyncPedidosAtual = estado || estadoSyncPedidosAtual;
        const indicador = document.getElementById('indicadorConexao');
        if (!indicador) return;
        const pendingPedidos = Number(estadoSyncPedidosAtual.pendingCount || 0);
        if (pendingPedidos > 0) {
            indicador.innerText = `📤 ${pendingPedidos}`;
            indicador.title = estadoSyncPedidosAtual.online ? `${pendingPedidos} operação(ões) aguardando confirmação` : `${pendingPedidos} operação(ões) aguardando internet`;
            return;
        }
        if (db.configs.bancoPendente) {
            indicador.innerText = '☁️';
            indicador.title = estadoSyncPedidosAtual.online ? 'Publicando cardápio e configurações' : 'Alterações aguardando internet';
            return;
        }
        indicador.innerText = estadoSyncPedidosAtual.online ? '🟢' : '🔴';
        indicador.title = estadoSyncPedidosAtual.online ? 'Sincronizado' : 'Sem conexão';
    }

    async function tentarSincronizarAgora() {
        if (syncConfiavel) await syncConfiavel.retryNow();
        await sincronizarBancoAutomaticamente();
    }

    function aplicarPedidosSincronizados(novosPedidos) {
        pedidosServidor = novosPedidos;
        salvarHistoricoLocal();
        if (db.configs.modo === 'cozinha') renderizarListaCozinha();
        else renderizarUltimosPedidos();
        gerenciarAlarme();
    }

    tocarPreview = function(selectId) { AloAudio.previewSound(selectId); };
    atualizarLabelsVolume = function() { AloAudio.updateVolumeLabels(); };
    normalizarSom = function(valor, fallback) { return AloAudio.normalize(valor, fallback); };
    normalizarSonsConfigurados = function() {
        db.configs.somCozinha = AloAudio.normalize(db.configs.somCozinha || 'sem_som', 'sirene_cozinha');
        db.configs.somPanelas = AloAudio.normalize(db.configs.somPanelas || 'sem_som', 'beep');
    };
    gerenciarAlarme = function() {
        AloAudio.manage({ mode: db.configs.modo, configs: db.configs, orders: pedidosDaAreaAtual(), knownIds: pedidosCientes });
    };
    pararAlarme = function() { AloAudio.stop(); };

    syncGeral = async function(forcarAtualizacao = false) {
        if (syncConfiavel) await syncConfiavel.syncNow(true, Boolean(forcarAtualizacao));
    };
    processarFilaRetentativas = async function() {
        if (syncConfiavel) await syncConfiavel.syncNow(true);
    };
    alterarStatusPedido = async function(id, novoStatus, motivo = '') {
        pedidosBloqueados.add(String(id));
        if (!syncConfiavel) {
            pedidosBloqueados.delete(String(id));
            alert('O armazenamento do aplicativo ainda está iniciando. Toque novamente.');
            return;
        }
        try {
            await syncConfiavel.enqueueStatus(String(id), novoStatus, motivo);
            aplicarPedidosSincronizados(syncConfiavel.orders);
        } catch (error) {
            alert('Não foi possível guardar essa alteração neste aparelho. Toque novamente.');
        } finally {
            setTimeout(() => pedidosBloqueados.delete(String(id)), 15000);
        }
    };

    async function excluirPedidoConfiavel(id) {
        if (!syncConfiavel) return alert('O armazenamento do aplicativo ainda está iniciando. Tente novamente.');
        try {
            await syncConfiavel.enqueueDelete(String(id));
            aplicarPedidosSincronizados(syncConfiavel.orders);
            abrirHistorico();
        } catch (error) {
            alert('Não foi possível guardar a exclusão. O pedido foi preservado; tente novamente.');
        }
    }

    async function excluirHojeConfiavel() {
        if (!syncConfiavel) return alert('O armazenamento do aplicativo ainda está iniciando. Tente novamente.');
        try {
            await syncConfiavel.enqueueDeleteToday();
            aplicarPedidosSincronizados(syncConfiavel.orders);
            abrirHistorico();
            alert(navigator.onLine ? 'Expediente removido. Confirmando no servidor.' : 'Expediente removido deste aparelho. A exclusão será enviada quando a internet voltar.');
        } catch (error) {
            alert('Não foi possível guardar a exclusão. Os pedidos foram preservados; tente novamente.');
        }
    }

    excluirTodoHistorico = async function() {
        const frase = document.getElementById('inputExcluirTudo').value;
        if (frase !== 'quero excluir todo o histórico') return alert('Frase de segurança incorreta.');
        if (!syncConfiavel) return alert('O armazenamento do aplicativo ainda está iniciando. Tente novamente.');
        try {
            await syncConfiavel.enqueueDeleteAll();
            aplicarPedidosSincronizados(syncConfiavel.orders);
            fecharModal('modalConfigAvancadas');
            alert(navigator.onLine ? 'Histórico removido. Confirmando no servidor.' : 'Histórico removido deste aparelho. A exclusão será enviada quando a internet voltar.');
        } catch (error) {
            alert('Não foi possível guardar a exclusão. O histórico foi preservado; tente novamente.');
        }
    };
    enviarPedidoConfirmado = async function() {
        if (envioPedidoEmAndamento || !syncConfiavel) return;
        envioPedidoEmAndamento = true;
        const btnConfirmar = document.getElementById('btnConfirmarPedido');
        if (btnConfirmar) btnConfirmar.disabled = true;
        const nome = document.getElementById('pedidoItemNome').value;
        const obsText = document.getElementById('pedidoObsText').value.trim();
        const reenvio = db.configs.reenvio || 'permitido';

        if (existeItemEmProducao(nome) && reenvio !== 'permitido') {
            const podeEnviar = reenvio === 'confirmacao' && await AloUiDialog.confirm('Esse item já está em produção. Deseja enviar outro pedido mesmo assim?', {
                title: 'Pedido repetido', icon: '↻', confirmText: 'Enviar novamente'
            });
            if (!podeEnviar) {
                if (reenvio === 'bloqueado') alert('Esse item está em produção');
                document.getElementById('modalFazerPedido').style.display = 'none';
                envioPedidoEmAndamento = false;
                if (btnConfirmar) btnConfirmar.disabled = false;
                return;
            }
        }

        const produto = obsText ? `${nome} (Obs: ${obsText})` : nome;
        const cadastroProduto = db.produtos.find(item => item.nome === nome) || {};
        const origensProduto = getAreasOrigemProduto(cadastroProduto);
        const areaOrigemAtual = getAreaAtual().tipo === 'envio' && origensProduto.includes(getAreaAtual().id)
            ? getAreaAtual().id
            : origensProduto[0];
        try {
            const pedido = await syncConfiavel.enqueueNewOrder({
                produto,
                areaOrigem: areaOrigemAtual || 'panelas',
                areaDestino: cadastroProduto.areaDestino || 'cozinha'
            });
            pedidosServidor = syncConfiavel.orders;
            document.getElementById('modalFazerPedido').style.display = 'none';
            renderizarUltimosPedidos();
            focarUltimosPedidosPanelas();
            salvarHistoricoLocal();
            if (!navigator.onLine) alert('Pedido guardado neste aparelho. Ele será enviado quando a internet voltar.');
        } catch (error) {
            alert('Não foi possível guardar o pedido neste aparelho. Tente novamente.');
        } finally {
            envioPedidoEmAndamento = false;
            if (btnConfirmar) btnConfirmar.disabled = false;
        }
    };

    async function iniciarComSyncConfiavel() {
        document.addEventListener('touchstart', () => AloAudio.unlock(), { once: true });
        document.addEventListener('click', () => AloAudio.unlock(), { once: true });
        iniciar();
        if (window.AloTasks) {
            AloTasks.init({
                getDatabase: () => db,
                getUrl: () => db.configs.url,
                markDatabaseChanged: marcarBancoAlterado,
                openModalTop: abrirModalNoTopo
            });
        }
        syncConfiavel = new AloSync({
            getUrl: () => db.configs.url,
            onOrders: aplicarPedidosSincronizados,
            onState: atualizarIndicadorSincronizacao
        });
        await syncConfiavel.start();
        await sincronizarBancoAutomaticamente();
        if(!bancoSyncTimer) bancoSyncTimer = setInterval(sincronizarBancoAutomaticamente, 5000);
        window.addEventListener('online', () => agendarSincronizacaoBanco(0));
    }

    const abrirModalMetricasOriginal = abrirModalMetricas;
    const renderizarMetricasDetalhesLocal = renderizarMetricasDetalhes;
    const cacheRelatorios = new Map();
    let requisicaoRelatorio = 0;

    function intervaloDoRelatorio(periodo) {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        let inicio = new Date(hoje);
        let fim = new Date();
        if (periodo === '7d') inicio.setDate(inicio.getDate() - 6);
        else if (periodo === '15d') inicio.setDate(inicio.getDate() - 14);
        else if (periodo === '30d') inicio.setDate(inicio.getDate() - 29);
        else if (periodo === 'custom') {
            const valorInicio = document.getElementById('filtroDataInicio').value;
            const valorFim = document.getElementById('filtroDataFim').value;
            if (!valorInicio || !valorFim) return null;
            inicio = new Date(`${valorInicio}T00:00:00`);
            fim = new Date(`${valorFim}T23:59:59.999`);
        }
        return { start: inicio.toISOString(), end: fim.toISOString() };
    }

    async function atualizarHistoricoRelatorio(periodo) {
        if (!syncConfiavel || !db.configs.url) return;
        const intervalo = intervaloDoRelatorio(periodo);
        if (!intervalo) return;
        const chave = `${intervalo.start}|${intervalo.end}`;
        const agora = Date.now();
        if (agora - (cacheRelatorios.get(chave) || 0) < 30000) return;

        const idRequisicao = ++requisicaoRelatorio;
        const status = document.getElementById('statusRelatorio');
        if (status) status.innerText = 'Atualizando dados...';
        try {
            const resposta = await AloApi.getHistory(db.configs.url, intervalo.start, intervalo.end);
            if (idRequisicao !== requisicaoRelatorio) return;
            const historico = Array.isArray(resposta.pedidos) ? resposta.pedidos.map(AloLogic.normalizeOrder) : [];
            const porId = new Map(syncConfiavel.orders.map(pedido => [pedido.id, pedido]));
            historico.forEach(pedido => porId.set(pedido.id, pedido));
            syncConfiavel.orders = Array.from(porId.values()).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            await AloStorage.putOrders(syncConfiavel.orders);
            aplicarPedidosSincronizados(syncConfiavel.orders);
            cacheRelatorios.set(chave, Date.now());
            renderizarMetricasDetalhesLocal(periodo);
            if (status) status.innerText = 'Dados atualizados';
        } catch (error) {
            if (idRequisicao === requisicaoRelatorio && status) status.innerText = 'Exibindo os dados salvos neste aparelho';
        }
    }

    renderizarMetricasDetalhes = function(periodo) {
        renderizarMetricasDetalhesLocal(periodo);
        atualizarHistoricoRelatorio(periodo);
    };

    abrirModalMetricas = function() {
        const status = document.getElementById('statusRelatorio');
        if (status) status.innerText = '';
        abrirModalMetricasOriginal();
    };

    function dadosBancoParaNuvem() {
        return {
            produtos: db.produtos,
            categorias: db.categorias,
            obsPedidos: db.obsPedidos,
            obsCancelamentos: db.obsCancelamentos,
            areas: db.areas,
            setoresTarefas: db.setoresTarefas,
            funcionarios: db.funcionarios,
            tarefas: db.tarefas,
            configsTarefas: {
                som: db.configsTarefas.som,
                volume: db.configsTarefas.volume,
                repeticaoMinutos: db.configsTarefas.repeticaoMinutos
            },
            configs: {
                senhaMestra: db.configs.senhaMestra || '',
                senhaModo: db.configs.senhaModo || '',
                somCozinha: db.configs.somCozinha || 'sem_som',
                somPanelas: db.configs.somPanelas || 'sem_som',
                volumeCozinha: db.configs.volumeCozinha || '100',
                volumePanelas: db.configs.volumePanelas || '70',
                telaAtiva: db.configs.telaAtiva || 'sim',
                inatividade: db.configs.inatividade || '0',
                reenvio: db.configs.reenvio || 'permitido'
            }
        };
    }

    function ehUrlAppsScript(valor) {
        try {
            const url = new URL(valor);
            return url.protocol === 'https:'
                && url.hostname === 'script.google.com'
                && /^\/macros\/s\/[^/]+\/exec\/?$/.test(url.pathname);
        } catch(error) {
            return false;
        }
    }

    function bancoNuvemValido(nuvemDB) {
        return Boolean(nuvemDB)
            && !Array.isArray(nuvemDB)
            && typeof nuvemDB === 'object'
            && Object.prototype.hasOwnProperty.call(nuvemDB, '_revision');
    }

    function aplicarBancoDaNuvem(nuvemDB) {
        const configuracaoLocal = {
            url: db.configs.url,
            modo: db.configs.modo,
            areaAtual: db.configs.areaAtual
        };
        db.produtos = Array.isArray(nuvemDB.produtos) ? nuvemDB.produtos : db.produtos;
        db.categorias = Array.isArray(nuvemDB.categorias) ? nuvemDB.categorias : db.categorias;
        db.obsPedidos = Array.isArray(nuvemDB.obsPedidos) ? nuvemDB.obsPedidos : db.obsPedidos;
        db.obsCancelamentos = Array.isArray(nuvemDB.obsCancelamentos) ? nuvemDB.obsCancelamentos : db.obsCancelamentos;
        db.areas = Array.isArray(nuvemDB.areas) && nuvemDB.areas.length ? nuvemDB.areas : db.areas;
        db.setoresTarefas = Array.isArray(nuvemDB.setoresTarefas) && nuvemDB.setoresTarefas.length ? nuvemDB.setoresTarefas : db.setoresTarefas;
        db.funcionarios = Array.isArray(nuvemDB.funcionarios) ? nuvemDB.funcionarios : db.funcionarios;
        db.tarefas = Array.isArray(nuvemDB.tarefas) ? nuvemDB.tarefas : db.tarefas;
        db.configsTarefas = { ...db.configsTarefas, ...(nuvemDB.configsTarefas || {}) };
        db.configs = {
            ...db.configs,
            ...(nuvemDB.configs || {}),
            ...configuracaoLocal,
            dadosBaixados: true,
            bancoPendente: false,
            revisaoBanco: Number(nuvemDB._revision || 0)
        };
        normalizarAreasERotas();
        normalizarSonsConfigurados();
        salvarBancoLocal();
        if (window.AloTasks) AloTasks.refreshDefinitions();
    }

    function agendarSincronizacaoBanco(atraso = 450) {
        if(bancoPublicacaoTimer) clearTimeout(bancoPublicacaoTimer);
        bancoPublicacaoTimer = setTimeout(() => {
            bancoPublicacaoTimer = null;
            sincronizarBancoAutomaticamente();
        }, atraso);
    }

    async function publicarBancoPendente() {
        const dadosEnviados = dadosBancoParaNuvem();
        const assinaturaEnviada = JSON.stringify(dadosEnviados);
        const resultado = await AloCatalogSync.publish({ api: AloApi, url: db.configs.url, data: dadosEnviados });
        if(!resultado.confirmed) return;

        const nenhumaEdicaoNova = JSON.stringify(dadosBancoParaNuvem()) === assinaturaEnviada;
        db.configs.dadosBaixados = true;
        db.configs.bancoPendente = !nenhumaEdicaoNova;
        db.configs.revisaoBanco = resultado.revision;
        salvarBancoLocal();
    }

    async function sincronizarBancoAutomaticamente() {
        if(bancoSyncEmAndamento || !db.configs.url || !navigator.onLine) return;
        bancoSyncEmAndamento = true;
        try {
            if(db.configs.bancoPendente) {
                await publicarBancoPendente();
            } else {
                const nuvemDB = await AloApi.getBank(db.configs.url);
                if(!bancoNuvemValido(nuvemDB) || !Array.isArray(nuvemDB.produtos)) return;
                const revisaoNuvem = Number(nuvemDB._revision || 0);
                const revisaoLocal = Number(db.configs.revisaoBanco || 0);
                if(!db.configs.dadosBaixados || revisaoNuvem > revisaoLocal) {
                    aplicarBancoDaNuvem(nuvemDB);
                    iniciar();
                }
            }
        } catch(error) {
            // O banco permanece marcado e tenta novamente ao recuperar a conexão.
        } finally {
            bancoSyncEmAndamento = false;
            atualizarIndicadorSincronizacao(estadoSyncPedidosAtual);
            if(db.configs.bancoPendente && navigator.onLine) agendarSincronizacaoBanco(2200);
        }
    }

    sincronizarPuxarNuvem = async function(pedirConfirmacao) {
        if (!db.configs.url) return;
        if (pedirConfirmacao) {
            const confirmed = await AloUiDialog.confirm('Este aparelho receberá o cardápio salvo na nuvem. Deseja continuar?', {
                title: 'Receber dados da nuvem', icon: '☁️', confirmText: 'Receber dados'
            });
            if (!confirmed) return;
        }
        try {
            const nuvemDB = await AloApi.getBank(db.configs.url);
            if (!bancoNuvemValido(nuvemDB)) {
                alert('URL incompatível com o banco do Alô Cozinha.');
                return;
            }
            if (Array.isArray(nuvemDB.produtos)) {
                aplicarBancoDaNuvem(nuvemDB);
                if (pedirConfirmacao) {
                    alert('Cardápio e configurações atualizados.');
                    location.reload();
                } else {
                    iniciar();
                }
            }
        } catch (error) {
            if(pedirConfirmacao) alert('Falha ao receber os dados. O que já está neste aparelho foi preservado.');
        }
    };

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js?v=2.0.10').catch(() => {}));
    }

    iniciarComSyncConfiavel();
