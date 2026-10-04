const { api } = window.HDS;

let currentDinoRequestSteamId = '';

function dinoRequestSteamId() {
  return String(document.getElementById('admin-dino-requests-steam')?.value || '').trim();
}

function setDinoRequestStatus(message, isError = false) {
  const el = document.getElementById('admin-dino-requests-status');
  if (!el) return;
  el.textContent = message || '';
  el.classList.toggle('error', Boolean(isError));
}

function requestActionName(request) {
  return String(request?.details?.action || request?.details?.command?.verb || 'action')
    .replace(/^dino_/, '')
    .replace('redeem', 'retrieve');
}

function renderDinoRequests(data) {
  const list = document.getElementById('admin-dino-requests-list');
  const flush = document.getElementById('admin-dino-requests-flush');
  if (!list) return;
  list.replaceChildren();

  const requests = Array.isArray(data?.requests) ? data.requests : [];
  const pending = requests.filter((request) => request.pending === true);
  if (flush) flush.disabled = pending.length === 0;

  if (!requests.length) {
    const empty = document.createElement('p');
    empty.className = 'section-intro';
    empty.textContent = 'No DinoStorage request history was found for this Steam ID.';
    list.append(empty);
    return;
  }

  for (const request of requests) {
    const row = document.createElement('div');
    row.className = 'admin-player-row';

    const identity = document.createElement('div');
    identity.className = 'admin-player-identity';

    const heading = document.createElement('strong');
    const action = requestActionName(request);
    const slot = String(request?.details?.slot || 'slot unknown');
    heading.textContent = `${action.toUpperCase()} · ${request.status}`;

    const detail = document.createElement('span');
    const created = request.created_at ? new Date(`${String(request.created_at).replace(' ', 'T')}Z`).toLocaleString() : 'time unknown';
    detail.textContent = `${slot} · ${request.id} · ${created}`;
    identity.append(heading, detail);

    const actions = document.createElement('div');
    actions.className = 'form-row';

    if (request.pending === true) {
      const reconcile = document.createElement('button');
      reconcile.className = 'small-button';
      reconcile.type = 'button';
      reconcile.textContent = 'Reconcile';
      reconcile.addEventListener('click', () => reconcileDinoRequest(request, reconcile));

      const cancel = document.createElement('button');
      cancel.className = 'small-button';
      cancel.type = 'button';
      cancel.textContent = 'Cancel lock';
      cancel.addEventListener('click', () => cancelDinoRequest(request, cancel));

      actions.append(reconcile, cancel);
    }

    row.append(identity);
    if (actions.childElementCount) row.append(actions);
    list.append(row);
  }

  setDinoRequestStatus(
    `${requests.length} DinoStorage request${requests.length === 1 ? '' : 's'} · ${pending.length} currently blocking. ` +
    `Unconfirmed requests automatically leave the player lock after ${Number(data?.staleUnlockSeconds || 300)} seconds and are marked stale for review.`
  );
}

async function loadDinoRequests(steamId = dinoRequestSteamId()) {
  const steam = String(steamId || '').trim();
  const result = document.getElementById('admin-dino-requests-result');
  const flush = document.getElementById('admin-dino-requests-flush');
  if (!/^\d{17}$/.test(steam)) {
    currentDinoRequestSteamId = '';
    if (result) result.hidden = true;
    if (flush) flush.disabled = true;
    setDinoRequestStatus('Enter a valid 17-digit Steam ID.', true);
    return;
  }

  currentDinoRequestSteamId = steam;
  if (flush) flush.disabled = true;
  setDinoRequestStatus('Loading DinoStorage request history…');
  try {
    const data = await api(`/api/admin-operations/dinostorage-requests/${encodeURIComponent(steam)}`);
    if (result) result.hidden = false;
    renderDinoRequests(data);
  } catch (error) {
    if (result) result.hidden = true;
    setDinoRequestStatus(error.message || 'Could not load DinoStorage requests.', true);
  }
}

