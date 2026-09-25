const commandBridge = require('./commandBridgeService');
const store = require('./automationStore');
const statusService = require('./statusService');
const bodyDropDiets = require('../config/bodyDropDiets');

const DEFAULT_DROP_TYPES = [
  { id: 'small', name: 'Small body', description: 'A small emergency food drop.', species: 'Compsognathus', growth: 1 },
  { id: 'medium', name: 'Medium body', description: 'A balanced body drop for a small group.', species: 'Dryosaurus', growth: 1 },
  { id: 'large', name: 'Large body', description: 'A larger drop for bigger carnivores or packs.', species: 'Triceratops', growth: 1 },
];

const BODYDROP_MAX_GROWTH_PERCENT = 60;
const GLOBAL_BODYDROP_MAX_FOOD_PERCENT = 30;
const GLOBAL_BODYDROP_DROP_TYPE = 'small';
const CARNIVORE_SPECIES = [
  'Allosaurus',
  'Austroraptor',
  'Baryonyx',
  'Carnotaurus',
  'Ceratosaurus',
  'Compsognathus',
  'Deinosuchus',
  'Dilophosaurus',
  'Herrerasaurus',
  'Omniraptor',
  'Omnoraptor',
  'Pteranodon',
  'Troodon',
  'Tyrannosaurus',
  'Utahraptor',
];

let globalBodyDropEnabled = false;
let globalBodyDropRun = null;

function normalizeSpecies(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isCarnivoreSpecies(value) {
  const normalized = normalizeSpecies(value);
  if (!normalized) return false;
  return CARNIVORE_SPECIES.some((species) => normalized.includes(normalizeSpecies(species)));
}

function percentValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return numeric <= 1 ? numeric * 100 : numeric;
}

function growthPercent(value) {
  return percentValue(value);
}

function foodPercent(value) {
  return percentValue(value);
}

function bodyDropEligibility(character) {
  if (!character) {
    return { eligible: false, reason: 'You must be spawned in-game to request a body drop.' };
  }

  const species = String(character.species || 'Unknown');
  if (!isCarnivoreSpecies(species)) {
    return { eligible: false, reason: 'Body drops are only available to carnivores.', species };
  }

  const percent = growthPercent(character.growth);
  if (percent === null) {
    return {
      eligible: false,
      reason: 'Your dinosaur growth could not be verified. Try again after the next server sync.',
      species,
    };
  }

  if (percent > BODYDROP_MAX_GROWTH_PERCENT) {
    return {
      eligible: false,
      reason: `Body drops are only available at ${BODYDROP_MAX_GROWTH_PERCENT}% growth or below. Your ${species} is ${Math.round(percent)}%.`,
      species,
      growthPercent: percent,
    };
  }

  return {
    eligible: true,
    reason: null,
    species,
    growthPercent: percent,
    maxGrowthPercent: BODYDROP_MAX_GROWTH_PERCENT,
  };
}

function globalBodyDropEligibility(character) {
  const base = bodyDropEligibility(character);
  if (!base.eligible) return base;

  const food = foodPercent(character?.hunger);
  if (food === null) {
    return {
      ...base,
      eligible: false,
      reason: 'Food level could not be verified for the global emergency drop.',
      foodPercent: null,
    };
  }

  if (food > GLOBAL_BODYDROP_MAX_FOOD_PERCENT) {
    return {
      ...base,
      eligible: false,
      reason: `Global emergency drops require ${GLOBAL_BODYDROP_MAX_FOOD_PERCENT}% food or below.`,
      foodPercent: food,
    };
  }

  const location = character?.location;
  if (!location || !['x', 'y', 'z'].every((axis) => Number.isFinite(location[axis]))) {
    return {
      ...base,
      eligible: false,
      reason: 'A live player position is required for the global emergency drop.',
      foodPercent: food,
    };
  }

  return {
    ...base,
    eligible: true,
    foodPercent: food,
    maxFoodPercent: GLOBAL_BODYDROP_MAX_FOOD_PERCENT,
  };
}

