"use strict";
const MAX_LEVEL = 999, PLAYTIME_XP_PER_5_MINUTES = 10, PLAYTIME_INTERVAL_MINUTES = 5;
function xpToReachLevel(level) {
  const target = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)));
  const steps = target - 1;
  return steps * 250 + 25 * steps * (steps - 1);
}
function levelFromXp(xp) {
  const total = Math.max(0, Math.floor(Number(xp) || 0));
  let low = 1, high = MAX_LEVEL;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (xpToReachLevel(mid) <= total) low = mid; else high = mid - 1;
  }
  return low;
}
module.exports = { MAX_LEVEL, PLAYTIME_XP_PER_5_MINUTES, PLAYTIME_INTERVAL_MINUTES, xpToReachLevel, levelFromXp };
