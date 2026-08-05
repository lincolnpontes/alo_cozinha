(function (global) {
    function comparable(bank) {
        return {
            produtos: bank.produtos || [],
            categorias: bank.categorias || [],
            obsPedidos: bank.obsPedidos || [],
            obsCancelamentos: bank.obsCancelamentos || [],
            areas: bank.areas || [],
            setoresTarefas: bank.setoresTarefas || [],
            funcionarios: bank.funcionarios || [],
            tarefas: bank.tarefas || [],
            configsTarefas: bank.configsTarefas || {},
            configs: bank.configs || {}
        };
    }

    function isEqual(bank, data) {
        return JSON.stringify(comparable(bank)) === JSON.stringify(data);
    }

    async function publish({ api, url, data, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
        const current = await api.getBank(url);
        if (!current || Array.isArray(current) || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, '_revision')) {
            throw new Error('Banco incompativel.');
        }
        if (isEqual(current, data)) {
            return { confirmed: true, revision: Number(current._revision || 0), sent: false };
        }

        await api.post(url, {
            action: 'salvar_banco',
            dados: data,
            expectedRevision: Number(current._revision || 0)
        });
        await wait(650);
        const confirmed = await api.getBank(url);
        return {
            confirmed: isEqual(confirmed, data),
            revision: Number(confirmed && confirmed._revision || 0),
            sent: true
        };
    }

    global.AloCatalogSync = Object.freeze({ isEqual, publish });
})(window);
