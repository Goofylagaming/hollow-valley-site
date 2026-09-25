const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-official-catalog-tiers-'));
  const previousDb = process.env.AUTOMATION_DB_PATH;
  process.env.AUTOMATION_DB_PATH = path.join(dir, 'economy.sqlite');

  const storePath = require.resolve('../src/services/economyStore');
  const catalogPath = require.resolve('../src/services/officialMarketplaceCatalogService');
  delete require.cache[storePath];
  delete require.cache[catalogPath];

  const store = require(storePath);
  const catalog = require(catalogPath);

  return {
    store,
    catalog,
    cleanup() {
      delete require.cache[storePath];
      delete require.cache[catalogPath];
      if (previousDb === undefined) delete process.env.AUTOMATION_DB_PATH;
      else process.env.AUTOMATION_DB_PATH = previousDb;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('official marketplace seeds only 50-74, 75+ and Prime tiers', (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);

  const items = fixture.catalog.seedOfficialCatalog();
  assert.equal(items.length, fixture.catalog.OFFICIAL_DINO_CATALOG.length * 3);

  const active = fixture.store.listCatalog({ activeOnly: true });
  assert.equal(active.length, fixture.catalog.OFFICIAL_DINO_CATALOG.length * 3);
  assert.deepEqual(
    [...new Set(active.map((item) => item.payload.growthTier))].sort(),
    ['high', 'mid', 'prime']
  );
  assert.equal(active.some((item) => Number(item.payload.growthPercent) < 50), false);
});

test('legacy 25-49 starter rows are deactivated and cannot be re-enabled', (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);

  fixture.store.upsertCatalogItem({
    id: 'dino:carnotaurus:starter',
    itemType: 'dino',
    name: 'Carnotaurus 25–49%',
    price: 1400,
    payload: {
      speciesId: 'carnotaurus',
      species: 'Carnotaurus',
      classPath: fixture.catalog.CLASS_PATHS.carnotaurus,
      growth: 0.35,
      growthPercent: 35,
      sizePercent: 35,
      growthTier: 'starter',
      growthTierLabel: '25–49%',
      isPrime: false,
    },
    active: true,
    sortOrder: 0,
  });

  fixture.catalog.seedOfficialCatalog();

  const retired = fixture.store.getCatalogItem('dino:carnotaurus:starter');
  assert.equal(retired.active, false);
  assert.throws(
    () => fixture.catalog.updateOfficialCatalogItem({
      catalogId: retired.id,
      price: retired.price,
      growthPercent: 35,
      active: true,
      isPrime: false,
    }),
    (error) => error?.code === 'CATALOG_ITEM_UNAVAILABLE'
  );
});
