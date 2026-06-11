const $ = (id) => document.getElementById(id);

const els = {
  appIdInput: $('appIdInput'),
  accountModeSelect: $('accountModeSelect'),
  accountWarning: $('accountWarning'),
  demoTokenInput: $('demoTokenInput'),
  realTokenInput: $('realTokenInput'),
  connectBtn: $('connectBtn'),
  connectionStatus: $('connectionStatus'),
  accountText: $('accountText'),
  balanceText: $('balanceText'),
  levelText: $('levelText'),
  stakeText: $('stakeText'),
  lastResultText: $('lastResultText'),
  symbolSelect: $('symbolSelect'),
  modeSelect: $('modeSelect'),
  barrierWrap: $('barrierWrap'),
  barrierInput: $('barrierInput'),
  durationInput: $('durationInput'),
  durationUnitSelect: $('durationUnitSelect'),
  buyBtn: $('buyBtn'),
  sellBtn: $('sellBtn'),
  stepInput: $('stepInput'),
  maxInput: $('maxInput'),
  pctInput: $('pctInput'),
  pinBtn: $('pinBtn'),
  clearLogBtn: $('clearLogBtn'),
  log: $('log')
};

let ws = null;
let reqId = 1;
let pending = new Map();
let isAuthorized = false;
let isSendingOrder = false;
let balance = null;
let currency = 'USD';
let activeLoginId = null;
let activeAccountMode = 'demo';
let balanceSubscriptionId = null;
let contractSubscriptionId = null;
let tradeLog = JSON.parse(localStorage.getItem('tradeLog') || '[]');

function getSelectedAccountMode() {
  return els.accountModeSelect.value === 'real' ? 'real' : 'demo';
}

function getSelectedToken() {
  return getSelectedAccountMode() === 'real'
    ? String(els.realTokenInput.value || '').trim()
    : String(els.demoTokenInput.value || '').trim();
}

function getAccountLabel(mode = getSelectedAccountMode()) {
  return mode === 'real' ? 'REAL' : 'DEMO';
}

function saveSettings() {
  localStorage.setItem('derivIcSettings', JSON.stringify({
    appId: els.appIdInput.value,
    accountMode: els.accountModeSelect.value,
    demoToken: els.demoTokenInput.value,
    realToken: els.realTokenInput.value,
    symbol: els.symbolSelect.value,
    mode: els.modeSelect.value,
    barrier: els.barrierInput.value,
    duration: els.durationInput.value,
    unit: els.durationUnitSelect.value,
    step: els.stepInput.value,
    max: els.maxInput.value,
    pct: els.pctInput.value
  }));
}

function loadSettings() {
  const raw = localStorage.getItem('derivIcSettings');
  if (!raw) return;
  try {
    const s = JSON.parse(raw);
    if (s.appId) els.appIdInput.value = s.appId;
    if (s.accountMode) els.accountModeSelect.value = s.accountMode;

    // Compatibilidad con la primera versión: si existía un token único, lo carga como demo.
    if (s.demoToken) els.demoTokenInput.value = s.demoToken;
    else if (s.token) els.demoTokenInput.value = s.token;

    if (s.realToken) els.realTokenInput.value = s.realToken;
    if (s.symbol) els.symbolSelect.value = s.symbol;
    if (s.mode) els.modeSelect.value = s.mode;
    if (s.barrier) els.barrierInput.value = s.barrier;
    if (s.duration) els.durationInput.value = s.duration;
    if (s.unit) els.durationUnitSelect.value = s.unit;
    if (s.step) els.stepInput.value = s.step;
    if (s.max) els.maxInput.value = s.max;
    if (s.pct) els.pctInput.value = s.pct;
  } catch (_) {}
}

function setStatus(text, cls = '') {
  els.connectionStatus.textContent = text;
  els.connectionStatus.className = cls;
}

function addLog(message, cls = '') {
  const item = {
    at: new Date().toLocaleTimeString(),
    message,
    cls
  };
  tradeLog.unshift(item);
  tradeLog = tradeLog.slice(0, 80);
  localStorage.setItem('tradeLog', JSON.stringify(tradeLog));
  renderLog();
}

