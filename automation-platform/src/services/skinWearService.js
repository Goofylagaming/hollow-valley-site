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

async function reconcileWearState(steamId) {
  const latest = store.getLatestSkinApplyJob(steamId);
  if (!latest) {
    return {
      assignment: store.getSkinLiveAssignment(steamId),
      latestJob: null,
    };
  }

  if (['queued', 'awaiting_confirmation'].includes(String(latest.status || ''))) {
    const command = {
      id: latest.id,
      steam: String(steamId),
      verb: 'skin_apply',
    };

    try {
      const outcome = await bridge.readOutcome(command);
      if (outcome?.state === 'confirmed') {
        store.updateSkinApplyJob({
          id: latest.id,
          status: 'verified',
          completed: true,
        });
        store.upsertSkinLiveAssignment({
          steamId,
          presetId: latest.preset_id,
          species: latest.species,
          skin: latest.skin,
          lifeMarker: latest.lifeMarker,
          requestId: latest.id,
          status: 'verified',
          source: 'wear_live',
        });
      } else if (outcome?.state === 'failed') {
        store.updateSkinApplyJob({
          id: latest.id,
          status: 'failed',
          error: outcome.message || 'SkinStudio rejected the skin',
          completed: true,
        });
      }
    } catch {
      // Status reads are best-effort. Keep the prior job state if the bridge
      // cannot be checked right now instead of turning a read into a new error.
    }
  }

  return {
    assignment: store.getSkinLiveAssignment(steamId),
    latestJob: store.getLatestSkinApplyJob(steamId),
  };
}

async function getWearState(steamId) {
  const state = await reconcileWearState(steamId);
  const assignment = state.assignment;
  const latestJob = state.latestJob;

  return {
    assignment: assignment ? {
      presetId: assignment.preset_id,
      species: assignment.species,
      status: assignment.status,
      source: assignment.source,
      requestId: assignment.request_id,
      appliedAt: assignment.applied_at,
      verifiedAt: assignment.verified_at,
      lifeMarker: assignment.lifeMarker,
    } : null,
    latestJob: latestJob ? {
      id: latestJob.id,
      presetId: latestJob.preset_id,
      species: latestJob.species,
      status: latestJob.status,
      error: latestJob.error || null,
      attempts: latestJob.attempts,
      createdAt: latestJob.created_at,
      updatedAt: latestJob.updated_at,
      completedAt: latestJob.completed_at,
      lifeMarker: latestJob.lifeMarker,
    } : null,
  };
}

async function retryLastWear(steamId) {
  const state = await reconcileWearState(steamId);
  const latest = state.latestJob;
  if (!latest?.preset_id) {
    const error = new Error('There is no previous Wear Live request to retry.');
    error.code = 'SKIN_WEAR_RETRY_NOT_FOUND';
    throw error;
  }
  if (latest.status === 'verified') {
    const error = new Error('Your most recent Wear Live request is already verified.');
    error.code = 'SKIN_WEAR_ALREADY_VERIFIED';
    throw error;
  }
  if (latest.status !== 'failed') {
    const updatedAt = Date.parse(String(latest.updated_at || latest.created_at || '').replace(' ', 'T') + 'Z');
    const stale = Number.isFinite(updatedAt) && Date.now() - updatedAt > 60000;
    if (!stale) {
      const error = new Error('Your Wear Live request is still pending. Refresh the status before retrying.');
      error.code = 'SKIN_WEAR_STILL_PENDING';
      throw error;
    }
  }
  return wearPreset({ steamId, presetId: latest.preset_id });
}

async function resetFailedWear(steamId) {
  const state = await reconcileWearState(steamId);
  const latest = state.latestJob;
  if (!latest) {
    const error = new Error('There is no Wear Live request to reset.');
    error.code = 'SKIN_WEAR_RESET_NOT_FOUND';
    throw error;
  }
  if (latest.status !== 'failed') {
    const error = new Error('Only failed Wear Live requests can be reset.');
    error.code = 'SKIN_WEAR_RESET_NOT_FAILED';
    throw error;
  }
  store.dismissSkinApplyJob(latest.id);
  return getWearState(steamId);
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

module.exports = {
  buildWearTokens,
  wearPreset,
  getWearState,
  retryLastWear,
  resetFailedWear,
  reconcileWearState,
  timeoutMs,
};
