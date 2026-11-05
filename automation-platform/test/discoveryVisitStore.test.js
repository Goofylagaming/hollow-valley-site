const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createDiscoveryCatalogStore } = require('../src/services/discoveryCatalog');
const { createDiscoveryVisitStore } = require('../src/services/discoveryVisitStore');

test('visits require consecutive trusted samples and retain private idempotent receipts', () => {
  const db = new DatabaseSync(':memory:');
  let clock = 1000000;
  const steam = '76561198000000801';
  try {
    createDiscoveryCatalogStore(db).register({ version: 'v1', mapVersion: 'fixture', bounds: { minX: -100000, maxX: 100000, minY: -100000, maxY: 100000 }, regions: [{ id: 'north', name: 'North' }], points: [
      { id: 'first', name: 'First', category: 'cave', regionId: 'north', enabled: true, x: 0, y: 0, radiusMetres: 50 },
      { id: 'hidden', name: 'Secret landmark', category: 'landmark', regionId: 'north', enabled: true, x: 90000, y: 90000, radiusMetres: 50 }
    ] });
    let visits = createDiscoveryVisitStore(db, { now: () => clock, enabled: () => true });
    const sample = (location, lifeId = 'life') => visits.observe({ steamId: steam, version: 'v1', lifeId, at: clock, location });
    sample({ x: 0, y: 0 });
    assert.equal(visits.discovered(steam, 'v1').points.length, 0);
    clock += 10000; sample(null); clock += 10000; sample({ x: 0, y: 0 });
    assert.equal(visits.discovered(steam, 'v1').points.length, 0);
    clock += 10000; assert.equal(sample({ x: 0, y: 0 }).discovered, 1);
    assert.equal(sample({ x: 0, y: 0 }).recorded, false);
    visits = createDiscoveryVisitStore(db, { now: () => clock, enabled: () => true });
    clock += 10000; assert.equal(sample({ x: 0, y: 0 }).discovered, 0);
    const result = visits.discovered(steam, 'v1');
    assert.equal(result.total, 2); assert.equal(result.points.length, 1);
    assert.equal(JSON.stringify(result).includes('Secret landmark'), false);
    assert.equal(visits.discovered('76561198000000802', 'v1').points.length, 0);
    clock += 10000; assert.equal(sample({ x: 90000, y: 90000 }, 'new-life').discovered, 0);
    clock += 121000; visits.prune();
    assert.equal(db.prepare('SELECT COUNT(*) n FROM discovery_last_samples').get().n, 0);
    assert.equal(visits.discovered(steam, 'v1').points.length, 1);
  } finally { db.close(); }
});
