const { getServerSnapshot } = require('./statusService');

const API_BASE = 'https://discord.com/api/v10';
let lastStatusChannelName = null;
let lastSyncAt = null;
let lastError = null;

function token() {
  return String(process.env.DISCORD_BOT_TOKEN || '').trim();
}

function configured() {
  return Boolean(token());
}

function announcementConfigured() {
  return configured() && Boolean(String(process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID || '').trim());
}

function statusChannelConfigured() {
  return configured() && Boolean(String(process.env.DISCORD_STATUS_CHANNEL_ID || '').trim());
}

function alertConfigured() {
  return configured() && Boolean(String(process.env.DISCORD_ALERT_CHANNEL_ID || '').trim());
}

function cleanMessage(value) {
  const message = String(value || '').trim();
  if (!message) throw new Error('Discord announcement message is required');
  if (message.length > 1900) throw new Error('Discord announcement message must be 1900 characters or fewer');
  return message;
}

function formatStatusChannelName(server) {
  if (!server?.configured) return 'server-status-unavailable';
  if (!server.online) return '🔴-hollow-valley-offline';
  const count = Number.isFinite(server.players?.length) ? server.players.length : Number(server.playerCount || 0);
  const max = Number.isFinite(server.maxPlayers) ? server.maxPlayers : null;
  return max ? `🟢-hollow-valley-${count}-${max}-online` : `🟢-hollow-valley-${count}-online`;
}

async function discordRequest(path, { method = 'GET', body } = {}) {
  if (!configured()) throw new Error('DISCORD_BOT_TOKEN is not configured');
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token()}`,
      'Content-Type': 'application/json',
      'User-Agent': 'HollowValleyAutomation/1.0',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });

  let payload = null;
  const text = await response.text();
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  if (!response.ok) {
    const detail = typeof payload === 'object' && payload?.message ? payload.message : String(payload || response.statusText);
    throw new Error(`Discord API ${response.status}: ${detail}`);
  }
  return payload;
}

async function sendChannelMessage(channelId, message, { nonce = null } = {}) {
  const target = String(channelId || '').trim();
  if (!target) throw new Error('Discord channel ID is not configured');
  const content = cleanMessage(message);
  const body = {
    content,
    allowed_mentions: { parse: [] },
  };
  if (nonce) {
    body.nonce = String(nonce);
    body.enforce_nonce = true;
  }
  const result = await discordRequest(`/channels/${encodeURIComponent(target)}/messages`, {
    method: 'POST',
    body,
  });
  return { id: result?.id || null, channelId: target, content };
}

async function sendAnnouncement(message, { nonce = null } = {}) {
  const channelId = String(process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID || '').trim();
  if (!channelId) throw new Error('DISCORD_ANNOUNCEMENT_CHANNEL_ID is not configured');
  return sendChannelMessage(channelId, message, { nonce });
}

async function sendAlert(message, { nonce = null } = {}) {
  const channelId = String(process.env.DISCORD_ALERT_CHANNEL_ID || '').trim();
  if (!channelId) throw new Error('DISCORD_ALERT_CHANNEL_ID is not configured');
  return sendChannelMessage(channelId, message, { nonce });
}

async function syncStatusChannel({ force = false } = {}) {
  const channelId = String(process.env.DISCORD_STATUS_CHANNEL_ID || '').trim();
  if (!channelId) throw new Error('DISCORD_STATUS_CHANNEL_ID is not configured');
  const server = await getServerSnapshot({ force });
  const name = formatStatusChannelName(server);
  if (name === lastStatusChannelName) {
    lastSyncAt = new Date().toISOString();
    lastError = null;
    return { changed: false, name, checkedAt: lastSyncAt };
  }

  try {
    await discordRequest(`/channels/${encodeURIComponent(channelId)}`, {
      method: 'PATCH',
      body: { name },
    });
    lastStatusChannelName = name;
    lastSyncAt = new Date().toISOString();
    lastError = null;
    return { changed: true, name, checkedAt: lastSyncAt };
  } catch (error) {
    lastSyncAt = new Date().toISOString();
    lastError = error.message;
    throw error;
  }
}

function getState() {
  return {
    configured: configured(),
    announcementConfigured: announcementConfigured(),
    statusChannelConfigured: statusChannelConfigured(),
    alertConfigured: alertConfigured(),
    lastStatusChannelName,
    lastSyncAt,
    lastError,
  };
}

function startDiscordAutomation() {
  if (!statusChannelConfigured()) return null;
  const intervalMs = Math.max(300_000, Number(process.env.DISCORD_STATUS_SYNC_INTERVAL_MS || 300_000));
  syncStatusChannel({ force: false }).catch((error) => console.warn('[discord-status-sync]', error.message));
  const timer = setInterval(() => {
    syncStatusChannel({ force: false }).catch((error) => console.warn('[discord-status-sync]', error.message));
  }, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  configured,
  announcementConfigured,
  statusChannelConfigured,
  alertConfigured,
  cleanMessage,
  formatStatusChannelName,
  sendChannelMessage,
  sendAnnouncement,
  sendAlert,
  syncStatusChannel,
  getState,
  startDiscordAutomation,
};
