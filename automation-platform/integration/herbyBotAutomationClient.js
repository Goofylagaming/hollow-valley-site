function requireConfig() {
  const baseUrl = String(process.env.AUTOMATION_SERVICE_URL || '').trim().replace(/\/$/, '');
  const token = String(process.env.HERBYBOT_AUTOMATION_TOKEN || '').trim();
  const timeoutMs = Math.max(1000, Math.min(30000, Number(process.env.AUTOMATION_SERVICE_TIMEOUT_MS || 8000)));
  if (!baseUrl) throw new Error('AUTOMATION_SERVICE_URL is not configured');
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('AUTOMATION_SERVICE_URL must be an http(s) URL');
  if (!token) throw new Error('HERBYBOT_AUTOMATION_TOKEN is not configured');
  return { baseUrl, token, timeoutMs };
}

async function call(path, { method = 'GET', body, fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required');
  const { baseUrl, token, timeoutMs } = requireConfig();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    const response = await fetchImpl(`${baseUrl}/api/herbybot${path}`, {
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
      const error = new Error(payload?.error || `HerbyBot bridge request failed (${response.status})`);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error('HerbyBot bridge request timed out');
      timeoutError.code = 'AUTOMATION_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function getStatus(options = {}) {
  return call('/status', options);
}

function claimMessages({ limit = 10, leaseSeconds = 60 } = {}, options = {}) {
  return call('/outbox/claim', {
    ...options,
    method: 'POST',
    body: { limit, leaseSeconds },
  });
}

function acknowledgeMessage(id, options = {}) {
  return call(`/outbox/${encodeURIComponent(String(id || '').trim())}/ack`, {
    ...options,
    method: 'POST',
    body: {},
  });
}

function failMessage(id, error, options = {}) {
  return call(`/outbox/${encodeURIComponent(String(id || '').trim())}/fail`, {
    ...options,
    method: 'POST',
    body: { error: String(error || 'HerbyBot delivery failed').slice(0, 500) },
  });
}

module.exports = {
  getStatus,
  claimMessages,
  acknowledgeMessage,
  failMessage,
};