function renderLog() {
  els.log.innerHTML = tradeLog.map(item => (
    `<div class="logItem ${item.cls}"><b>${item.at}</b> · ${escapeHtml(item.message)}</div>`
  )).join('');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
}

function send(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('WebSocket no conectado'));
  }
  const id = reqId++;
  const request = { ...payload, req_id: id };
  ws.send(JSON.stringify(request));
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Timeout de respuesta Deriv'));
    }, 15000);
    pending.set(id, { resolve, reject, timeout });
  });
}

async function connect() {
  saveSettings();
  const appId = String(els.appIdInput.value || '').trim();
  const token = getSelectedToken();
  const requestedMode = getSelectedAccountMode();
  const requestedLabel = getAccountLabel(requestedMode);

  if (!appId || !token) {
    addLog(`Falta App ID o token ${requestedLabel}.`, 'err');
    return;
  }

  disconnect();
  activeAccountMode = requestedMode;
  setStatus(`Conectando ${requestedLabel}...`, 'warn');
  els.connectBtn.disabled = true;

  ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`);

  ws.onopen = async () => {
    try {
      const auth = await send({ authorize: token });
      if (auth.error) throw new Error(auth.error.message);

      isAuthorized = true;
      currency = auth.authorize.currency || 'USD';
      activeLoginId = auth.authorize.loginid || null;

      const actualMode = isDemoLogin(activeLoginId) ? 'demo' : 'real';
      if (actualMode !== requestedMode) {
        addLog(`Aviso: seleccionaste ${requestedLabel}, pero el token parece de cuenta ${getAccountLabel(actualMode)} (${activeLoginId}).`, 'warn');
        activeAccountMode = actualMode;
      }

      setStatus(`Conectado ${getAccountLabel(activeAccountMode)}: ${activeLoginId}`, activeAccountMode === 'real' ? 'realStatus' : 'ok');
      addLog(`Conectado en modo ${getAccountLabel(activeAccountMode)} a ${activeLoginId}.`, activeAccountMode === 'real' ? 'warn' : 'ok');
      await subscribeBalance();
    } catch (err) {
      addLog(`Error al autorizar ${requestedLabel}: ${err.message}`, 'err');
      setStatus('Error de autorización', 'err');
      disconnect();
    } finally {
      els.connectBtn.disabled = false;
      updateUi();
    }
  };

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);

    if (msg.req_id && pending.has(msg.req_id)) {
      const { resolve, reject, timeout } = pending.get(msg.req_id);
      clearTimeout(timeout);
      pending.delete(msg.req_id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg);
      return;
    }

    if (msg.msg_type === 'balance' && msg.balance) {
      balance = Number(msg.balance.balance);
      currency = msg.balance.currency || currency;
      if (msg.subscription?.id) balanceSubscriptionId = msg.subscription.id;
      updateUi();
      return;
    }

    if (msg.msg_type === 'proposal_open_contract' && msg.proposal_open_contract) {
      handleContractUpdate(msg.proposal_open_contract, msg.subscription?.id);
    }
  };

  ws.onerror = () => {
    addLog('Error de conexión WebSocket.', 'err');
    setStatus('Error de conexión', 'err');
  };

  ws.onclose = () => {
    isAuthorized = false;
    isSendingOrder = false;
    activeLoginId = null;
    setStatus('Desconectado');
    els.connectBtn.disabled = false;
    updateUi();
  };
}

function isDemoLogin(loginid) {
  return String(loginid || '').toUpperCase().startsWith('VRTC');
}

function disconnect() {
  if (ws) {
    try { ws.close(); } catch (_) {}
  }
  ws = null;
  isAuthorized = false;
  isSendingOrder = false;
  activeLoginId = null;
  balance = null;
  balanceSubscriptionId = null;
  contractSubscriptionId = null;
  pending.forEach(({ timeout, reject }) => {
    clearTimeout(timeout);
    reject(new Error('Conexión cerrada'));
  });
  pending.clear();
}

async function subscribeBalance() {
  const res = await send({ balance: 1, subscribe: 1 });
  if (res.balance) {
    balance = Number(res.balance.balance);
    currency = res.balance.currency || currency;
  }
  if (res.subscription?.id) balanceSubscriptionId = res.subscription.id;
  updateUi();
}

function getIcConfig() {
  return {
    step: Number(els.stepInput.value || 105),
    max: Number(els.maxInput.value || 2000),
    pct: Number(els.pctInput.value || 5) / 100
  };
}

function getLevelForBalance(value) {
  const { step, max } = getIcConfig();
  if (!Number.isFinite(value) || value <= 0) return step;

  if (value >= max) return max;

  const level = Math.floor(value / step) * step;
  return Math.max(step, level || step);
}

function getStake() {
  const { pct } = getIcConfig();
  const level = getLevelForBalance(balance ?? 0);
  return Number((level * pct).toFixed(2));
}

function updateAccountModeUi() {
  const selectedMode = getSelectedAccountMode();
  const selectedLabel = getAccountLabel(selectedMode);
  els.connectBtn.textContent = `Conectar ${selectedLabel}`;

  els.accountWarning.classList.toggle('realHint', selectedMode === 'real');
  els.accountWarning.classList.toggle('demoHint', selectedMode !== 'real');
  els.accountWarning.textContent = selectedMode === 'real'
    ? 'ATENCIÓN: modo REAL seleccionado. Las operaciones usan saldo real.'
    : 'Modo demo activo. Ideal para testear sin tocar saldo real.';
}

function updateUi() {
  updateAccountModeUi();
  const level = getLevelForBalance(balance ?? 0);
  const stake = getStake();

  els.accountText.textContent = isAuthorized
    ? `${getAccountLabel(activeAccountMode)} ${activeLoginId || ''}`.trim()
    : getAccountLabel(getSelectedAccountMode());
  els.accountText.className = isAuthorized && activeAccountMode === 'real' ? 'realAccount' : '';

  els.balanceText.textContent = balance === null ? '—' : `${balance.toFixed(2)} ${currency}`;
  els.levelText.textContent = balance === null ? '—' : `${level}`;
  els.stakeText.textContent = balance === null ? '—' : `${stake.toFixed(2)} ${currency}`;

  const canTrade = isAuthorized && !isSendingOrder && balance !== null;
  els.buyBtn.disabled = !canTrade;
  els.sellBtn.disabled = !canTrade;

  const mode = els.modeSelect.value;
  els.barrierWrap.classList.toggle('hidden', mode !== 'higher_lower');
  if (mode === 'higher_lower') {
    els.buyBtn.innerHTML = 'HIGHER<br><span>CALL con barrera</span>';
    els.sellBtn.innerHTML = 'LOWER<br><span>PUT con barrera</span>';
  } else {
    els.buyBtn.innerHTML = 'COMPRA<br><span>CALL / RISE</span>';
    els.sellBtn.innerHTML = 'VENTA<br><span>PUT / FALL</span>';
  }
}

async function executeTrade(side) {
  if (!isAuthorized || isSendingOrder) return;
  saveSettings();

  const mode = els.modeSelect.value;
  const symbol = els.symbolSelect.value;
  const stake = getStake();
  const contractType = side === 'buy' ? 'CALL' : 'PUT';
  const duration = Number(els.durationInput.value || 1);
  const durationUnit = els.durationUnitSelect.value;
  const barrier = String(els.barrierInput.value || '').trim();
  const accountLabel = getAccountLabel(activeAccountMode);

  if (mode === 'higher_lower' && !barrier) {
    addLog('En Higher/Lower falta cargar la barrera.', 'err');
    return;
  }

  if (activeAccountMode === 'real') {
    const confirmed = window.confirm(`Vas a operar en cuenta REAL.\n\n${contractType} ${symbol}\nStake: ${stake.toFixed(2)} ${currency}\n\n¿Confirmás la orden?`);
    if (!confirmed) {
      addLog('Orden REAL cancelada por confirmación manual.', 'warn');
      return;
    }
  }

  isSendingOrder = true;
  updateUi();
  addLog(`[${accountLabel}] Pidiendo proposal ${contractType} ${symbol} · stake ${stake.toFixed(2)} ${currency}`, 'warn');

  try {
    const proposalReq = {
      proposal: 1,
      amount: stake,
      basis: 'stake',
      contract_type: contractType,
      currency,
      duration,
      duration_unit: durationUnit,
      symbol
    };

    if (mode === 'higher_lower') proposalReq.barrier = barrier;

    const proposal = await send(proposalReq);
    const proposalId = proposal.proposal?.id;
    const askPrice = Number(proposal.proposal?.ask_price || stake);
    if (!proposalId) throw new Error('Deriv no devolvió proposal_id');

    const buy = await send({ buy: proposalId, price: askPrice });
    const contractId = buy.buy?.contract_id;
    if (!contractId) throw new Error('Deriv no devolvió contract_id');

    addLog(`[${accountLabel}] Comprado contrato ${contractId} · ${contractType} · ${askPrice.toFixed(2)} ${currency}`, 'ok');
    await subscribeContract(contractId);
  } catch (err) {
    addLog(`[${accountLabel}] Orden rechazada: ${err.message}`, 'err');
    isSendingOrder = false;
    updateUi();
  }
}

async function subscribeContract(contractId) {
  const res = await send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 });
  if (res.subscription?.id) contractSubscriptionId = res.subscription.id;
  if (res.proposal_open_contract) handleContractUpdate(res.proposal_open_contract, res.subscription?.id);
}

async function handleContractUpdate(contract, subId) {
  if (subId) contractSubscriptionId = subId;

  if (!contract.is_sold) return;

  const profit = Number(contract.profit || 0);
  const result = profit > 0 ? 'ITM' : 'OTM';
  els.lastResultText.textContent = `${result} ${profit.toFixed(2)}`;
  addLog(`[${getAccountLabel(activeAccountMode)}] ${result} · profit ${profit.toFixed(2)} ${currency} · balance recalculando nivel`, profit > 0 ? 'ok' : 'err');

  isSendingOrder = false;

  try {
    if (contractSubscriptionId) await send({ forget: contractSubscriptionId });
  } catch (_) {}

  try {
    const b = await send({ balance: 1 });
    if (b.balance) balance = Number(b.balance.balance);
  } catch (_) {}

  contractSubscriptionId = null;
  updateUi();
}

els.connectBtn.addEventListener('click', connect);
els.buyBtn.addEventListener('click', () => executeTrade('buy'));
els.sellBtn.addEventListener('click', () => executeTrade('sell'));
els.accountModeSelect.addEventListener('change', () => {
  saveSettings();
  if (isAuthorized) {
    addLog(`Cambio a modo ${getAccountLabel(getSelectedAccountMode())}. Reconectá para usar ese token.`, 'warn');
    disconnect();
  }
  updateUi();
});
els.modeSelect.addEventListener('change', () => { saveSettings(); updateUi(); });
[
  els.symbolSelect,
  els.barrierInput,
  els.durationInput,
  els.durationUnitSelect,
  els.stepInput,
  els.maxInput,
  els.pctInput,
  els.appIdInput,
  els.demoTokenInput,
  els.realTokenInput
].forEach(el => {
  el.addEventListener('change', () => { saveSettings(); updateUi(); });
  el.addEventListener('input', () => { saveSettings(); updateUi(); });
});
els.clearLogBtn.addEventListener('click', () => {
  tradeLog = [];
  localStorage.removeItem('tradeLog');
  renderLog();
});
els.pinBtn.addEventListener('click', async () => {
  const isTop = await window.electronAPI.toggleAlwaysOnTop();
  els.pinBtn.textContent = isTop ? '📌 ON' : '📌 OFF';
});

(async function init() {
  loadSettings();
  renderLog();
  updateUi();
  try {
    const isTop = await window.electronAPI.isAlwaysOnTop();
    els.pinBtn.textContent = isTop ? '📌 ON' : '📌 OFF';
  } catch (_) {}
})();
