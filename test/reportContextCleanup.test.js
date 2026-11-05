'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {createReportContextCleanup, INTERVAL_MS} = require('../server/services/reportContextCleanup');

function fixture(env = {}) {
  let callback, calls = 0, timers = 0, clears = 0, unrefs = 0, failure = false;
  const warnings = [], handle = {unref() { unrefs++; }};
  const cleanup = createReportContextCleanup({env,
    getStore() { calls++; if (failure) throw Error('PRIVATE database path and report text'); return {purgeExpired() {}}; },
    setTimer(fn, delay) { assert.equal(delay, INTERVAL_MS); callback = fn; timers++; return handle; },
    clearTimer(value) { assert.equal(value, handle); clears++; },
    warn(message) { warnings.push(message); },
  });
  return {cleanup, env, tick: () => callback(), fail: value => {failure = value;},
    stats: () => ({calls, timers, clears, unrefs}), warnings};
}

test('default-off cleanup does not open a store, create a timer or initialize schema', () => {
  for (const flag of [undefined, '0', 'true']) {
    const f = fixture({PLAYER_REPORT_CONTEXT_RETENTION_CLEANUP_ENABLED: flag});
    f.cleanup.start()();
    assert.deepEqual(f.stats(), {calls:0, timers:0, clears:0, unrefs:0});
  }
});

test('enabled cleanup runs at startup and hourly, starts once and releases its timer on stop', () => {
  const f = fixture({PLAYER_REPORT_CONTEXT_RETENTION_CLEANUP_ENABLED:'1'});
  const stop = f.cleanup.start(); f.cleanup.start(); f.tick();
  assert.deepEqual(f.stats(), {calls:2, timers:1, clears:0, unrefs:1});
  stop(); stop(); f.tick();
  assert.deepEqual(f.stats(), {calls:2, timers:1, clears:1, unrefs:1});
  f.cleanup.start();
  assert.equal(f.stats().calls, 3);
  assert.equal(f.stats().timers, 2);
  f.cleanup.stop();
});

test('runtime disabling suppresses deletion and transient failures retry without private logging', () => {
  const f = fixture({PLAYER_REPORT_CONTEXT_RETENTION_CLEANUP_ENABLED:'1'});
  f.fail(true); f.cleanup.start();
  assert.equal(f.warnings.length,1); assert.doesNotMatch(f.warnings[0], /PRIVATE|database path|report text/);
  f.env.PLAYER_REPORT_CONTEXT_RETENTION_CLEANUP_ENABLED='0'; f.tick();
  assert.equal(f.stats().calls,1);
  f.env.PLAYER_REPORT_CONTEXT_RETENTION_CLEANUP_ENABLED='1'; f.fail(false); f.tick();
  assert.equal(f.stats().calls,2); assert.equal(f.warnings.length,1);
  f.cleanup.stop();
});
