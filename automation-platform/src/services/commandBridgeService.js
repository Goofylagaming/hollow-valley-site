const { randomUUID } = require('node:crypto');
const fileBridge = require('../adapters/fileBridge');

const SOURCES = {
  bd: 'BodyDrop',
  dino_store: 'DinoStorage',
  dino_retrieve: 'DinoStorage',
  dino_list: 'DinoStorage',
};

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

async function queueCommand(command) {
  if (process.env.COMMAND_BRIDGE_ENABLED !== 'true') {
    throw new Error('COMMAND_BRIDGE_ENABLED must be true before queueing game actions');
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
  const text = await fileBridge.readResultsText();
  return findOutcome(text, command);
}

module.exports = {
  SOURCES,
  buildCommand,
  queueCommand,
  readOutcome,
  findOutcome,
};
