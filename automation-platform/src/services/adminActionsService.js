const commandBridge = require('./commandBridgeService');

function validateSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('A valid 17-digit Steam ID is required');
  return steamId;
}

async function runImmediateCommand({ verb, steamId, tokens = [], timeoutMs = 7000 }) {
  const steam = validateSteamId(steamId);
  commandBridge.assertPublisherReady();
  const command = commandBridge.buildCommand(verb, steam, tokens);
  await commandBridge.queueCommand(command);

  const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 7000);
  do {
    const outcome = await commandBridge.readOutcome(command);
    if (outcome?.state === 'failed') {
      const error = new Error(outcome.message || `${verb} failed`);
      error.code = 'ADMIN_ACTION_COMMAND_FAILED';
      error.requestId = command.id;
      throw error;
    }
    if (outcome?.state === 'confirmed') {
      return { command, outcome };
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await new Promise((resolve) => setTimeout(resolve, Math.min(250, remaining)));
  } while (true);

  const error = new Error(`${verb} timed out waiting for AdminActions confirmation`);
  error.code = 'ADMIN_ACTION_COMMAND_TIMEOUT';
  error.requestId = command.id;
  throw error;
}

function slayPlayer({ steamId }) {
  return runImmediateCommand({
    verb: 'admin_slay',
    steamId: validateSteamId(steamId),
    tokens: [],
    timeoutMs: 7000,
  });
}

module.exports = {
  validateSteamId,
  runImmediateCommand,
  slayPlayer,
};
