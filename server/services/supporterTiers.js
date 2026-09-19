const TIERS = Object.freeze({
  supporter: Object.freeze({ label: "Valley Supporter", priceAud: 7, multiplier: 2 }),
  guardian: Object.freeze({ label: "Valley Guardian", priceAud: 15, multiplier: 3 }),
  legend: Object.freeze({ label: "Valley Legend", priceAud: 25, multiplier: 5 }),
});

const LEGACY_TIER_ALIASES = Object.freeze({
  member: "supporter",
  elite: "guardian",
  supporter: "supporter",
  guardian: "guardian",
  legend: "legend",
});

const PRICE_ENV_CANDIDATES = Object.freeze({
  supporter: Object.freeze(["STRIPE_PRICE_SUPPORTER", "STRIPE_PRICE_MEMBER"]),
  guardian: Object.freeze(["STRIPE_PRICE_GUARDIAN", "STRIPE_PRICE_ELITE"]),
  legend: Object.freeze(["STRIPE_PRICE_LEGEND"]),
});

function normalizeTier(value) {
  const key = String(value || "").trim().toLowerCase();
  return Object.hasOwn(LEGACY_TIER_ALIASES, key) ? LEGACY_TIER_ALIASES[key] : null;
}

function tierInfo(value) {
  const tier = normalizeTier(value);
  return tier ? TIERS[tier] : null;
}

function supporterMultiplier(value) {
  return tierInfo(value)?.multiplier || 1;
}

function stripePriceId(value, env = process.env) {
  const tier = normalizeTier(value);
  if (!tier) return null;
  for (const name of PRICE_ENV_CANDIDATES[tier]) {
    const candidate = String(env[name] || "").trim();
    if (/^price_[A-Za-z0-9]+$/.test(candidate)) return candidate;
  }
  return null;
}

function tierFromStripePriceId(priceId, env = process.env) {
  const candidate = String(priceId || "");
  for (const tier of Object.keys(TIERS)) {
    if (stripePriceId(tier, env) === candidate) return tier;
  }
  return null;
}

module.exports = {
  TIERS,
  LEGACY_TIER_ALIASES,
  PRICE_ENV_CANDIDATES,
  normalizeTier,
  tierInfo,
  supporterMultiplier,
  stripePriceId,
  tierFromStripePriceId,
};
