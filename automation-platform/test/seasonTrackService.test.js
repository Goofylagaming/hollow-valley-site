"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
process.env.AUTOMATION_DB_PATH = ':memory:';
delete process.env.SEASON_TRACK_ENABLED; delete process.env.SEASON_TRACK_MANAGEMENT_ENABLED;
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
  } finally { economy.db.close(); }
});
