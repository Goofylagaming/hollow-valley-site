const { getServerSnapshot } = require('./statusService');
const herbyBot = require('./herbyBotOutboxService');

let lastStatusChannelName = null;
let lastSyncAt = null;
let lastError = null;

function configured() {
  return herbyBot.configured();
}

function announcementConfigured() {
  return configured();
}

function statusChannelConfigured() {
  return configured();
}

function alertConfigured() {
  return configured();
}

function cleanMessage(value) {
  return herbyBot.cleanMessage(value);
}

function formatStatusChannelName(server) {
  if (!server?.configured) return 'server-status-unavailable';
  if (!server.online) return '🔴-hollow-valley-offline';
  const count = Number.isFinite(server.players?.length) ? server.players.length : Number(server.playerCount || 0);
  const max = Number.isFinite(server.maxPlayers) ? server.maxPlayers : null;
  return max ? `🟢-hollow-valley-${count}-${max}-online` : `🟢-hollow-valley-${count}-online`;
}

async function sendAnnouncement(message, { nonce = null } = {}) {
  try {
    const event = herbyBot.queueAnnouncement(cleanMessage(message), { nonce: nonce || undefined });
    lastError = null;
    return {
      id: event.id,
      queued: true,
      destination: event.destination,
      nonce: event.nonce,
      message: event.message,
    };
  } catch (error) {
    lastError = error.message;
    throw error;
  }
}

async function sendAlert(message, { nonce = null } = {}) {
  try {
    const event = herbyBot.queueAlert(cleanMessage(message), { nonce: nonce || undefined });
    lastError = null;
    return {
      id: event.id,
      queued: true,
      destination: event.destination,
      nonce: event.nonce,
      message: event.message,
    };
  } catch (error) {
    lastError = error.message;
    throw error;
  }
}

async function syncStatusChannel({ force = false } = {}) {
  const server = await getServerSnapshot({ force });
  const name = formatStatusChannelName(server);
  lastStatusChannelName = name;
  lastSyncAt = new Date().toISOString();
  lastError = null;
  return {
    changed: false,
    delegated: true,
    name,
    checkedAt: lastSyncAt,
    message: 'Status-channel delivery is owned by the existing HerbyBot client.',
  };
}

function getState() {
  const bridge = herbyBot.getState();
  return {
    configured: configured(),
    announcementConfigured: announcementConfigured(),
    statusChannelConfigured: statusChannelConfigured(),
    alertConfigured: alertConfigured(),
    deliveryMode: 'herbybot_outbox',
    lastStatusChannelName,
    lastSyncAt,
    lastError,
    outbox: bridge.outbox,
  };
}

function startDiscordAutomation() {
  // The automation service intentionally does not connect to Discord.
  // Existing HerbyBot owns the single gateway connection and polls the outbox.
  return null;
}

module.exports = {
  configured,
  announcementConfigured,
  statusChannelConfigured,
  alertConfigured,
  cleanMessage,
  formatStatusChannelName,
  sendAnnouncement,
  sendAlert,
  syncStatusChannel,
  getState,
  startDiscordAutomation,
};
