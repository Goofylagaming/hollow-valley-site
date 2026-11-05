const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createDiscoveryCatalogStore } = require('../src/services/discoveryCatalog');
const { createDiscoveryVisitStore } = require('../src/services/discoveryVisitStore');

test('accepted snapshots commit discovery with consent and roll it back with the enclosing transaction', () => {
  const saved = [process.env.POI_DISCOVERY_ENABLED, process.env.POI_DISCOVERY_CATALOG_VERSION];
  process.env.POI_DISCOVERY_ENABLED = '1'; process.env.POI_DISCOVERY_CATALOG_VERSION = 'v1';
  const db = new DatabaseSync(':memory:'); let clock = 2000000;
  try {
    const legacy = require('../src/services/valleyLegacyStore').createLegacyStore(db, { now: () => clock });
    createDiscoveryCatalogStore(db).register({version:'v1',mapVersion:'fixture',bounds:{minX:-10000,maxX:10000,minY:-10000,maxY:10000},regions:[{id:'north',name:'North'}],points:[{id:'cave',name:'Cave',category:'cave',regionId:'north',enabled:true,x:0,y:0,radiusMetres:50}]});
    const steam = '76561198000000801';
    const players = [{ steamId:steam, species:'Rex', growth:0.5, location:{x:0,y:0} }];
    clock += 10000; legacy.snapshot(players,clock);
    assert.equal(legacy.discoveries.discovered(steam,'v1').points.length,0);
    legacy.discoveries.change(steam,{enabled:true,expectedRevision:0});
    clock += 10000; legacy.snapshot(players,clock);
    clock += 10000;
    db.exec('CREATE TRIGGER fail_receipt BEFORE INSERT ON discovery_visits BEGIN SELECT RAISE(ABORT,\'fixture failure\'); END');
    assert.throws(()=>legacy.snapshot(players,clock));
    assert.equal(legacy.discoveries.discovered(steam,'v1').points.length,0);
    db.exec('DROP TRIGGER fail_receipt');
    legacy.snapshot(players,clock);
    assert.equal(legacy.discoveries.discovered(steam,'v1').points.length,1);
  } finally {
    db.close();
    for (const [index,key] of ['POI_DISCOVERY_ENABLED','POI_DISCOVERY_CATALOG_VERSION'].entries()) {
      if(saved[index]===undefined)delete process.env[key];else process.env[key]=saved[index];
    }
  }
});

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
    visits.change(steam, { enabled: true, expectedRevision: 0 });
    clock += 10000;
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
    visits.change(steam, { enabled: false, expectedRevision: 1, erase: true });
    assert.equal(visits.discovered(steam, 'v1').points.length, 0);
    clock += 10000; assert.equal(sample({ x: 0, y: 0 }).recorded, false);
    assert.throws(() => visits.change(steam, { enabled: true, expectedRevision: 1 }), { status: 409 });
  } finally { db.close(); }
});
