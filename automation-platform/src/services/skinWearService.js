const bridge = require('./commandBridgeService');
const skinPresets = require('./skinPresetService');
const statusService = require('./statusService');
const store = require('./economyStore');

function timeoutMs() {
  const value = Number(process.env.SKIN_WEAR_TIMEOUT_MS || 12000);
  return Math.max(1000, Math.min(25000, Number.isFinite(value) ? value : 12000));
}

function encodeColor(name, color) {
  return `${name}=${['r','g','b','a'].map((channel) => Number(color[channel]).toFixed(6)).join(',')}`;
}

function buildWearTokens(preset, targetSpecies = null) {
  const skin = skinPresets.sanitizeSkin(preset.skin);
  const universal = String(preset.species || '').toLowerCase() === 'universal';
  const paletteOnly = universal || /fangs\s*&\s*ferns/i.test(String(preset.description || ''));
  const species = skinPresets.validateSpecies(targetSpecies || preset.species);
  return [
    `preset=${preset.id}`,
    `species=${species}`,
    ...skinPresets.COLOR_KEYS.map((key) => encodeColor(key, skin[key])),
    `variation=${skin.skinVariation}`,
    `pattern=${skin.patternIndex}`,
    `theme=${skin.themeIndex}`,
    ...(paletteOnly ? ['preserveIndices=1'] : []),
  ];
}

async function wearPreset({ steamId, presetId }) {
  if (!skinPresets.liveWearEnabled()) {
    const error = new Error('Live skin wearing is disabled');
    error.code = 'SKIN_LIVE_WEAR_DISABLED';
    throw error;
  }

  const preset = skinPresets.getPresetForPlayer(steamId, presetId);
  let targetSpecies = null;
  let activeCharacter = null;
  let snapshot = null;
  try {
    snapshot = await statusService.getServerSnapshot();
    activeCharacter = (snapshot?.characters || []).find(
      (entry) => String(entry?.steamId || '') === String(steamId)
    ) || null;
  } catch {
    // A non-universal skin can still be sent to the game-side validator when
    // presence is temporarily unavailable. Universal skins still require it.
  }

  if (String(preset.species || '').toLowerCase() === 'universal') {
    if (!snapshot?.online) {
      const error = new Error('The game server must be online to equip a universal skin.');
      error.code = 'SKIN_SERVER_OFFLINE';
      throw error;
    }
    if (!activeCharacter?.species) {
      const error = new Error('Spawn a dinosaur in game before equipping a universal skin.');
      error.code = 'SKIN_ACTIVE_DINO_REQUIRED';
      throw error;
    }
    targetSpecies = activeCharacter.species;
  }

  const resolvedSpecies = skinPresets.validateSpecies(targetSpecies || preset.species);
  const safeSkin = skinPresets.sanitizeSkin(preset.skin);
  const lifeMarker = activeCharacter ? {
    species: activeCharacter.species || resolvedSpecies,
    growth: Number.isFinite(Number(activeCharacter.growth)) ? Number(activeCharacter.growth) : null,
    gender: activeCharacter.gender || null,
    capturedAt: new Date().toISOString(),
  } : {
    species: resolvedSpecies,
    growth: null,
    gender: null,
    capturedAt: new Date().toISOString(),
  };

  const command = bridge.buildCommand('skin_apply', steamId, buildWearTokens(preset, targetSpecies));
  store.createSkinApplyJob({
    id: command.id,
    steamId,
    presetId: preset.id,
    species: resolvedSpecies,
    skin: safeSkin,
    lifeMarker,
  });

  try {
    await bridge.queueCommand(command);
  } catch (error) {
    store.updateSkinApplyJob({
      id: command.id,
      status: 'failed',
      error: error.message || 'Could not queue Skin Studio command',
      completed: true,
    });
    throw error;
  }

  const deadline = Date.now() + timeoutMs();
  while (Date.now() < deadline) {
    const outcome = await bridge.readOutcome(command);
    if (outcome?.state === 'confirmed') {
      store.updateSkinApplyJob({
        id: command.id,
        status: 'verified',
        completed: true,
      });
      store.upsertSkinLiveAssignment({
        steamId,
        presetId: preset.id,
        species: resolvedSpecies,
        skin: safeSkin,
        lifeMarker,
        requestId: command.id,
        status: 'verified',
        source: 'wear_live',
      });
      return {
        accepted: true,
        confirmed: true,
        persisted: true,
        requestId: command.id,
        message: outcome.message,
        source: outcome.source,
        preset,
      };
    }
    if (outcome?.state === 'failed') {
      store.updateSkinApplyJob({
        id: command.id,
        status: 'failed',
        error: outcome.message || 'SkinStudio rejected the skin',
        completed: true,
      });
      const error = new Error(outcome.message || 'SkinStudio rejected the skin');
      error.code = 'SKIN_WEAR_FAILED';
      error.requestId = command.id;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }

  store.updateSkinApplyJob({
    id: command.id,
    status: 'awaiting_confirmation',
    error: 'Timed out waiting for game-side confirmation',
  });

  return {
    accepted: true,
    confirmed: false,
    persisted: false,
    requestId: command.id,
    message: 'Skin request queued. The game server has not confirmed application yet.',
    preset,
  };
}

module.exports = { buildWearTokens, wearPreset, timeoutMs };
