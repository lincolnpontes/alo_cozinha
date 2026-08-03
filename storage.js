(function (global) {
    const DB_NAME = 'alo_cozinha_operacao';
    const DB_VERSION = 1;
    const STORES = { orders: 'orders', outbox: 'outbox', meta: 'meta' };
    let databasePromise = null;

    function openDatabase() {
        if (databasePromise) return databasePromise;
        databasePromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORES.orders)) {
                    const store = db.createObjectStore(STORES.orders, { keyPath: 'id' });
                    store.createIndex('syncState', 'syncState', { unique: false });
                    store.createIndex('timestamp', 'timestamp', { unique: false });
                }
                if (!db.objectStoreNames.contains(STORES.outbox)) {
                    const store = db.createObjectStore(STORES.outbox, { keyPath: 'operationId' });
                    store.createIndex('orderId', 'orderId', { unique: false });
                    store.createIndex('nextAttemptAt', 'nextAttemptAt', { unique: false });
                    store.createIndex('type', 'type', { unique: false });
                }
                if (!db.objectStoreNames.contains(STORES.meta)) {
                    db.createObjectStore(STORES.meta, { keyPath: 'key' });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento local.'));
        });
        return databasePromise;
    }

    async function transaction(storeNames, mode, callback) {
        const db = await openDatabase();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(storeNames, mode);
            let result;
            tx.oncomplete = () => resolve(result);
            tx.onerror = () => reject(tx.error || new Error('Falha no armazenamento local.'));
            tx.onabort = () => reject(tx.error || new Error('Operação local cancelada.'));
            try {
                result = callback(tx);
            } catch (error) {
                tx.abort();
                reject(error);
            }
        });
    }

    function requestValue(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error || new Error('Falha ao ler o armazenamento local.'));
        });
    }

    async function getAllOrders() {
        const db = await openDatabase();
        const tx = db.transaction(STORES.orders, 'readonly');
        return requestValue(tx.objectStore(STORES.orders).getAll());
    }

    async function getAllOperations() {
        const db = await openDatabase();
        const tx = db.transaction(STORES.outbox, 'readonly');
        return requestValue(tx.objectStore(STORES.outbox).getAll());
    }

    async function getMeta(key, fallback = null) {
        const db = await openDatabase();
        const tx = db.transaction(STORES.meta, 'readonly');
        const record = await requestValue(tx.objectStore(STORES.meta).get(key));
        return record ? record.value : fallback;
    }

    async function putMeta(key, value) {
        return transaction([STORES.meta], 'readwrite', tx => {
            tx.objectStore(STORES.meta).put({ key, value });
        });
    }

    async function putOrder(order) {
        return transaction([STORES.orders], 'readwrite', tx => {
            tx.objectStore(STORES.orders).put(order);
        });
    }

    async function putOrders(orders) {
        if (!orders.length) return;
        return transaction([STORES.orders], 'readwrite', tx => {
            const store = tx.objectStore(STORES.orders);
            orders.forEach(order => store.put(order));
        });
    }

    async function deleteOrders(orderIds) {
        if (!orderIds.length) return;
        return transaction([STORES.orders], 'readwrite', tx => {
            const store = tx.objectStore(STORES.orders);
            orderIds.map(String).forEach(id => store.delete(id));
        });
    }

    async function putOrderAndOperation(order, operation) {
        return transaction([STORES.orders, STORES.outbox], 'readwrite', tx => {
            tx.objectStore(STORES.orders).put(order);
            tx.objectStore(STORES.outbox).put(operation);
        });
    }

    async function replaceStatusOperation(order, operation) {
        return transaction([STORES.orders, STORES.outbox], 'readwrite', tx => {
            const orders = tx.objectStore(STORES.orders);
            const outbox = tx.objectStore(STORES.outbox);
            orders.put(order);
            const cursorRequest = outbox.index('orderId').openCursor(IDBKeyRange.only(operation.orderId));
            cursorRequest.onsuccess = () => {
                const cursor = cursorRequest.result;
                if (!cursor) {
                    outbox.put(operation);
                    return;
                }
                if (cursor.value.type === 'status') cursor.delete();
                cursor.continue();
            };
        });
    }

    async function deleteOrdersAndQueue(orderIds, operation, clearAll = false) {
        const ids = new Set((orderIds || []).map(String));
        return transaction([STORES.orders, STORES.outbox], 'readwrite', tx => {
            const orders = tx.objectStore(STORES.orders);
            const outbox = tx.objectStore(STORES.outbox);

            if (clearAll) {
                orders.clear();
                outbox.clear();
                outbox.put(operation);
            } else {
                ids.forEach(id => orders.delete(id));
                const cursorRequest = outbox.openCursor();
                cursorRequest.onsuccess = () => {
                    const cursor = cursorRequest.result;
                    if (!cursor) {
                        outbox.put(operation);
                        return;
                    }
                    if (ids.has(String(cursor.value.orderId))) cursor.delete();
                    cursor.continue();
                };
            }
        });
    }

    async function updateOperation(operation) {
        return transaction([STORES.outbox], 'readwrite', tx => {
            tx.objectStore(STORES.outbox).put(operation);
        });
    }

    async function removeOperations(operationIds) {
        if (!operationIds.length) return;
        return transaction([STORES.outbox], 'readwrite', tx => {
            const store = tx.objectStore(STORES.outbox);
            operationIds.forEach(id => store.delete(id));
        });
    }

    async function migrateLegacy() {
        if (await getMeta('legacyMigrationV1', false)) return;

        let legacyOrders = [];
        let legacyQueue = [];
        try { legacyOrders = JSON.parse(localStorage.getItem('kds_pedidos_local') || '[]'); } catch (error) {}
        try { legacyQueue = JSON.parse(localStorage.getItem('kds_fila_status') || '[]'); } catch (error) {}

        await transaction([STORES.orders, STORES.outbox, STORES.meta], 'readwrite', tx => {
            const orders = tx.objectStore(STORES.orders);
            const outbox = tx.objectStore(STORES.outbox);
            legacyOrders.forEach(order => {
                if (!order || !order.id) return;
                const migratedOrder = global.AloLogic.normalizeOrder({
                    ...order,
                    syncState: order.isTemp ? 'queued' : 'confirmed',
                    localOnly: Boolean(order.isTemp)
                });
                orders.put(migratedOrder);
                // Pedidos temporarios da versao anterior nunca receberam confirmacao.
                if (order.isTemp) {
                    const operationId = global.AloLogic.createId('legacy_create');
                    outbox.put({
                        operationId,
                        type: 'create',
                        orderId: String(migratedOrder.id),
                        payload: { action: 'novo_pedido', id: migratedOrder.id, produto: migratedOrder.produto, operationId },
                        createdAt: new Date(migratedOrder.timestamp).getTime() || Date.now(),
                        attempts: 0,
                        nextAttemptAt: 0,
                        lastError: ''
                    });
                }
            });
            legacyQueue.forEach(item => {
                const payload = item && item.payload;
                if (!payload || !payload.id) return;
                const operationId = global.AloLogic.createId('legacy_status');
                outbox.put({
                    operationId,
                    type: 'status',
                    orderId: String(payload.id),
                    payload: { ...payload, operationId },
                    createdAt: item.time || Date.now(),
                    attempts: 0,
                    nextAttemptAt: 0,
                    lastError: ''
                });
            });
            tx.objectStore(STORES.meta).put({ key: 'legacyMigrationV1', value: true });
        });
    }

    global.AloStorage = Object.freeze({
        openDatabase,
        getAllOrders,
        getAllOperations,
        getMeta,
        putMeta,
        putOrder,
        putOrders,
        deleteOrders,
        putOrderAndOperation,
        replaceStatusOperation,
        deleteOrdersAndQueue,
        updateOperation,
        removeOperations,
        migrateLegacy
    });
})(window);
