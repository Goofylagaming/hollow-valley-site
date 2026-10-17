function config() {
  const baseUrl = String(process.env.AUTOMATION_SERVICE_URL || '').trim().replace(/\/$/, '');
  const token = String(process.env.HOLLOW_VALLEY_API_TOKEN || '').trim();
  const timeoutMs = Math.max(1000, Math.min(15000, Number(process.env.AUTOMATION_SERVICE_TIMEOUT_MS || 8000)));
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('AUTOMATION_SERVICE_URL is not configured');
  if (!token) throw new Error('HOLLOW_VALLEY_API_TOKEN is not configured');
  return { baseUrl, token, timeoutMs };
}

async function listEvents({ since, limit = 100 } = {}) {
  if (typeof globalThis.fetch !== 'function') throw new Error('A fetch implementation is required');
  const { baseUrl, token, timeoutMs } = config();
  const params = new URLSearchParams();
  if (since) params.set('since', String(since));
  params.set('limit', String(Math.max(1, Math.min(250, Number(limit) || 100))));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(`${baseUrl}/api/website/territory-combat/events?${params.toString()}`, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
      },
      signal: controller.signal,
    });
    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(payload?.error || `Territory combat request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return payload || { events: [] };
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeout = new Error('Territory combat request timed out');
      timeout.code = 'AUTOMATION_TIMEOUT';
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { listEvents };
