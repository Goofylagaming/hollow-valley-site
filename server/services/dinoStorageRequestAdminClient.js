function validateSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('A valid 17-digit Steam ID is required');
  return steamId;
}

function validateRequestId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error('A valid DinoStorage request ID is required');
  return id;
}

async function callAdmin(path, { method = 'GET', body } = {}) {
  if (typeof globalThis.fetch !== 'function') throw new Error('A fetch implementation is required');
  const baseUrl = String(process.env.AUTOMATION_SERVICE_URL || '').trim().replace(/\/$/, '');
  const token = String(process.env.AUTOMATION_ADMIN_TOKEN || '').trim();
  const timeoutMs = Math.max(1000, Math.min(30000, Number(process.env.AUTOMATION_SERVICE_TIMEOUT_MS || 8000)));
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('AUTOMATION_SERVICE_URL is not configured');
  if (!token) {
    const error = new Error('Automation admin API is not configured');
    error.status = 503;
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(`${baseUrl}/api/admin/dinostorage-requests${path}`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(payload?.error || `Automation admin request failed (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('Automation service request timed out');
      timeoutError.code = 'AUTOMATION_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function listRequests(steamId) {
  return callAdmin(`/${encodeURIComponent(validateSteamId(steamId))}`);
}

function reconcileRequest(requestId) {
  return callAdmin(`/${encodeURIComponent(validateRequestId(requestId))}/reconcile`, { method: 'POST' });
}

function cancelRequest({ requestId, steamId }) {
  return callAdmin(`/${encodeURIComponent(validateRequestId(requestId))}/cancel`, {
    method: 'POST',
    body: { steamId: validateSteamId(steamId) },
  });
}

function flushPending(steamId) {
  return callAdmin(`/flush/${encodeURIComponent(validateSteamId(steamId))}`, {
    method: 'POST',
    body: {},
  });
}

function sweepStale() {
  return callAdmin('/sweep-stale/run', { method: 'POST' });
}

module.exports = {
  cancelRequest,
  flushPending,
  listRequests,
  reconcileRequest,
  sweepStale,
  validateRequestId,
  validateSteamId,
};
