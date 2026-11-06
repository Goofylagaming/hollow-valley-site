'use strict';

const INTERVAL_MS = 60 * 60 * 1000;

function createReportContextCleanup({
  env = process.env,
  getStore = () => require('./reportContextSnapshots').getDefaultStore(),
  setTimer = setInterval,
  clearTimer = clearInterval,
  warn = message => console.warn(message),
} = {}) {
  let timer = null;
  function tick() {
    if (timer === null || env.PLAYER_REPORT_CONTEXT_RETENTION_CLEANUP_ENABLED !== '1') return;
    try { getStore().purgeExpired(); }
    catch { warn('[report-context] Expired-copy cleanup failed; it will retry on the next scheduled run.'); }
  }
  function stop() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }
  function start() {
    if (timer !== null || env.PLAYER_REPORT_CONTEXT_RETENTION_CLEANUP_ENABLED !== '1') return stop;
    timer = setTimer(tick, INTERVAL_MS);
    timer.unref?.();
    tick();
    return stop;
  }
  return { start, stop };
}

const cleanup = createReportContextCleanup();
module.exports = { createReportContextCleanup, start: cleanup.start, INTERVAL_MS };
