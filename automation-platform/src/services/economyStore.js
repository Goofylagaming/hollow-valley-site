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

  CREATE TABLE IF NOT EXISTS economy_legacy_wallet_migrations (
    legacy_user_id TEXT PRIMARY KEY,
    steam_id TEXT NOT NULL UNIQUE,
    legacy_balance INTEGER NOT NULL CHECK(legacy_balance >= 0),
    migrated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (steam_id) REFERENCES economy_wallets(steam_id)
  );

  CREATE TABLE IF NOT EXISTS economy_playtime_progress (
    steam_id TEXT PRIMARY KEY,
    last_seen_ms INTEGER NOT NULL,
    accrued_ms INTEGER NOT NULL DEFAULT 0,
    rewarded_intervals INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (steam_id) REFERENCES economy_wallets(steam_id)
  );

  CREATE TABLE IF NOT EXISTS economy_quest_state (
    steam_id TEXT PRIMARY KEY,
    daily_period_key TEXT NOT NULL,
    daily_total_seconds INTEGER NOT NULL DEFAULT 0,
    daily_streak_seconds INTEGER NOT NULL DEFAULT 0,
    weekly_period_key TEXT NOT NULL,
    weekly_total_seconds INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (steam_id) REFERENCES economy_wallets(steam_id)
  );

  CREATE TABLE IF NOT EXISTS economy_quest_achievements (
    steam_id TEXT NOT NULL,
    quest_id TEXT NOT NULL,
    period_key TEXT NOT NULL,
    boost_percent INTEGER NOT NULL DEFAULT 0,
    achieved_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (steam_id, quest_id, period_key),
    FOREIGN KEY (steam_id) REFERENCES economy_wallets(steam_id)
  );
  CREATE INDEX IF NOT EXISTS idx_economy_quest_achievements_steam
    ON economy_quest_achievements(steam_id, achieved_at DESC);

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

  CREATE TABLE IF NOT EXISTS economy_dino_listings (
    id TEXT PRIMARY KEY,
    seller_steam_id TEXT NOT NULL,
    original_slot TEXT NOT NULL,
    price INTEGER NOT NULL CHECK(price > 0),
    status TEXT NOT NULL DEFAULT 'escrowing',
    idempotency_key TEXT NOT NULL UNIQUE,
    buyer_steam_id TEXT,
    buyer_slot TEXT,
    purchase_key TEXT UNIQUE,
    snapshot_json TEXT NOT NULL DEFAULT '{}',
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    sold_at TEXT,
    cancelled_at TEXT,
    FOREIGN KEY (seller_steam_id) REFERENCES economy_wallets(steam_id)
  );
  CREATE INDEX IF NOT EXISTS idx_economy_dino_listings_status_created
    ON economy_dino_listings(status, created_at ASC);
  CREATE INDEX IF NOT EXISTS idx_economy_dino_listings_seller
    ON economy_dino_listings(seller_steam_id, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_economy_dino_listings_active_slot
    ON economy_dino_listings(seller_steam_id, original_slot)
    WHERE status IN ('escrowing','active','reserved','transfer_uncertain','cancelling');

  CREATE TABLE IF NOT EXISTS economy_skin_presets (
    id TEXT PRIMARY KEY,
    owner_steam_id TEXT,
    species TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    skin_json TEXT NOT NULL,
    is_premium INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    published INTEGER NOT NULL DEFAULT 0,
    price INTEGER NOT NULL DEFAULT 0 CHECK(price >= 0),
    share_code TEXT,
    create_key TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (owner_steam_id) REFERENCES economy_wallets(steam_id)
  );
  CREATE INDEX IF NOT EXISTS idx_economy_skin_presets_owner
    ON economy_skin_presets(owner_steam_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_economy_skin_presets_species
    ON economy_skin_presets(species, active, is_premium);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_economy_skin_presets_share_code
    ON economy_skin_presets(share_code) WHERE share_code IS NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS idx_economy_skin_presets_create_key
    ON economy_skin_presets(create_key) WHERE create_key IS NOT NULL;

  CREATE TABLE IF NOT EXISTS economy_skin_unlocks (
    steam_id TEXT NOT NULL,
    preset_id TEXT NOT NULL,
    purchase_price INTEGER NOT NULL DEFAULT 0 CHECK(purchase_price >= 0),
    idempotency_key TEXT UNIQUE,
    unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (steam_id, preset_id),
    FOREIGN KEY (steam_id) REFERENCES economy_wallets(steam_id),
    FOREIGN KEY (preset_id) REFERENCES economy_skin_presets(id)
  );
  CREATE INDEX IF NOT EXISTS idx_economy_skin_unlocks_steam
    ON economy_skin_unlocks(steam_id, unlocked_at DESC);
`);

(function ensureSkinPresetStoreSchema() {
  const columns = db.prepare('PRAGMA table_info(economy_skin_presets)').all();
  const names = new Set(columns.map((column) => column.name));
  const additions = [
    ['description', "TEXT NOT NULL DEFAULT ''"],
    ['published', 'INTEGER NOT NULL DEFAULT 0'],
    ['price', 'INTEGER NOT NULL DEFAULT 0'],
    ['share_code', 'TEXT'],
    ['create_key', 'TEXT'],
  ];
  for (const [name, definition] of additions) {
    if (!names.has(name)) db.exec(`ALTER TABLE economy_skin_presets ADD COLUMN ${name} ${definition};`);
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_economy_skin_presets_share_code
      ON economy_skin_presets(share_code) WHERE share_code IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_economy_skin_presets_create_key
      ON economy_skin_presets(create_key) WHERE create_key IS NOT NULL;
    CREATE TABLE IF NOT EXISTS economy_skin_unlocks (
      steam_id TEXT NOT NULL,
      preset_id TEXT NOT NULL,
      purchase_price INTEGER NOT NULL DEFAULT 0 CHECK(purchase_price >= 0),
      idempotency_key TEXT UNIQUE,
      unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (steam_id, preset_id),
      FOREIGN KEY (steam_id) REFERENCES economy_wallets(steam_id),
      FOREIGN KEY (preset_id) REFERENCES economy_skin_presets(id)
    );
    CREATE INDEX IF NOT EXISTS idx_economy_skin_unlocks_steam
      ON economy_skin_unlocks(steam_id, unlocked_at DESC);
  `);
})();

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

