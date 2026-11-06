"use strict";

const amounts = Object.freeze([500, 750, 1000, 1250, 1500, 2000, 3000]);
const rates = new Map([["supporter",10], ["guardian",20], ["legend",30]]);
const dayLength = 86400000;
const brisbaneOffset = 10 * 3600000;

// Queensland observes UTC+10 year-round. Use integer local dates so a late
// evening claim followed shortly by a midnight claim counts as two days.
function claimWindow(now) {
  const ordinal = Math.floor((now + brisbaneOffset) / dayLength);
  return { day: new Date(ordinal * dayLength).toISOString().slice(0,10),
    nextEligible: new Date((ordinal + 1) * dayLength - brisbaneOffset).toISOString() };
}

function quoteDailyReward(previous, now, entitledTier, graceEnabled = true) {
  const { day, nextEligible } = claimWindow(now);
  if (previous && previous.day >= day) return { eligible:false, day, nextEligible, claim:previous };
  let cycleDay = 1;
  let graceUsed = false;
  if (previous && previous.cycleDay < amounts.length) {
    const gap = (Date.parse(day) - Date.parse(previous.day)) / dayLength;
    if (gap === 1 || (gap === 2 && graceEnabled && !previous.graceUsed)) {
      cycleDay = previous.cycleDay + 1;
      graceUsed = previous.graceUsed || gap === 2;
    }
  }
  const percent = rates.get(entitledTier) || 0;
  const base = amounts[cycleDay - 1];
  const bonus = Math.round(base * percent / 100);
  return { eligible:true, day, nextEligible, cycleDay, graceUsed, base, percent, bonus, amount:base + bonus };
}

module.exports = { amounts, claimWindow, quoteDailyReward };
