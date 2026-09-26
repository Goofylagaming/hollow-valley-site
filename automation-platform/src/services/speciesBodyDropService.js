const commandBridge = require('./commandBridgeService');
const store = require('./automationStore');
const statusService = require('./statusService');
const baseBodyDrop = require('./bodyDropService');
const bodyDropDiets = require('../config/bodyDropDiets');

function validateSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('A valid 17-digit Steam ID is required');
  return steamId;
}

function validateDropType(value) {
  const dropType = String(value || '').trim();
  if (!/^[a-z0-9_-]{2,64}$/i.test(dropType)) throw new Error('Unknown body drop type');
  return dropType;
}

function characterForSteam(snapshot, steamId) {
  return (snapshot?.characters || []).find((entry) => String(entry?.steamId || '') === steamId) || null;
}

function dietStateForCharacter(character, eligibility) {
  const diet = character ? bodyDropDiets.dietForSpecies(character.species) : null;
  const options = character && diet
    ? bodyDropDiets.optionsForSpecies(character.species, character.growth)
    : [];
  const corpseGrowth = character && diet ? bodyDropDiets.scaleCorpseGrowth(character.growth) : null;

  return {
    diet,
    options,
    corpseGrowth,
    corpseGrowthPercent: corpseGrowth === null ? null : Math.round(corpseGrowth * 100),
    dietEligibility: {
      eligible: Boolean(eligibility?.eligible && diet),
      configured: Boolean(diet),
      reason: !character
        ? 'You must be spawned in-game to request a body drop.'
        : !eligibility?.eligible
          ? eligibility?.reason || 'BodyDrop is not available for this dinosaur.'
          : !diet
            ? `BodyDrop diet support is not configured for ${character.species || 'this dinosaur'} yet.`
            : null,
    },
  };
}

async function getBodyDropState(steamId) {
  steamId = validateSteamId(steamId);

  const base = await baseBodyDrop.getBodyDropState(steamId);
  if (base.serverOnline === false) {
    return {
      ...base,
      dietVersion: bodyDropDiets.DIET_VERSION,
      dietEligibility: { eligible: false, configured: false, reason: null },
      requester: null,
      options: [],
      corpseGrowth: null,
      corpseGrowthPercent: null,
      restrictions: {
        ...(base.restrictions || {}),
        dietValidated: true,
        corpseGrowthScalePercent: 75,
        corpseGrowthMinPercent: 15,
        corpseGrowthMaxPercent: 40,
      },
    };
  }

  const snapshot = await statusService.getServerSnapshot();
  const character = characterForSteam(snapshot, steamId);
  const eligibility = baseBodyDrop.bodyDropEligibility(character);
  const dietState = dietStateForCharacter(character, eligibility);

  return {
    ...base,
    eligibility,
    dietEligibility: dietState.dietEligibility,
    requester: character ? {
      species: character.species || null,
      growthPercent: baseBodyDrop.growthPercent(character.growth),
      foodPercent: baseBodyDrop.foodPercent(character.hunger),
    } : null,
    dietVersion: bodyDropDiets.DIET_VERSION,
    options: dietState.options,
    corpseGrowth: dietState.corpseGrowth,
    corpseGrowthPercent: dietState.corpseGrowthPercent,
    restrictions: {
      ...(base.restrictions || {}),
      dietValidated: true,
      corpseGrowthScalePercent: 75,
      corpseGrowthMinPercent: 15,
      corpseGrowthMaxPercent: 40,
    },
  };
}

async function requestBodyDrop({ steamId, dropType }) {
  steamId = validateSteamId(steamId);
  dropType = validateDropType(dropType);

  baseBodyDrop.assertBodyDropAvailable(steamId);

  const snapshot = await statusService.getServerSnapshot({ force: true });
  if (!snapshot.online) {
    throw new Error(snapshot.error || 'The Isle server is not online or RCON is unavailable');
  }

  const character = characterForSteam(snapshot, steamId);
  const eligibility = baseBodyDrop.bodyDropEligibility(character);
  if (!eligibility.eligible) {
    const error = new Error(eligibility.reason);
    error.code = 'BODYDROP_INELIGIBLE';
    error.eligibility = eligibility;
    throw error;
  }

  const allOptions = bodyDropDiets.optionsForSpecies(character.species, character.growth);
  const requestedOption = allOptions.find((entry) => entry.id === dropType) || null;
  const allowedOptions = allOptions.filter((entry) => entry.available !== false);
  const option = requestedOption?.available === false ? null : requestedOption;
  if (!option) {
    const diet = bodyDropDiets.dietForSpecies(character.species);
    const error = new Error(
      requestedOption?.available === false
        ? requestedOption.unavailableReason || 'That diet item cannot be spawned by BodyDrop yet.'
        : diet
          ? `That body is not configured for the current ${eligibility.species} diet.`
          : `BodyDrop diet support is not configured for ${eligibility.species} yet.`
    );
    error.code = 'BODYDROP_DIET_MISMATCH';
    error.eligibility = eligibility;
    error.allowedDropTypes = allowedOptions.map((entry) => entry.id);
    throw error;
  }

  const location = character?.location;
  if (!location || !['x', 'y', 'z'].every((axis) => Number.isFinite(location[axis]))) {
    throw new Error('Player must be spawned in-game with a live RCON position before requesting a body drop');
  }

  // Re-check after the live snapshot so simultaneous requests cannot both pass.
  baseBodyDrop.assertBodyDropAvailable(steamId);

  const command = commandBridge.buildCommand('bd', steamId, [
    'spawn',
    option.species,
    String(location.x),
    String(location.y),
    String(location.z),
    String(option.growth),
    steamId,
  ]);

  store.createRequest({
    id: command.id,
    kind: 'bodydrop',
    steamId,
    status: 'preparing',
    commandId: command.id,
    details: {
      dropType: option.id,
      requestMode: 'species-diet',
      dietVersion: bodyDropDiets.DIET_VERSION,
      nutrient: option.nutrient,
      nutrientLabel: option.nutrientLabel,
      species: option.species,
      growth: option.growth,
      requesterSpecies: eligibility.species,
      requesterGrowthPercent: eligibility.growthPercent,
      requesterFoodPercent: baseBodyDrop.foodPercent(character?.hunger),
      location,
      command,
    },
  });

  try {
    await commandBridge.queueCommand(command);
    return store.updateRequest(command.id, {
      status: 'queued',
      message: `${option.nutrientLabel} diet body (${option.species}) queued for BodyDrop.`,
      error: null,
    });
  } catch (error) {
    store.updateRequest(command.id, {
      status: 'failed',
      message: null,
      error: error.message,
    });
    throw error;
  }
}

function getDietCatalog() {
  return bodyDropDiets.catalog();
}

module.exports = {
  getBodyDropState,
  requestBodyDrop,
  getDietCatalog,
  _private: {
    characterForSteam,
    dietStateForCharacter,
    validateDropType,
    validateSteamId,
  },
};
