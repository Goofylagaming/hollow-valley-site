const { randomUUID } = require('node:crypto');
const store = require('./economyStore');

const db = store.db;

function purchaseCatalogItem({ steamId, catalogId, idempotencyKey }) {
  const buyer = store.validateSteamId(steamId);
  const itemId = String(catalogId || '').trim();
  const key = String(idempotencyKey || '').trim();
  if (!key || key.length > 160) throw new Error('Marketplace idempotency key is required');

  db.exec('BEGIN IMMEDIATE');
  try {
    store.ensureWallet(buyer);
    const existingOrder = db.prepare('SELECT * FROM economy_marketplace_orders WHERE idempotency_key = ?').get(key);
    if (existingOrder) {
      if (existingOrder.steam_id !== buyer || existingOrder.catalog_id !== itemId) {
        throw new Error('Marketplace idempotency key already exists with different order data');
      }
      db.exec('COMMIT');
      return { duplicate: true, order: store.getOrder(existingOrder.id), wallet: store.getWallet(buyer) };
    }

    const item = store.getCatalogItem(itemId);
    if (!item || !item.active) {
      const error = new Error('Marketplace item is unavailable');
      error.code = 'CATALOG_ITEM_UNAVAILABLE';
      throw error;
    }

    const wallet = db.prepare('SELECT balance FROM economy_wallets WHERE steam_id = ?').get(buyer);
    if (Number(wallet.balance) < Number(item.price)) {
      const error = new Error('Not enough Valley Coin');
      error.code = 'INSUFFICIENT_FUNDS';
      throw error;
    }

    const orderId = randomUUID();
    const nextBalance = Number(wallet.balance) - Number(item.price);
    const snapshot = {
      id: item.id,
      itemType: item.item_type,
      name: item.name,
      description: item.description,
      price: item.price,
      payload: item.payload,
    };

    db.prepare('UPDATE economy_wallets SET balance = ?, updated_at = datetime(\'now\') WHERE steam_id = ?')
      .run(nextBalance, buyer);
    db.prepare(`
      INSERT INTO economy_wallet_ledger
        (id, steam_id, amount, kind, reason, idempotency_key, reference_type, reference_id, metadata_json)
      VALUES (?, ?, ?, 'marketplace_purchase', ?, ?, 'marketplace_order', ?, ?)
    `).run(
      randomUUID(),
      buyer,
      -Number(item.price),
      `Marketplace purchase: ${item.name}`,
      `wallet:${key}`,
      orderId,
      JSON.stringify({ catalogId: item.id })
    );
    db.prepare(`
      INSERT INTO economy_marketplace_orders
        (id, steam_id, catalog_id, price, status, idempotency_key, item_snapshot_json)
      VALUES (?, ?, ?, ?, 'pending', ?, ?)
    `).run(orderId, buyer, item.id, Number(item.price), key, JSON.stringify(snapshot));
    db.exec('COMMIT');

    return {
      duplicate: false,
      order: store.getOrder(orderId),
      wallet: store.getWallet(buyer),
    };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function markOrderFulfilled(orderId, fulfillment = {}) {
  const id = String(orderId || '').trim();
  const order = store.getOrder(id);
  if (!order) throw new Error('Marketplace order not found');
  if (order.status === 'fulfilled') return order;
  if (order.status !== 'pending') throw new Error(`Cannot fulfill marketplace order in status ${order.status}`);
  db.prepare(`
    UPDATE economy_marketplace_orders
    SET status = 'fulfilled', fulfillment_json = ?, error = NULL,
        fulfilled_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND status = 'pending'
  `).run(JSON.stringify(fulfillment || {}), id);
  return store.getOrder(id);
}

function markOrderFailed(orderId, errorMessage) {
  const id = String(orderId || '').trim();
  const order = store.getOrder(id);
  if (!order) throw new Error('Marketplace order not found');
  if (order.status === 'fulfilled' || order.status === 'refunded') return order;
  db.prepare(`
    UPDATE economy_marketplace_orders
    SET status = 'failed', error = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(String(errorMessage || 'Marketplace fulfillment failed').slice(0, 500), id);
  return store.getOrder(id);
}

function refundOrder(orderId, reason = 'Marketplace order refund') {
  const id = String(orderId || '').trim();
  db.exec('BEGIN IMMEDIATE');
  try {
    const order = store.getOrder(id);
    if (!order) throw new Error('Marketplace order not found');
    if (order.status === 'refunded') {
      db.exec('COMMIT');
      return { duplicate: true, order, wallet: store.getWallet(order.steam_id) };
    }
    if (order.status === 'fulfilled') throw new Error('Fulfilled marketplace orders require an explicit return workflow before refund');

    const refundKey = `marketplace-refund:${id}`;
    const existing = db.prepare('SELECT id FROM economy_wallet_ledger WHERE idempotency_key = ?').get(refundKey);
    if (!existing) {
      const wallet = db.prepare('SELECT balance FROM economy_wallets WHERE steam_id = ?').get(order.steam_id);
      db.prepare('UPDATE economy_wallets SET balance = ?, updated_at = datetime(\'now\') WHERE steam_id = ?')
        .run(Number(wallet.balance) + Number(order.price), order.steam_id);
      db.prepare(`
        INSERT INTO economy_wallet_ledger
          (id, steam_id, amount, kind, reason, idempotency_key, reference_type, reference_id, metadata_json)
        VALUES (?, ?, ?, 'marketplace_refund', ?, ?, 'marketplace_order', ?, '{}')
      `).run(randomUUID(), order.steam_id, Number(order.price), String(reason), refundKey, id);
    }

    db.prepare(`
      UPDATE economy_marketplace_orders
      SET status = 'refunded', error = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(id);
    db.exec('COMMIT');
    return { duplicate: false, order: store.getOrder(id), wallet: store.getWallet(order.steam_id) };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

module.exports = {
  purchaseCatalogItem,
  markOrderFulfilled,
  markOrderFailed,
  refundOrder,
};
