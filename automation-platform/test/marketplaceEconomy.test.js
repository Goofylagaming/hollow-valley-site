const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadMarketplace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-market-'));
  const previous = {
    db: process.env.AUTOMATION_DB_PATH,
    write: process.env.MARKETPLACE_WRITE_ENABLED,
    fulfillment: process.env.OFFICIAL_MARKETPLACE_FULFILLMENT_ENABLED,
  };
  process.env.AUTOMATION_DB_PATH = path.join(dir, 'economy.sqlite');
  process.env.MARKETPLACE_WRITE_ENABLED = 'true';
  process.env.OFFICIAL_MARKETPLACE_FULFILLMENT_ENABLED = 'true';

  const storePath = require.resolve('../src/services/economyStore');
  const marketPath = require.resolve('../src/services/marketplaceService');
  delete require.cache[storePath];
  delete require.cache[marketPath];
  const store = require(storePath);
  const marketplace = require(marketPath);

  return {
    store,
    marketplace,
    cleanup() {
      delete require.cache[storePath];
      delete require.cache[marketPath];
      if (previous.db === undefined) delete process.env.AUTOMATION_DB_PATH;
      else process.env.AUTOMATION_DB_PATH = previous.db;
      if (previous.write === undefined) delete process.env.MARKETPLACE_WRITE_ENABLED;
      else process.env.MARKETPLACE_WRITE_ENABLED = previous.write;
      if (previous.fulfillment === undefined) delete process.env.OFFICIAL_MARKETPLACE_FULFILLMENT_ENABLED;
      else process.env.OFFICIAL_MARKETPLACE_FULFILLMENT_ENABLED = previous.fulfillment;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('catalog purchase debits wallet and creates one pending order atomically', (t) => {
  const fixture = loadMarketplace();
  t.after(fixture.cleanup);
  const { store, marketplace } = fixture;
  const steamId = '76561198000000006';

  store.upsertCatalogItem({
    id: 'dino:carno:50',
    itemType: 'dino',
    name: 'Carnotaurus 50%',
    price: 400,
    payload: { species: 'Carnotaurus', growth: 0.5, growthPercent: 50, sizePercent: 50, growthTier: '50', isPrime: false },
  });
  store.applyWalletTransaction({
    steamId,
    amount: 1000,
    kind: 'admin_seed',
    reason: 'Test funding',
    idempotencyKey: 'seed:market:001',
  });

  const first = marketplace.purchaseCatalogItem({
    steamId,
    catalogId: 'dino:carno:50',
    idempotencyKey: 'purchase:interaction:001',
  });
  assert.equal(first.wallet.balance, 600);
  assert.equal(first.order.status, 'pending');
  assert.equal(first.order.itemSnapshot.payload.species, 'Carnotaurus');

  const duplicate = marketplace.purchaseCatalogItem({
    steamId,
    catalogId: 'dino:carno:50',
    idempotencyKey: 'purchase:interaction:001',
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.order.id, first.order.id);
  assert.equal(duplicate.wallet.balance, 600);
  assert.equal(store.listOrders({ steamId }).length, 1);
  assert.equal(store.getWallet(steamId).transactions.filter((tx) => tx.kind === 'marketplace_purchase').length, 1);
});

test('insufficient funds create neither debit nor marketplace order', (t) => {
  const fixture = loadMarketplace();
  t.after(fixture.cleanup);
  const { store, marketplace } = fixture;
  const steamId = '76561198000000007';

  store.upsertCatalogItem({
    id: 'dino:rex:50',
    itemType: 'dino',
    name: 'Tyrannosaurus 50%',
    price: 1000,
    payload: { species: 'Tyrannosaurus', growth: 0.5, growthPercent: 50, sizePercent: 50, growthTier: '50', isPrime: false },
  });

  assert.throws(() => marketplace.purchaseCatalogItem({
    steamId,
    catalogId: 'dino:rex:50',
    idempotencyKey: 'purchase:interaction:002',
  }), (error) => error.code === 'INSUFFICIENT_FUNDS');

  assert.equal(store.getWallet(steamId).balance, 0);
  assert.equal(store.listOrders({ steamId }).length, 0);
});

test('failed pending order can be refunded idempotently', (t) => {
  const fixture = loadMarketplace();
  t.after(fixture.cleanup);
  const { store, marketplace } = fixture;
  const steamId = '76561198000000008';

  store.upsertCatalogItem({
    id: 'dino:dryo:50',
    itemType: 'dino',
    name: 'Dryosaurus 50%',
    price: 200,
    payload: { species: 'Dryosaurus', growth: 0.5, growthPercent: 50, sizePercent: 50, growthTier: '50', isPrime: false },
  });
  store.applyWalletTransaction({
    steamId,
    amount: 500,
    kind: 'admin_seed',
    reason: 'Test funding',
    idempotencyKey: 'seed:market:003',
  });

  const purchase = marketplace.purchaseCatalogItem({
    steamId,
    catalogId: 'dino:dryo:50',
    idempotencyKey: 'purchase:interaction:003',
  });
  marketplace.markOrderFailed(purchase.order.id, 'Fulfillment failed');

  const refund = marketplace.refundOrder(purchase.order.id);
  assert.equal(refund.wallet.balance, 500);
  assert.equal(refund.order.status, 'refunded');

  const duplicate = marketplace.refundOrder(purchase.order.id);
  assert.equal(duplicate.wallet.balance, 500);
  assert.equal(store.getWallet(steamId).transactions.filter((tx) => tx.kind === 'marketplace_refund').length, 1);
});


test('official purchase is fail-closed before any debit when fulfillment gate is disabled', (t) => {
  const fixture = loadMarketplace();
  t.after(fixture.cleanup);
  const { store, marketplace } = fixture;
  const steamId = '76561198000000011';

  store.upsertCatalogItem({
    id: 'dino:carno:50',
    itemType: 'dino',
    name: 'Carnotaurus 50%',
    price: 400,
    payload: { species: 'Carnotaurus', growth: 0.5, growthPercent: 50, sizePercent: 50, growthTier: '50', isPrime: false },
  });
  store.applyWalletTransaction({
    steamId,
    amount: 1000,
    kind: 'admin_seed',
    reason: 'Test funding',
    idempotencyKey: 'seed:market:disabled',
  });

  process.env.OFFICIAL_MARKETPLACE_FULFILLMENT_ENABLED = 'false';
  assert.throws(() => marketplace.purchaseCatalogItem({
    steamId,
    catalogId: 'dino:carno:50',
    idempotencyKey: 'purchase:disabled:001',
  }), (error) => error.code === 'OFFICIAL_MARKETPLACE_FULFILLMENT_DISABLED');

  assert.equal(store.getWallet(steamId).balance, 1000);
  assert.equal(store.listOrders({ steamId }).length, 0);
});


test('official checkout rejects retired 100% dinos and underpriced 75% Prime dinos', (t) => {
  const fixture = loadMarketplace();
  t.after(fixture.cleanup);
  const { store, marketplace } = fixture;
  const steamId = '76561198000000012';

  store.applyWalletTransaction({
    steamId,
    amount: 200000,
    kind: 'admin_seed',
    reason: 'Test funding',
    idempotencyKey: 'seed:market:policy',
  });

  store.upsertCatalogItem({
    id: 'dino:rex:prime',
    itemType: 'dino',
    name: 'Tyrannosaurus 100% Prime',
    price: 100000,
    payload: { species: 'Tyrannosaurus', growth: 1, growthPercent: 100, sizePercent: 100, growthTier: 'prime', isPrime: true },
  });
  assert.throws(() => marketplace.purchaseCatalogItem({
    steamId,
    catalogId: 'dino:rex:prime',
    idempotencyKey: 'purchase:policy:100',
  }), (error) => error.code === 'CATALOG_ITEM_UNAVAILABLE');

  store.upsertCatalogItem({
    id: 'dino:rex:75',
    itemType: 'dino',
    name: 'Tyrannosaurus 75% Prime',
    price: 49999,
    payload: { species: 'Tyrannosaurus', growth: 0.75, growthPercent: 75, sizePercent: 75, growthTier: '75', isPrime: true },
  });
  assert.throws(() => marketplace.purchaseCatalogItem({
    steamId,
    catalogId: 'dino:rex:75',
    idempotencyKey: 'purchase:policy:underpriced',
  }), (error) => error.code === 'CATALOG_ITEM_UNAVAILABLE');

  assert.equal(store.getWallet(steamId).balance, 200000);
  assert.equal(store.listOrders({ steamId }).length, 0);
});
