const bridge = require('./commandBridgeService');
const skinPresets = require('./skinPresetService');

function timeoutMs() {
  const value = Number(process.env.SKIN_WEAR_TIMEOUT_MS || 12000);
  return Math.max(1000, Math.min(25000, Number.isFinite(value) ? value : 12000));
}

function encodeColor(name, color) {
  return `${name}=${['r','g','b','a'].map((channel) => Number(color[channel]).toFixed(6)).join(',')}`;
}

function buildWearTokens(preset) {
  const skin = skinPresets.sanitizeSkin(preset.skin);
  return [
    `preset=${preset.id}`,
    `species=${skinPresets.validateSpecies(preset.species)}`,
    ...skinPresets.COLOR_KEYS.map((key) => encodeColor(key, skin[key])),
    `variation=${skin.skinVariation}`,
    `pattern=${skin.patternIndex}`,
    `theme=${skin.themeIndex}`,
  ];
}

async function wearPreset({ steamId, presetId }) {
  if (!skinPresets.liveWearEnabled()) {
    const error = new Error('Live skin wearing is disabled');
    error.code = 'SKIN_LIVE_WEAR_DISABLED';
    throw error;
  }

  const preset = skinPresets.getPresetForPlayer(steamId, presetId);
  const command = bridge.buildCommand('skin_apply', steamId, buildWearTokens(preset));
  await bridge.queueCommand(command);

  const deadline = Date.now() + timeoutMs();
  while (Date.now() < deadline) {
    const outcome = await bridge.readOutcome(command);
    if (outcome?.state === 'confirmed') {
      return {
        accepted: true,
        confirmed: true,
        requestId: command.id,
        message: outcome.message,
        source: outcome.source,
        preset,
      };
    }
    if (outcome?.state === 'failed') {
      const error = new Error(outcome.message || 'SkinStudio rejected the skin');
      error.code = 'SKIN_WEAR_FAILED';
      error.requestId = command.id;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  return {
    accepted: true,
    confirmed: false,
    requestId: command.id,
    message: 'Skin request queued. The game server has not confirmed application yet.',
    preset,
  };
}

module.exports = { buildWearTokens, wearPreset, timeoutMs };
