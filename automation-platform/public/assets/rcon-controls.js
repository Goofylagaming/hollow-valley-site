const RCON_TOKEN_KEY = 'hdsAutomationAdminToken';

function rconToken() {
  return sessionStorage.getItem(RCON_TOKEN_KEY) || '';
}

async function rconFetch(url, options = {}) {
  const token = rconToken();
  if (!token) throw new Error('Admin console is locked');
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok) throw new Error(body?.error || `Request failed (${response.status})`);
  return body;
}

function rconNotice(message, isError = false) {
  const box = document.getElementById('rcon-action-status');
  if (!box) return;
  box.hidden = !message;
  box.textContent = message || '';
  box.classList.toggle('error', Boolean(isError));
}

function setFieldsEnabled(selector, enabled) {
  for (const field of document.querySelectorAll(selector)) field.disabled = !enabled;
}

function setRconControlsEnabled(enabled) {
  setFieldsEnabled('.rcon-control textarea,.rcon-control input,.rcon-control button', enabled);
  updateWipeButton();
}

function applyRconActionGates(state) {
  const gates = state.actionGates || {};
  const panel = document.querySelector('.rcon-panel');
  if (!panel) return;

  panel.dataset.writeEnabled = state.writeEnabled ? 'true' : 'false';
  panel.dataset.wipeEnabled = gates.wipeCorpses ? 'true' : 'false';

  setFieldsEnabled('#rcon-announcement-form textarea,#rcon-announcement-form button', Boolean(gates.announce));
  setFieldsEnabled('#rcon-save', Boolean(gates.save));
  setFieldsEnabled('#rcon-ai-form input,#rcon-ai-form button', Boolean(gates.aiDensity));
  setFieldsEnabled('#rcon-wipe-form input,#rcon-wipe-form button', Boolean(gates.wipeCorpses));
  updateWipeButton();
}

function updateWipeButton() {
  const input = document.getElementById('rcon-wipe-confirm');
  const button = document.querySelector('#rcon-wipe-form button[type="submit"]');
  if (!button || button.closest('.rcon-panel')?.dataset.wipeEnabled !== 'true') return;
  button.disabled = input?.value !== 'WIPE CORPSES';
}

function renderRconState(state) {
  const panel = document.querySelector('.rcon-panel');
  const badge = document.getElementById('rcon-write-health');
  const warning = document.getElementById('rcon-write-warning');
  if (!panel || !badge || !warning) return;

  if (!state.configured) {
    badge.textContent = 'RCON not configured';
    warning.textContent = 'RCON connection settings are incomplete. Write controls remain unavailable.';
    setRconControlsEnabled(false);
    panel.dataset.writeEnabled = 'false';
    panel.dataset.wipeEnabled = 'false';
    return;
  }

  const gates = state.actionGates || {};
  const enabled = Object.entries(gates).filter(([, value]) => value).map(([action]) => action);
  const locked = Object.entries(gates).filter(([, value]) => !value).map(([action]) => action);

  if (!enabled.length) {
    badge.textContent = 'Write locked';
    warning.textContent = 'All RCON write actions are locked. Enable only the specific action gates that have been reviewed.';
    setRconControlsEnabled(false);
    panel.dataset.writeEnabled = 'false';
    panel.dataset.wipeEnabled = 'false';
    return;
  }

  badge.textContent = enabled.length === Object.keys(gates).length ? 'Write enabled' : 'Partial writes enabled';
  warning.textContent = `Enabled: ${enabled.join(', ')}. Locked: ${locked.join(', ') || 'none'}. Commands are sent once and are never automatically retried.`;
  applyRconActionGates(state);
}

async function loadRconState() {
  if (!rconToken()) {
    setRconControlsEnabled(false);
    return;
  }
  try {
    renderRconState(await rconFetch('/api/admin/rcon'));
  } catch (error) {
    setRconControlsEnabled(false);
    rconNotice(error.message, true);
  }
}

async function runRconAction(path, payload, button, busyText) {
  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = busyText;
  rconNotice('');
  try {
    const body = await rconFetch(path, {
      method: 'POST',
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    const result = body.result || {};
    if (result.confirmed) rconNotice(`${result.action} confirmed by the game server.`);
    else if (result.sent) rconNotice(result.warning || `${result.action} was sent but not confirmed.`, true);
    else rconNotice(`${result.action || 'Command'} completed.`);
    return body;
  } catch (error) {
    rconNotice(error.message, true);
    throw error;
  } finally {
    button.textContent = oldText;
    await loadRconState();
  }
}

document.getElementById('rcon-announcement-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const message = document.getElementById('rcon-announcement')?.value.trim();
  if (!message) return;
  try {
    await runRconAction('/api/admin/rcon/announce', { message }, button, 'Sending…');
    document.getElementById('rcon-announcement').value = '';
  } catch {}
});

document.getElementById('rcon-save')?.addEventListener('click', async (event) => {
  try { await runRconAction('/api/admin/rcon/save', undefined, event.currentTarget, 'Saving…'); } catch {}
});

document.getElementById('rcon-ai-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const value = Number(document.getElementById('rcon-ai-density')?.value);
  try { await runRconAction('/api/admin/rcon/ai-density', { value }, button, 'Updating…'); } catch {}
});

document.getElementById('rcon-wipe-confirm')?.addEventListener('input', updateWipeButton);
document.getElementById('rcon-wipe-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const confirm = document.getElementById('rcon-wipe-confirm')?.value;
  if (confirm !== 'WIPE CORPSES') return;
  const button = event.currentTarget.querySelector('button[type="submit"]');
  try {
    await runRconAction('/api/admin/rcon/wipe-corpses', { confirm }, button, 'Wiping…');
    document.getElementById('rcon-wipe-confirm').value = '';
  } catch {}
});

setRconControlsEnabled(false);
setTimeout(loadRconState, 500);
setInterval(loadRconState, 15_000);

const auditScript = document.createElement('script');
auditScript.src = '/assets/audit-panel.js?v=1';
auditScript.defer = true;
document.body.appendChild(auditScript);
