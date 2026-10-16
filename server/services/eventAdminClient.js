function validateEventId(value) {
  const id = String(value || '').trim();
  if (!/^\d{10,24}$/.test(id)) throw new Error('Invalid Discord event ID');
  return id;
}

function validateSteamIdOrNull(value) {
  const steamId = String(value || '').trim();
  return /^\d{17}$/.test(steamId) ? steamId : null;
}

async function deleteWebsiteEvent({ eventId, deletedBySteamId = null }) {
  if (typeof globalThis.fetch !== 'function') throw new Error('A fetch implementation is required');

  const baseUrl = String(process.env.AUTOMATION_SERVICE_URL || '').trim().replace(/\/$/, '');
  const token = String(process.env.AUTOMATION_ADMIN_TOKEN || '').trim();
  const timeoutMs = Math.max(1000, Math.min(30000, Number(process.env.AUTOMATION_SERVICE_TIMEOUT_MS || 8000)));

  if (!/^https?:\/\//i.test(baseUrl)) {
    const error = new Error('AUTOMATION_SERVICE_URL is not configured');
    error.status = 503;
    throw error;
  }
  if (!token) {
    const error = new Error('Automation admin API is not configured');
    error.status = 503;
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    const response = await fetch(`${baseUrl}/api/admin/events/${encodeURIComponent(validateEventId(eventId))}`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ deletedBySteamId: validateSteamIdOrNull(deletedBySteamId) }),
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
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { deleteWebsiteEvent };
