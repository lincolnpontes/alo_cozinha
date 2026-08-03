const SHEET_PEDIDOS = 'Pedidos';
const PROP_BANCO = 'kds_banco';
const PROP_BANCO_REVISION = 'kds_banco_revision';
const PROP_PEDIDOS_REVISION = 'kds_pedidos_revision';
const BASE_HEADERS = ['ID', 'Produto', 'Status', 'Timestamp', 'FinalizadoEm', 'Motivo'];
const EXTRA_HEADERS = ['AtualizadoEm', 'Revisao', 'OperacaoId', 'AreaOrigem', 'AreaDestino'];
const HEADERS_PEDIDOS = BASE_HEADERS.concat(EXTRA_HEADERS);
const FINAL_STATUSES = new Set(['enviado', 'buscar', 'cancelado', 'concluido']);
const VALID_STATUSES = new Set(['pendente', 'fazendo', 'enviado', 'buscar', 'cancelado', 'concluido']);

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getPedidosSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_PEDIDOS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_PEDIDOS);
    sheet.getRange(1, 1, 1, HEADERS_PEDIDOS.length).setValues([HEADERS_PEDIDOS]);
    return sheet;
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS_PEDIDOS.length).setValues([HEADERS_PEDIDOS]);
    return sheet;
  }

  const headerValues = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), HEADERS_PEDIDOS.length)).getValues()[0];
  const missingExtraHeaders = EXTRA_HEADERS.some((header, index) => !headerValues[BASE_HEADERS.length + index]);
  if (missingExtraHeaders) {
    sheet.getRange(1, BASE_HEADERS.length + 1, 1, EXTRA_HEADERS.length).setValues([EXTRA_HEADERS]);
  }
  return sheet;
}

function getPedidosData_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, HEADERS_PEDIDOS.length).getValues();
}

function asIso_(value) {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(value);
  return isNaN(date.getTime()) ? '' : date.toISOString();
}

function orderFromRow_(row) {
  return {
    id: row[0].toString(),
    produto: row[1] || '',
    status: row[2] || 'pendente',
    timestamp: asIso_(row[3]),
    finalizadoEm: asIso_(row[4]),
    motivo: row[5] || '',
    atualizadoEm: asIso_(row[6]) || asIso_(row[3]),
    revisao: Number(row[7] || 0),
    operacaoId: row[8] || '',
    areaOrigem: row[9] || 'panelas',
    areaDestino: row[10] || 'cozinha'
  };
}

function getPedidosRevision_() {
  return Number(PropertiesService.getDocumentProperties().getProperty(PROP_PEDIDOS_REVISION) || '0');
}

function nextPedidosRevision_() {
  const revision = getPedidosRevision_() + 1;
  PropertiesService.getDocumentProperties().setProperty(PROP_PEDIDOS_REVISION, String(revision));
  return revision;
}

function findRecordsById_(sheet) {
  const rows = getPedidosData_(sheet);
  const records = {};
  rows.forEach((values, index) => {
    records[values[0].toString()] = { row: index + 2, values: values };
  });
  return records;
}

function applyStatus_(values, novoStatus, motivo, operationId, expectedStatus, expectedOrderRevision, revision) {
  if (!VALID_STATUSES.has(novoStatus)) throw new Error('Status inválido.');
  const currentStatus = values[2] || 'pendente';
  const currentRevision = Number(values[7] || 0);
  if (currentStatus === novoStatus) return false;
  if (expectedStatus && currentStatus !== expectedStatus) return false;
  if (expectedOrderRevision !== undefined && expectedOrderRevision !== null && currentRevision > Number(expectedOrderRevision)) return false;

  const now = new Date().toISOString();
  values[2] = novoStatus;
  values[4] = FINAL_STATUSES.has(novoStatus) ? now : '';
  values[5] = novoStatus === 'cancelado' ? (motivo || '') : values[5] || '';
  values[6] = now;
  values[7] = revision;
  values[8] = operationId || '';
  return true;
}