async function reconcileDinoRequest(request, button) {
  if (!request?.id) return;
  if (button) button.disabled = true;
  setDinoRequestStatus(`Reconciling ${request.id}…`);
  try {
    const data = await api(`/api/admin-operations/dinostorage-requests/${encodeURIComponent(request.id)}/reconcile`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const status = data?.request?.status || data?.afterStatus || 'checked';
    setDinoRequestStatus(`Request ${request.id} reconciled as ${status}.`);
    await loadDinoRequests(currentDinoRequestSteamId);
  } catch (error) {
    setDinoRequestStatus(error.message || 'Reconciliation failed.', true);
    if (button) button.disabled = false;
  }
}

async function cancelDinoRequest(request, button) {
  if (!request?.id || !currentDinoRequestSteamId) return;
  if (!confirm(`Cancel the DinoStorage lock for request ${request.id}? This does not delete or retrieve any dinosaur and does not replay the command.`)) return;
  if (button) button.disabled = true;
  setDinoRequestStatus(`Cancelling lock ${request.id}…`);
  try {
    await api(`/api/admin-operations/dinostorage-requests/${encodeURIComponent(request.id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ steamId: currentDinoRequestSteamId }),
    });
    setDinoRequestStatus(`Cancelled stale DinoStorage lock ${request.id}. No dinosaur files were changed.`);
    await loadDinoRequests(currentDinoRequestSteamId);
  } catch (error) {
    setDinoRequestStatus(error.message || 'Could not cancel the DinoStorage lock.', true);
    if (button) button.disabled = false;
  }
}

async function flushDinoRequests() {
  const steam = currentDinoRequestSteamId || dinoRequestSteamId();
  if (!/^\d{17}$/.test(steam)) return;
  if (!confirm(`Flush all pending DinoStorage request locks for ${steam}? This only terminalizes automation requests. Stored dinosaur files and CommandBridge history are left untouched.`)) return;

  const button = document.getElementById('admin-dino-requests-flush');
  if (button) button.disabled = true;
  setDinoRequestStatus('Flushing pending DinoStorage locks…');
  try {
    const data = await api(`/api/admin-operations/dinostorage-requests/flush/${encodeURIComponent(steam)}`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setDinoRequestStatus(`Flushed ${Number(data?.flushed || 0)} pending request lock(s). No dinosaur files were changed.`);
    await loadDinoRequests(steam);
  } catch (error) {
    setDinoRequestStatus(error.message || 'Could not flush pending DinoStorage locks.', true);
    if (button) button.disabled = false;
  }
}

async function sweepStaleDinoRequests() {
  const button = document.getElementById('admin-dino-requests-sweep');
  if (button) button.disabled = true;
  setDinoRequestStatus('Reconciling and sweeping stale DinoStorage requests…');
  try {
    const data = await api('/api/admin-operations/dinostorage-requests/sweep-stale', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const expired = Number(data?.stale?.expired || data?.expired || 0);
    const changed = Number(data?.reconciliation?.changed || data?.reconciled || 0);
    setDinoRequestStatus(`Sweep complete · ${changed} reconciled · ${expired} stale lock(s) released.`);
    if (currentDinoRequestSteamId) await loadDinoRequests(currentDinoRequestSteamId);
  } catch (error) {
    setDinoRequestStatus(error.message || 'Could not sweep stale DinoStorage requests.', true);
  } finally {
    if (button) button.disabled = false;
  }
}

document.getElementById('admin-dino-requests-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  loadDinoRequests();
});
document.getElementById('admin-dino-requests-flush')?.addEventListener('click', flushDinoRequests);
document.getElementById('admin-dino-requests-sweep')?.addEventListener('click', sweepStaleDinoRequests);

document.getElementById('admin-records-form')?.addEventListener('submit', () => {
  const source = String(document.getElementById('admin-records-steam')?.value || '').trim();
  const target = document.getElementById('admin-dino-requests-steam');
  if (/^\d{17}$/.test(source) && target) target.value = source;
});
