const { executeRconCommand } = require('../adapters/evrimaRcon');

const COMMANDS = Object.freeze({
  announce: 0x10,
  directMessage: 0x11,
  wipeCorpses: 0x13,
  save: 0x50,
  aiDensity: 0x92,
});

const ACTION_GATES = Object.freeze({
  announce: 'RCON_ANNOUNCEMENT_WRITE_ENABLED',
  directMessage: 'RCON_DIRECT_MESSAGE_WRITE_ENABLED',
  wipeCorpses: 'RCON_CORPSE_WIPE_WRITE_ENABLED',
  save: 'RCON_SAVE_WRITE_ENABLED',
  aiDensity: 'RCON_AI_DENSITY_WRITE_ENABLED',
});

function envEnabled(name) {
  return String(process.env[name] || '').toLowerCase() === 'true';
}

function legacyWriteEnabled() {
  return envEnabled('RCON_WRITE_ENABLED');
}

function writeEnabled(action = null) {
  if (!action) {
    return legacyWriteEnabled() || Object.keys(ACTION_GATES).some((key) => writeEnabled(key));
  }

  const gate = ACTION_GATES[action];
  if (!gate) return false;

  // Explicit per-action gates override the legacy global gate. If a specific
  // gate is not present, keep backward compatibility with RCON_WRITE_ENABLED.
  if (process.env[gate] !== undefined && String(process.env[gate]).trim() !== '') {
    return envEnabled(gate);
  }
  return legacyWriteEnabled();
}

function getActionGates() {
  return Object.fromEntries(Object.keys(ACTION_GATES).map((action) => [action, writeEnabled(action)]));
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
  if (!writeEnabled(action)) {
    const gate = ACTION_GATES[action] || 'RCON_WRITE_ENABLED';
    const error = new Error(`RCON ${action} writes are disabled. Enable ${gate}=true only after operator review.`);
    error.code = 'RCON_WRITE_DISABLED';
    error.gate = gate;
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
  const actionGates = getActionGates();
  return {
    configured: Boolean(String(process.env.RCON_HOST || '').trim() && String(process.env.RCON_PORT || '').trim() && String(process.env.RCON_PASSWORD || '')),
    writeEnabled: Object.values(actionGates).some(Boolean),
    legacyWriteEnabled: legacyWriteEnabled(),
    actionGates,
    supportedActions: Object.keys(COMMANDS),
  };
}

module.exports = {
  COMMANDS,
  ACTION_GATES,
  writeEnabled,
  getActionGates,
  validateMessage,
  validateSteamId,
  validateDensity,
  buildAction,
  execute,
  getState,
};
