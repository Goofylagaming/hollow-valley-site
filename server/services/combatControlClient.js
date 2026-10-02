function config() {
  const baseUrl = String(process.env.AUTOMATION_SERVICE_URL || '').trim().replace(/\/$/, '');
  const websiteToken = String(process.env.HOLLOW_VALLEY_API_TOKEN || '').trim();
  const adminToken = String(process.env.AUTOMATION_ADMIN_TOKEN || '').trim();
  const timeoutMs = Math.max(1000, Math.min(30000, Number(process.env.AUTOMATION_SERVICE_TIMEOUT_MS || 8000)));
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('AUTOMATION_SERVICE_URL is not configured');
  return { baseUrl, websiteToken, adminToken, timeoutMs };
}

async function request(path, token, { method = 'GET', body } = {}) {
  if (!token) {
    const error = new Error('Automation combat API is not configured');
    error.status = 503;
    throw error;
  }
  const { baseUrl, timeoutMs } = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const response = await fetch(`${baseUrl}${path}`, {
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
      const error = new Error(payload?.error || `Automation combat request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeout = new Error('Automation combat request timed out');
      timeout.status = 504;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function getLeaderboard(period) {
  const normalized = String(period || '').toLowerCase();
  if (!['daily', 'weekly'].includes(normalized)) throw new Error('Invalid combat leaderboard period');
  const { websiteToken } = config();
  return request(`/api/website/leaderboards/combat?period=${encodeURIComponent(normalized)}`, websiteToken);
}

function resetPlayerStats(steamId) {
  const id = String(steamId || '').trim();
  if (!/^\d{17}$/.test(id)) throw new Error('A valid 17-digit Steam ID is required');
  const { adminToken } = config();
  return request('/api/admin/combat/reset-stats', adminToken, {
    method: 'POST',
    body: { steamId: id, confirm: 'RESET COMBAT' },
  });
}

module.exports = { getLeaderboard, resetPlayerStats };
