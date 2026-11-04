"use strict";

const { normalizeTier, tierInfo } = require("./supporterTiers");

// DinoStorage is unlimited for every player. Keep the legacy field at zero
// so older callers cannot accidentally turn storage capacity into a paid perk.
const BENEFITS = Object.freeze({
  supporter: Object.freeze({ storageBonusSlots: 0, monthlySkinChoices: 1, frameId: "supporter-fern" }),
  guardian: Object.freeze({ storageBonusSlots: 0, monthlySkinChoices: 2, frameId: "guardian-river" }),
  legend: Object.freeze({ storageBonusSlots: 0, monthlySkinChoices: 3, frameId: "legend-gold" }),
});

function enabled(env = process.env) {
  return /^(1|true|yes)$/i.test(String(env.MEMBERSHIP_REWARDS_ENABLED || "").trim());
}

function timestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  // SQLite timestamps are UTC even though they omit the timezone suffix.
  const text = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)
    ? value.replace(" ", "T") + "Z" : value;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function entitlement(status, { now = Date.now(), env = process.env } = {}) {
  const tier = normalizeTier(status?.tier);
  const until = timestamp(status?.renews_at);
  // A scheduled cancellation keeps these paid benefits until the verified
  // period end. Coin eligibility intentionally uses its existing stricter rule.
  const entitled = Boolean(enabled(env) && tier && status?.stripe_status === "active" &&
    until !== null && until > now);
  return {
    entitled,
    tier: entitled ? tier : null,
    tierLabel: entitled ? tierInfo(tier).label : null,
    expiresAt: until === null ? null : new Date(until).toISOString(),
    storageBonusSlots: entitled ? BENEFITS[tier].storageBonusSlots : 0,
    monthlySkinChoices: entitled ? BENEFITS[tier].monthlySkinChoices : 0,
  };
}

module.exports = { BENEFITS, enabled, timestamp, entitlement };
