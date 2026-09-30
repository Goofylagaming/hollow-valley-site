const commandBridge = require('./commandBridgeService');

function validateSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('A valid 17-digit Steam ID is required');
  return steamId;
}

function validateSource(value, { allowBoth = false, optional = true } = {}) {
  const source = String(value || '').trim().toLowerCase();
  if (!source && optional) return null;
  const allowed = allowBoth ? ['completed', 'pending', 'both'] : ['completed', 'pending'];
  if (!allowed.includes(source)) {
    throw new Error(`Safe Log recovery source must be ${allowed.join(' or ')}`);
  }
  return source;
}

async function runImmediateCommand({ verb, steamId, tokens = [], timeoutMs = 10000 }) {
  const steam = validateSteamId(steamId);
  commandBridge.assertPublisherReady();
  const command = commandBridge.buildCommand(verb, steam, tokens);
  await commandBridge.queueCommand(command);

  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 10000);
  do {
    const outcome = await commandBridge.readOutcome(command);
    if (outcome?.state === 'failed') {
      const error = new Error(outcome.message || `${verb} failed`);
      error.code = 'SAFELOG_COMMAND_FAILED';
      error.requestId = command.id;
      throw error;
    }
    if (outcome?.state === 'confirmed') return { command, outcome };
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, remaining)));
  } while (true);

  const error = new Error(`${verb} timed out waiting for Safe Log recovery confirmation`);
  error.code = 'SAFELOG_COMMAND_TIMEOUT';
  error.requestId = command.id;
  throw error;
}

async function getRecovery({ steamId, source = null }) {
  const steam = validateSteamId(steamId);
  const selectedSource = validateSource(source);
  const result = await runImmediateCommand({
    verb: 'safelog_get',
    steamId: steam,
    tokens: selectedSource ? [selectedSource] : [],
  });

  let recovery = null;
  try {
    recovery = JSON.parse(result.outcome.message);
  } catch (error) {
    throw new Error(`Safe Log recovery returned invalid JSON: ${error.message}`);
  }

  if (recovery !== null && (typeof recovery !== 'object' || Array.isArray(recovery))) {
    throw new Error('Safe Log recovery returned an invalid record');
  }
  return { recovery, outcome: result.outcome };
}

async function restoreRecovery({ steamId, source = null }) {
  const steam = validateSteamId(steamId);
  const selectedSource = validateSource(source);
  return runImmediateCommand({
    verb: 'safelog_restore',
    steamId: steam,
    tokens: selectedSource ? [selectedSource] : [],
    timeoutMs: 12000,
  });
}

async function clearRecovery({ steamId, source = 'both' }) {
  const steam = validateSteamId(steamId);
  const selectedSource = validateSource(source, { allowBoth: true, optional: false });
  return runImmediateCommand({
    verb: 'safelog_clear',
    steamId: steam,
    tokens: [selectedSource],
  });
}

module.exports = {
  validateSteamId,
  validateSource,
  runImmediateCommand,
  getRecovery,
  restoreRecovery,
  clearRecovery,
};
