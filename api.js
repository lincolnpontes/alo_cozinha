(function (global) {
    function buildUrl(baseUrl, params = {}) {
        const url = new URL(baseUrl);
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
        });
        url.searchParams.set('cb', Date.now().toString());
        return url.toString();
    }

    async function post(baseUrl, payload) {
        if (!baseUrl) throw new Error('URL do servidor não configurada.');
        await fetch(baseUrl, {
            method: 'POST',
            mode: 'no-cors',
            cache: 'no-store',
            body: JSON.stringify(payload)
        });
    }

    async function sync(baseUrl, revision) {
        const response = await fetch(buildUrl(baseUrl, { action: 'sincronizar', revision }), { cache: 'no-store' });
        if (!response.ok) throw new Error('Servidor indisponível.');
        return response.json();
    }

    async function getBank(baseUrl) {
        const response = await fetch(buildUrl(baseUrl, { action: 'carregar_banco' }), { cache: 'no-store' });
        if (!response.ok) throw new Error('Não foi possível carregar o cardápio.');
        return response.json();
    }

    async function getHistory(baseUrl, start, end) {
        const response = await fetch(buildUrl(baseUrl, { action: 'historico', start, end }), { cache: 'no-store' });
        if (!response.ok) throw new Error('Não foi possível carregar o histórico.');
        return response.json();
    }

    async function syncActivities(baseUrl, revision) {
        const response = await fetch(buildUrl(baseUrl, { action: 'sincronizar_atividades', revision }), { cache: 'no-store' });
        if (!response.ok) throw new Error('Não foi possível sincronizar as tarefas.');
        return response.json();
    }

    async function getActivityHistory(baseUrl, start, end) {
        const response = await fetch(buildUrl(baseUrl, { action: 'historico_atividades', start, end }), { cache: 'no-store' });
        if (!response.ok) throw new Error('Não foi possível carregar o histórico de tarefas.');
        return response.json();
    }

    global.AloApi = Object.freeze({ buildUrl, post, sync, getBank, getHistory, syncActivities, getActivityHistory });
})(window);
