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

test('official marketplace seeds exactly 49% and 75% Prime tiers', (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);

  const items = fixture.catalog.seedOfficialCatalog();
  assert.equal(items.length, fixture.catalog.OFFICIAL_DINO_CATALOG.length * 2);

  const active = fixture.store.listCatalog({ activeOnly: true });
  assert.equal(active.length, fixture.catalog.OFFICIAL_DINO_CATALOG.length * 2);
  assert.deepEqual(
    [...new Set(active.map((item) => item.payload.growthTier))].sort(),
    ['49', '75']
  );
  assert.deepEqual(
    [...new Set(active.map((item) => Number(item.payload.growthPercent)))].sort((a, b) => a - b),
    [49, 75]
  );
  assert.equal(active.some((item) => Number(item.payload.growthPercent) === 100), false);
  assert.equal(active.filter((item) => item.payload.growthTier === '49').every((item) => item.payload.isPrime === false), true);
  assert.equal(active.filter((item) => item.payload.growthTier === '75').every((item) => item.payload.isPrime === true), true);
  assert.equal(active.filter((item) => item.payload.growthTier === '75').every((item) => item.price >= 50000), true);
});

test('legacy marketplace tiers including prior 50% and 100% Prime are retired on seed', (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);

  for (const [id, growthTier, growth, isPrime, price] of [
    ['dino:carnotaurus:starter', 'starter', 35, false, 1400],
    ['dino:carnotaurus:mid', 'mid', 60, false, 1400],
    ['dino:carnotaurus:50', '50', 50, false, 12345],
    ['dino:carnotaurus:high', 'high', 85, false, 1400],
    ['dino:carnotaurus:prime', 'prime', 100, true, 1400],
  ]) {
    fixture.store.upsertCatalogItem({
      id,
      itemType: 'dino',
      name: `Carnotaurus ${growth}%`,
      price,
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
    'dino:carnotaurus:50',
    'dino:carnotaurus:high',
    'dino:carnotaurus:prime',
  ]) {
    assert.equal(fixture.store.getCatalogItem(id).active, false);
  }

  const fortyNine = fixture.store.getCatalogItem('dino:carnotaurus:49');
  const seventyFive = fixture.store.getCatalogItem('dino:carnotaurus:75');
  assert.equal(fortyNine.active, true);
  assert.equal(fortyNine.payload.growthPercent, 49);
  assert.equal(fortyNine.payload.isPrime, false);
  assert.equal(fortyNine.price, 12345);
  assert.equal(seventyFive.active, true);
  assert.equal(seventyFive.payload.growthPercent, 75);
  assert.equal(seventyFive.payload.isPrime, true);
  assert.equal(seventyFive.price, 50000);
});

test('pre-current-policy 75% rows reactivate once, then admin disables are preserved', (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);

  fixture.store.upsertCatalogItem({
    id: 'dino:carnotaurus:75',
    itemType: 'dino',
    name: 'Carnotaurus 75% Prime',
    price: 50000,
    payload: {
      speciesId: 'carnotaurus',
      species: 'Carnotaurus',
      classPath: fixture.catalog.CLASS_PATHS.carnotaurus,
      growth: 0.75,
      growthPercent: 75,
      sizePercent: 75,
      growthTier: '75',
      growthTierLabel: '75%',
      isPrime: true,
    },
    active: false,
    sortOrder: 1,
  });

  fixture.catalog.seedOfficialCatalog();
  let migrated = fixture.store.getCatalogItem('dino:carnotaurus:75');
  assert.equal(migrated.active, true);
  assert.equal(migrated.payload.growthTier, '75');
  assert.equal(migrated.payload.growthPercent, 75);
  assert.equal(migrated.payload.isPrime, true);
  assert.equal(migrated.payload.officialCatalogPolicyVersion, fixture.catalog.OFFICIAL_CATALOG_POLICY_VERSION);
  assert.equal(migrated.price, 50000);

  fixture.catalog.updateOfficialCatalogItem({
    catalogId: 'dino:carnotaurus:75',
    price: 60000,
    active: false,
  });
  fixture.catalog.seedOfficialCatalog();

  migrated = fixture.store.getCatalogItem('dino:carnotaurus:75');
  assert.equal(migrated.active, false);
  assert.equal(migrated.price, 60000);
});

test('admin can edit prices but cannot underprice the 75% Prime tier', (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);
  fixture.catalog.seedOfficialCatalog();

  const fortyNine = fixture.catalog.updateOfficialCatalogItem({
    catalogId: 'dino:carnotaurus:49',
    price: 12345,
    active: true,
  });
  assert.equal(fortyNine.price, 12345);
  assert.equal(fortyNine.payload.growthPercent, 49);
  assert.equal(fortyNine.payload.isPrime, false);

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
