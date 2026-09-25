const { randomUUID } = require('node:crypto');
const fileBridge = require('../adapters/fileBridge');
const httpBridge = require('./commandBridgeHttpService');

const SOURCES = {
  bd: 'BodyDrop',
  dino_store: 'DinoStorage',
  dino_retrieve: 'DinoStorage',
  dino_list: 'DinoStorage',
  dino_grant: 'DinoStorage',
  dino_delete: 'DinoStorage',
  dino_edit: 'DinoStorage',
  prime_grant: 'DinoStorage',
  skin_apply: 'SkinStudio',
};
const PUBLISHER_ACK = 'automation-platform-is-sole-publisher';

function getTransport() {
  const transport = String(process.env.COMMAND_BRIDGE_TRANSPORT || 'file').trim().toLowerCase();
  if (!['file', 'http_pull'].includes(transport)) {
    throw new Error('COMMAND_BRIDGE_TRANSPORT must be file or http_pull');
  }
  return transport;
}

function transportConfigured() {
  if (getTransport() === 'http_pull') {
    return Boolean(String(process.env.BINARYLANE_COMMAND_TOKEN || '').trim());
  }
  return Boolean(
    String(process.env.SFTP_HOST || '').trim() &&
    String(process.env.SFTP_PORT || '').trim() &&
    String(process.env.SFTP_USER || '').trim() &&
    String(process.env.SFTP_PASSWORD || '').trim() &&
    String(process.env.SFTP_BASE_PATH || '').trim()
  );
}

function buildCommand(verb, steamId, tokens = []) {
  if (!Object.hasOwn(SOURCES, verb)) throw new Error(`Unsupported CommandBridge verb: ${verb}`);
  if (!/^\d{17}$/.test(String(steamId || ''))) throw new Error('A valid 17-digit Steam ID is required');
  if (!Array.isArray(tokens) || tokens.some((token) => typeof token !== 'string' || /["\\\x00-\x1f]/.test(token))) {
    throw new Error('CommandBridge tokens must be strings without quotes, backslashes or control characters');
  }
  return {
    id: randomUUID(),
    ts: Math.floor(Date.now() / 1000),
    verb,
    steam: String(steamId),
    args: { args: tokens },
  };
}

function assertPublisherReady() {
  if (process.env.COMMAND_BRIDGE_ENABLED !== 'true') {
    throw new Error('COMMAND_BRIDGE_ENABLED must be true before queueing game actions');
  }
  if (String(process.env.COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK || '').trim() !== PUBLISHER_ACK) {
    throw new Error(`CommandBridge publishing is locked until COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK=${PUBLISHER_ACK}. Confirm the live website no longer publishes directly to commands.ndjson before setting it.`);
  }
  return true;
}

async function queueCommand(command) {
  assertPublisherReady();

  if (getTransport() === 'http_pull') {
    if (!transportConfigured()) {
      throw new Error('BINARYLANE_COMMAND_TOKEN must be configured for COMMAND_BRIDGE_TRANSPORT=http_pull');
    }
    httpBridge.enqueue(command, SOURCES[command.verb]);
    return command;
  }

  await fileBridge.publishCommandLine(JSON.stringify(command));
  return command;
}

function parseCompleteLines(text) {
  if (!text) return [];
  const end = text.lastIndexOf('\n');
  const safe = end >= 0 ? text.slice(0, end + 1) : '';
  return safe.split('\n').filter((line) => line.trim()).map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error('CommandBridge results contain malformed NDJSON');
    }
  });
}

function findOutcome(text, command) {
  let acknowledged = false;
  for (const result of parseCompleteLines(text)) {
    if (!result || result.id !== command.id || result.steam !== command.steam) continue;
    if (typeof result.ok !== 'boolean' || typeof result.msg !== 'string') {
      throw new Error('CommandBridge result has an invalid ok/msg schema');
    }

    if (result.source === SOURCES[command.verb]) {
      return {
        state: result.ok ? 'confirmed' : 'failed',
        ok: result.ok,
        acknowledged: true,
        source: result.source,
        message: result.msg,
      };
    }

    if (result.source === undefined && result.verb === command.verb) {
      if (!result.ok) {
        return {
          state: 'failed',
          ok: false,
          acknowledged: true,
          source: 'CommandBridge',
          message: result.msg,
        };
      }
      acknowledged = true;
    }
  }
  return acknowledged
    ? { state: 'acknowledged', ok: false, acknowledged: true, source: 'CommandBridge', message: 'CommandBridge accepted the request; sub-mod result is still pending.' }
    : null;
}

async function readOutcome(command) {
  if (getTransport() === 'http_pull') {
    const row = httpBridge.getRequest(command.id);
    if (!row || row.steam !== command.steam || row.verb !== command.verb || !row.result_json) return null;
    return findOutcome(`${row.result_json}\n`, command);
  }

  const text = await fileBridge.readResultsText();
  return findOutcome(text, command);
}

async function getBridgeHealth() {
  const enabled = process.env.COMMAND_BRIDGE_ENABLED === 'true';
  const transport = getTransport();

  if (!enabled) {
    return {
      enabled: false,
      configured: transportConfigured(),
      connected: false,
      transport,
      queueBusy: false,
      error: null,
    };
  }

  if (transport === 'http_pull') {
    const configured = transportConfigured();
    const summary = httpBridge.getSummary();
    return {
      enabled: true,
      configured,
      connected: configured,
      transport,
      queueBusy: summary.pending > 0 || summary.dispatched > 0 || summary.acknowledged > 0,
      summary,
      error: configured ? null : 'BINARYLANE_COMMAND_TOKEN is not configured',
    };
  }

  return {
    ...(await fileBridge.getBridgeHealth()),
    transport,
  };
}

module.exports = {
  SOURCES,
  PUBLISHER_ACK,
  getTransport,
  transportConfigured,
  buildCommand,
  assertPublisherReady,
  queueCommand,
  readOutcome,
  findOutcome,
  getBridgeHealth,
};
