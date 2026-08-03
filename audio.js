(function (global) {
    const sounds = {
        sem_som: { type: 'silent' },
        alarme: { type: 'audio', url: 'https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg' },
        beep: { type: 'audio', url: 'https://actions.google.com/sounds/v1/alarms/beep_short.ogg' },
        sino_forte: { type: 'audio', url: 'https://actions.google.com/sounds/v1/alarms/medium_bell_ringing_near.ogg' },
        sirene_cozinha: { type: 'synthetic', interval: 950 },
        alerta_triplo: { type: 'synthetic', interval: 850 },
        campainha_forte: { type: 'synthetic', interval: 1000 },
        toque_urgente: { type: 'synthetic', interval: 750 }
    };
    let player = new Audio();
    let preview = null;
    let previewTimer = null;
    let context = null;
    let syntheticTimer = null;
    let playingKey = 'sem_som';
    let playingVolume = -1;

    function normalize(value, fallback) {
        return value === 'sem_som' || sounds[value] ? value : fallback;
    }

    function audioContext() {
        const AudioContextClass = global.AudioContext || global.webkitAudioContext;
        if (!AudioContextClass) return null;
        if (!context) context = new AudioContextClass();
        if (context.state === 'suspended') context.resume().catch(() => {});
        return context;
    }

    function volumeFor(selectId) {
        const volumeId = selectId === 'configSomPanelas' ? 'configVolumePanelas' : 'configVolumeCozinha';
        const input = document.getElementById(volumeId);
        return Math.max(0, Math.min(100, Number(input ? input.value : 100))) / 100;
    }

    function updateVolumeLabels() {
        [['configVolumeCozinha', 'labelVolumeCozinha'], ['configVolumePanelas', 'labelVolumePanelas']].forEach(([inputId, labelId]) => {
            const input = document.getElementById(inputId);
            const label = document.getElementById(labelId);
            if (input && label) label.innerText = `${input.value}%`;
        });
    }

    function playPulse(startFrequency, endFrequency, delay, duration, volume, wave, layers) {
        const ctx = audioContext();
        if (!ctx || volume <= 0) return;
        const startsAt = ctx.currentTime + delay;
        const compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -24;
        compressor.ratio.value = 12;
        compressor.connect(ctx.destination);
        for (let index = 0; index < layers; index++) {
            const offset = (index - (layers - 1) / 2) * 18;
            const oscillator = ctx.createOscillator();
            const gain = ctx.createGain();
            oscillator.type = wave;
            oscillator.frequency.setValueAtTime(startFrequency + offset, startsAt);
            oscillator.frequency.linearRampToValueAtTime(endFrequency + offset, startsAt + duration);
            gain.gain.setValueAtTime(0.0001, startsAt);
            gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume * 0.75), startsAt + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
            oscillator.connect(gain).connect(compressor);
            oscillator.start(startsAt);
            oscillator.stop(startsAt + duration + 0.04);
        }
        setTimeout(() => { try { compressor.disconnect(); } catch (error) {} }, (delay + duration + 0.3) * 1000);
    }

    function playNoise(delay, duration, volume) {
        const ctx = audioContext();
        if (!ctx || volume <= 0) return;
        const startsAt = ctx.currentTime + delay;
        const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * duration), ctx.sampleRate);
        const samples = buffer.getChannelData(0);
        for (let index = 0; index < samples.length; index++) samples[index] = (Math.random() * 2 - 1) * 0.55;
        const source = ctx.createBufferSource();
        const filter = ctx.createBiquadFilter();
        const gain = ctx.createGain();
        filter.type = 'bandpass';
        filter.frequency.value = 1600;
        filter.Q.value = 1.6;
        gain.gain.setValueAtTime(0.0001, startsAt);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volume * 0.55), startsAt + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);
        source.buffer = buffer;
        source.connect(filter).connect(gain).connect(ctx.destination);
        source.start(startsAt);
        source.stop(startsAt + duration + 0.04);
    }

    function playSynthetic(key, volume) {
        if (navigator.vibrate) navigator.vibrate(key === 'toque_urgente' ? [120, 60, 120, 60, 220] : [180, 70, 180]);
        if (key === 'sirene_cozinha') {
            playPulse(560, 1420, 0, 0.34, volume, 'square', 3);
            playNoise(0.02, 0.18, volume);
            playPulse(1420, 560, 0.38, 0.34, volume, 'square', 3);
            playNoise(0.40, 0.16, volume);
        } else if (key === 'alerta_triplo') {
            [0, 0.22, 0.44].forEach((delay, index) => {
                playPulse(index === 1 ? 1480 : 1180, index === 1 ? 1480 : 1180, delay, index === 2 ? 0.22 : 0.16, volume, 'square', 3);
                playNoise(delay, index === 2 ? 0.14 : 0.12, volume);
            });
        } else if (key === 'campainha_forte') {
            playPulse(920, 1620, 0, 0.18, volume, 'sine', 4);
            playPulse(1620, 920, 0.2, 0.18, volume, 'sine', 4);
            playPulse(1180, 1180, 0.48, 0.25, volume, 'triangle', 4);
        } else if (key === 'toque_urgente') {
            [[780, 0, 0.12], [980, 0.14, 0.12], [1280, 0.28, 0.18], [1620, 0.5, 0.22]].forEach(([frequency, delay, duration]) => playPulse(frequency, frequency, delay, duration, volume, delay === 0.5 ? 'square' : 'sawtooth', 3));
            playNoise(0.5, 0.16, volume);
        }
    }

    function stopSynthetic() {
        if (syntheticTimer) clearInterval(syntheticTimer);
        syntheticTimer = null;
    }

    function stop() {
        player.pause();
        stopSynthetic();
        playingKey = 'sem_som';
        playingVolume = -1;
        const header = document.getElementById('mainHeader');
        if (header) header.classList.remove('alerta-pisca', 'alerta-pisca-buscar');
    }

    function previewSound(selectId) {
        if (preview) { preview.pause(); preview.currentTime = 0; }
        if (previewTimer) clearTimeout(previewTimer);
        const key = normalize(document.getElementById(selectId).value, selectId === 'configSomPanelas' ? 'beep' : 'sirene_cozinha');
        if (key === 'sem_som') return;
        const sound = sounds[key];
        const volume = volumeFor(selectId);
        if (sound.type === 'audio') {
            preview = new Audio(sound.url);
            preview.volume = volume;
            preview.play().catch(() => {});
            previewTimer = setTimeout(() => preview && preview.pause(), 3000);
        } else {
            playSynthetic(key, volume);
        }
    }

    function manage({ mode, configs, orders, knownIds }) {
        const header = document.getElementById('mainHeader');
        if (!header) return;
        header.classList.remove('alerta-pisca', 'alerta-pisca-buscar');
        let key = 'sem_som';
        if (mode === 'cozinha') {
            if (orders.some(order => order.status === 'pendente' && global.AloLogic.isToday(order.timestamp))) {
                header.classList.add('alerta-pisca');
                key = normalize(configs.somCozinha || 'sem_som', 'sirene_cozinha');
            }
        } else {
            const now = Date.now();
            if (orders.some(order => (order.status === 'buscar' || order.status === 'cancelado') && (now - new Date(order.finalizadoEm).getTime()) < 300000 && !knownIds.has(String(order.id)))) {
                header.classList.add('alerta-pisca-buscar');
                key = normalize(configs.somPanelas || 'sem_som', 'beep');
            }
        }
        if (key === 'sem_som') return stop();
        const sound = sounds[key];
        const volume = Math.max(0, Math.min(100, Number(mode === 'panelas' ? configs.volumePanelas || 70 : configs.volumeCozinha || 100))) / 100;
        if (playingKey === key && Math.abs(playingVolume - volume) < 0.01) return;
        stop();
        playingKey = key;
        playingVolume = volume;
        if (sound.type === 'audio') {
            player.src = sound.url;
            player.loop = true;
            player.volume = volume;
            player.play().catch(() => {});
        } else {
            playSynthetic(key, volume);
            syntheticTimer = setInterval(() => playSynthetic(key, volume), sound.interval);
        }
    }

    function unlock() {
        audioContext();
    }

    global.AloAudio = Object.freeze({
        sounds,
        normalize,
        volumeFor,
        updateVolumeLabels,
        previewSound,
        manage,
        stop,
        unlock
    });
})(window);
