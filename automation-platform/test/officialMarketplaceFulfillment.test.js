const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadFixture({ createError = null, existingState = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-official-market-'));
  const previous = {
    db: process.env.AUTOMATION_DB_PATH,
    writes: process.env.MARKETPLACE_WRITE_ENABLED,
    fulfillment: process.env.OFFICIAL_MARKETPLACE_FULFILLMENT_ENABLED,
  };

  process.env.AUTOMATION_DB_PATH = path.join(dir, 'economy.sqlite');
  process.env.MARKETPLACE_WRITE_ENABLED = 'true';
  process.env.OFFICIAL_MARKETPLACE_FULFILLMENT_ENABLED = 'true';

  const storePath = require.resolve('../src/services/economyStore');
  const filePath = require.resolve('../src/services/parkedDinoFileService');
  const marketPath = require.resolve('../src/services/marketplaceService');
  const catalogPath = require.resolve('../src/services/officialMarketplaceCatalogService');
  const fulfillPath = require.resolve('../src/services/officialMarketplaceFulfillmentService');

  for (const modulePath of [storePath, filePath, marketPath, catalogPath, fulfillPath]) {
    delete require.cache[modulePath];
  }

  const stored = new Map();
  if (existingState) stored.set(existingState.slot, JSON.parse(JSON.stringify(existingState)));
  let creates = 0;

  require.cache[filePath] = {
    id: filePath,
    filename: filePath,
    loaded: true,
    exports: {
      async storedExists(_steamId, slot) {
        return stored.has(slot);
      },
      async readStoredDino(_steamId, slot) {
        if (!stored.has(slot)) throw new Error('not found');
        return JSON.parse(JSON.stringify(stored.get(slot)));
      },
      async createStoredDino(_steamId, slot, state) {
        creates += 1;
        if (createError) {
          const error = new Error(createError.message || 'create failed');
          error.code = createError.code;
          throw error;
        }
        if (stored.has(slot)) {
          const error = new Error('target exists');
          error.code = 'DINO_TARGET_EXISTS';
          throw error;
        }
        stored.set(slot, JSON.parse(JSON.stringify(state)));
        return state;
      },
    },
  };

  const store = require(storePath);
  const marketplace = require(marketPath);
  const catalog = require(catalogPath);
  const fulfillment = require(fulfillPath);

  return {
    store,
    marketplace,
    catalog,
    fulfillment,
    stored,
    getCreates: () => creates,
    cleanup() {
      for (const modulePath of [storePath, filePath, marketPath, catalogPath, fulfillPath]) {
        delete require.cache[modulePath];
      }
      if (previous.db === undefined) delete process.env.AUTOMATION_DB_PATH;
      else process.env.AUTOMATION_DB_PATH = previous.db;
      if (previous.writes === undefined) delete process.env.MARKETPLACE_WRITE_ENABLED;
      else process.env.MARKETPLACE_WRITE_ENABLED = previous.writes;
      if (previous.fulfillment === undefined) delete process.env.OFFICIAL_MARKETPLACE_FULFILLMENT_ENABLED;
      else process.env.OFFICIAL_MARKETPLACE_FULFILLMENT_ENABLED = previous.fulfillment;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function fundAndBuy(fixture, steamId = '76561198000000601', catalogId = 'dino:carnotaurus:75') {
  fixture.catalog.seedOfficialCatalog();
  fixture.store.applyWalletTransaction({
    steamId,
    amount: 5000,
    kind: 'test_credit',
    reason: 'Official store funding',
    idempotencyKey: `fund:${steamId}`,
  });
  return fixture.marketplace.purchaseCatalogItem({
    steamId,
    catalogId,
    idempotencyKey: `official-buy:${steamId}:${catalogId}`,
  });
}

test('official catalog excludes unreleased Deinocheirus and seeds valid 75% class paths', (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);

  const items = fixture.catalog.seedOfficialCatalog();
  assert.equal(items.length, 20);
  assert.equal(items.some((item) => item.payload.speciesId === 'deinocheirus'), false);

  const carno = fixture.store.getCatalogItem('dino:carnotaurus:75');
  assert.equal(carno.active, true);
  assert.equal(carno.payload.growth, 0.75);
  assert.equal(
    carno.payload.classPath,
    '/Game/TheIsle/Core/Characters/Dinosaurs/Carnotaurus/BP_Carnotaurus.BP_Carnotaurus_C'
  );
});

test('official fulfillment creates a minimal real DinoStorage state and marks order fulfilled', async (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);
  const purchase = fundAndBuy(fixture);

  assert.equal(purchase.order.status, 'pending');
  const result = await fixture.fulfillment.fulfillOrder(purchase.order.id);
  assert.equal(result.order.status, 'fulfilled');
  assert.equal(fixture.getCreates(), 1);

  const slot = fixture.fulfillment.slotForOrder(purchase.order.id);
  const state = fixture.stored.get(slot);
  assert.equal(state.slot, slot);
  assert.equal(state.growth, 0.75);
  assert.equal(
    state.classPath,
    '/Game/TheIsle/Core/Characters/Dinosaurs/Carnotaurus/BP_Carnotaurus.BP_Carnotaurus_C'
  );
  assert.equal(state.marketplacePurchase.orderId, purchase.order.id);

  for (const forbidden of ['isFemale', 'health', 'stamina', 'skin', 'mutations', 'nutrients', 'isPrime']) {
    assert.equal(Object.hasOwn(state, forbidden), false, `${forbidden} should not be fabricated`);
  }
});

test('official fulfillment is restart-idempotent when stored file already has order marker', async (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);
  const purchase = fundAndBuy(fixture, '76561198000000602');
  const state = fixture.fulfillment.buildStoredState(purchase.order);
  fixture.stored.set(state.slot, JSON.parse(JSON.stringify(state)));

  const result = await fixture.fulfillment.fulfillOrder(purchase.order.id);
  assert.equal(result.order.status, 'fulfilled');
  assert.equal(fixture.getCreates(), 0);

  const duplicate = await fixture.fulfillment.fulfillOrder(purchase.order.id);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.order.status, 'fulfilled');
});

