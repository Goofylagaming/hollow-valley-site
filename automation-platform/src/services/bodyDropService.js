const fileBridge = require('../adapters/fileBridge');
const commandBridge = require('./commandBridgeService');
const store = require('./automationStore');
const { getServerSnapshot } = require('./statusService');

const DEFAULT_DROP_TYPES = [
  { id: 'small', name: 'Small body', description: 'A small emergency food drop.', species: 'Compsognathus', growth: 1 },
  { id: 'medium', name: 'Medium body', description: 'A balanced body drop for a small group.', species: 'Dryosaurus', growth: 1 },
  { id: 'large', name: 'Large body', description: 'A larger drop for bigger carnivores or packs.', species: 'Triceratops', growth: 1 },
];

const BODYDROP_MAX_GROWTH_PERCENT = 60;
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

function normalizeSpecies(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isCarnivoreSpecies(value) {
  const normalized = normalizeSpecies(value);
  if (!normalized) return false;
  return CARNIVORE_SPECIES.some((species) => normalized.includes(normalizeSpecies(species)));
}

function growthPercent(value) {
  if (value === null || value === undefined || value === '') return null;
  const growth = Number(value);
  if (!Number.isFinite(growth) || growth < 0) return null;
  return growth <= 1 ? growth * 100 : growth;
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

function getCooldownSeconds() {
  const value = Number(process.env.BODYDROP_COOLDOWN_SECONDS);
  return Number.isFinite(value) && value >= 0 ? value : 900;
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

function getCooldown(steamId, now = Date.now()) {
  const latest = store.getLatestForSteam(steamId, 'bodydrop');
  if (!latest) return { active: false, remainingSeconds: 0, latest: null };
  if (['preparing', 'queued', 'acknowledged', 'unknown'].includes(latest.status)) {
    return { active: true, reason: 'pending', remainingSeconds: null, latest };
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

async function requestBodyDrop({ steamId, dropType }) {
  steamId = String(steamId || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('A valid 17-digit Steam ID is required');

  const option = getDropTypes().find((item) => item.id === String(dropType || '').trim());
  if (!option) throw new Error('Unknown body drop type');

  const cooldown = getCooldown(steamId);
  if (cooldown.active) {
    const error = new Error(cooldown.reason === 'pending' ? 'A body drop request is already awaiting reconciliation' : 'Body drop is still on cooldown');
    error.code = 'BODYDROP_COOLDOWN';
    error.cooldown = cooldown;
    throw error;
  }

  const snapshot = await getServerSnapshot({ force: true });
  if (!snapshot.online) throw new Error(snapshot.error || 'The Isle server is not online or RCON is unavailable');
  const character = snapshot.characters.find((entry) => entry.steamId === steamId);
  const eligibility = bodyDropEligibility(character);
  if (!eligibility.eligible) {
    const error = new Error(eligibility.reason);
    error.code = 'BODYDROP_INELIGIBLE';
    error.eligibility = eligibility;
    throw error;
  }

  const location = character?.location;
  if (!location || !['x', 'y', 'z'].every((axis) => Number.isFinite(location[axis]))) {
    throw new Error('Player must be spawned in-game with a live RCON position before requesting a body drop');
  }

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
      species: option.species,
      growth: option.growth,
      requesterSpecies: eligibility.species,
      requesterGrowthPercent: eligibility.growthPercent,
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

async function reconcileBodyDrops() {
  if (process.env.COMMAND_BRIDGE_ENABLED !== 'true') return { checked: 0, changed: 0 };
  const requests = store.listRequests({ kind: 'bodydrop', statuses: ['queued', 'acknowledged', 'unknown'], limit: 200 });
  if (!requests.length) return { checked: 0, changed: 0 };

  const resultsText = await fileBridge.readResultsText();
  const unknownAfterMs = Math.max(10, Number(process.env.BODYDROP_UNKNOWN_AFTER_SECONDS || 60)) * 1000;
  let changed = 0;

  for (const request of requests) {
    const command = request.details?.command;
    if (!command) continue;
    const outcome = commandBridge.findOutcome(resultsText, command);
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
  bodyDropEligibility,
  growthPercent,
  isCarnivoreSpecies,
  getCooldown,
  getDropTypes,
  requestBodyDrop,
  reconcileBodyDrops,
  startBodyDropReconciler,
};
