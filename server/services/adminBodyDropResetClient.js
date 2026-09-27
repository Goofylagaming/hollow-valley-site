function config() {
  const baseUrl = String(process.env.AUTOMATION_SERVICE_URL || '').trim().replace(/\/$/, '');
  const token = String(process.env.AUTOMATION_ADMIN_TOKEN || '').trim();
  const timeoutMs = Math.max(1000, Math.min(30000, Number(process.env.AUTOMATION_SERVICE_TIMEOUT_MS || 8000)));
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error('AUTOMATION_SERVICE_URL is not configured');
  if (!token) {
    const error = new Error('Automation admin API is not configured');
    error.status = 503;
    throw error;
  }
  return { baseUrl, token, timeoutMs };
}

function validateSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) {
    const error = new Error('A valid 17-digit Steam ID is required.');
    error.status = 400;
    throw error;
  }
  return steamId;
}

async function resetBodyDropCooldown(steamId) {
  const id = validateSteamId(steamId);
  const { baseUrl, token, timeoutMs } = config();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  try {
    const response = await fetch(`${baseUrl}/api/bodydrop/reset`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ steamId: id }),
      signal: controller.signal,
    });

    let payload = null;
    try { payload = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(payload?.error || `Automation admin request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeout = new Error('Automation service request timed out');
      timeout.status = 504;
      throw timeout;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { resetBodyDropCooldown, validateSteamId };
