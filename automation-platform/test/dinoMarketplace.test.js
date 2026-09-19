const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function loadMarketplace({ transferError = null } = {}) {
  let currentTransferError = transferError;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-p2p-'));
  const previous = {
    db: process.env.AUTOMATION_DB_PATH,
    write: process.env.MARKETPLACE_WRITE_ENABLED,
    p2pWrite: process.env.P2P_MARKETPLACE_WRITE_ENABLED,
  };
  process.env.AUTOMATION_DB_PATH = path.join(dir, 'economy.sqlite');
  process.env.MARKETPLACE_WRITE_ENABLED = 'true';
  process.env.P2P_MARKETPLACE_WRITE_ENABLED = 'true';

  const storePath = require.resolve('../src/services/economyStore');
  const filePath = require.resolve('../src/services/parkedDinoFileService');
  const servicePath = require.resolve('../src/services/dinoMarketplaceService');
  delete require.cache[storePath];
  delete require.cache[filePath];
  delete require.cache[servicePath];

  const filesState = {
    sellerPresent: true,
    escrowPresent: false,
    buyerPresent: false,
    moves: 0,
    transfers: 0,
    restores: 0,
  };

  require.cache[filePath] = {
    id: filePath,
    filename: filePath,
    loaded: true,
    exports: {
      validateSlot(value) {
        const slot = String(value || '').trim();
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(slot)) throw new Error('Invalid DinoStorage slot');
        return slot;
      },
      async readStoredDino() {
        if (!filesState.sellerPresent) throw new Error('missing');
        return {
          version: 2,
          slot: 'slot_a',
          classPath: '/Game/TheIsle/Core/Characters/Dinosaurs/Carnotaurus/BP_Carnotaurus.BP_Carnotaurus_C',
          growth: 0.76,
          isFemale: false,
          isPrime: true,
          capturedAt: 123456,
          health: 999,
          location: { x: 1, y: 2, z: 3 },
          mutations: { Slot1: 'Mutation_A', Slot2: 'Mutation_B' },
          skin: { patternIndex: 2 },
        };
      },
      async moveStoredToEscrow() {
        filesState.moves += 1;
        if (!filesState.sellerPresent || filesState.escrowPresent) throw new Error('move failed');
        filesState.sellerPresent = false;
        filesState.escrowPresent = true;
      },
      async escrowExists() { return filesState.escrowPresent; },
      async storedExists() { return filesState.sellerPresent; },
      async transferEscrowToStored() {
        filesState.transfers += 1;
        if (currentTransferError) {
          const error = new Error(currentTransferError.message);
          error.code = currentTransferError.code;
          throw error;
        }
        if (!filesState.escrowPresent) {
          if (filesState.buyerPresent) return { transferred: true, resumed: true };
          const error = new Error('missing escrow');
          error.code = 'TRANSFER_UNCERTAIN';
          throw error;
        }
        filesState.escrowPresent = false;
        filesState.buyerPresent = true;
        return { transferred: true };
      },
      async restoreEscrowToSeller() {
        filesState.restores += 1;
        if (!filesState.escrowPresent) {
          if (filesState.sellerPresent) return { restored: true, resumed: true };
          const error = new Error('missing escrow');
          error.code = 'TRANSFER_UNCERTAIN';
          throw error;
        }
        filesState.escrowPresent = false;
        filesState.sellerPresent = true;
        return { restored: true };
      },
    },
  };

  const store = require(storePath);
  const service = require(servicePath);

  return {
    store,
    service,
    filesState,
    setTransferError(value) { currentTransferError = value; },
    cleanup() {
      delete require.cache[storePath];
      delete require.cache[filePath];
      delete require.cache[servicePath];
      if (previous.db === undefined) delete process.env.AUTOMATION_DB_PATH;
      else process.env.AUTOMATION_DB_PATH = previous.db;
      if (previous.write === undefined) delete process.env.MARKETPLACE_WRITE_ENABLED;
      else process.env.MARKETPLACE_WRITE_ENABLED = previous.write;
      if (previous.p2pWrite === undefined) delete process.env.P2P_MARKETPLACE_WRITE_ENABLED;
      else process.env.P2P_MARKETPLACE_WRITE_ENABLED = previous.p2pWrite;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function createActive(fixture, seller = '76561198000000101') {
  return fixture.service.createDinoListing({
    sellerSteamId: seller,
    slot: 'slot_a',
    price: 500,
    idempotencyKey: 'listing:test:001',
  });
}

test('listing moves the real parked dino into escrow and exposes only a public snapshot', async (t) => {
  const fixture = loadMarketplace();
  t.after(fixture.cleanup);

  const result = await createActive(fixture);
  assert.equal(result.listing.status, 'active');
  assert.equal(fixture.filesState.sellerPresent, false);
  assert.equal(fixture.filesState.escrowPresent, true);
  assert.equal(result.listing.snapshot.species, 'Carnotaurus');
  assert.equal(result.listing.snapshot.growth, 0.76);
  assert.deepEqual(result.listing.snapshot.mutationList.sort(), ['Mutation_A', 'Mutation_B']);
  assert.equal(Object.hasOwn(result.listing.snapshot, 'health'), false);
  assert.equal(Object.hasOwn(result.listing.snapshot, 'location'), false);

  const publicListings = fixture.service.listPublicListings();
  assert.equal(publicListings.length, 1);
  assert.equal(Object.hasOwn(publicListings[0], 'seller_steam_id'), false);
});

test('seller cancellation restores escrowed dino and closes listing', async (t) => {
  const fixture = loadMarketplace();
  t.after(fixture.cleanup);
  const seller = '76561198000000102';
  const created = await createActive(fixture, seller);

  const cancelled = await fixture.service.cancelDinoListing({
    sellerSteamId: seller,
    listingId: created.listing.id,
  });

  assert.equal(cancelled.listing.status, 'cancelled');
  assert.equal(fixture.filesState.sellerPresent, true);
  assert.equal(fixture.filesState.escrowPresent, false);
  assert.equal(fixture.filesState.restores, 1);
});

test('buyer hold, DinoStorage transfer and seller credit complete exactly once', async (t) => {
  const fixture = loadMarketplace();
  t.after(fixture.cleanup);
  const seller = '76561198000000103';
  const buyer = '76561198000000104';
  const created = await createActive(fixture, seller);

  fixture.store.applyWalletTransaction({
    steamId: buyer,
    amount: 1000,
    kind: 'test_credit',
    reason: 'Buyer funding',
    idempotencyKey: 'fund:buyer:001',
  });

  const first = await fixture.service.buyDinoListing({
    buyerSteamId: buyer,
    listingId: created.listing.id,
    idempotencyKey: 'purchase:p2p:001',
  });

  assert.equal(first.listing.status, 'sold');
  assert.equal(first.wallet.balance, 500);
  assert.equal(fixture.store.getWallet(seller).balance, 500);
  assert.equal(fixture.filesState.buyerPresent, true);
  assert.equal(fixture.filesState.transfers, 1);

  const duplicate = await fixture.service.buyDinoListing({
    buyerSteamId: buyer,
    listingId: created.listing.id,
    idempotencyKey: 'purchase:p2p:001',
  });
  assert.equal(duplicate.listing.status, 'sold');
  assert.equal(duplicate.wallet.balance, 500);
  assert.equal(fixture.store.getWallet(seller).balance, 500);
  assert.equal(fixture.filesState.transfers, 1);

  const buyerKinds = fixture.store.getWallet(buyer).transactions.map((tx) => tx.kind);
  const sellerKinds = fixture.store.getWallet(seller).transactions.map((tx) => tx.kind);
  assert.equal(buyerKinds.filter((kind) => kind === 'marketplace_p2p_hold').length, 1);
  assert.equal(sellerKinds.filter((kind) => kind === 'marketplace_p2p_sale').length, 1);
});

test('safe transfer failure refunds buyer and reactivates listing', async (t) => {
  const fixture = loadMarketplace({ transferError: { code: 'DINO_TARGET_EXISTS', message: 'buyer slot occupied' } });
  t.after(fixture.cleanup);
  const seller = '76561198000000105';
  const buyer = '76561198000000106';
  const created = await createActive(fixture, seller);

  fixture.store.applyWalletTransaction({
    steamId: buyer,
    amount: 1000,
    kind: 'test_credit',
    reason: 'Buyer funding',
    idempotencyKey: 'fund:buyer:002',
  });

  await assert.rejects(() => fixture.service.buyDinoListing({
    buyerSteamId: buyer,
    listingId: created.listing.id,
    idempotencyKey: 'purchase:p2p:002',
  }), /buyer slot occupied/);

  const listing = fixture.store.getDinoListing(created.listing.id);
  assert.equal(listing.status, 'active');
  assert.equal(fixture.store.getWallet(buyer).balance, 1000);
  assert.equal(fixture.store.getWallet(seller).balance, 0);
  assert.equal(fixture.store.getWallet(buyer).transactions.filter((tx) => tx.kind === 'marketplace_p2p_refund').length, 1);
});

test('uncertain transfer never refunds or credits seller until reconciliation', async (t) => {
  const fixture = loadMarketplace({ transferError: { code: 'TRANSFER_UNCERTAIN', message: 'network dropped after copy' } });
  t.after(fixture.cleanup);
  const seller = '76561198000000107';
  const buyer = '76561198000000108';
  const created = await createActive(fixture, seller);

  fixture.store.applyWalletTransaction({
    steamId: buyer,
    amount: 1000,
    kind: 'test_credit',
    reason: 'Buyer funding',
    idempotencyKey: 'fund:buyer:003',
  });

  await assert.rejects(() => fixture.service.buyDinoListing({
    buyerSteamId: buyer,
    listingId: created.listing.id,
    idempotencyKey: 'purchase:p2p:003',
  }), (error) => error.code === 'TRANSFER_UNCERTAIN');

  const listing = fixture.store.getDinoListing(created.listing.id);
  assert.equal(listing.status, 'transfer_uncertain');
  assert.equal(fixture.store.getWallet(buyer).balance, 500);
  assert.equal(fixture.store.getWallet(seller).balance, 0);
  assert.equal(fixture.store.getWallet(buyer).transactions.some((tx) => tx.kind === 'marketplace_p2p_refund'), false);
});

test('seller cannot buy their own listing', async (t) => {
  const fixture = loadMarketplace();
  t.after(fixture.cleanup);
  const seller = '76561198000000109';
  const created = await createActive(fixture, seller);
  fixture.store.applyWalletTransaction({
    steamId: seller,
    amount: 1000,
    kind: 'test_credit',
    reason: 'Seller funding',
    idempotencyKey: 'fund:seller:001',
  });

  await assert.rejects(() => fixture.service.buyDinoListing({
    buyerSteamId: seller,
    listingId: created.listing.id,
    idempotencyKey: 'purchase:self:001',
  }), /own dinosaur/i);

  assert.equal(fixture.store.getDinoListing(created.listing.id).status, 'active');
  assert.equal(fixture.store.getWallet(seller).balance, 1000);
});


test('reconciler completes an uncertain transfer after retry proves buyer copy', async (t) => {
  const fixture = loadMarketplace({ transferError: { code: 'TRANSFER_UNCERTAIN', message: 'network dropped after copy' } });
  t.after(fixture.cleanup);
  const seller = '76561198000000110';
  const buyer = '76561198000000111';
  const created = await createActive(fixture, seller);

  fixture.store.applyWalletTransaction({
    steamId: buyer,
    amount: 1000,
    kind: 'test_credit',
    reason: 'Buyer funding',
    idempotencyKey: 'fund:buyer:004',
  });

  await assert.rejects(() => fixture.service.buyDinoListing({
    buyerSteamId: buyer,
    listingId: created.listing.id,
    idempotencyKey: 'purchase:p2p:004',
  }), (error) => error.code === 'TRANSFER_UNCERTAIN');

  assert.equal(fixture.store.getDinoListing(created.listing.id).status, 'transfer_uncertain');
  fixture.setTransferError(null);

  const result = await fixture.service.reconcileDinoListings();
  assert.equal(result.checked, 1);
  assert.equal(result.changed, 1);
  assert.equal(fixture.store.getDinoListing(created.listing.id).status, 'sold');
  assert.equal(fixture.store.getWallet(buyer).balance, 500);
  assert.equal(fixture.store.getWallet(seller).balance, 500);
});

test('reconciler finishes a cancelling listing after service restart', async (t) => {
  const fixture = loadMarketplace();
  t.after(fixture.cleanup);
  const seller = '76561198000000112';
  const created = await createActive(fixture, seller);

  fixture.store.db.prepare(`
    UPDATE economy_dino_listings SET status = 'cancelling' WHERE id = ?
  `).run(created.listing.id);

  const result = await fixture.service.reconcileDinoListings();
  assert.equal(result.checked, 1);
  assert.equal(result.changed, 1);
  assert.equal(fixture.store.getDinoListing(created.listing.id).status, 'cancelled');
  assert.equal(fixture.filesState.sellerPresent, true);
  assert.equal(fixture.filesState.escrowPresent, false);
});


test('seller sale ledger does not expose buyer Steam identity', async (t) => {
  const fixture = loadMarketplace();
  t.after(fixture.cleanup);
  const seller = '76561198000000110';
  const buyer = '76561198000000111';
  const created = await createActive(fixture, seller);

  fixture.store.applyWalletTransaction({
    steamId: buyer,
    amount: 1000,
    kind: 'test_credit',
    reason: 'Buyer funding',
    idempotencyKey: 'fund:buyer:privacy',
  });

  await fixture.service.buyDinoListing({
    buyerSteamId: buyer,
    listingId: created.listing.id,
    idempotencyKey: 'purchase:p2p:privacy',
  });

  const sale = fixture.store.getWallet(seller).transactions
    .find((tx) => tx.kind === 'marketplace_p2p_sale');
  assert.ok(sale);
  assert.equal(JSON.stringify(sale.metadata).includes(buyer), false);
  assert.equal(sale.metadata.listingId, created.listing.id);
});
