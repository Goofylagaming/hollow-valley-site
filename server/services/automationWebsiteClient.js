function requireConfig() {
  const baseUrl = String(process.env.AUTOMATION_SERVICE_URL || '').trim().replace(/\/$/, '');
  const token = String(process.env.HOLLOW_VALLEY_API_TOKEN || '').trim();
  const timeoutMs = Math.max(1000, Math.min(30000, Number(process.env.AUTOMATION_SERVICE_TIMEOUT_MS || 8000)));
  if (!baseUrl) throw new Error('AUTOMATION_SERVICE_URL is not configured');
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('AUTOMATION_SERVICE_URL must be an http(s) URL');
  if (!token) throw new Error('HOLLOW_VALLEY_API_TOKEN is not configured');
  return { baseUrl, token, timeoutMs };
}

function validateSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('A valid 17-digit Steam ID is required');
  return steamId;
}

function validateRequestId(value) {
  const id = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(id)) throw new Error('Invalid automation request ID');
  return id;
}

async function call(path, { method = 'GET', body } = {}) {
  if (typeof globalThis.fetch !== 'function') throw new Error('A fetch implementation is required');
  const { baseUrl, token, timeoutMs } = requireConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(`${baseUrl}/api/website${path}`, {
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
      const error = new Error(payload?.error || `Automation service request failed (${response.status})`);
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

function getActiveCharacter(steamId) {
  return call(`/dinostorage/active-character/${encodeURIComponent(validateSteamId(steamId))}`);
}

function listStoredDinos(steamId) {
  return call(`/dinostorage/${encodeURIComponent(validateSteamId(steamId))}`);
}

function requestDinoAction(action, { steamId, slot }) {
  if (!['store', 'redeem'].includes(action)) throw new Error('Unsupported DinoStorage action');
  const selectedSlot = String(slot || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(selectedSlot)) throw new Error('Invalid DinoStorage slot');
  return call(`/dinostorage/${action}`, {
    method: 'POST',
    body: { steamId: validateSteamId(steamId), slot: selectedSlot },
  });
}

function getRequestStatus(requestId, steamId) {
  return call(`/requests/${encodeURIComponent(validateRequestId(requestId))}?steamId=${encodeURIComponent(validateSteamId(steamId))}`);
}

function getBodyDropCooldown(steamId) {
  return call(`/bodydrop/cooldown/${encodeURIComponent(validateSteamId(steamId))}`);
}

function requestBodyDrop({ steamId, dropType }) {
  const type = String(dropType || '').trim();
  if (!/^[A-Za-z0-9_-]{2,32}$/.test(type)) throw new Error('Invalid body drop type');
  return call('/bodydrop', {
    method: 'POST',
    body: { steamId: validateSteamId(steamId), dropType: type },
  });
}

module.exports = {
  getActiveCharacter,
  listStoredDinos,
  requestDinoAction,
  getRequestStatus,
  getBodyDropCooldown,
  requestBodyDrop,
};
