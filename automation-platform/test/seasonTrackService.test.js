"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
process.env.AUTOMATION_DB_PATH = ':memory:';
delete process.env.SEASON_TRACK_ENABLED; delete process.env.SEASON_TRACK_MANAGEMENT_ENABLED;
delete process.env.SEASON_TRACK_MAINTENANCE_ENABLED;
const service = require('../src/services/seasonTrackService');
test('runtime flags alone never initialize season schema or install source triggers', () => {
  const economyPath = require.resolve('../src/services/economyStore');
  assert.equal(require.cache[economyPath], undefined);
  assert.throws(service.get, { status: 503 }); assert.equal(require.cache[economyPath], undefined);
  process.env.SEASON_TRACK_ENABLED = '1';
  assert.throws(service.get, { status: 503 });
  const economy = require(economyPath);
  try {
    assert.equal(economy.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name LIKE 'progression_season_%'").get().n, 0);
    require('../src/services/progressionService');
    require('../src/services/seasonTrackStore').createSeasonTrackStore(economy.db);
    process.env.SEASON_TRACK_ENABLED = '0'; process.env.SEASON_TRACK_MANAGEMENT_ENABLED = '1';
    const store = service.get(); assert.equal(store.catalog().items.length, 0);
    process.env.SEASON_TRACK_READ_ONLY = '1'; assert.throws(() => store.erase('synthetic-season', '76561198000000401'), { status: 403 });
    delete process.env.SEASON_TRACK_READ_ONLY;
    let clock = Date.now() - 10 * 86400000;
    const { describe, createSeasonTrackStore } = require('../src/services/seasonTrackStore');
    const operator = createSeasonTrackStore(economy.db, { now: () => clock });
    const def = { id: 'synthetic-expired-runtime', title: 'Synthetic expired runtime season', startsAt: new Date(clock + 86400000).toISOString(), endsAt: new Date(clock + 2 * 86400000).toISOString(), settlesAt: new Date(clock + 3 * 86400000).toISOString(), retainUntil: new Date(clock + 4 * 86400000).toISOString(), free: true,
      sources: [{ source: 'quest', policy: 'achievement-time' }], tiers: [{ xp: 10, title: 'Synthetic milestone' }] }, digest = describe(def).digest;
    operator.stage(def, { reviewer: '76561198000000401', digest }); operator.changeState(def.id, { action: 'publish', reviewer: '76561198000000401', digest, expectedRevision: 1 });
    clock = Date.parse(def.startsAt); operator.enroll(def.id, '76561198000000401');
    delete process.env.SEASON_TRACK_MANAGEMENT_ENABLED; process.env.SEASON_TRACK_MAINTENANCE_ENABLED = '1';
    assert.throws(service.get, { status: 503 });
    assert.equal(service.maintain().removed, 1, 'cleanup runs without collection, website access, player reads or telemetry');
    delete process.env.SEASON_TRACK_MAINTENANCE_ENABLED;
  } finally { economy.db.close(); }
});
test('maintenance scheduling is independent of tracking, single-instance and disabled on a read-only deployment', () => {
  delete process.env.SEASON_TRACK_ENABLED; delete process.env.SEASON_TRACK_MANAGEMENT_ENABLED;
  assert.deepEqual(service.maintain(), { skipped: true }); assert.equal(service.start(), null);
  process.env.SEASON_TRACK_MAINTENANCE_ENABLED = '1'; process.env.SEASON_TRACK_READ_ONLY = '1';
  let calls = 0, cancelled = 0, callback;
  const timer = { unref() {} };
  const options = { schedule(fn, ms) { calls++; callback = fn; assert.equal(ms, 60000); return timer; }, cancel(value) { assert.equal(value, timer); cancelled++; }, report() { throw new Error('Read-only maintenance must skip without errors'); } };
  assert.equal(service.start(options), timer); assert.equal(service.start(options), timer); assert.equal(calls, 1);
  callback(); assert.deepEqual(service.maintain(), { skipped: true });
  service.stop(); assert.equal(cancelled, 1);
});
