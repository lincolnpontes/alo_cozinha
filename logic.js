(function (global) {
    const ACTIVE_STATUSES = new Set(['pendente', 'fazendo']);
    const FINAL_STATUSES = new Set(['enviado', 'buscar', 'cancelado', 'concluido']);

    function createId(prefix = 'op') {
        if (global.crypto && typeof global.crypto.randomUUID === 'function') {
            return `${prefix}_${global.crypto.randomUUID()}`;
        }
        return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }

    function getNomeBasePedido(produto) {
        return (produto || '').split(' (Obs:')[0];
    }

    function isToday(value) {
        const date = new Date(value);
        return !Number.isNaN(date.getTime()) && date.toDateString() === new Date().toDateString();
    }

    function isPedidoAtivoHoje(pedido) {
        return Boolean(pedido && ACTIVE_STATUSES.has(pedido.status) && isToday(pedido.timestamp));
    }

    function isStatusFinal(status) {
        return FINAL_STATUSES.has(status);
    }

    function normalizeOrder(order) {
        return {
            id: String(order.id),
            produto: order.produto || '',
            status: order.status || 'pendente',
            timestamp: order.timestamp || new Date().toISOString(),
            finalizadoEm: order.finalizadoEm || '',
            motivo: order.motivo || '',
            atualizadoEm: order.atualizadoEm || order.timestamp || new Date().toISOString(),
            revisao: Number(order.revisao || 0),
            operacaoId: order.operacaoId || '',
            areaOrigem: order.areaOrigem || 'panelas',
            areaDestino: order.areaDestino || 'cozinha',
            syncState: order.syncState || 'confirmed',
            localOnly: Boolean(order.localOnly)
        };
    }

    global.AloLogic = Object.freeze({
        ACTIVE_STATUSES,
        FINAL_STATUSES,
        createId,
        getNomeBasePedido,
        isToday,
        isPedidoAtivoHoje,
        isStatusFinal,
        normalizeOrder
    });
})(window);
