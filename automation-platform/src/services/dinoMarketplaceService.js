const { randomUUID } = require('node:crypto');
const store = require('./economyStore');
const files = require('./parkedDinoFileService');

const ACTIVE_STATUSES = new Set(['escrowing', 'active', 'reserved', 'transfer_uncertain', 'cancelling']);

function writeEnabled() {
  return String(process.env.MARKETPLACE_WRITE_ENABLED || '').toLowerCase() === 'true';
}

function assertWriteEnabled() {
  if (!writeEnabled()) {
    const error = new Error('Marketplace writes are disabled');
    error.code = 'MARKETPLACE_WRITE_DISABLED';
    throw error;
  }
}

function validateKey(value, name) {
  const key = String(value || '').trim();
  if (!/^[A-Za-z0-9:_-]{8,160}$/.test(key)) throw new Error(`${name} is invalid`);
  return key;
}

function validatePrice(value) {
  const price = Number(value);
  if (!Number.isSafeInteger(price) || price <= 0 || price > 100000000) {
    throw new Error('Listing price must be a positive whole number');
  }
  return price;
}

function speciesFromClassPath(classPath) {
  const match = /BP_([^./]+?)(?:_C)?(?:\.|$)/i.exec(String(classPath || ''));
  return match ? match[1].replace(/_C$/i, '') : 'Unknown';
}

function mutationList(mutations) {
  if (!mutations || typeof mutations !== 'object') return [];
  return [...new Set(Object.values(mutations)
    .filter((value) => typeof value === 'string' && value && value !== 'None'))];
}

function publicSnapshot(state, slot) {
  return {
    species: speciesFromClassPath(state?.classPath),
    growth: Number.isFinite(Number(state?.growth)) ? Number(state.growth) : null,
    gender: state?.isFemale === true ? 'Female' : state?.isFemale === false ? 'Male' : null,
    isPrime: Boolean(state?.isPrime),
    mutationList: mutationList(state?.mutations),
    skin: state?.skin && typeof state.skin === 'object' ? state.skin : null,
    capturedAt: Number(state?.capturedAt || 0) || null,
    originalSlot: slot,
  };
}

function getListing(id) {
  const listing = store.getDinoListing(id);
  if (!listing) {
    const error = new Error('Marketplace listing not found');
    error.code = 'LISTING_NOT_FOUND';
    throw error;
  }
  return listing;
}

function buyerSlotForListing(listingId) {
  return `market_${String(listingId).replace(/-/g, '').slice(0, 24)}`;
}

async function createDinoListing({ sellerSteamId, slot, price, idempotencyKey }) {
  assertWriteEnabled();
  const seller = store.validateSteamId(sellerSteamId);
  const selectedSlot = files.validateSlot(slot);
  const listingPrice = validatePrice(price);
  const key = validateKey(idempotencyKey, 'Listing idempotency key');

  const existing = store.getDinoListingByIdempotency(key);
  if (existing) {
    if (existing.seller_steam_id !== seller || existing.original_slot !== selectedSlot || Number(existing.price) !== listingPrice) {
      throw new Error('Listing idempotency key already exists with different listing data');
    }
    return { duplicate: true, listing: existing };
  }

  const state = await files.readStoredDino(seller, selectedSlot);
  const listingId = randomUUID();
  const snapshot = publicSnapshot(state, selectedSlot);
  store.ensureWallet(seller);

  try {
    store.db.prepare(`
      INSERT INTO economy_dino_listings
        (id, seller_steam_id, original_slot, price, status, idempotency_key, snapshot_json)
      VALUES (?, ?, ?, ?, 'escrowing', ?, ?)
    `).run(listingId, seller, selectedSlot, listingPrice, key, JSON.stringify(snapshot));
  } catch (error) {
    if (/unique constraint/i.test(String(error.message))) {
      const conflict = new Error('This parked dinosaur already has an active marketplace listing');
      conflict.code = 'DINO_ALREADY_LISTED';
      throw conflict;
    }
    throw error;
  }

  try {
    await files.moveStoredToEscrow({ listingId, steamId: seller, slot: selectedSlot });
    store.db.prepare(`
      UPDATE economy_dino_listings
      SET status = 'active', error = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(listingId);
  } catch (error) {
    const escrowPresent = await files.escrowExists(listingId).catch(() => false);
    const sellerPresent = await files.storedExists(seller, selectedSlot).catch(() => false);
    if (escrowPresent && !sellerPresent) {
      store.db.prepare(`
        UPDATE economy_dino_listings
        SET status = 'active', error = NULL, updated_at = datetime('now')
        WHERE id = ?
      `).run(listingId);
    } else {
      store.db.prepare(`
        UPDATE economy_dino_listings
        SET status = 'failed', error = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(String(error.message).slice(0, 500), listingId);
      throw error;
    }
  }

  return { duplicate: false, listing: getListing(listingId) };
}

