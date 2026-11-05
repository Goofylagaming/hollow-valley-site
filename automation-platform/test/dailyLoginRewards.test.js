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
