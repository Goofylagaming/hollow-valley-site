const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

process.env.AUTOMATION_DB_PATH = ':memory:';
const capacity = require('../src/services/dinoStorageCapacityService');
const economy = require('../src/services/economyStore');
const dinoStorage = require('../src/services/dinoStorageService');
const bridge = require('../src/services/commandBridgeService');
const automation = require('../src/services/automationStore');
const marketplace = require('../src/services/marketplaceService');
const p2p = require('../src/services/dinoMarketplaceService');
const files = require('../src/services/parkedDinoFileService');
const steam = '76561198000000001';
const seller = '76561198000000002';
const env = {
  DINOSTORAGE_MEMBERSHIP_CAPACITY_ENABLED: 'true',
  DINOSTORAGE_BASE_SLOTS: '2',
  DINOSTORAGE_CAPACITY_SERVER_ACK: capacity.SERVER_ACK,
  HOLLOW_VALLEY_API_BASE_URL: 'https://website.invalid',
  HOLLOW_VALLEY_API_TOKEN: 'test-only-token',
};

function response({ tier = 'supporter', entitled = true, expiresAt = new Date(Date.now() + 86400000).toISOString(), steamId = steam } = {}) {
  return { ok: true, json: async () => ({ memberships: [{ steamId, entitled, tier, expiresAt }] }) };
}

function options({ dinos = [], member = {}, ...rest } = {}) {
  return { env, listStored: async () => dinos, fetchImpl: async () => response(member), ...rest };
}

function reset() {
  capacity.initialize();
  economy.db.exec(`DELETE FROM membership_storage_reservations;
    DELETE FROM membership_storage_admission_locks;
    DELETE FROM economy_dino_listings;
    DELETE FROM economy_marketplace_orders;
    DELETE FROM economy_wallet_ledger;
    DELETE FROM economy_wallets;`);
  for (const row of automation.listRequests({ kind: 'dinostorage', limit: 500 })) automation.updateRequest(row.id, { status: 'failed' });
}

