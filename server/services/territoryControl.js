const CONTROL_CONTRIBUTOR_CAP = 4;
const ADVANTAGE_BONUS_PER_MINUTE = 3;

function count(value) {
  const number = Math.floor(Number(value) || 0);
  return Math.max(0, number);
}

function effectivePresence(value, cap = CONTROL_CONTRIBUTOR_CAP) {
  return Math.min(count(value), Math.max(1, count(cap) || CONTROL_CONTRIBUTOR_CAP));
}

function resolveMomentumRate(momentumRate) {
  if (momentumRate !== undefined && momentumRate !== null) {
    const explicit = Number(momentumRate);
    return Number.isFinite(explicit) ? explicit : 0;
  }

  try {
    // Lazy-load keeps the pure scoring helper usable in isolation while letting
    // the live runtime pick up the one active war's verified kill momentum.
    const territoryMomentum = require('./territoryMomentum');
    return Number(territoryMomentum.liveMomentum().ratePerMinute) || 0;
  } catch {
    // Momentum is a bonus signal, never a reason to stop capture processing.
    return 0;
  }
}

function controlRatePerMinute({ attackers = 0, defenders = 0, contributorCap = CONTROL_CONTRIBUTOR_CAP, momentumRate } = {}) {
  const effectiveAttackers = effectivePresence(attackers, contributorCap);
  const effectiveDefenders = effectivePresence(defenders, contributorCap);

  let presenceRate = effectiveAttackers - effectiveDefenders;
  if (effectiveAttackers > effectiveDefenders) presenceRate += ADVANTAGE_BONUS_PER_MINUTE;
  else if (effectiveDefenders > effectiveAttackers) presenceRate -= ADVANTAGE_BONUS_PER_MINUTE;

  const momentum = resolveMomentumRate(momentumRate);
  const rate = presenceRate + momentum;

  return {
    rate,
    presenceRate,
    momentumRate: momentum,
    attackers: count(attackers),
    defenders: count(defenders),
    effectiveAttackers,
    effectiveDefenders,
    contributorCap: Math.max(1, count(contributorCap) || CONTROL_CONTRIBUTOR_CAP),
    contested: effectiveAttackers > 0 && effectiveDefenders > 0,
  };
}

function normalizeControlScore(value, fallback = -100) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(-100, Math.min(100, numeric));
}

function advanceControlScore({
  score = -100,
  attackers = 0,
  defenders = 0,
  elapsedSeconds = 0,
  contributorCap = CONTROL_CONTRIBUTOR_CAP,
  momentumRate,
} = {}) {
  const current = normalizeControlScore(score, 0);
  const seconds = Math.max(0, Math.min(60, Number(elapsedSeconds) || 0));
  const state = controlRatePerMinute({ attackers, defenders, contributorCap, momentumRate });
  const next = Math.max(-100, Math.min(100, current + (state.rate * seconds / 60)));
  return {
    ...state,
    previousScore: current,
    score: Math.round(next * 10) / 10,
    elapsedSeconds: seconds,
  };
}

module.exports = {
  CONTROL_CONTRIBUTOR_CAP,
  ADVANTAGE_BONUS_PER_MINUTE,
  effectivePresence,
  resolveMomentumRate,
  controlRatePerMinute,
  normalizeControlScore,
  advanceControlScore,
};