function migrateLegacyWallet({ legacyUserId, steamId, balance }) {
  const id = validateSteamId(steamId);
  const legacyId = String(legacyUserId ?? '').trim();
  const legacyBalance = Number(balance);
  if (!/^[1-9]\d{0,18}$/.test(legacyId)) throw new Error('Invalid legacy user ID');
  if (!Number.isSafeInteger(legacyBalance) || legacyBalance < 0) {
    throw new Error('Legacy wallet balance must be a non-negative integer');
  }

  db.exec('BEGIN IMMEDIATE');
  try {
    ensureWallet(id);
    const existing = db.prepare(
      'SELECT * FROM economy_legacy_wallet_migrations WHERE legacy_user_id = ? OR steam_id = ?'
    ).get(legacyId, id);

    if (existing) {
      if (existing.legacy_user_id !== legacyId || existing.steam_id !== id || Number(existing.legacy_balance) !== legacyBalance) {
        const error = new Error('Legacy wallet has already been migrated with different account data');
        error.code = 'LEGACY_WALLET_MIGRATION_CONFLICT';
        throw error;
      }
      db.exec('COMMIT');
      return {
        duplicate: true,
        migration: existing,
        wallet: getWallet(id),
      };
    }

    if (legacyBalance > 0) {
      const key = `legacy-wallet-migration:user:${legacyId}`;
      const wallet = db.prepare('SELECT balance FROM economy_wallets WHERE steam_id = ?').get(id);
      const nextBalance = Number(wallet.balance) + legacyBalance;
      const transactionId = randomUUID();

      db.prepare(`
        UPDATE economy_wallets
        SET balance = ?, updated_at = datetime('now')
        WHERE steam_id = ?
      `).run(nextBalance, id);
      db.prepare(`
        INSERT INTO economy_wallet_ledger
          (id, steam_id, amount, kind, reason, idempotency_key, reference_type, reference_id, metadata_json)
        VALUES (?, ?, ?, 'legacy_wallet_migration', 'Legacy Hollow Valley wallet balance', ?, 'legacy_user', ?, ?)
      `).run(
        transactionId,
        id,
        legacyBalance,
        key,
        legacyId,
        JSON.stringify({ legacyUserId: legacyId, legacyBalance })
      );
    }

    db.prepare(`
      INSERT INTO economy_legacy_wallet_migrations
        (legacy_user_id, steam_id, legacy_balance)
      VALUES (?, ?, ?)
    `).run(legacyId, id, legacyBalance);

    const migration = db.prepare(
      'SELECT * FROM economy_legacy_wallet_migrations WHERE legacy_user_id = ?'
    ).get(legacyId);
    db.exec('COMMIT');
    return {
      duplicate: false,
      migration,
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

function getQuestState(steamId) {
  const id = validateSteamId(steamId);
  return db.prepare('SELECT * FROM economy_quest_state WHERE steam_id = ?').get(id) || null;
}

function listQuestAchievements(steamId, { periodKeys = null } = {}) {
  const id = validateSteamId(steamId);
  const keys = Array.isArray(periodKeys) ? periodKeys.filter(Boolean).map(String) : [];
  if (!keys.length) {
    return db.prepare(`
      SELECT * FROM economy_quest_achievements
      WHERE steam_id = ?
      ORDER BY achieved_at DESC
    `).all(id);
  }
  return db.prepare(`
    SELECT * FROM economy_quest_achievements
    WHERE steam_id = ? AND period_key IN (${keys.map(() => '?').join(',')})
    ORDER BY achieved_at DESC
  `).all(id, ...keys);
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

function mapSkinPreset(row, { owned = false } = {}) {
  if (!row) return null;
  return {
    ...row,
    isPremium: Boolean(row.is_premium),
    active: Boolean(row.active),
    published: Boolean(row.published),
    owned: Boolean(owned),
    price: Math.max(0, Number(row.price) || 0),
    skin: parseJson(row.skin_json),
  };
}

function getSkinPreset(id) {
  const row = db.prepare('SELECT * FROM economy_skin_presets WHERE id = ?').get(String(id || '').trim());
  return mapSkinPreset(row);
}

function getSkinPresetByShareCode(shareCode) {
  const code = String(shareCode || '').trim().toUpperCase();
  if (!code) return null;
  return mapSkinPreset(db.prepare('SELECT * FROM economy_skin_presets WHERE upper(share_code) = ?').get(code));
}

function getSkinPresetByCreateKey(createKey) {
  const key = String(createKey || '').trim();
  if (!key) return null;
  return mapSkinPreset(db.prepare('SELECT * FROM economy_skin_presets WHERE create_key = ?').get(key));
}

function hasSkinUnlock(steamId, presetId) {
  const steam = validateSteamId(steamId);
  return Boolean(db.prepare(
    'SELECT 1 FROM economy_skin_unlocks WHERE steam_id = ? AND preset_id = ?'
  ).get(steam, String(presetId || '').trim()));
}

function listSkinPresets({
  ownerSteamId = null,
  species = null,
  includePremium = true,
  activeOnly = true,
  publishedOnly = false,
  limit = 200,
} = {}) {
  const clauses = [];
  const params = [];
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));

  if (ownerSteamId) {
    const owner = validateSteamId(ownerSteamId);
    if (includePremium) {
      clauses.push('(owner_steam_id = ? OR is_premium = 1)');
      params.push(owner);
    } else {
      clauses.push('owner_steam_id = ?');
      params.push(owner);
    }
  } else if (includePremium) {
    clauses.push('is_premium = 1');
  }

  if (species) {
    clauses.push('lower(species) = lower(?)');
    params.push(String(species));
  }
  if (activeOnly) clauses.push('active = 1');
  if (publishedOnly) clauses.push('published = 1');

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`
    SELECT * FROM economy_skin_presets
    ${where}
    ORDER BY published DESC, is_premium DESC, created_at DESC
    LIMIT ?
  `).all(...params, safeLimit).map((row) => mapSkinPreset(row));
}

function listSkinStore({ steamId = null, species = null, limit = 300 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 300));
  const clauses = ['p.active = 1', 'p.published = 1'];
  const params = [];
  if (species) {
    clauses.push('lower(p.species) = lower(?)');
    params.push(String(species));
  }

  let join = '';
  let ownedExpr = '0';
  if (steamId) {
    const steam = validateSteamId(steamId);
    join = 'LEFT JOIN economy_skin_unlocks u ON u.preset_id = p.id AND u.steam_id = ?';
    params.unshift(steam);
    ownedExpr = 'CASE WHEN p.owner_steam_id = ? OR p.is_premium = 1 OR u.preset_id IS NOT NULL THEN 1 ELSE 0 END';
    params.splice(1, 0, steam);
  }

  const sql = `
    SELECT p.*, ${ownedExpr} AS owned_flag
    FROM economy_skin_presets p
    ${join}
    WHERE ${clauses.join(' AND ')}
    ORDER BY p.is_premium DESC, p.price ASC, p.created_at DESC
    LIMIT ?
  `;
  return db.prepare(sql).all(...params, safeLimit).map((row) => mapSkinPreset(row, { owned: Boolean(row.owned_flag) }));
}

