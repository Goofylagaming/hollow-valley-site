const { executeRconCommand } = require('../adapters/evrimaRcon');

const COMMANDS = Object.freeze({
  announce: 0x10,
  directMessage: 0x11,
  wipeCorpses: 0x13,
  save: 0x50,
  aiDensity: 0x92,
});

function writeEnabled() {
  return String(process.env.RCON_WRITE_ENABLED || '').toLowerCase() === 'true';
}

function getConfig() {
  const host = String(process.env.RCON_HOST || '').trim();
  const port = Number(process.env.RCON_PORT);
  const password = String(process.env.RCON_PASSWORD || '');
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !password) {
    throw new Error('RCON host, port and password must be configured');
  }
  return {
    host,
    port,
    password,
    timeoutMs: Math.max(1000, Number(process.env.RCON_TIMEOUT_MS || 6000)),
  };
}

function validateMessage(value) {
  const message = String(value || '').trim();
  if (!message) throw new Error('Message is required');
  if (message.length > 240) throw new Error('Message must be 240 characters or fewer');
  if (/[\x00\r\n]/.test(message)) throw new Error('Message cannot contain line breaks or control characters');
  return message;
}

function validateSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('A valid 17-digit Steam ID is required');
  return steamId;
}

function validateDensity(value) {
  const density = Number(value);
  if (!Number.isFinite(density) || density < 0 || density > 1) throw new Error('AI density must be between 0 and 1');
  return density;
}

function buildAction(action, payload = {}) {
  switch (action) {
    case 'announce':
      return { action, code: COMMANDS.announce, params: validateMessage(payload.message) };
    case 'directMessage': {
      const steamId = validateSteamId(payload.steamId);
      const message = validateMessage(payload.message);
      return { action, code: COMMANDS.directMessage, params: `${steamId},${message}` };
    }
    case 'save':
      return { action, code: COMMANDS.save, params: '' };
    case 'wipeCorpses':
      if (String(payload.confirm || '') !== 'WIPE CORPSES') {
        throw new Error('Corpse wipe requires confirm="WIPE CORPSES"');
      }
      return { action, code: COMMANDS.wipeCorpses, params: '' };
    case 'aiDensity':
      return { action, code: COMMANDS.aiDensity, params: String(validateDensity(payload.value)) };
    default:
      throw new Error('Unsupported RCON control action');
  }
}

async function execute(action, payload = {}) {
  if (!writeEnabled()) {
    const error = new Error('RCON write controls are disabled. Set RCON_WRITE_ENABLED=true only after operator review.');
    error.code = 'RCON_WRITE_DISABLED';
    throw error;
  }
  const command = buildAction(action, payload);
  const result = await executeRconCommand({ ...getConfig(), code: command.code, params: command.params });
  return {
    action,
    sent: result.sent,
    confirmed: result.confirmed,
    response: result.response || null,
    warning: result.warning || null,
    executedAt: new Date().toISOString(),
  };
}

function getState() {
  return {
    configured: Boolean(String(process.env.RCON_HOST || '').trim() && String(process.env.RCON_PORT || '').trim() && String(process.env.RCON_PASSWORD || '')),
    writeEnabled: writeEnabled(),
    supportedActions: Object.keys(COMMANDS),
  };
}

module.exports = {
  COMMANDS,
  writeEnabled,
  validateMessage,
  validateSteamId,
  validateDensity,
  buildAction,
  execute,
  getState,
};
