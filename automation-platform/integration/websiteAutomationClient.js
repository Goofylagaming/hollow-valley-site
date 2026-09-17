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
  const requestId = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)) throw new Error('Invalid automation request ID');
  return requestId;
}

async function call(path, { method = 'GET', body, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  const { baseUrl, token, timeoutMs } = requireConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    const response = await fetchImpl(`${baseUrl}/api/website${path}`, {
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

function getBodyDropCooldown(steamId, options = {}) {
  return call(`/bodydrop/cooldown/${encodeURIComponent(validateSteamId(steamId))}`, options);
}

function requestBodyDrop({ steamId, dropType }, options = {}) {
  const validatedSteamId = validateSteamId(steamId);
  const type = String(dropType || '').trim();
  if (!/^[A-Za-z0-9_-]{2,32}$/.test(type)) throw new Error('Invalid body drop type');
  return call('/bodydrop', { ...options, method: 'POST', body: { steamId: validatedSteamId, dropType: type } });
}

function listStoredDinos(steamId, options = {}) {
  return call(`/dinostorage/${encodeURIComponent(validateSteamId(steamId))}`, options);
}

function requestDinoAction(action, { steamId, slot = 'default' }, options = {}) {
  if (!['store', 'redeem'].includes(action)) throw new Error('Unsupported DinoStorage action');
  const validatedSteamId = validateSteamId(steamId);
  const selectedSlot = String(slot || 'default').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(selectedSlot)) throw new Error('Invalid DinoStorage slot');
  return call(`/dinostorage/${action}`, {
    ...options,
    method: 'POST',
    body: { steamId: validatedSteamId, slot: selectedSlot },
  });
}

function getRequestStatus(requestId, steamId, options = {}) {
  const id = validateRequestId(requestId);
  const steam = validateSteamId(steamId);
  return call(`/requests/${encodeURIComponent(id)}?steamId=${encodeURIComponent(steam)}`, options);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRequestStatus(requestId, steamId, {
  fetchImpl = globalThis.fetch,
  intervalMs = 2000,
  maxWaitMs = 30000,
} = {}) {
  const id = validateRequestId(requestId);
  const steam = validateSteamId(steamId);
  const pollEvery = Math.max(250, Math.min(10000, Number(intervalMs) || 2000));
  const deadline = Date.now() + Math.max(1000, Math.min(120000, Number(maxWaitMs) || 30000));
  const terminal = new Set(['confirmed', 'accepted', 'completed', 'failed', 'unknown', 'cancelled']);
  let latest = null;

  while (Date.now() <= deadline) {
    const payload = await getRequestStatus(id, steam, { fetchImpl });
    latest = payload?.request || null;
    if (!latest) throw new Error('Automation service returned no request state');
    if (terminal.has(latest.status)) {
      return {
        request: latest,
        terminal: true,
        requiresOperator: latest.status === 'unknown',
      };
    }
    if (Date.now() + pollEvery > deadline) break;
    await sleep(pollEvery);
  }

  return {
    request: latest,
    terminal: false,
    timedOut: true,
    requiresOperator: false,
  };
}

module.exports = {
  validateSteamId,
  validateRequestId,
  getBodyDropCooldown,
  requestBodyDrop,
  listStoredDinos,
  requestDinoAction,
  getRequestStatus,
  waitForRequestStatus,
};
