const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.env.AUTOMATION_DB_PATH || path.join(__dirname, '..', '..', 'data', 'automation.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS economy_wallets (
    steam_id TEXT PRIMARY KEY,
    balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS economy_wallet_ledger (
    id TEXT PRIMARY KEY,
    steam_id TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK(amount <> 0),
    kind TEXT NOT NULL,
    reason TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    reference_type TEXT,
    reference_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (steam_id) REFERENCES economy_wallets(steam_id)
  );
  CREATE INDEX IF NOT EXISTS idx_economy_ledger_steam_created
    ON economy_wallet_ledger(steam_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS economy_playtime_progress (
    steam_id TEXT PRIMARY KEY,
    last_seen_ms INTEGER NOT NULL,
    accrued_ms INTEGER NOT NULL DEFAULT 0,
    rewarded_intervals INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (steam_id) REFERENCES economy_wallets(steam_id)
  );

  CREATE TABLE IF NOT EXISTS economy_marketplace_catalog (
    id TEXT PRIMARY KEY,
    item_type TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    price INTEGER NOT NULL CHECK(price > 0),
    payload_json TEXT NOT NULL DEFAULT '{}',
    active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS economy_marketplace_orders (
    id TEXT PRIMARY KEY,
    steam_id TEXT NOT NULL,
    catalog_id TEXT NOT NULL,
    price INTEGER NOT NULL CHECK(price > 0),
    status TEXT NOT NULL DEFAULT 'pending',
    idempotency_key TEXT NOT NULL UNIQUE,
    item_snapshot_json TEXT NOT NULL DEFAULT '{}',
    fulfillment_json TEXT NOT NULL DEFAULT '{}',
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    fulfilled_at TEXT,
    FOREIGN KEY (steam_id) REFERENCES economy_wallets(steam_id),
    FOREIGN KEY (catalog_id) REFERENCES economy_marketplace_catalog(id)
  );
  CREATE INDEX IF NOT EXISTS idx_economy_orders_steam_created
    ON economy_marketplace_orders(steam_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_economy_orders_status_created
    ON economy_marketplace_orders(status, created_at ASC);
`);

function validateSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw new Error('Invalid Steam ID');
  return steamId;
}

function parseJson(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function ensureWallet(steamId) {
  const id = validateSteamId(steamId);
  db.prepare(`
    INSERT INTO economy_wallets (steam_id, balance)
    VALUES (?, 0)
    ON CONFLICT(steam_id) DO NOTHING
  `).run(id);
  return db.prepare('SELECT * FROM economy_wallets WHERE steam_id = ?').get(id);
}

function getWallet(steamId, { limit = 50 } = {}) {
  const id = validateSteamId(steamId);
  const wallet = ensureWallet(id);
  const safeLimit = Math.max(1, Math.min(200, Number(limit) || 50));
  const transactions = db.prepare(`
    SELECT id, amount, kind, reason, reference_type, reference_id, metadata_json, created_at
    FROM economy_wallet_ledger
    WHERE steam_id = ?
    ORDER BY created_at DESC, rowid DESC
    LIMIT ?
  `).all(id, safeLimit).map((row) => ({
    ...row,
    metadata: parseJson(row.metadata_json),
  }));
  return { steamId: id, balance: Number(wallet.balance) || 0, transactions };
}

function getLedgerByIdempotency(idempotencyKey) {
  const key = String(idempotencyKey || '').trim();
  if (!key) return null;
  const row = db.prepare('SELECT * FROM economy_wallet_ledger WHERE idempotency_key = ?').get(key);
  return row ? { ...row, metadata: parseJson(row.metadata_json) } : null;
}

function applyWalletTransaction({
  steamId,
  amount,
  kind,
  reason,
  idempotencyKey,
  referenceType = null,
  referenceId = null,
  metadata = {},
}) {
  const id = validateSteamId(steamId);
  const delta = Number(amount);
  if (!Number.isSafeInteger(delta) || delta === 0) throw new Error('Wallet amount must be a non-zero integer');
  const txKind = String(kind || '').trim();
  const txReason = String(reason || '').trim();
  const key = String(idempotencyKey || '').trim();
  if (!txKind || !txReason || !key) throw new Error('Wallet transaction kind, reason and idempotency key are required');
  if (key.length > 160) throw new Error('Wallet idempotency key is too long');

  db.exec('BEGIN IMMEDIATE');
  try {
    ensureWallet(id);
    const existing = getLedgerByIdempotency(key);
    if (existing) {
      if (existing.steam_id !== id || Number(existing.amount) !== delta || existing.kind !== txKind) {
        throw new Error('Wallet idempotency key already exists with different transaction data');
      }
      db.exec('COMMIT');
      return { duplicate: true, transaction: existing, wallet: getWallet(id) };
    }

    const wallet = db.prepare('SELECT balance FROM economy_wallets WHERE steam_id = ?').get(id);
    const nextBalance = Number(wallet.balance) + delta;
    if (nextBalance < 0) {
      const error = new Error('Insufficient Valley Coin');
      error.code = 'INSUFFICIENT_FUNDS';
      throw error;
    }

    const transactionId = randomUUID();
    db.prepare(`
      UPDATE economy_wallets
      SET balance = ?, updated_at = datetime('now')
      WHERE steam_id = ?
    `).run(nextBalance, id);
    db.prepare(`
      INSERT INTO economy_wallet_ledger
        (id, steam_id, amount, kind, reason, idempotency_key, reference_type, reference_id, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      transactionId,
      id,
      delta,
      txKind,
      txReason,
      key,
      referenceType ? String(referenceType) : null,
      referenceId ? String(referenceId) : null,
      JSON.stringify(metadata || {})
    );
    db.exec('COMMIT');
    return {
      duplicate: false,
      transaction: getLedgerByIdempotency(key),
      wallet: getWallet(id),
    };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function getPlaytimeProgress(steamId) {
  const id = validateSteamId(steamId);
  return db.prepare('SELECT * FROM economy_playtime_progress WHERE steam_id = ?').get(id) || null;
}

function upsertCatalogItem({ id, itemType, name, description = null, price, payload = {}, active = true, sortOrder = 0 }) {
  const catalogId = String(id || '').trim();
  if (!/^[A-Za-z0-9:_-]{2,80}$/.test(catalogId)) throw new Error('Invalid catalog item ID');
  const type = String(itemType || '').trim();
  const title = String(name || '').trim();
  const cost = Number(price);
  if (!type || !title) throw new Error('Catalog item type and name are required');
  if (!Number.isSafeInteger(cost) || cost <= 0) throw new Error('Catalog price must be a positive integer');

  db.prepare(`
    INSERT INTO economy_marketplace_catalog
      (id, item_type, name, description, price, payload_json, active, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      item_type = excluded.item_type,
      name = excluded.name,
      description = excluded.description,
      price = excluded.price,
      payload_json = excluded.payload_json,
      active = excluded.active,
      sort_order = excluded.sort_order,
      updated_at = datetime('now')
  `).run(catalogId, type, title, description, cost, JSON.stringify(payload || {}), active ? 1 : 0, Number(sortOrder) || 0);
  return getCatalogItem(catalogId);
}

function getCatalogItem(id) {
  const row = db.prepare('SELECT * FROM economy_marketplace_catalog WHERE id = ?').get(String(id));
  return row ? { ...row, payload: parseJson(row.payload_json), active: Boolean(row.active) } : null;
}

function listCatalog({ activeOnly = true } = {}) {
  const rows = db.prepare(`
    SELECT * FROM economy_marketplace_catalog
    ${activeOnly ? 'WHERE active = 1' : ''}
    ORDER BY sort_order ASC, price ASC, name ASC
  `).all();
  return rows.map((row) => ({ ...row, payload: parseJson(row.payload_json), active: Boolean(row.active) }));
}

function getOrder(id) {
  const row = db.prepare('SELECT * FROM economy_marketplace_orders WHERE id = ?').get(String(id));
  return row ? {
    ...row,
    itemSnapshot: parseJson(row.item_snapshot_json),
    fulfillment: parseJson(row.fulfillment_json),
  } : null;
}

function listOrders({ steamId = null, statuses = null, limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const clauses = [];
  const params = [];
  if (steamId) {
    clauses.push('steam_id = ?');
    params.push(validateSteamId(steamId));
  }
  if (Array.isArray(statuses) && statuses.length) {
    clauses.push(`status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses.map(String));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`
    SELECT * FROM economy_marketplace_orders
    ${where}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...params, safeLimit).map((row) => ({
    ...row,
    itemSnapshot: parseJson(row.item_snapshot_json),
    fulfillment: parseJson(row.fulfillment_json),
  }));
}

module.exports = {
  dbPath,
  validateSteamId,
  ensureWallet,
  getWallet,
  getLedgerByIdempotency,
  applyWalletTransaction,
  getPlaytimeProgress,
  upsertCatalogItem,
  getCatalogItem,
  listCatalog,
  getOrder,
  listOrders,
};
