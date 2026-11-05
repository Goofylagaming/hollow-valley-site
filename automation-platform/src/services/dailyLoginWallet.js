"use strict";

const economy = require("./economyStore");
const { amounts, quoteDailyReward } = require("./dailyLoginRewards");

function dailyStatus(steamId, tier, now = Date.now()) {
  const id = economy.validateSteamId(steamId);
  const previous = economy.db.prepare(`SELECT metadata_json FROM economy_wallet_ledger
    WHERE steam_id=? AND kind='daily_login_reward' ORDER BY reference_id DESC LIMIT 1`).get(id);
  return { ...quoteDailyReward(previous ? JSON.parse(previous.metadata_json) : null,
    now, tier, process.env.DAILY_LOGIN_GRACE_ENABLED !== "0"), amounts };
}

function claimDaily(steamId, tier, expectedDay, now = Date.now()) {
  const quote = dailyStatus(steamId, tier, now);
  if (quote.day !== expectedDay || !quote.eligible) return quote;
  const key = "daily-login:" + steamId + ":" + quote.day;
  try {
    economy.applyWalletTransaction({ steamId, amount:quote.amount, kind:"daily_login_reward",
      reason:"Daily login reward", idempotencyKey:key, referenceType:"brisbane_day",
      referenceId:quote.day, metadata:quote });
  } catch (error) {
    if (!economy.getLedgerByIdempotency(key)) throw error;
  }
  return dailyStatus(steamId,tier,now);
}

module.exports = { dailyStatus, claimDaily };
