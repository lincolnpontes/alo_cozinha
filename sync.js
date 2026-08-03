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
            this.lastFullPullAt = 0;
            this.serverProtocol = 'unknown';
            this.supportsCreateBatch = false;
            this.rerunRequested = false;
            this.forceNextPull = false;
            this.boundOnline = () => this.syncNow(true, true);
            this.boundVisibility = () => {
                if (document.visibilityState === 'visible') this.syncNow(true, true);
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
            await this.syncNow(true, true);
        }

        async enqueueNewOrder({ produto, areaOrigem = 'panelas', areaDestino = 'cozinha' }) {
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
                areaOrigem,
                areaDestino,
                syncState: navigator.onLine ? 'queued' : 'offline',
                localOnly: true
            });
            const operation = this.newOperation('create', id, {
                action: 'novo_pedido', id, produto, areaOrigem, areaDestino, operationId
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
            const operations = await global.AloStorage.getAllOperations();
            const previousStatus = operations.find(operation => operation.type === 'status' && operation.orderId === String(id));
            const operationId = global.AloLogic.createId('status');
            const now = new Date().toISOString();
            const updated = global.AloLogic.normalizeOrder({
                ...current,
                status: novoStatus,
                motivo: novoStatus === 'cancelado' ? motivo : current.motivo,
                finalizadoEm: global.AloLogic.isStatusFinal(novoStatus) ? now : '',
                atualizadoEm: now,
                operacaoId: operationId,
                syncState: navigator.onLine ? 'queued' : 'offline'
            });
            const operation = this.newOperation('status', updated.id, {
                action: 'atualizar_status',
                id: updated.id,
                novoStatus,
                motivo,
                expectedStatus: previousStatus ? previousStatus.payload.expectedStatus : current.status,
                expectedOrderRevision: previousStatus ? previousStatus.payload.expectedOrderRevision : current.revisao,
                operationId
            }, operationId);
            await global.AloStorage.replaceStatusOperation(updated, operation);
            this.upsertLocalOrder(updated);
            this.emit();
            this.schedule(0);
        }

        async enqueueDelete(id) {
            const orderId = String(id);
            const current = this.orders.find(order => order.id === orderId);
            if (!current) return;
            const operationId = global.AloLogic.createId('excluir');
            const operation = this.newOperation('delete', orderId, {
                action: 'excluir_pedido', id: orderId, operationId, ids: [orderId]
            }, operationId);
            await global.AloStorage.deleteOrdersAndQueue([orderId], operation);
            this.orders = this.orders.filter(order => order.id !== orderId);
            this.emit();
            this.schedule(0);
        }

        async enqueueDeleteToday() {
            const ids = this.orders.filter(order => global.AloLogic.isToday(order.timestamp)).map(order => order.id);
            const operationId = global.AloLogic.createId('excluir_hoje');
            const operation = this.newOperation('delete_today', operationId, {
                action: 'excluir_hoje', operationId, ids
            }, operationId);
            await global.AloStorage.deleteOrdersAndQueue(ids, operation);
            const deleted = new Set(ids);
            this.orders = this.orders.filter(order => !deleted.has(order.id));
            this.emit();
            this.schedule(0);
        }

        async enqueueDeleteAll() {
            const ids = this.orders.map(order => order.id);
            const operationId = global.AloLogic.createId('excluir_tudo');
            const operation = this.newOperation('delete_all', operationId, {
                action: 'excluir_tudo', operationId, ids
            }, operationId);
            await global.AloStorage.deleteOrdersAndQueue(ids, operation, true);
            this.orders = [];
            this.revision = '';
            await global.AloStorage.putMeta('ordersRevision', '');
            this.emit();
            this.schedule(0);
        }

        async syncNow(flush = true, force = false) {
            if (!this.getUrl()) {
                this.emit();
                return;
            }
            if (this.cycleRunning) {
                this.rerunRequested = true;
                if (force) this.forceNextPull = true;
                return;
            }
            this.cycleRunning = true;
            const forcePull = force || this.forceNextPull || !this.lastFullPullAt || (Date.now() - this.lastFullPullAt) >= 12000;
            this.forceNextPull = false;
            this.emit();
            try {
                let sent = false;
                if (flush) {
                    sent = await this.flushDueOperations();
                }
                await this.pull(sent ? true : forcePull);
                if (flush) {
                    const sentAfterPull = await this.flushDueOperations();
                    if (sentAfterPull) await this.pull(true);
                }
                this.lastError = '';
                this.lastSyncAt = Date.now();
            } catch (error) {
                this.lastError = error && error.message ? error.message : 'Sem conexão com o servidor.';
                await this.markPendingOffline();
            } finally {
                this.cycleRunning = false;
                this.emit();
                if (this.rerunRequested) {
                    this.rerunRequested = false;
                    this.schedule(0);
                } else {
                    this.schedule();
                }
            }
        }

        async pull(force = false) {
            let data = await global.AloApi.sync(this.getUrl(), force ? '' : this.revision);
            if (Array.isArray(data)) {
                this.serverProtocol = 'legacy';
                data = { status: 'ok', changed: true, pedidos: data };
            } else if (data && data.status === 'ok') {
                this.serverProtocol = 'modern';
            }
            if (!data || data.status !== 'ok') throw new Error('Resposta inválida do servidor.');
            this.supportsCreateBatch = Boolean(data.capabilities && data.capabilities.novoPedidoLote);
            if (data.changed) {
                const remoteOrders = Array.isArray(data.pedidos) ? data.pedidos.map(global.AloLogic.normalizeOrder) : [];
                await this.reconcile(remoteOrders, force);
                await this.mergeRemoteOrders(remoteOrders, force);
            }
            if (force) this.lastFullPullAt = Date.now();
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
            const deletions = due.filter(operation => operation.type === 'delete' || operation.type === 'delete_today' || operation.type === 'delete_all');
            let sent = false;

            if (creates.length > 1 && this.supportsCreateBatch) {
                await this.dispatch(creates, {
                    action: 'novo_pedido_lote',
                    pedidos: creates.map(operation => operation.payload)
                });
                sent = true;
            } else {
                for (const operation of creates) {
                    await this.dispatch([operation], operation.payload);
                    sent = true;
                }
            }

            for (const operation of deletions) {
                await this.dispatch([operation], operation.payload);
                sent = true;
            }

            if (statuses.length && this.serverProtocol !== 'legacy') {
                const updates = statuses.map(operation => ({
                    id: operation.payload.id,
                    novoStatus: operation.payload.novoStatus,
                    motivo: operation.payload.motivo || '',
                    expectedStatus: operation.payload.expectedStatus,
                    expectedOrderRevision: operation.payload.expectedOrderRevision,
                    operationId: operation.operationId
                }));
                await this.dispatch(statuses, { action: 'atualizar_status_lote', updates });
                sent = true;
            } else if (statuses.length) {
                for (const operation of statuses) {
                    await this.dispatch([operation], {
                        action: operation.payload.novoStatus === 'cancelado' ? 'cancelar_pedido' : 'atualizar_status',
                        id: operation.payload.id,
                        novoStatus: operation.payload.novoStatus,
                        motivo: operation.payload.motivo || '',
                        expectedStatus: operation.payload.expectedStatus,
                        expectedOrderRevision: operation.payload.expectedOrderRevision,
                        operationId: operation.operationId
                    });
                    sent = true;
                }
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

        async reconcile(remoteOrders, fullPull = false) {
            const remoteById = new Map(remoteOrders.map(order => [order.id, order]));
            const operations = await global.AloStorage.getAllOperations();
            const createOrderIds = new Set(operations.filter(operation => operation.type === 'create').map(operation => String(operation.orderId)));
            const confirmed = [];
            operations.forEach(operation => {
                if ((operation.type === 'delete' || operation.type === 'delete_today' || operation.type === 'delete_all') && operation.attempts > 0) {
                    const ids = Array.isArray(operation.payload.ids) ? operation.payload.ids.map(String) : [];
                    if (ids.every(id => !remoteById.has(id))) confirmed.push(operation.operationId);
                    return;
                }
                const remote = remoteById.get(String(operation.orderId));
                if (!remote) {
                    const staleMissingStatus = fullPull && operation.type === 'status' && operation.attempts > 0
                        && !createOrderIds.has(String(operation.orderId))
                        && (Date.now() - Number(operation.createdAt || 0)) >= 60000;
                    if (staleMissingStatus) confirmed.push(operation.operationId);
                    return;
                }
                if (operation.type === 'create') {
                    confirmed.push(operation.operationId);
                    return;
                }
                if (operation.type === 'status') {
                    const expectedRevision = Number(operation.payload.expectedOrderRevision);
                    const remoteRevision = Number(remote.revisao || 0);
                    const desiredStateReached = remote.status === operation.payload.novoStatus;
                    const changedByAnotherAction = Number.isFinite(expectedRevision) && remoteRevision > expectedRevision;
                    const activeActionAlreadyFinished = operation.payload.novoStatus === 'fazendo' && global.AloLogic.isStatusFinal(remote.status);
                    if (desiredStateReached || changedByAnotherAction || activeActionAlreadyFinished) {
                        confirmed.push(operation.operationId);
                    }
                }
            });
            await global.AloStorage.removeOperations(confirmed);
        }

        async mergeRemoteOrders(remoteOrders, fullPull = false) {
            const pending = await global.AloStorage.getAllOperations();
            const pendingByOrder = new Map();
            const pendingDeletedIds = new Set();
            pending.forEach(operation => {
                pendingByOrder.set(String(operation.orderId), operation);
                if (operation.type === 'delete' || operation.type === 'delete_today' || operation.type === 'delete_all') {
                    (operation.payload.ids || []).forEach(id => pendingDeletedIds.add(String(id)));
                }
            });
            const localById = new Map(this.orders.map(order => [order.id, order]));
            const changes = [];

            remoteOrders.forEach(remote => {
                if (pendingDeletedIds.has(remote.id)) return;
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

            const staleLocalIds = [];
            if (fullPull) {
                const remoteIds = new Set(remoteOrders.map(order => order.id));
                localById.forEach((order, id) => {
                    const shouldRemove = !remoteIds.has(id) && !activeOperationIds.has(id)
                        && (global.AloLogic.isToday(order.timestamp) || global.AloLogic.ACTIVE_STATUSES.has(order.status));
                    if (shouldRemove) {
                        localById.delete(id);
                        staleLocalIds.push(id);
                    }
                });
            }

            this.orders = Array.from(localById.values()).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            await global.AloStorage.putOrders(changes);
            await global.AloStorage.deleteOrders(staleLocalIds);
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
            return this.syncNow(true, true);
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
                : (document.visibilityState === 'visible' ? 1200 : 6000);
            this.timer = setTimeout(() => this.syncNow(true), wait);
        }
    }

    global.AloSync = SyncManager;
})(window);
