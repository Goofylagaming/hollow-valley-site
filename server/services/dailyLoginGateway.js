"use strict";

const automation = require("./automationWebsiteClient");

// Streak rewards replace the old page-load bonus. The automation service
// answers the legacy claim with HTTP 503 while DAILY_LOGIN_REWARDS_ENABLED=1
// so that automatic payout cannot award a second set of coins. This gateway
// keeps that rule: page loads may read status, and only an explicit claim
// pays, through the same daily-login ledger key the supporter page uses.

function streakRewardsEnabled(env = process.env) {
  return env.DAILY_LOGIN_REWARDS_ENABLED === "1";
}

function rewardTier(userId) {
  const status = require("../db").getSupporterStatus(userId);
  return require("./membershipRewards").entitlement(status).tier;
}

function currentReward(streak) {
  if (streak && streak.eligible === false && streak.claim) return streak.claim;
  return streak || {};
}

function presentStreakStatus(streak) {
  const current = currentReward(streak);
  const amount = Number(current.amount) || 0;
  const base = Number(current.base ?? amount) || 0;
  const percent = Number(current.percent) || 0;
  const claimed = streak?.eligible === false;
  return {
    enabled: true,
    mode: "streak",
    automaticClaim: false,
    amount,
    baseAmount: base,
    effectiveAmount: amount,
    supporterMultiplier: percent > 0 ? 1 + percent / 100 : 1,
    supporterBonusCoins: Number(current.bonus) || 0,
    timezone: "Australia/Brisbane",
    dayKey: streak?.day || current.day || null,
    claimed,
    claimable: streak?.eligible === true && amount > 0,
    eligible: streak?.eligible === true,
    day: streak?.day || null,
    nextEligible: streak?.nextEligible || null,
    cycleDay: current.cycleDay ?? null,
    graceUsed: Boolean(current.graceUsed),
    graceEnabled: streak?.graceEnabled !== false,
    amounts: Array.isArray(streak?.amounts) ? streak.amounts : null,
    claim: streak?.claim || null,
    base,
    percent,
    bonus: Number(current.bonus) || 0,
  };
}

async function readWallet(steamId) {
  try {
    return await automation.getWallet(steamId);
  } catch {
    return null;
  }
}

async function readDailyLogin(user) {
  const steamId = String(user.steam_id);
  if (!streakRewardsEnabled()) return automation.getDailyLoginBonus(steamId);
  const streak = await automation.dailyLogin("status", { steamId, tier: rewardTier(user.id) });
  return presentStreakStatus(streak);
}

async function claimDailyLogin(user, { explicit = false } = {}) {
  const steamId = String(user.steam_id);
  if (!streakRewardsEnabled()) return automation.claimDailyLoginBonus(steamId);

  const tier = rewardTier(user.id);
  const before = await automation.dailyLogin("status", { steamId, tier });
  if (!explicit || before?.eligible !== true || !before.day) {
    const status = presentStreakStatus(before);
    return {
      ok: true,
      ...status,
      duplicate: true,
      amount: status.claimed ? status.amount : 0,
      automaticClaimSuppressed: !explicit,
      wallet: explicit ? await readWallet(steamId) : null,
    };
  }

  const after = await automation.dailyLogin("claim", { steamId, tier, day: before.day });
  const status = presentStreakStatus(after);
  const awarded = before.eligible === true && after?.eligible === false;
  return {
    ok: true,
    ...status,
    duplicate: !awarded,
    awarded,
    amount: awarded ? status.amount : (status.claimed ? status.amount : 0),
    automaticClaimSuppressed: false,
    wallet: await readWallet(steamId),
  };
}

module.exports = {
  streakRewardsEnabled,
  presentStreakStatus,
  readDailyLogin,
  claimDailyLogin,
};
