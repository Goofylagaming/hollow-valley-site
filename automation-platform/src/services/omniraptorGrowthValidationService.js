// Read-only live Omniraptor observation for testing a future personal growth
// rate hook. This module MUST NOT modify pawn state, Game.ini, RCON or wallets.
const MAX_SAMPLE_AGE_MS = 75_000;
const GROWTH_TARGETS = Object.freeze(Array.from({ length: 10 }, (_, index) => index + 1));

function canonicalOmniraptor(value) {
  const species = String(value || '').trim().toLowerCase();
  return /^(?:bp_)?omniraptor(?:_c)?$/.test(species) ? 'omniraptor' : null;
}

function growthPercent(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  if (value <= 1) return Number((value * 100).toFixed(3));
  if (value <= 100) return Number(value.toFixed(3));
  return null;
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function projectSnapshot(snapshot, steamId, { nowMs = Date.now() } = {}) {
  if (!/^\d{17}$/.test(String(steamId || ''))) {
    throw new Error('Steam-linked administrator identity is required');
  }
  if (!Number.isFinite(nowMs)) throw new Error('Invalid current time');
  const base = {
    mode: 'read-only',
    gameMutationEnabled: false,
    perDinosaurGrowthSupported: false,
    allowedTargetMultipliers: GROWTH_TARGETS,
    player: { steamId: String(steamId), species: null, growthPercent: null },
    observedAt: null,
    sampleAgeSeconds: null,
    source: null,
    status: 'unknown',
  };
  if (!snapshot?.online || snapshot.configured === false) {
    return { ...base, status: 'server-unavailable' };
  }

  // The presence feed is authoritative for samples but can arrive stale.
  // Never treat cached status as a fresh sample unless its source timestamp
  // is recent. Do not trigger RCON polling from this admin tool.
  const observedMs = Date.parse(String(snapshot.checkedAt || ''));
  if (!Number.isFinite(observedMs) || observedMs > nowMs + 10_000) {
    return { ...base, status: 'unverified-timestamp' };
  }
  const ageMs = Math.max(0, nowMs - observedMs);
  const source = String(snapshot.source || 'unknown');
  const observedAt = new Date(observedMs).toISOString();
  const common = {
    ...base,
    observedAt,
    sampleAgeSeconds: Math.round(ageMs / 1000),
    source,
  };
  if (ageMs > MAX_SAMPLE_AGE_MS || snapshot.stale === true) {
    return { ...common, status: 'stale-snapshot' };
  }
  const players = Array.isArray(snapshot.players) ? snapshot.players : [];
  if (!players.some(player => String(player.steamId) === steamId)) {
    return { ...common, status: 'player-offline' };
  }
  const characters = Array.isArray(snapshot.characters) ? snapshot.characters : [];
  const character = characters.find(item => String(item.steamId) === steamId);
  if (!character) return { ...common, status: 'character-unverified' };
  const species = String(character.species || '').trim().slice(0, 120);
  if (!canonicalOmniraptor(species)) {
    return {
      ...common, status: 'not-omniraptor',
      player: { steamId, species: species || null, growthPercent: null },
    };
  }
  const percent = growthPercent(character.growth);
  const player = {
    steamId,
    species: 'Omniraptor',
    growthPercent: percent,
    // These are observation-only state indicators. The validation does not
    // assert they remain constant during normal gameplay.
    health: finiteOrNull(character.health),
    stamina: finiteOrNull(character.stamina),
    hunger: finiteOrNull(character.hunger),
    thirst: finiteOrNull(character.thirst),
    mutationCount: Array.isArray(character.mutations) ? character.mutations.length : null,
  };
  if (percent === null) return { ...common, player, status: 'growth-unavailable' };
  return { ...common, player, status: percent >= 99.95 ? 'fully-grown' : 'ready' };
}

module.exports = {
  GROWTH_TARGETS, MAX_SAMPLE_AGE_MS, canonicalOmniraptor, growthPercent, projectSnapshot,
};