async function cancelDinoListing({ sellerSteamId, listingId }) {
  assertWriteEnabled();
  const seller = store.validateSteamId(sellerSteamId);
  let listing = getListing(listingId);
  if (listing.seller_steam_id !== seller) {
    const error = new Error('Marketplace listing not found');
    error.code = 'LISTING_NOT_FOUND';
    throw error;
  }
  if (listing.status === 'cancelled') return { duplicate: true, listing };
  if (!['active', 'cancelling'].includes(listing.status)) {
    throw new Error(`Cannot cancel listing in status ${listing.status}`);
  }

  if (listing.status === 'active') {
    store.db.prepare(`
      UPDATE economy_dino_listings
      SET status = 'cancelling', error = NULL, updated_at = datetime('now')
      WHERE id = ? AND status = 'active'
    `).run(listing.id);
  }

  try {
    await files.restoreEscrowToSeller({
      listingId: listing.id,
      sellerSteamId: seller,
      sellerSlot: listing.original_slot,
    });
  } catch (error) {
    store.db.prepare(`
      UPDATE economy_dino_listings
      SET status = 'cancelling', error = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(String(error.message).slice(0, 500), listing.id);
    throw error;
  }

  store.db.prepare(`
    UPDATE economy_dino_listings
    SET status = 'cancelled', error = NULL, cancelled_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(listing.id);
  listing = getListing(listing.id);
  return { duplicate: false, listing };
}

function reservePurchase({ buyerSteamId, listingId, purchaseKey }) {
  const buyer = store.validateSteamId(buyerSteamId);
  const key = validateKey(purchaseKey, 'Purchase idempotency key');

  store.db.exec('BEGIN IMMEDIATE');
  try {
    const listing = getListing(listingId);

    if (listing.status === 'sold') {
      if (listing.buyer_steam_id === buyer && listing.purchase_key === key) {
        store.db.exec('COMMIT');
        return { duplicate: true, listing, buyer, key };
      }
      throw new Error('Marketplace listing has already sold');
    }

    if (['reserved', 'transfer_uncertain'].includes(listing.status)) {
      if (listing.buyer_steam_id === buyer && listing.purchase_key === key) {
        store.db.exec('COMMIT');
        return { duplicate: true, listing, buyer, key };
      }
      throw new Error('Marketplace listing is already reserved');
    }

    if (listing.status !== 'active') throw new Error(`Marketplace listing is not available (${listing.status})`);
    if (listing.seller_steam_id === buyer) throw new Error('You cannot buy your own dinosaur');

    store.ensureWallet(buyer);
    const wallet = store.db.prepare('SELECT balance FROM economy_wallets WHERE steam_id = ?').get(buyer);
    if (Number(wallet.balance) < Number(listing.price)) {
      const error = new Error('Not enough Valley Coin');
      error.code = 'INSUFFICIENT_FUNDS';
      throw error;
    }

    const holdKey = `p2p-hold:${key}`;
    const existingHold = store.db.prepare('SELECT id FROM economy_wallet_ledger WHERE idempotency_key = ?').get(holdKey);
    if (!existingHold) {
      store.db.prepare('UPDATE economy_wallets SET balance = ?, updated_at = datetime(\'now\') WHERE steam_id = ?')
        .run(Number(wallet.balance) - Number(listing.price), buyer);
      store.db.prepare(`
        INSERT INTO economy_wallet_ledger
          (id, steam_id, amount, kind, reason, idempotency_key, reference_type, reference_id, metadata_json)
        VALUES (?, ?, ?, 'marketplace_p2p_hold', ?, ?, 'dino_listing', ?, ?)
      `).run(
        randomUUID(),
        buyer,
        -Number(listing.price),
        `Marketplace hold for ${listing.snapshot?.species || 'parked dinosaur'}`,
        holdKey,
        listing.id,
        JSON.stringify({ listingId: listing.id })
      );
    }

    const buyerSlot = buyerSlotForListing(listing.id);
    store.db.prepare(`
      UPDATE economy_dino_listings
      SET status = 'reserved', buyer_steam_id = ?, buyer_slot = ?, purchase_key = ?,
          error = NULL, updated_at = datetime('now')
      WHERE id = ? AND status = 'active'
    `).run(buyer, buyerSlot, key, listing.id);

    const reserved = getListing(listing.id);
    store.db.exec('COMMIT');
    return { duplicate: false, listing: reserved, buyer, key };
  } catch (error) {
    try { store.db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function refundReservation(listing, reason) {
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const current = getListing(listing.id);
    if (!current.buyer_steam_id || !current.purchase_key) {
      store.db.exec('COMMIT');
      return current;
    }
    const refundKey = `p2p-refund:${current.id}:${current.purchase_key}`;
    const existing = store.db.prepare('SELECT id FROM economy_wallet_ledger WHERE idempotency_key = ?').get(refundKey);
    if (!existing) {
      const wallet = store.db.prepare('SELECT balance FROM economy_wallets WHERE steam_id = ?').get(current.buyer_steam_id);
      store.db.prepare('UPDATE economy_wallets SET balance = ?, updated_at = datetime(\'now\') WHERE steam_id = ?')
        .run(Number(wallet.balance) + Number(current.price), current.buyer_steam_id);
      store.db.prepare(`
        INSERT INTO economy_wallet_ledger
          (id, steam_id, amount, kind, reason, idempotency_key, reference_type, reference_id, metadata_json)
        VALUES (?, ?, ?, 'marketplace_p2p_refund', ?, ?, 'dino_listing', ?, ?)
      `).run(
        randomUUID(),
        current.buyer_steam_id,
        Number(current.price),
        String(reason || 'Marketplace transfer refund').slice(0, 200),
        refundKey,
        current.id,
        JSON.stringify({ listingId: current.id })
      );
    }
    store.db.prepare(`
      UPDATE economy_dino_listings
      SET status = 'active', buyer_steam_id = NULL, buyer_slot = NULL, purchase_key = NULL,
          error = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(current.id);
    const active = getListing(current.id);
    store.db.exec('COMMIT');
    return active;
  } catch (error) {
    try { store.db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function finalizeSale(listingId) {
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const listing = getListing(listingId);
    if (listing.status === 'sold') {
      store.db.exec('COMMIT');
      return listing;
    }
    if (!['reserved', 'transfer_uncertain'].includes(listing.status)) {
      throw new Error(`Cannot finalize listing in status ${listing.status}`);
    }

    store.ensureWallet(listing.seller_steam_id);
    const saleKey = `p2p-sale:${listing.id}`;
    const existing = store.db.prepare('SELECT id FROM economy_wallet_ledger WHERE idempotency_key = ?').get(saleKey);
    if (!existing) {
      const wallet = store.db.prepare('SELECT balance FROM economy_wallets WHERE steam_id = ?').get(listing.seller_steam_id);
      store.db.prepare('UPDATE economy_wallets SET balance = ?, updated_at = datetime(\'now\') WHERE steam_id = ?')
        .run(Number(wallet.balance) + Number(listing.price), listing.seller_steam_id);
      store.db.prepare(`
        INSERT INTO economy_wallet_ledger
          (id, steam_id, amount, kind, reason, idempotency_key, reference_type, reference_id, metadata_json)
        VALUES (?, ?, ?, 'marketplace_p2p_sale', ?, ?, 'dino_listing', ?, ?)
      `).run(
        randomUUID(),
        listing.seller_steam_id,
        Number(listing.price),
        `Sold ${listing.snapshot?.species || 'parked dinosaur'} on marketplace`,
        saleKey,
        listing.id,
        JSON.stringify({ listingId: listing.id })
      );
    }

    store.db.prepare(`
      UPDATE economy_dino_listings
      SET status = 'sold', error = NULL, sold_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(listing.id);
    const sold = getListing(listing.id);
    store.db.exec('COMMIT');
    return sold;
  } catch (error) {
    try { store.db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

async function buyDinoListing({ buyerSteamId, listingId, idempotencyKey }) {
  assertWriteEnabled();
  const reservation = reservePurchase({
    buyerSteamId,
    listingId,
    purchaseKey: idempotencyKey,
  });
  if (reservation.listing.status === 'sold') {
    return {
      duplicate: true,
      listing: reservation.listing,
      wallet: store.getWallet(reservation.buyer),
    };
  }

  let transferCompleted = false;
  try {
    await files.transferEscrowToStored({
      listingId: reservation.listing.id,
      buyerSteamId: reservation.buyer,
      buyerSlot: reservation.listing.buyer_slot,
    });
    transferCompleted = true;
    const sold = finalizeSale(reservation.listing.id);
    return {
      duplicate: reservation.duplicate,
      listing: sold,
      wallet: store.getWallet(reservation.buyer),
    };
  } catch (error) {
    if (transferCompleted || error.code === 'TRANSFER_UNCERTAIN') {
      store.db.prepare(`
        UPDATE economy_dino_listings
        SET status = 'transfer_uncertain', error = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(String(error.message).slice(0, 500), reservation.listing.id);
      error.code = 'TRANSFER_UNCERTAIN';
      throw error;
    }

    refundReservation(reservation.listing, `Marketplace transfer failed: ${error.message}`);
    throw error;
  }
}

async function reconcileDinoListings() {
  if (!writeEnabled()) return { skipped: true, checked: 0, changed: 0 };
  const listings = store.listDinoListings({
    statuses: ['escrowing', 'reserved', 'transfer_uncertain', 'cancelling'],
    limit: 200,
  });
  let changed = 0;
  const errors = [];

  for (const listing of listings) {
    try {
      if (listing.status === 'escrowing') {
        const escrowPresent = await files.escrowExists(listing.id);
        const sellerPresent = await files.storedExists(listing.seller_steam_id, listing.original_slot);

        if (escrowPresent && !sellerPresent) {
          store.db.prepare(`
            UPDATE economy_dino_listings
            SET status = 'active', error = NULL, updated_at = datetime('now')
            WHERE id = ?
          `).run(listing.id);
          changed += 1;
          continue;
        }

        if (!escrowPresent && sellerPresent) {
          await files.moveStoredToEscrow({
            listingId: listing.id,
            steamId: listing.seller_steam_id,
            slot: listing.original_slot,
          });
          store.db.prepare(`
            UPDATE economy_dino_listings
            SET status = 'active', error = NULL, updated_at = datetime('now')
            WHERE id = ?
          `).run(listing.id);
          changed += 1;
          continue;
        }

        const message = escrowPresent && sellerPresent
          ? 'Both seller and escrow copies exist; operator review required.'
          : 'Neither seller nor escrow copy exists; operator review required.';
        store.db.prepare(`
          UPDATE economy_dino_listings
          SET error = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(message, listing.id);
        errors.push({ id: listing.id, error: message });
        continue;
      }

      if (listing.status === 'cancelling') {
        await files.restoreEscrowToSeller({
          listingId: listing.id,
          sellerSteamId: listing.seller_steam_id,
          sellerSlot: listing.original_slot,
        });
        store.db.prepare(`
          UPDATE economy_dino_listings
          SET status = 'cancelled', error = NULL, cancelled_at = datetime('now'), updated_at = datetime('now')
          WHERE id = ?
        `).run(listing.id);
        changed += 1;
        continue;
      }

      if (listing.status === 'reserved' || listing.status === 'transfer_uncertain') {
        try {
          await files.transferEscrowToStored({
            listingId: listing.id,
            buyerSteamId: listing.buyer_steam_id,
            buyerSlot: listing.buyer_slot,
          });
          finalizeSale(listing.id);
          changed += 1;
        } catch (error) {
          if (error.code === 'DINO_TARGET_EXISTS') {
            refundReservation(listing, `Marketplace reconciliation refund: ${error.message}`);
            changed += 1;
          } else {
            store.db.prepare(`
              UPDATE economy_dino_listings
              SET status = 'transfer_uncertain', error = ?, updated_at = datetime('now')
              WHERE id = ?
            `).run(String(error.message).slice(0, 500), listing.id);
            errors.push({ id: listing.id, error: error.message });
          }
        }
      }
    } catch (error) {
      store.db.prepare(`
        UPDATE economy_dino_listings
        SET error = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(String(error.message).slice(0, 500), listing.id);
      errors.push({ id: listing.id, error: error.message });
    }
  }

  return { skipped: false, checked: listings.length, changed, errors };
}

function startDinoMarketplaceReconciler() {
  const intervalMs = Math.max(5000, Number(process.env.MARKETPLACE_RECONCILE_INTERVAL_MS || 15000));
  const timer = setInterval(() => {
    reconcileDinoListings().catch((error) => console.warn('[marketplace-reconcile]', error.message));
  }, intervalMs);
  timer.unref?.();
  return timer;
}

function listPublicListings({ limit = 100 } = {}) {
  return store.listDinoListings({ statuses: ['active'], limit }).map((listing) => ({
    id: listing.id,
    price: Number(listing.price),
    status: listing.status,
    snapshot: listing.snapshot,
    createdAt: listing.created_at,
  }));
}

function listSellerListings(sellerSteamId, { limit = 100 } = {}) {
  return store.listDinoListings({ sellerSteamId, limit });
}

module.exports = {
  ACTIVE_STATUSES,
  writeEnabled,
  assertWriteEnabled,
  validatePrice,
  publicSnapshot,
  buyerSlotForListing,
  createDinoListing,
  cancelDinoListing,
  buyDinoListing,
  listPublicListings,
  listSellerListings,
  finalizeSale,
  refundReservation,
  reconcileDinoListings,
  startDinoMarketplaceReconciler,
};