function listOwnedSkinPresets(steamId, { limit = 300 } = {}) {
  const steam = validateSteamId(steamId);
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 300));
  return db.prepare(`
    SELECT p.*, CASE WHEN p.owner_steam_id = ? OR p.is_premium = 1 OR u.preset_id IS NOT NULL THEN 1 ELSE 0 END AS owned_flag
    FROM economy_skin_presets p
    LEFT JOIN economy_skin_unlocks u ON u.preset_id = p.id AND u.steam_id = ?
    WHERE p.active = 1 AND (p.owner_steam_id = ? OR p.is_premium = 1 OR u.preset_id IS NOT NULL)
    ORDER BY p.owner_steam_id = ? DESC, p.published DESC, p.created_at DESC
    LIMIT ?
  `).all(steam, steam, steam, steam, safeLimit)
    .map((row) => mapSkinPreset(row, { owned: Boolean(row.owned_flag) }));
}

function getDinoListing(id) {
  const row = db.prepare('SELECT * FROM economy_dino_listings WHERE id = ?').get(String(id || '').trim());
  return row ? { ...row, snapshot: parseJson(row.snapshot_json) } : null;
}

function getDinoListingByIdempotency(idempotencyKey) {
  const row = db.prepare('SELECT * FROM economy_dino_listings WHERE idempotency_key = ?').get(String(idempotencyKey || '').trim());
  return row ? { ...row, snapshot: parseJson(row.snapshot_json) } : null;
}