function updateStatuses_(sheet, updates) {
  if (!updates || !updates.length) return 0;
  const records = findRecordsById_(sheet);
  let revision = getPedidosRevision_();
  const changedRecords = [];
  updates.forEach(update => {
    if (!update || !update.id) return;
    const record = records[update.id.toString()];
    if (!record) return;
    const nextRevision = revision + 1;
    if (applyStatus_(
      record.values,
      update.novoStatus,
      update.motivo || '',
      update.operationId || '',
      update.expectedStatus,
      update.expectedOrderRevision,
      nextRevision
    )) {
      revision = nextRevision;
      changedRecords.push(record);
    }
  });
  if (!changedRecords.length) return 0;

  changedRecords.sort((a, b) => a.row - b.row);
  let group = [];
  const writeGroup = () => {
    if (!group.length) return;
    sheet.getRange(group[0].row, 1, group.length, HEADERS_PEDIDOS.length).setValues(group.map(record => record.values));
    group = [];
  };
  changedRecords.forEach(record => {
    if (group.length && record.row !== group[group.length - 1].row + 1) writeGroup();
    group.push(record);
  });
  writeGroup();
  PropertiesService.getDocumentProperties().setProperty(PROP_PEDIDOS_REVISION, String(revision));
  return changedRecords.length;
}

function bancosComRevisao_() {
  const bancoStr = PropertiesService.getDocumentProperties().getProperty(PROP_BANCO);
  const banco = bancoStr ? JSON.parse(bancoStr) : {};
  banco._revision = Number(PropertiesService.getDocumentProperties().getProperty(PROP_BANCO_REVISION) || '0');
  return banco;
}

function salvarBanco_(dados, expectedRevision) {
  const properties = PropertiesService.getDocumentProperties();
  const currentRevision = Number(properties.getProperty(PROP_BANCO_REVISION) || '0');
  if (expectedRevision !== undefined && expectedRevision !== null && Number(expectedRevision) !== currentRevision) {
    return { status: 'conflict', revision: currentRevision };
  }
  const bancoLimpo = {
    produtos: dados.produtos || [],
    categorias: dados.categorias || [],
    obsPedidos: dados.obsPedidos || [],
    obsCancelamentos: dados.obsCancelamentos || [],
    areas: dados.areas || [],
    configs: dados.configs || {}
  };
  const revision = currentRevision + 1;
  properties.setProperty(PROP_BANCO, JSON.stringify(bancoLimpo));
  properties.setProperty(PROP_BANCO_REVISION, String(revision));
  return { status: 'ok', revision: revision };
}

function pedidosVisiveis_(sheet) {
  const now = new Date();
  const today = now.toDateString();
  const recentLimit = now.getTime() - (5 * 60 * 1000);
  return getPedidosData_(sheet)
    .map(orderFromRow_)
    .filter(order => {
      if (order.status === 'pendente' || order.status === 'fazendo') return true;
      if (new Date(order.timestamp).toDateString() === today) return true;
      return order.finalizadoEm && new Date(order.finalizadoEm).getTime() >= recentLimit;
    });
}

function filtrarHistorico_(sheet, start, end) {
  const startTime = start ? new Date(start).getTime() : 0;
  const endTime = end ? new Date(end).getTime() : Number.MAX_SAFE_INTEGER;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const timestamps = sheet.getRange(2, 4, lastRow - 1, 1).getValues();
  let firstMatch = -1;
  let lastMatch = -1;
  timestamps.forEach((row, index) => {
    const timestamp = new Date(row[0]).getTime();
    if (timestamp >= startTime && timestamp <= endTime) {
      if (firstMatch === -1) firstMatch = index + 2;
      lastMatch = index + 2;
    }
  });
  if (firstMatch === -1) return [];

  return sheet.getRange(firstMatch, 1, lastMatch - firstMatch + 1, HEADERS_PEDIDOS.length).getValues()
    .map(orderFromRow_)
    .filter(order => {
      const timestamp = new Date(order.timestamp).getTime();
      return timestamp >= startTime && timestamp <= endTime;
    });
}

