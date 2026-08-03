(function (global) {
    class SyncManager {
        constructor(options) {
            this.getUrl = options.getUrl;
            this.onOrders = options.onOrders || (() => {});
            this.onState = options.onState || (() => {});
            this.orders = [];
            this.revision = '';
            this.cycleRunning = false;
            this.timer = null;
            this.lastError = '';
            this.lastSyncAt = 0;
            this.boundOnline = () => this.syncNow(true);
            this.boundVisibility = () => {
                if (document.visibilityState === 'visible') this.syncNow(true);
                this.schedule();
            };
        }

        async start() {
            await global.AloStorage.openDatabase();
            await global.AloStorage.migrateLegacy();
            this.orders = (await global.AloStorage.getAllOrders()).map(global.AloLogic.normalizeOrder);
            this.revision = await global.AloStorage.getMeta('ordersRevision', '');
            global.addEventListener('online', this.boundOnline);
            global.addEventListener('offline', () => this.emit());
            document.addEventListener('visibilitychange', this.boundVisibility);
            this.emit();
            this.syncNow(true);
        }

        async enqueueNewOrder({ produto }) {
            const id = global.AloLogic.createId('pedido');
            const operationId = global.AloLogic.createId('novo');
            const now = new Date().toISOString();
            const order = global.AloLogic.normalizeOrder({
                id,
                produto,
                status: 'pendente',
                timestamp: now,
                atualizadoEm: now,
                operacaoId: operationId,
                syncState: navigator.onLine ? 'queued' : 'offline',
                localOnly: true
            });
            const operation = this.newOperation('create', id, {
                action: 'novo_pedido', id, produto, operationId
            }, operationId);
            await global.AloStorage.putOrderAndOperation(order, operation);
            this.upsertLocalOrder(order);
            this.emit();
            this.schedule(0);
            return order;
        }

        async enqueueStatus(id, novoStatus, motivo = '') {
            const current = this.orders.find(order => order.id === String(id));
            if (!current) return;
            const operationId = global.AloLogic.createId('status');
            const now = new Date().toISOString();
            const updated = global.AloLogic.normalizeOrder({
                ...current,
                status: novoStatus,
                motivo: novoStatus === 'cancelado' ? motivo : current.motivo,
                finalizadoEm: global.AloLogic.isStatusFinal(novoStatus) ? now : '',
                atualizadoEm: now,
                operacaoId,
                syncState: navigator.onLine ? 'queued' : 'offline'
            });
            const operation = this.newOperation('status', updated.id, {
                action: 'atualizar_status',
                id: updated.id,
                novoStatus,
                motivo,
                operationId
            }, operationId);
            await global.AloStorage.replaceStatusOperation(updated, operation);
            this.upsertLocalOrder(updated);
            this.emit();
            this.schedule(120);
        }

        async syncNow(flush = true) {
            if (this.cycleRunning || !this.getUrl()) {
                this.emit();
                return;
            }
            this.cycleRunning = true;
            this.emit();
            try {
                await this.pull();
                if (flush) {
                    const sent = await this.flushDueOperations();
                    if (sent) await this.pull();
                }
                this.lastError = '';
                this.lastSyncAt = Date.now();
            } catch (error) {
                this.lastError = error && error.message ? error.message : 'Sem conexão com o servidor.';
                await this.markPendingOffline();
            } finally {
                this.cycleRunning = false;
                this.emit();
                this.schedule();
            }
        }

        async pull() {
            const data = await global.AloApi.sync(this.getUrl(), this.revision);
            if (!data || data.status !== 'ok') throw new Error('Resposta inválida do servidor.');
            if (data.changed) {
                const remoteOrders = Array.isArray(data.pedidos) ? data.pedidos.map(global.AloLogic.normalizeOrder) : [];
                await this.reconcile(remoteOrders);
                await this.mergeRemoteOrders(remoteOrders);
            }
            if (data.revision !== undefined) {
                this.revision = String(data.revision);
                await global.AloStorage.putMeta('ordersRevision', this.revision);
            }
        }

        async flushDueOperations() {
            const all = await global.AloStorage.getAllOperations();
            const now = Date.now();
            const due = all.filter(operation => !operation.nextAttemptAt || operation.nextAttemptAt <= now)
                .sort((a, b) => a.createdAt - b.createdAt)
                .slice(0, 25);
            if (!due.length) return false;

            const creates = due.filter(operation => operation.type === 'create');
            const createOrderIds = new Set(creates.map(operation => operation.orderId));
            const statuses = due.filter(operation => operation.type === 'status' && !createOrderIds.has(operation.orderId));
            let sent = false;

            for (const operation of creates) {
                await this.dispatch([operation], operation.payload);
                sent = true;
            }

            if (statuses.length) {
                const updates = statuses.map(operation => ({
                    id: operation.payload.id,
                    novoStatus: operation.payload.novoStatus,
                    motivo: operation.payload.motivo || '',
                    operationId: operation.operationId
                }));
                await this.dispatch(statuses, { action: 'atualizar_status_lote', updates });
                sent = true;
            }
            return sent;
        }

        async dispatch(operations, payload) {
            const attemptedAt = Date.now();
            const retrying = operations.map(operation => ({
                ...operation,
                attempts: (operation.attempts || 0) + 1,
                lastAttemptAt: attemptedAt,
                nextAttemptAt: attemptedAt + this.backoffMs((operation.attempts || 0) + 1),
                lastError: ''
            }));
            await Promise.all(retrying.map(operation => global.AloStorage.updateOperation(operation)));
            try {
                await global.AloApi.post(this.getUrl(), payload);
            } catch (error) {
                const failed = retrying.map(operation => ({ ...operation, lastError: 'Aguardando internet.' }));
                await Promise.all(failed.map(operation => global.AloStorage.updateOperation(operation)));
                throw error;
            }
        }

        async reconcile(remoteOrders) {
            const remoteById = new Map(remoteOrders.map(order => [order.id, order]));
            const operations = await global.AloStorage.getAllOperations();
            const confirmed = [];
            operations.forEach(operation => {
                const remote = remoteById.get(String(operation.orderId));
                if (!remote) return;
                if (operation.type === 'create') {
                    confirmed.push(operation.operationId);
                    return;
                }
                if (operation.type === 'status' && remote.status === operation.payload.novoStatus && remote.operacaoId === operation.operationId) {
                    confirmed.push(operation.operationId);
                }
            });
            await global.AloStorage.removeOperations(confirmed);
        }

        async mergeRemoteOrders(remoteOrders) {
            const pending = await global.AloStorage.getAllOperations();
            const pendingByOrder = new Map();
            pending.forEach(operation => pendingByOrder.set(String(operation.orderId), operation));
            const localById = new Map(this.orders.map(order => [order.id, order]));
            const changes = [];

            remoteOrders.forEach(remote => {
                const local = localById.get(remote.id);
                const operation = pendingByOrder.get(remote.id);
                const merged = operation && local
                    ? global.AloLogic.normalizeOrder({ ...remote, ...local, syncState: navigator.onLine ? 'retrying' : 'offline' })
                    : global.AloLogic.normalizeOrder({ ...remote, syncState: 'confirmed', localOnly: false });
                localById.set(remote.id, merged);
                changes.push(merged);
            });

            const allOperations = await global.AloStorage.getAllOperations();
            const activeOperationIds = new Set(allOperations.map(operation => operation.orderId));
            localById.forEach((order, id) => {
                if (!activeOperationIds.has(id) && order.syncState !== 'confirmed') {
                    const confirmed = global.AloLogic.normalizeOrder({ ...order, syncState: 'confirmed', localOnly: false });
                    localById.set(id, confirmed);
                    changes.push(confirmed);
                }
            });

            this.orders = Array.from(localById.values()).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            await global.AloStorage.putOrders(changes);
        }

        async markPendingOffline() {
            const operations = await global.AloStorage.getAllOperations();
            const pendingIds = new Set(operations.map(operation => String(operation.orderId)));
            const changed = this.orders.map(order => pendingIds.has(order.id)
                ? global.AloLogic.normalizeOrder({ ...order, syncState: 'offline' })
                : order);
            this.orders = changed;
            await global.AloStorage.putOrders(changed.filter(order => pendingIds.has(order.id)));
        }

        async retryNow() {
            const operations = await global.AloStorage.getAllOperations();
            await Promise.all(operations.map(operation => global.AloStorage.updateOperation({ ...operation, nextAttemptAt: 0 })));
            this.syncNow(true);
        }

        newOperation(type, orderId, payload, operationId) {
            return {
                operationId,
                type,
                orderId: String(orderId),
                payload,
                createdAt: Date.now(),
                attempts: 0,
                nextAttemptAt: 0,
                lastError: ''
            };
        }

        backoffMs(attempts) {
            const base = Math.min(60000, 1000 * (2 ** Math.min(attempts, 6)));
            return base + Math.floor(Math.random() * 500);
        }

        upsertLocalOrder(order) {
            const index = this.orders.findIndex(item => item.id === order.id);
            if (index === -1) this.orders.push(order);
            else this.orders[index] = order;
            this.orders.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        }

        async getPendingCount() {
            return (await global.AloStorage.getAllOperations()).length;
        }

        async emit() {
            const pendingCount = await this.getPendingCount();
            this.onOrders([...this.orders]);
            this.onState({
                online: navigator.onLine && !this.lastError,
                syncing: this.cycleRunning,
                pendingCount,
                lastError: this.lastError,
                lastSyncAt: this.lastSyncAt
            });
        }

        schedule(delay) {
            if (this.timer) clearTimeout(this.timer);
            const wait = delay !== undefined
                ? delay
                : (document.visibilityState === 'visible' ? 3000 : 15000);
            this.timer = setTimeout(() => this.syncNow(true), wait);
        }
    }

    global.AloSync = SyncManager;
})(window);