test('conflicting official target slot refunds buyer exactly once', async (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);
  const steamId = '76561198000000603';
  const purchase = fundAndBuy(fixture, steamId);
  const slot = fixture.fulfillment.slotForOrder(purchase.order.id);
  fixture.stored.set(slot, {
    slot,
    classPath: '/Game/TheIsle/Core/Characters/Dinosaurs/Dryosaurus/BP_Dryosaurus.BP_Dryosaurus_C',
    growth: 0.5,
  });

  const result = await fixture.fulfillment.fulfillOrder(purchase.order.id);
  assert.equal(result.refunded, true);
  assert.equal(result.order.status, 'refunded');
  assert.equal(fixture.store.getWallet(steamId).balance, 5000);

  const refunds = fixture.store.getWallet(steamId).transactions
    .filter((transaction) => transaction.kind === 'marketplace_refund');
  assert.equal(refunds.length, 1);
});

test('transient FTP failure leaves official order pending and does not refund prematurely', async (t) => {
  const fixture = loadFixture({ createError: { message: 'temporary FTP outage' } });
  t.after(fixture.cleanup);
  const steamId = '76561198000000604';
  const purchase = fundAndBuy(fixture, steamId);

  await assert.rejects(
    () => fixture.fulfillment.fulfillOrder(purchase.order.id),
    /temporary FTP outage/
  );

  assert.equal(fixture.store.getOrder(purchase.order.id).status, 'pending');
  assert.equal(fixture.store.getWallet(steamId).balance, 2200);
  assert.equal(
    fixture.store.getWallet(steamId).transactions.some((transaction) => transaction.kind === 'marketplace_refund'),
    false
  );
});

test('catalog seeding deactivates obsolete dinosaur items', (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);

  fixture.store.upsertCatalogItem({
    id: 'dino:deinocheirus:75',
    itemType: 'dino',
    name: 'Deinocheirus 75%',
    price: 3120,
    payload: { speciesId: 'deinocheirus', growth: 0.75 },
    active: true,
  });
  fixture.catalog.seedOfficialCatalog();

  assert.equal(fixture.store.getCatalogItem('dino:deinocheirus:75').active, false);
  assert.equal(fixture.store.listCatalog({ activeOnly: true }).some((item) => item.id === 'dino:deinocheirus:75'), false);
});


test('official fulfillment requires both write gates', (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);

  assert.equal(fixture.fulfillment.enabled(), true);
  process.env.MARKETPLACE_WRITE_ENABLED = 'false';
  assert.equal(fixture.fulfillment.enabled(), false);
  process.env.MARKETPLACE_WRITE_ENABLED = 'true';
  process.env.OFFICIAL_MARKETPLACE_FULFILLMENT_ENABLED = 'false';
  assert.equal(fixture.fulfillment.enabled(), false);
});
