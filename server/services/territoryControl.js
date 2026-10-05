const CONTROL_CONTRIBUTOR_CAP = 4;
const ADVANTAGE_BONUS_PER_MINUTE = 3;

function count(value) {
  const number = Math.floor(Number(value) || 0);
  return Math.max(0, number);
}

function effectivePresence(value, cap = CONTROL_CONTRIBUTOR_CAP) {
  return Math.min(count(value), Math.max(1, count(cap) || CONTROL_CONTRIBUTOR_CAP));
}

function controlRatePerMinute({ attackers = 0, defenders = 0, contributorCap = CONTROL_CONTRIBUTOR_CAP, momentumRate = 0 } = {}) {
  const effectiveAttackers = effectivePresence(attackers, contributorCap);
  const effectiveDefenders = effectivePresence(defenders, contributorCap);

  let presenceRate = effectiveAttackers - effectiveDefenders;
  if (effectiveAttackers > effectiveDefenders) presenceRate += ADVANTAGE_BONUS_PER_MINUTE;
  else if (effectiveDefenders > effectiveAttackers) presenceRate -= ADVANTAGE_BONUS_PER_MINUTE;

  const momentum = Number.isFinite(Number(momentumRate)) ? Number(momentumRate) : 0;
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

function advanceControlScore({
  score = -100,
  attackers = 0,
  defenders = 0,
  elapsedSeconds = 0,
  contributorCap = CONTROL_CONTRIBUTOR_CAP,
  momentumRate = 0,
} = {}) {
  const current = Math.max(-100, Math.min(100, Number(score) || 0));
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
  controlRatePerMinute,
  advanceControlScore,
};
