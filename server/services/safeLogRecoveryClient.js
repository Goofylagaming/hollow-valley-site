function validateSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('A valid 17-digit Steam ID is required');
  return steamId;
}

function validateSource(value, { allowBoth = false, optional = true } = {}) {
  const source = String(value || '').trim().toLowerCase();
  if (!source && optional) return null;
  const allowed = allowBoth ? ['completed', 'pending', 'both'] : ['completed', 'pending'];
  if (!allowed.includes(source)) throw new Error(`Safe Log recovery source must be ${allowed.join(' or ')}`);
  return source;
}

async function call(path, { method = 'GET', body } = {}) {
  if (typeof globalThis.fetch !== 'function') throw new Error('A fetch implementation is required');
  const baseUrl = String(process.env.AUTOMATION_SERVICE_URL || '').trim().replace(/\/$/, '');
  const token = String(process.env.AUTOMATION_ADMIN_TOKEN || '').trim();
  const timeoutMs = Math.max(1000, Math.min(30000, Number(process.env.AUTOMATION_SERVICE_TIMEOUT_MS || 12000)));
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
    const response = await fetch(`${baseUrl}/api/admin/safelog-recovery${path}`, {
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
      const error = new Error(payload?.error || `Safe Log recovery request failed (${response.status})`);
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

function getRecovery(steamId, source = null) {
  const steam = validateSteamId(steamId);
  const selected = validateSource(source);
  const query = selected ? `?source=${encodeURIComponent(selected)}` : '';
  return call(`/${encodeURIComponent(steam)}${query}`);
}

function restoreRecovery({ steamId, source = null, confirm }) {
  const steam = validateSteamId(steamId);
  const selected = validateSource(source);
  return call('/restore', {
    method: 'POST',
    body: { steamId: steam, source: selected, confirm },
  });
}

function clearRecovery({ steamId, source = 'both', confirm }) {
  const steam = validateSteamId(steamId);
  const selected = validateSource(source, { allowBoth: true, optional: false });
  return call('/clear', {
    method: 'POST',
    body: { steamId: steam, source: selected, confirm },
  });
}

module.exports = {
  validateSteamId,
  validateSource,
  getRecovery,
  restoreRecovery,
  clearRecovery,
};