function listDinoListings({ sellerSteamId = null, statuses = null, limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const clauses = [];
  const params = [];
  if (sellerSteamId) {
    clauses.push('seller_steam_id = ?');
    params.push(validateSteamId(sellerSteamId));
  }
  if (Array.isArray(statuses) && statuses.length) {
    clauses.push(`status IN (${statuses.map(() => '?').join(',')})`);
    params.push(...statuses.map(String));
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`
    SELECT * FROM economy_dino_listings
    ${where}
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...params, safeLimit).map((row) => ({
    ...row,
    snapshot: parseJson(row.snapshot_json),
  }));
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
  db,
  dbPath,
  validateSteamId,
  ensureWallet,
  getWallet,
  getLedgerByIdempotency,
  applyWalletTransaction,
  migrateLegacyWallet,
  getPlaytimeProgress,
  getQuestState,
  listQuestAchievements,
  upsertCatalogItem,
  getCatalogItem,
  listCatalog,
  getSkinPreset,
  getSkinPresetByShareCode,
  getSkinPresetByCreateKey,
  hasSkinUnlock,
  listSkinPresets,
  listSkinStore,
  listOwnedSkinPresets,
  getDinoListing,
  getDinoListingByIdempotency,
  listDinoListings,
  getOrder,
  listOrders,
};