function setupEnvironment(t, member = {}) {
  for (const [key, value] of Object.entries({ ...env, COMMAND_BRIDGE_ENABLED: 'true', COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK: bridge.PUBLISHER_ACK,
    COMMAND_BRIDGE_TRANSPORT: 'http_pull', BINARYLANE_COMMAND_TOKEN: 'test-command-token', MARKETPLACE_WRITE_ENABLED: 'true', OFFICIAL_MARKETPLACE_FULFILLMENT_ENABLED: 'true' })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  t.mock.method(globalThis, 'fetch', async () => response(member));
}

function seedCatalog() {
  economy.upsertCatalogItem({ id: 'capacity:carno:49', itemType: 'dino', name: 'Carnotaurus 49%', price: 400,
    payload: { species: 'Carnotaurus', growth: 0.49, growthPercent: 49, sizePercent: 49, growthTier: '49', isPrime: false } });
  economy.applyWalletTransaction({ steamId: steam, amount: 1000, kind: 'test', reason: 'Test', idempotencyKey: `fund:${randomUUID()}` });
}

test('disabled storage rollout adds no quota and makes no membership or game calls', async () => {
  reset();
  let reads = 0;
  const opts = options({ env: {}, fetchImpl: async () => { reads++; throw new Error('must not call'); }, listStored: async () => { reads++; throw new Error('must not call'); } });
  const admission = await capacity.reserveIncoming({ steamId: steam, slot: 'new', operation: 'test:new' }, opts);
  assert.equal(admission.enabled, false);
  const status = await capacity.getStatus(steam, opts);
  assert.equal(status.limit, null);
  assert.equal(status.reason, 'not-enabled');
  assert.equal(reads, 0);
});

test('there is no default base allowance and rollout requires verified server intake paths', async () => {
  reset();
  for (const override of [{ DINOSTORAGE_BASE_SLOTS: '' }, { DINOSTORAGE_BASE_SLOTS: '0' }, { DINOSTORAGE_CAPACITY_SERVER_ACK: '' }]) {
    const opts = options({ env: { ...env, ...override } });
    assert.equal((await capacity.getStatus(steam, opts)).configured, false);
    await assert.rejects(capacity.reserveIncoming({ steamId: steam, slot: 'new', operation: 'test:new' }, opts), (e) => e.code === 'DINOSTORAGE_CAPACITY_UNCONFIGURED');
  }
});

test('trusted non-coin entitlements add exactly one, two, or four slots', async () => {
  reset();
  for (const [tier, bonus] of Object.entries(capacity.BONUS_SLOTS)) {
    const status = await capacity.getStatus(steam, options({ member: { tier } }));
    assert.equal(status.bonusSlots, bonus);
    assert.equal(status.limit, 2 + bonus);
  }
  const expired = await capacity.getStatus(steam, options({ member: { tier: 'legend', expiresAt: '2020-01-01T00:00:00Z' }, dinos: [{ slot: 'a' }, { slot: 'b' }, { slot: 'c' }] }));
  assert.equal(expired.bonusSlots, 0);
  assert.equal(expired.limit, 2);
  assert.equal(expired.used, 3);
  assert.equal(expired.withdrawOnly, true);
});

test('capacity is checked before accepting a store command and retrieval remains available on expiry', async (t) => {
  reset();
  setupEnvironment(t, { entitled: false, tier: null, expiresAt: null });
  const dinos = [{ slot: 'old-a' }, { slot: 'old-b' }, { slot: 'old-c' }];
  t.mock.method(dinoStorage, 'listStoredDinosFresh', async () => dinos);
  const commands = [];
  t.mock.method(bridge, 'queueCommand', async (command) => { commands.push(command); });
  await assert.rejects(dinoStorage.requestDinoStorageAction({ action: 'store', steamId: steam, slot: 'new' }), (e) => e.code === 'DINOSTORAGE_CAPACITY_FULL');
  assert.deepEqual(dinos.map((d) => d.slot), ['old-a', 'old-b', 'old-c']);
  assert.equal(commands.length, 0);
  const redeemed = await dinoStorage.requestDinoStorageAction({ action: 'redeem', steamId: steam, slot: 'old-c' });
  await new Promise(setImmediate);
  assert.equal(redeemed.details.action, 'redeem');
  assert.equal(commands.length, 1);
  assert.equal(commands[0].verb, 'dino_retrieve');
});

test('simultaneous admission checks cannot both claim the last space', async () => {
  reset();
  let unblock;
  let entered;
  const waiting = new Promise((resolve) => { unblock = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  const opts = options({ dinos: [{ slot: 'a' }, { slot: 'b' }], listStored: async () => { entered(); await waiting; return [{ slot: 'a' }, { slot: 'b' }]; } });
  const first = capacity.reserveIncoming({ steamId: steam, slot: 'last', operation: 'one' }, opts);
  await started;
  await assert.rejects(capacity.reserveIncoming({ steamId: steam, slot: 'other', operation: 'two' }, opts), (e) => e.code === 'DINOSTORAGE_CAPACITY_BUSY');
  unblock();
  await first;
  await assert.rejects(capacity.reserveIncoming({ steamId: steam, slot: 'other', operation: 'two' }, options({ dinos: [{ slot: 'a' }, { slot: 'b' }] })), (e) => e.code === 'DINOSTORAGE_CAPACITY_FULL');
  assert.equal(economy.db.prepare('SELECT count(*) AS n FROM membership_storage_reservations').get().n, 1);
});

test('a timed-out admission lease cannot write after another process takes its lock', async () => {
  reset();
  const opts = options({ listStored: async () => {
    economy.db.prepare('UPDATE membership_storage_admission_locks SET owner = ? WHERE steam_id = ?').run('replacement', steam);
    return [];
  } });
  await assert.rejects(capacity.reserveIncoming({ steamId: steam, slot: 'a', operation: 'late' }, opts), (e) => e.code === 'DINOSTORAGE_CAPACITY_BUSY');
  assert.equal(economy.db.prepare('SELECT count(*) AS n FROM membership_storage_reservations').get().n, 0);
  assert.equal(economy.db.prepare('SELECT owner FROM membership_storage_admission_locks').get().owner, 'replacement');
});

test('fresh stored evidence replaces reservations without double-counting and uncertainty keeps capacity reserved', async () => {
  reset();
  await capacity.reserveIncoming({ steamId: steam, slot: 'pending', operation: 'first' }, options());
  const before = await capacity.getStatus(steam, options());
  assert.equal(before.used, 1);
  assert.equal(before.pending, 1);
  await capacity.reserveIncoming({ steamId: steam, slot: 'next', operation: 'second' }, options({ dinos: [{ slot: 'pending' }] }));
  const after = await capacity.getStatus(steam, options({ dinos: [{ slot: 'pending' }] }));
  assert.equal(after.used, 2);
  assert.equal(after.pending, 1);
  assert.equal(economy.db.prepare('SELECT count(*) AS n FROM membership_storage_reservations WHERE operation_key = ?').get('first').n, 0);
});

test('a confirmed deposit later retrieved is not left consuming a permanent phantom slot', async (t) => {
  reset();
  setupEnvironment(t);
  let now = 2000000000000;
  t.mock.method(Date, 'now', () => now);
  const command = bridge.buildCommand('dino_store', steam, ['consumed']);
  await capacity.reserveIncoming({ steamId: steam, slot: 'consumed', operation: `command:${command.id}`, commandId: command.id }, options());
  capacity.noteCommandOutcome(command, { state: 'confirmed' });
  now += 100;
  const afterRetrieval = await capacity.getStatus(steam, options({ dinos: [] }));
  assert.equal(afterRetrieval.used, 0);
  assert.equal(afterRetrieval.pending, 0);
  await capacity.reserveIncoming({ steamId: steam, slot: 'replacement', operation: 'replacement' }, options());
  assert.equal(economy.db.prepare('SELECT count(*) AS n FROM membership_storage_reservations').get().n, 1);
});

test('a storage snapshot begun before confirmation cannot retire a still-pending deposit', async (t) => {
  reset();
  setupEnvironment(t);
  let now = 2000000000000;
  t.mock.method(Date, 'now', () => now);
  const command = bridge.buildCommand('dino_store', steam, ['arriving']);
  await capacity.reserveIncoming({ steamId: steam, slot: 'arriving', operation: `command:${command.id}`, commandId: command.id }, options());
  now += 100;
  const duringConfirmation = await capacity.getStatus(steam, options({ listStored: async () => {
    now += 100;
    capacity.noteCommandOutcome(command, { state: 'confirmed' });
    return [];
  } }));
  assert.equal(duringConfirmation.used, 1);
  assert.equal(duringConfirmation.pending, 1);
});

test('Windows slot names cannot evade occupied-slot protection by changing case', async () => {
  reset();
  await assert.rejects(capacity.reserveIncoming({ steamId: steam, slot: 'MY-DINO', operation: 'case-bypass' }, options({ dinos: [{ slot: 'my-dino' }] })),
    (e) => e.code === 'DINO_TARGET_EXISTS');
});

test('a failed membership read fails closed for a new deposit without deleting stored assets', async () => {
  reset();
  const dinos = [{ slot: 'safe' }];
  await assert.rejects(capacity.reserveIncoming({ steamId: steam, slot: 'new', operation: 'offline' }, options({ dinos, fetchImpl: async () => { throw new Error('offline'); } })), (e) => e.code === 'DINOSTORAGE_MEMBERSHIP_UNAVAILABLE');
  assert.deepEqual(dinos, [{ slot: 'safe' }]);
  assert.equal(economy.db.prepare('SELECT count(*) AS n FROM membership_storage_reservations').get().n, 0);
});

test('listing and cancelling a dinosaur cannot manufacture extra space', async () => {
  reset();
  economy.ensureWallet(steam);
  economy.db.prepare("INSERT INTO economy_dino_listings(id,seller_steam_id,original_slot,price,status,idempotency_key) VALUES(?,?,?,?,?,?)")
    .run(randomUUID(), steam, 'escrowed', 100, 'active', 'listing-key');
  const opts = options({ dinos: [{ slot: 'a' }, { slot: 'b' }] });
  const status = await capacity.getStatus(steam, opts);
  assert.equal(status.escrow, 1);
  assert.equal(status.used, 3);
  await assert.rejects(capacity.reserveIncoming({ steamId: steam, slot: 'new', operation: 'bypass' }, opts), (e) => e.code === 'DINOSTORAGE_CAPACITY_FULL');
});

test('catalog purchase checks capacity before debiting and direct synchronous purchase cannot bypass admission', async (t) => {
  reset();
  setupEnvironment(t);
  seedCatalog();
  t.mock.method(dinoStorage, 'listStoredDinosFresh', async () => [{ slot: 'a' }, { slot: 'b' }, { slot: 'c' }]);
  await assert.rejects(marketplace.purchaseCatalogItemWithCapacity({ steamId: steam, catalogId: 'capacity:carno:49', idempotencyKey: 'full' }), (e) => e.code === 'DINOSTORAGE_CAPACITY_FULL');
  assert.throws(() => marketplace.purchaseCatalogItem({ steamId: steam, catalogId: 'capacity:carno:49', idempotencyKey: 'bypass' }), (e) => e.code === 'DINOSTORAGE_ADMISSION_REQUIRED');
  assert.equal(economy.getWallet(steam).balance, 1000);
  assert.equal(economy.listOrders({ steamId: steam }).length, 0);
});

test('catalog order reserves once before charging and retries preserve the paid receipt', async (t) => {
  reset();
  setupEnvironment(t);
  seedCatalog();
  t.mock.method(dinoStorage, 'listStoredDinosFresh', async () => []);
  const input = { steamId: steam, catalogId: 'capacity:carno:49', idempotencyKey: 'buy-once' };
  const first = await marketplace.purchaseCatalogItemWithCapacity(input);
  const again = await marketplace.purchaseCatalogItemWithCapacity(input);
  assert.equal(first.wallet.balance, 600);
  assert.equal(again.wallet.balance, 600);
  assert.equal(first.order.id, again.order.id);
  assert.equal(again.duplicate, true);
  const rows = economy.db.prepare('SELECT * FROM membership_storage_reservations').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].operation_key, `official:${first.order.id}`);
});

test('a failed payment transaction releases admission before any delivery', async (t) => {
  reset();
  setupEnvironment(t);
  seedCatalog();
  economy.db.prepare('UPDATE economy_wallets SET balance=0 WHERE steam_id=?').run(steam);
  t.mock.method(dinoStorage, 'listStoredDinosFresh', async () => []);
  await assert.rejects(marketplace.purchaseCatalogItemWithCapacity({ steamId: steam, catalogId: 'capacity:carno:49', idempotencyKey: 'no-money' }), (e) => e.code === 'INSUFFICIENT_FUNDS');
  assert.equal(economy.db.prepare('SELECT count(*) AS n FROM membership_storage_reservations').get().n, 0);
  assert.equal(economy.listOrders({ steamId: steam }).length, 0);
});

test('P2P buyer is not charged when capacity fails', async (t) => {
  reset();
  setupEnvironment(t);
  seedCatalog();
  economy.ensureWallet(seller);
  const id = randomUUID();
  economy.db.prepare("INSERT INTO economy_dino_listings(id,seller_steam_id,original_slot,price,status,idempotency_key) VALUES(?,?,?,?,?,?)")
    .run(id, seller, 'seller-slot', 100, 'active', 'p2p-list');
  t.mock.method(dinoStorage, 'listStoredDinosFresh', async () => [{ slot: 'a' }, { slot: 'b' }, { slot: 'c' }]);
  t.mock.method(files, 'transferEscrowToStored', async () => assert.fail('No transfer should occur'));
  await assert.rejects(p2p.buyDinoListing({ buyerSteamId: steam, listingId: id, idempotencyKey: 'p2p-buy-capacity-test' }), (e) => e.code === 'DINOSTORAGE_CAPACITY_FULL');
  assert.equal(economy.getWallet(steam).balance, 1000);
  assert.equal(economy.getDinoListing(id).status, 'active');
});

test('raw command and direct file intake cannot bypass the capacity gate', async (t) => {
  reset();
  setupEnvironment(t);
  t.mock.method(dinoStorage, 'listStoredDinosFresh', async () => [{ slot: 'a' }, { slot: 'b' }, { slot: 'c' }]);
  const command = bridge.buildCommand('dino_grant', steam, ['new', '/Game/Test', '0.49', '0', randomUUID()]);
  await assert.rejects(bridge.queueCommand(command), (e) => e.code === 'DINOSTORAGE_CAPACITY_FULL');
  await assert.rejects(files.createStoredDino(steam, 'new-file', {}), (e) => e.code === 'DINOSTORAGE_CAPACITY_FULL');
  await assert.rejects(files.transferEscrowToStored({ listingId: randomUUID(), buyerSteamId: steam, buyerSlot: 'new-p2p' }), (e) => e.code === 'DINOSTORAGE_CAPACITY_FULL');
});

test('already paid pending orders keep their delivery rights after membership expires', async () => {
  reset();
  seedCatalog();
  const id = randomUUID();
  economy.db.prepare("INSERT INTO economy_marketplace_orders(id,steam_id,catalog_id,price,idempotency_key,status) VALUES(?,?,?,?,?,'pending')")
    .run(id, steam, 'capacity:carno:49', 100, 'already-paid');
  const ticket = await capacity.reserveIncoming({ steamId: steam, slot: capacity.officialSlot(id), operation: `official:${id}`, allowExisting: true },
    options({ member: { entitled: false }, dinos: [{ slot: 'a' }, { slot: 'b' }, { slot: 'c' }] }));
  assert.equal(ticket.enabled, true);
  assert.equal(ticket.operation, `official:${id}`);
});