function doPost(e) {
  const lock = LockService.getDocumentLock();
  let locked = false;
  try {
    lock.waitLock(10000);
    locked = true;
    const params = JSON.parse((e.postData && e.postData.contents) || '{}');
    const action = params.action;
    const sheetPedidos = getPedidosSheet_();

    if (action === 'novo_pedido') {
      if (!params.id || !params.produto) return json_({ status: 'error', message: 'ID e produto são obrigatórios.' });
      const records = findRecordsById_(sheetPedidos);
      const id = params.id.toString();
      if (!records[id]) {
        const now = new Date().toISOString();
        const revision = nextPedidosRevision_();
        sheetPedidos.appendRow([
          id, params.produto, 'pendente', now, '', '', now, revision, params.operationId || '',
          params.areaOrigem || 'panelas', params.areaDestino || 'cozinha'
        ]);
      }
      return json_({ status: 'ok', id: id, revision: getPedidosRevision_() });
    }

    if (action === 'atualizar_status') {
      updateStatuses_(sheetPedidos, [{
        id: params.id,
        novoStatus: params.novoStatus,
        motivo: params.motivo || '',
        expectedStatus: params.expectedStatus,
        expectedOrderRevision: params.expectedOrderRevision,
        operationId: params.operationId || ''
      }]);
      return json_({ status: 'ok', revision: getPedidosRevision_() });
    }

    if (action === 'cancelar_pedido') {
      updateStatuses_(sheetPedidos, [{
        id: params.id,
        novoStatus: 'cancelado',
        motivo: params.motivo || '',
        expectedStatus: params.expectedStatus,
        expectedOrderRevision: params.expectedOrderRevision,
        operationId: params.operationId || ''
      }]);
      return json_({ status: 'ok', revision: getPedidosRevision_() });
    }

    if (action === 'atualizar_status_lote') {
      updateStatuses_(sheetPedidos, params.updates || []);
      return json_({ status: 'ok', revision: getPedidosRevision_() });
    }

    if (action === 'excluir_pedido') {
      const records = findRecordsById_(sheetPedidos);
      const record = records[(params.id || '').toString()];
      if (record) {
        sheetPedidos.deleteRow(record.row);
        nextPedidosRevision_();
      }
      return json_({ status: 'ok', revision: getPedidosRevision_() });
    }

    if (action === 'excluir_hoje') {
      const data = sheetPedidos.getDataRange().getValues();
      const today = new Date().toDateString();
      let changed = false;
      for (let index = data.length - 1; index >= 1; index--) {
        if (new Date(data[index][3]).toDateString() === today) {
          sheetPedidos.deleteRow(index + 1);
          changed = true;
        }
      }
      if (changed) nextPedidosRevision_();
      return json_({ status: 'ok', revision: getPedidosRevision_() });
    }

    if (action === 'excluir_tudo') {
      const lastRow = sheetPedidos.getLastRow();
      if (lastRow > 1) {
        sheetPedidos.deleteRows(2, lastRow - 1);
        nextPedidosRevision_();
      }
      return json_({ status: 'ok', revision: getPedidosRevision_() });
    }

    if (action === 'salvar_banco') {
      return json_(salvarBanco_(params.dados || {}, params.expectedRevision));
    }

    return json_({ status: 'error', message: 'Ação não encontrada.' });
  } catch (error) {
    return json_({ status: 'error', message: error.message });
  } finally {
    if (locked) lock.releaseLock();
  }
}

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : '';
  if (action === 'carregar_banco') return json_(bancosComRevisao_());

  const sheetPedidos = getPedidosSheet_();
  if (action === 'sincronizar') {
    const revision = getPedidosRevision_();
    if (String(e.parameter.revision || '') === String(revision)) {
      return json_({ status: 'ok', changed: false, revision: revision, serverTime: new Date().toISOString() });
    }
    return json_({
      status: 'ok',
      changed: true,
      revision: revision,
      serverTime: new Date().toISOString(),
      pedidos: pedidosVisiveis_(sheetPedidos)
    });
  }

  if (action === 'historico') {
    return json_({ status: 'ok', pedidos: filtrarHistorico_(sheetPedidos, e.parameter.start, e.parameter.end) });
  }

  return json_(getPedidosData_(sheetPedidos).map(orderFromRow_));
}

function resgatarMeusDados() {
  const dados = PropertiesService.getDocumentProperties().getProperty(PROP_BANCO);
  const aba = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  aba.getRange('H1').setValue(dados || 'NENHUM DADO ENCONTRADO');
}
