"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { quoteDailyReward: quote } = require("../src/services/dailyLoginRewards");
const before = Date.parse("2026-11-05T13:59:59.999Z");
const day = 86400000;

test("Brisbane midnight opens the next day and yesterday's tier cannot change today's receipt", () => {
  const first = quote(null,before,"legend");
  assert.equal(first.amount,650);
  assert.equal(first.nextEligible,"2026-11-05T14:00:00.000Z");
  assert.deepEqual(quote(first,before,"guardian").claim,first);
  assert.equal(quote(first,before+1,"supporter").amount,825);
});

test("one missed day pauses the cycle, a second gap resets it, and day seven renews grace", () => {
  let receipt = quote(null,before,null);
  receipt = quote(receipt,before+2*day,"guardian");
  assert.equal(receipt.amount,900);
  assert.equal(receipt.graceUsed,true);
  assert.equal(quote(receipt,before+4*day,null).cycleDay,1);
  for (let i=3;i<=7;i++) receipt = quote(receipt,before+i*day,null);
  assert.equal(receipt.cycleDay,7);
  const restarted = quote(receipt,before+8*day,null);
  assert.equal(restarted.cycleDay,1);
  assert.equal(restarted.graceUsed,false);
  assert.equal(quote(restarted,before+10*day,null,false).cycleDay,1);
});
test("cutover preserves a legacy same-day receipt and prevents a second or multiplied payout", () => {
  process.env.AUTOMATION_DB_PATH=":memory:";
  process.env.DAILY_LOGIN_REWARDS_ENABLED="1";
  process.env.WALLET_DAILY_LOGIN_BONUS_ENABLED="true";
  const old = require("../src/services/dailyLoginBonusService");
  const wallet = require("../src/services/economyStore");
  const daily = require("../src/services/dailyLoginWallet");
  const id="76561198000000621", day="2026-11-05";
  assert.equal(old.enabled(),false);
  wallet.applyWalletTransaction({steamId:id,amount:1000,kind:"daily_login_bonus",reason:"legacy",
    idempotencyKey:"daily-login:"+id+":"+day,referenceId:day});
  const result=daily.claimDaily(id,"legend",day,before);
  assert.equal(result.eligible,false);
  assert.equal(result.claim.legacy,true);
  assert.equal(wallet.getWallet(id).balance,1000);
});
