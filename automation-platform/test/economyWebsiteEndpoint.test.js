const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-economy-endpoint-'));
process.env.AUTOMATION_DB_PATH = path.join(dir, 'economy.sqlite');
process.env.HOLLOW_VALLEY_API_TOKEN = 'economy-website-secret';
process.env.PLAYER_PRESENCE_ENABLED = 'false';
process.env.WALLET_PLAYTIME_REWARDS_ENABLED = 'false';
process.env.MARKETPLACE_WRITE_ENABLED = 'true';

const { app } = require('../src/index');
const economy = require('../src/services/economyStore');

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('website wallet and marketplace APIs are protected and preserve atomic purchase state', async (t) => {
  const steamId = '76561198000000020';
  economy.upsertCatalogItem({
    id: 'dino:carno:75',
    itemType: 'dino',
    name: 'Carnotaurus 75%',
    price: 400,
    payload: { speciesId: 'carnotaurus', sizePercent: 75 },
  });
  economy.applyWalletTransaction({
    steamId,
    amount: 1000,
    kind: 'test_credit',
    reason: 'Endpoint funding',
    idempotencyKey: 'endpoint:funding:001',
  });

  const server = await listen();
  t.after(async () => {
    await close(server);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/website`;

  const denied = await fetch(`${base}/wallet/${steamId}`);
  assert.equal(denied.status, 401);

  const headers = {
    Authorization: 'Bearer economy-website-secret',
    'Content-Type': 'application/json',
  };

  const walletBefore = await fetch(`${base}/wallet/${steamId}`, { headers });
  assert.equal(walletBefore.status, 200);
  const walletBody = await walletBefore.json();
  assert.equal(walletBody.balance, 1000);
  assert.equal(walletBody.earning.activeBoostPercent, 0);
  assert.equal(walletBody.earning.boostedCoinsPer5Minutes, 0);

  const questsResponse = await fetch(`${base}/quests/${steamId}`, { headers });
  assert.equal(questsResponse.status, 200);
  const quests = await questsResponse.json();
  assert.equal(quests.quests.length, 5);
  assert.equal(quests.activeBoostPercent, 0);
  assert.deepEqual(quests.quests.map((quest) => quest.id), [
    'daily-consecutive-1h',
    'daily-total-3h',
    'daily-total-6h',
    'weekly-total-12h',
    'weekly-total-24h',
  ]);

  const catalogResponse = await fetch(`${base}/marketplace/catalog`, { headers });
  assert.equal(catalogResponse.status, 200);
  const catalog = await catalogResponse.json();
  assert.equal(catalog.catalog.length, 1);
  assert.equal(catalog.catalog[0].id, 'dino:carno:75');

  const body = JSON.stringify({
    steamId,
    idempotencyKey: 'website-marketplace:endpoint-001',
  });
  const purchase = await fetch(`${base}/marketplace/catalog/dino%3Acarno%3A75/buy`, {
    method: 'POST',
    headers,
    body,
  });
  assert.equal(purchase.status, 201);
  const purchaseBody = await purchase.json();
  assert.equal(purchaseBody.order.status, 'pending');
  assert.equal(purchaseBody.wallet.balance, 600);

  const retry = await fetch(`${base}/marketplace/catalog/dino%3Acarno%3A75/buy`, {
    method: 'POST',
    headers,
    body,
  });
  assert.equal(retry.status, 200);
  const retryBody = await retry.json();
  assert.equal(retryBody.duplicate, true);
  assert.equal(retryBody.order.id, purchaseBody.order.id);
  assert.equal(retryBody.wallet.balance, 600);

  const ordersResponse = await fetch(`${base}/marketplace/orders/${steamId}`, { headers });
  assert.equal(ordersResponse.status, 200);
  const orders = await ordersResponse.json();
  assert.equal(orders.orders.length, 1);
  assert.equal(orders.orders[0].status, 'pending');
});
