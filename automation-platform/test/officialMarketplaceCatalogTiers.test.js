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
  const policyPath = require.resolve('../src/services/officialMarketplacePolicy');
  const catalogPath = require.resolve('../src/services/officialMarketplaceCatalogService');
  delete require.cache[storePath];
  delete require.cache[policyPath];
  delete require.cache[catalogPath];

  const store = require(storePath);
  const catalog = require(catalogPath);

  return {
    store,
    catalog,
    cleanup() {
      delete require.cache[storePath];
      delete require.cache[policyPath];
      delete require.cache[catalogPath];
      if (previousDb === undefined) delete process.env.AUTOMATION_DB_PATH;
      else process.env.AUTOMATION_DB_PATH = previousDb;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('official marketplace seeds exactly 50% and 75% Prime tiers', (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);

  const items = fixture.catalog.seedOfficialCatalog();
  assert.equal(items.length, fixture.catalog.OFFICIAL_DINO_CATALOG.length * 2);

  const active = fixture.store.listCatalog({ activeOnly: true });
  assert.equal(active.length, fixture.catalog.OFFICIAL_DINO_CATALOG.length * 2);
  assert.deepEqual(
    [...new Set(active.map((item) => item.payload.growthTier))].sort(),
    ['50', '75']
  );
  assert.deepEqual(
    [...new Set(active.map((item) => Number(item.payload.growthPercent)))].sort((a, b) => a - b),
    [50, 75]
  );
  assert.equal(active.some((item) => Number(item.payload.growthPercent) === 100), false);
  assert.equal(active.filter((item) => item.payload.growthTier === '50').every((item) => item.payload.isPrime === false), true);
  assert.equal(active.filter((item) => item.payload.growthTier === '75').every((item) => item.payload.isPrime === true), true);
  assert.equal(active.filter((item) => item.payload.growthTier === '75').every((item) => item.price >= 50000), true);
});

test('legacy marketplace tiers including 100% Prime are retired on seed', (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);

  for (const [id, growthTier, growth, isPrime] of [
    ['dino:carnotaurus:starter', 'starter', 35, false],
    ['dino:carnotaurus:mid', 'mid', 60, false],
    ['dino:carnotaurus:high', 'high', 85, false],
    ['dino:carnotaurus:prime', 'prime', 100, true],
  ]) {
    fixture.store.upsertCatalogItem({
      id,
      itemType: 'dino',
      name: `Carnotaurus ${growth}%`,
      price: 1400,
      payload: {
        speciesId: 'carnotaurus',
        species: 'Carnotaurus',
        classPath: fixture.catalog.CLASS_PATHS.carnotaurus,
        growth: growth / 100,
        growthPercent: growth,
        sizePercent: growth,
        growthTier,
        growthTierLabel: `${growth}%`,
        isPrime,
      },
      active: true,
      sortOrder: 0,
    });
  }

  fixture.catalog.seedOfficialCatalog();

  for (const id of [
    'dino:carnotaurus:starter',
    'dino:carnotaurus:mid',
    'dino:carnotaurus:high',
    'dino:carnotaurus:prime',
  ]) {
    assert.equal(fixture.store.getCatalogItem(id).active, false);
  }

  const fifty = fixture.store.getCatalogItem('dino:carnotaurus:50');
  const seventyFive = fixture.store.getCatalogItem('dino:carnotaurus:75');
  assert.equal(fifty.active, true);
  assert.equal(fifty.payload.growthPercent, 50);
  assert.equal(fifty.payload.isPrime, false);
  assert.equal(seventyFive.active, true);
  assert.equal(seventyFive.payload.growthPercent, 75);
  assert.equal(seventyFive.payload.isPrime, true);
  assert.equal(seventyFive.price, 50000);
});

test('admin can edit prices but cannot underprice the 75% Prime tier', (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);
  fixture.catalog.seedOfficialCatalog();

  const fifty = fixture.catalog.updateOfficialCatalogItem({
    catalogId: 'dino:carnotaurus:50',
    price: 12345,
    active: true,
  });
  assert.equal(fifty.price, 12345);
  assert.equal(fifty.payload.growthPercent, 50);
  assert.equal(fifty.payload.isPrime, false);

  assert.throws(
    () => fixture.catalog.updateOfficialCatalogItem({
      catalogId: 'dino:carnotaurus:75',
      price: 49999,
      active: true,
    }),
    /minimum price of 50,000 Valley Coin/
  );

  const seventyFive = fixture.catalog.updateOfficialCatalogItem({
    catalogId: 'dino:carnotaurus:75',
    price: 75000,
    active: true,
  });
  assert.equal(seventyFive.price, 75000);
  assert.equal(seventyFive.payload.growthPercent, 75);
  assert.equal(seventyFive.payload.isPrime, true);
});

test('retired 100% rows fail official sale policy even if manually reactivated', (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);

  const legacy = fixture.store.upsertCatalogItem({
    id: 'dino:carnotaurus:prime',
    itemType: 'dino',
    name: 'Carnotaurus 100% Prime',
    price: 99999,
    payload: {
      speciesId: 'carnotaurus',
      species: 'Carnotaurus',
      classPath: fixture.catalog.CLASS_PATHS.carnotaurus,
      growth: 1,
      growthPercent: 100,
      sizePercent: 100,
      growthTier: 'prime',
      growthTierLabel: 'Prime',
      isPrime: true,
    },
    active: true,
  });

  assert.throws(
    () => fixture.catalog.assertOfficialDinoSalePolicy(legacy),
    (error) => error?.code === 'CATALOG_ITEM_UNAVAILABLE'
  );
});
