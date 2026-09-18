const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadMarketplace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-market-'));
  const previous = process.env.AUTOMATION_DB_PATH;
  process.env.AUTOMATION_DB_PATH = path.join(dir, 'economy.sqlite');

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
      if (previous === undefined) delete process.env.AUTOMATION_DB_PATH;
      else process.env.AUTOMATION_DB_PATH = previous;
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
    id: 'dino:carno:75',
    itemType: 'dino',
    name: 'Carnotaurus 75%',
    price: 400,
    payload: { species: 'Carnotaurus', growth: 0.75 },
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
    catalogId: 'dino:carno:75',
    idempotencyKey: 'purchase:interaction:001',
  });
  assert.equal(first.wallet.balance, 600);
  assert.equal(first.order.status, 'pending');
  assert.equal(first.order.itemSnapshot.payload.species, 'Carnotaurus');

  const duplicate = marketplace.purchaseCatalogItem({
    steamId,
    catalogId: 'dino:carno:75',
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
    id: 'dino:rex:75',
    itemType: 'dino',
    name: 'Tyrannosaurus 75%',
    price: 1000,
    payload: { species: 'Tyrannosaurus', growth: 0.75 },
  });

  assert.throws(() => marketplace.purchaseCatalogItem({
    steamId,
    catalogId: 'dino:rex:75',
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
    id: 'dino:dryo:75',
    itemType: 'dino',
    name: 'Dryosaurus 75%',
    price: 200,
    payload: { species: 'Dryosaurus', growth: 0.75 },
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
    catalogId: 'dino:dryo:75',
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