function getCooldownSeconds() {
  const value = Number(process.env.BODYDROP_COOLDOWN_SECONDS);
  return Number.isFinite(value) && value >= 0 ? value : 600;
}

function getGlobalBodyDropStaggerMs() {
  const value = Number(process.env.GLOBAL_BODYDROP_STAGGER_MS);
  return Number.isFinite(value) && value >= 0 ? Math.min(30000, value) : 2500;
}

function getDropTypes() {
  const raw = process.env.BODYDROP_TYPES;
  if (!raw) return DEFAULT_DROP_TYPES;
  const parsed = raw.split(',').map((entry) => {
    const [id, name, description, species, growth] = entry.split(':').map((part) => part?.trim());
    if (!/^[a-z0-9_-]{2,32}$/i.test(id || '') || !species) return null;
    const growthNumber = Number(growth);
    return {
      id,
      name: name || id,
      description: description || 'Body drop request.',
      species,
      growth: Number.isFinite(growthNumber) && growthNumber > 0 ? Math.min(1, growthNumber) : 1,
    };
  }).filter(Boolean);
  return parsed.length ? parsed : DEFAULT_DROP_TYPES;
}

function parseSqliteDate(value) {
  if (!value) return null;
  const timestamp = Date.parse(`${String(value).replace(' ', 'T')}Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function cooldownForRequest(latest, now = Date.now()) {
  if (!latest) return { active: false, remainingSeconds: 0, latest: null };
  if (['preparing', 'queued', 'acknowledged', 'unknown'].includes(latest.status)) {
    return { active: true, reason: 'pending', remainingSeconds: null, latest };
  }
  if (['failed', 'cancelled'].includes(latest.status)) {
    return { active: false, reason: null, remainingSeconds: 0, latest };
  }

  const createdAt = parseSqliteDate(latest.created_at);
  if (!createdAt) return { active: false, remainingSeconds: 0, latest };
  const remainingSeconds = Math.max(0, Math.ceil((createdAt + getCooldownSeconds() * 1000 - now) / 1000));
  return {
    active: remainingSeconds > 0,
    reason: remainingSeconds > 0 ? 'cooldown' : null,
    remainingSeconds,
    nextAvailableAt: remainingSeconds > 0 ? new Date(createdAt + getCooldownSeconds() * 1000).toISOString() : null,
    latest,
  };
}

function getCooldown(steamId, now = Date.now()) {
  return cooldownForRequest(store.getLatestForSteam(steamId, 'bodydrop'), now);
}

function assertBodyDropAvailable(steamId) {
  const cooldown = getCooldown(steamId);
  if (!cooldown.active) return cooldown;

  const error = new Error(
    cooldown.reason === 'pending'
      ? 'A body drop request is already awaiting reconciliation'
      : 'Body drop is still on cooldown'
  );
  error.code = 'BODYDROP_COOLDOWN';
  error.cooldown = cooldown;
  throw error;
}

async function getBodyDropState(steamId) {
  steamId = String(steamId || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('A valid 17-digit Steam ID is required');

  const cooldown = getCooldown(steamId);
  const snapshot = await statusService.getServerSnapshot();
  if (!snapshot.online) {
    return {
      steamId,
      serverOnline: false,
      cooldown,
      eligibility: { eligible: false, reason: null },
      restrictions: {
        carnivoreOnly: true,
        maxGrowthPercent: BODYDROP_MAX_GROWTH_PERCENT,
      },
    };
  }

  const character = snapshot.characters.find((entry) => entry.steamId === steamId);
  const eligibility = bodyDropEligibility(character);
  const diet = character ? bodyDropDiets.dietForSpecies(character.species) : null;
  const options = character && diet
    ? bodyDropDiets.optionsForSpecies(character.species, character.growth)
    : [];
  const corpseGrowth = character && diet ? bodyDropDiets.scaleCorpseGrowth(character.growth) : null;
  const dietEligibility = {
    eligible: Boolean(eligibility.eligible && diet),
    configured: Boolean(diet),
    reason: !character
      ? 'You must be spawned in-game to request a body drop.'
      : !eligibility.eligible
        ? eligibility.reason
        : !diet
          ? `BodyDrop diet support is not configured for ${character.species || 'this dinosaur'} yet.`
          : null,
  };
  return {
    steamId,
    serverOnline: true,
    cooldown,
    eligibility,
    dietEligibility,
    requester: character ? {
      species: character.species || null,
      growthPercent: growthPercent(character.growth),
      foodPercent: foodPercent(character.hunger),
    } : null,
    dietVersion: bodyDropDiets.DIET_VERSION,
    options,
    corpseGrowth,
    corpseGrowthPercent: corpseGrowth === null ? null : Math.round(corpseGrowth * 100),
    restrictions: {
      carnivoreOnly: true,
      maxGrowthPercent: BODYDROP_MAX_GROWTH_PERCENT,
      dietValidated: true,
      corpseGrowthScalePercent: 75,
      corpseGrowthMinPercent: 15,
      corpseGrowthMaxPercent: 40,
    },
  };
}

async function requestBodyDrop({ steamId, dropType, maxFoodPercent = null }) {
  steamId = String(steamId || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('A valid 17-digit Steam ID is required');

  const selectedDropType = String(dropType || '').trim();
  if (!/^[a-z0-9_-]{2,64}$/i.test(selectedDropType)) throw new Error('Unknown body drop type');

  assertBodyDropAvailable(steamId);

  const snapshot = await statusService.getServerSnapshot({ force: true });
  if (!snapshot.online) throw new Error(snapshot.error || 'The Isle server is not online or RCON is unavailable');
  const character = snapshot.characters.find((entry) => entry.steamId === steamId);
  const eligibility = bodyDropEligibility(character);
  if (!eligibility.eligible) {
    const error = new Error(eligibility.reason);
    error.code = 'BODYDROP_INELIGIBLE';
    error.eligibility = eligibility;
    throw error;
  }

  const legacyOption = getDropTypes().find((item) => item.id === selectedDropType) || null;
  const allowedOptions = bodyDropDiets.optionsForSpecies(character.species, character.growth);
  const dietOption = allowedOptions.find((item) => item.id === selectedDropType) || null;
  const option = dietOption || legacyOption;
  if (!option) {
    const error = new Error(`That body is not configured for the current ${eligibility.species} diet.`);
    error.code = 'BODYDROP_DIET_MISMATCH';
    error.eligibility = eligibility;
    error.allowedDropTypes = allowedOptions.map((item) => item.id);
    throw error;
  }
  const requestMode = dietOption ? 'species-diet' : 'legacy';

  let requesterFoodPercent = foodPercent(character?.hunger);
  if (maxFoodPercent !== null) {
    const maxFood = Number(maxFoodPercent);
    if (!Number.isFinite(maxFood) || maxFood < 0 || maxFood > 100) throw new Error('Invalid maximum food percentage');
    if (requesterFoodPercent === null || requesterFoodPercent > maxFood) {
      const error = new Error(`Global emergency drops require ${Math.round(maxFood)}% food or below.`);
      error.code = 'BODYDROP_INELIGIBLE';
      error.eligibility = {
        ...eligibility,
        eligible: false,
        foodPercent: requesterFoodPercent,
        maxFoodPercent: maxFood,
      };
      throw error;
    }
  }

  const location = character?.location;
  if (!location || !['x', 'y', 'z'].every((axis) => Number.isFinite(location[axis]))) {
    throw new Error('Player must be spawned in-game with a live RCON position before requesting a body drop');
  }

  // RCON lookup is asynchronous. Re-check immediately before creating the
  // ledger entry so two simultaneous requests cannot both pass the first
  // cooldown check and publish duplicate drops.
  assertBodyDropAvailable(steamId);

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
      requestMode,
      nutrient: option.nutrient || null,
      nutrientLabel: option.nutrientLabel || null,
      species: option.species,
      growth: option.growth,
      requesterSpecies: eligibility.species,
      requesterGrowthPercent: eligibility.growthPercent,
      requesterFoodPercent,
      location,
      command,
    },
  });

  try {
    await commandBridge.queueCommand(command);
    return store.updateRequest(command.id, {
      status: 'queued',
      message: 'BodyDrop command published to CommandBridge; awaiting acknowledgement/result.',
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

function globalRunIsActive() {
  return Boolean(globalBodyDropRun && globalBodyDropRun.status === 'running');
}

function getGlobalBodyDropState() {
  return {
    enabled: globalBodyDropEnabled,
    defaultOff: true,
    running: globalRunIsActive(),
    dropType: GLOBAL_BODYDROP_DROP_TYPE,
    staggerMs: getGlobalBodyDropStaggerMs(),
    criteria: {
      carnivoreOnly: true,
      maxGrowthPercent: BODYDROP_MAX_GROWTH_PERCENT,
      maxFoodPercent: GLOBAL_BODYDROP_MAX_FOOD_PERCENT,
      requiresLivePosition: true,
      respectsPlayerCooldown: true,
      stagedDietRollout: true,
    },
    lastRun: globalBodyDropRun ? { ...globalBodyDropRun } : null,
  };
}

function setGlobalBodyDropEnabled(enabled) {
  const next = enabled === true;
  if (next && globalRunIsActive()) {
    const error = new Error('A global emergency BodyDrop run is already in progress');
    error.code = 'GLOBAL_BODYDROP_RUNNING';
    throw error;
  }
  globalBodyDropEnabled = next;
  return getGlobalBodyDropState();
}

function getGlobalBodyDropCandidates(snapshot) {
  const seen = new Set();
  const candidates = [];

  for (const character of snapshot?.characters || []) {
    const steamId = String(character?.steamId || '').trim();
    if (!/^\d{17}$/.test(steamId) || seen.has(steamId)) continue;
    seen.add(steamId);

    const eligibility = globalBodyDropEligibility(character);
    if (!eligibility.eligible) continue;

    const cooldown = getCooldown(steamId);
    if (cooldown.active) continue;

    candidates.push({
      steamId,
      species: eligibility.species,
      growthPercent: eligibility.growthPercent,
      foodPercent: eligibility.foodPercent,
      dropType: GLOBAL_BODYDROP_DROP_TYPE,
    });
  }

  return candidates;
}

async function activateGlobalBodyDrop() {
  if (!globalBodyDropEnabled) {
    const error = new Error('Global emergency BodyDrop is OFF. Enable it before activating a run.');
    error.code = 'GLOBAL_BODYDROP_DISABLED';
    throw error;
  }
  if (globalRunIsActive()) {
    const error = new Error('A global emergency BodyDrop run is already in progress');
    error.code = 'GLOBAL_BODYDROP_RUNNING';
    throw error;
  }

  // Fail closed: every activation is one-shot and immediately returns the
  // feature to OFF so a second run always requires a fresh admin enable.
  globalBodyDropEnabled = false;

  const snapshot = await statusService.getServerSnapshot({ force: true });
  if (!snapshot.online) {
    const error = new Error(snapshot.error || 'The Isle server is not online or the live player snapshot is unavailable');
    error.code = 'GLOBAL_BODYDROP_SERVER_OFFLINE';
    throw error;
  }

  const candidates = getGlobalBodyDropCandidates(snapshot);
  const run = {
    startedAt: new Date().toISOString(),
    finishedAt: candidates.length ? null : new Date().toISOString(),
    status: candidates.length ? 'running' : 'completed',
    eligibleCount: candidates.length,
    scheduledCount: candidates.length,
    completedCount: 0,
    queuedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    lastError: null,
  };
  globalBodyDropRun = run;

  const staggerMs = getGlobalBodyDropStaggerMs();
  candidates.forEach((candidate, index) => {
    const timer = setTimeout(async () => {
      try {
        await requestBodyDrop({
          steamId: candidate.steamId,
          dropType: GLOBAL_BODYDROP_DROP_TYPE,
          maxFoodPercent: GLOBAL_BODYDROP_MAX_FOOD_PERCENT,
        });
        run.queuedCount += 1;
      } catch (error) {
        if (error.code === 'BODYDROP_COOLDOWN' || error.code === 'BODYDROP_INELIGIBLE') {
          run.skippedCount += 1;
        } else {
          run.failedCount += 1;
          run.lastError = error.message || String(error);
        }
      } finally {
        run.completedCount += 1;
        if (run.completedCount >= run.scheduledCount) {
          run.status = 'completed';
          run.finishedAt = new Date().toISOString();
        }
      }
    }, index * staggerMs);
    timer.unref?.();
  });

  return getGlobalBodyDropState();
}

async function reconcileBodyDrops() {
  if (process.env.COMMAND_BRIDGE_ENABLED !== 'true') return { checked: 0, changed: 0 };
  const requests = store.listRequests({ kind: 'bodydrop', statuses: ['queued', 'acknowledged', 'unknown'], limit: 200 });
  if (!requests.length) return { checked: 0, changed: 0 };

  const unknownAfterMs = Math.max(10, Number(process.env.BODYDROP_UNKNOWN_AFTER_SECONDS || 60)) * 1000;
  let changed = 0;

  for (const request of requests) {
    const command = request.details?.command;
    if (!command) continue;
    const outcome = await commandBridge.readOutcome(command);
    if (outcome) {
      const nextStatus = outcome.state;
      if (request.status !== nextStatus || request.message !== outcome.message) changed += 1;
      store.updateRequest(request.id, {
        status: nextStatus,
        message: outcome.message,
        error: outcome.state === 'failed' ? outcome.message : null,
      });
      continue;
    }

    const createdAt = parseSqliteDate(request.created_at);
    if (request.status === 'queued' && createdAt && Date.now() - createdAt >= unknownAfterMs) {
      changed += 1;
      store.updateRequest(request.id, {
        status: 'unknown',
        message: 'No matching CommandBridge acknowledgement/result yet. Do not retry until this request is reconciled.',
      });
    }
  }

  return { checked: requests.length, changed };
}

function startBodyDropReconciler() {
  const intervalMs = Math.max(2000, Number(process.env.BODYDROP_RECONCILE_INTERVAL_MS || 5000));
  const timer = setInterval(() => {
    reconcileBodyDrops().catch((error) => console.warn('[bodydrop-reconcile]', error.message));
  }, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  BODYDROP_MAX_GROWTH_PERCENT,
  GLOBAL_BODYDROP_MAX_FOOD_PERCENT,
  assertBodyDropAvailable,
  bodyDropEligibility,
  globalBodyDropEligibility,
  cooldownForRequest,
  growthPercent,
  foodPercent,
  isCarnivoreSpecies,
  getCooldown,
  getDropTypes,
  getDietCatalog: bodyDropDiets.catalog,
  getDietOptionsForSpecies: bodyDropDiets.optionsForSpecies,
  scaleCorpseGrowth: bodyDropDiets.scaleCorpseGrowth,
  getBodyDropState,
  requestBodyDrop,
  getGlobalBodyDropState,
  setGlobalBodyDropEnabled,
  getGlobalBodyDropCandidates,
  activateGlobalBodyDrop,
  reconcileBodyDrops,
  startBodyDropReconciler,
};
