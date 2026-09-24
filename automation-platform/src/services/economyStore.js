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
    exclusive INTEGER NOT NULL DEFAULT 0,
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
  CREATE TABLE IF NOT EXISTS economy_skin_grants (
    steam_id TEXT NOT NULL,
    preset_id TEXT NOT NULL,
    granted_by_steam_id TEXT,
    note TEXT NOT NULL DEFAULT '',
    custom_species TEXT,
    custom_name TEXT,
    custom_description TEXT,
    custom_skin_json TEXT,
    customized_at TEXT,
    granted_at TEXT NOT NULL DEFAULT (datetime('now')),
    revoked_at TEXT,
    PRIMARY KEY (steam_id, preset_id),
    FOREIGN KEY (steam_id) REFERENCES economy_wallets(steam_id),
    FOREIGN KEY (preset_id) REFERENCES economy_skin_presets(id)
  );
  CREATE INDEX IF NOT EXISTS idx_economy_skin_grants_steam
    ON economy_skin_grants(steam_id, granted_at DESC);
  CREATE INDEX IF NOT EXISTS idx_economy_skin_grants_preset
    ON economy_skin_grants(preset_id, granted_at DESC);
`);

(function ensureSkinPresetStoreSchema() {
  const columns = db.prepare('PRAGMA table_info(economy_skin_presets)').all();
  const names = new Set(columns.map((column) => column.name));
  const additions = [
    ['description', "TEXT NOT NULL DEFAULT ''"],
    ['published', 'INTEGER NOT NULL DEFAULT 0'],
    ['exclusive', 'INTEGER NOT NULL DEFAULT 0'],
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
    CREATE TABLE IF NOT EXISTS economy_skin_grants (
      steam_id TEXT NOT NULL,
      preset_id TEXT NOT NULL,
      granted_by_steam_id TEXT,
      note TEXT NOT NULL DEFAULT '',
      granted_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT,
      PRIMARY KEY (steam_id, preset_id),
      FOREIGN KEY (steam_id) REFERENCES economy_wallets(steam_id),
      FOREIGN KEY (preset_id) REFERENCES economy_skin_presets(id)
    );
    CREATE INDEX IF NOT EXISTS idx_economy_skin_grants_steam
      ON economy_skin_grants(steam_id, granted_at DESC);
    CREATE INDEX IF NOT EXISTS idx_economy_skin_grants_preset
      ON economy_skin_grants(preset_id, granted_at DESC);
  `);

  const grantColumns = db.prepare('PRAGMA table_info(economy_skin_grants)').all();
  const grantNames = new Set(grantColumns.map((column) => column.name));
  const grantAdditions = [
    ['custom_species', 'TEXT'],
    ['custom_name', 'TEXT'],
    ['custom_description', 'TEXT'],
    ['custom_skin_json', 'TEXT'],
    ['customized_at', 'TEXT'],
  ];
  for (const [name, definition] of grantAdditions) {
    if (!grantNames.has(name)) db.exec(`ALTER TABLE economy_skin_grants ADD COLUMN ${name} ${definition};`);
  }
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
  const granted = Boolean(row.granted_flag);
  const customized = granted && Boolean(row.grant_customized_at);
  return {
    ...row,
    species: customized && row.grant_custom_species ? row.grant_custom_species : row.species,
    name: customized && row.grant_custom_name ? row.grant_custom_name : row.name,
    description: customized && row.grant_custom_description !== null && row.grant_custom_description !== undefined
      ? row.grant_custom_description
      : row.description,
    isPremium: Boolean(row.is_premium),
    active: Boolean(row.active),
    published: Boolean(row.published),
    exclusive: Boolean(row.exclusive),
    granted,
    grantCustomized: customized,
    grantNote: row.grant_note || '',
    grantedAt: row.granted_at || null,
    customizedAt: row.grant_customized_at || null,
    owned: Boolean(owned),
    price: Math.max(0, Number(row.price) || 0),
    skin: parseJson(customized && row.grant_custom_skin_json ? row.grant_custom_skin_json : row.skin_json),
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


function hasSkinGrant(steamId, presetId) {
  const steam = validateSteamId(steamId);
  return Boolean(db.prepare(
    'SELECT 1 FROM economy_skin_grants WHERE steam_id = ? AND preset_id = ? AND revoked_at IS NULL'
  ).get(steam, String(presetId || '').trim()));
}

function getSkinGrant(steamId, presetId) {
  const steam = validateSteamId(steamId);
  return db.prepare(`
    SELECT *
    FROM economy_skin_grants
    WHERE steam_id = ? AND preset_id = ? AND revoked_at IS NULL
  `).get(steam, String(presetId || '').trim()) || null;
}

function customizeSkinGrant({ steamId, presetId, species, name, description, skin }) {
  const steam = validateSteamId(steamId);
  const id = String(presetId || '').trim();
  const result = db.prepare(`
    UPDATE economy_skin_grants
    SET custom_species = ?,
        custom_name = ?,
        custom_description = ?,
        custom_skin_json = ?,
        customized_at = datetime('now')
    WHERE steam_id = ? AND preset_id = ? AND revoked_at IS NULL
  `).run(
    String(species || '').trim(),
    String(name || '').trim(),
    String(description || '').trim(),
    JSON.stringify(skin || {}),
    steam,
    id
  );
  if (!result.changes) {
    const error = new Error('Exclusive skin grant was not found');
    error.code = 'SKIN_GRANT_NOT_FOUND';
    throw error;
  }
  return getSkinGrant(steam, id);
}

function grantSkinPreset({ steamId, presetId, grantedBySteamId = null, note = '' }) {
  const steam = validateSteamId(steamId);
  const id = String(presetId || '').trim();
  const preset = getSkinPreset(id);
  if (!preset || !preset.active) {
    const error = new Error('Skin preset not found');
    error.code = 'SKIN_PRESET_NOT_FOUND';
    throw error;
  }
  ensureWallet(steam);
  const grantedBy = grantedBySteamId ? validateSteamId(grantedBySteamId) : null;
  const grantNote = String(note || '').trim().slice(0, 240);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(`
      UPDATE economy_skin_presets
      SET exclusive = 1, published = 0, is_premium = 0, price = 0, updated_at = datetime('now')
      WHERE id = ?
    `).run(id);
    db.prepare(`
      INSERT INTO economy_skin_grants
        (steam_id, preset_id, granted_by_steam_id, note, granted_at, revoked_at)
      VALUES (?, ?, ?, ?, datetime('now'), NULL)
      ON CONFLICT(steam_id, preset_id) DO UPDATE SET
        granted_by_steam_id = excluded.granted_by_steam_id,
        note = excluded.note,
        granted_at = datetime('now'),
        revoked_at = NULL
    `).run(steam, id, grantedBy, grantNote);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return {
    preset: { ...getSkinPreset(id), owned: true, granted: true, grantNote, grantedAt: new Date().toISOString() },
    grant: db.prepare('SELECT * FROM economy_skin_grants WHERE steam_id = ? AND preset_id = ?').get(steam, id),
  };
}

function revokeSkinGrant({ steamId, presetId }) {
  const steam = validateSteamId(steamId);
  const id = String(presetId || '').trim();
  const result = db.prepare(`
    UPDATE economy_skin_grants
    SET revoked_at = datetime('now')
    WHERE steam_id = ? AND preset_id = ? AND revoked_at IS NULL
  `).run(steam, id);
  return { steamId: steam, presetId: id, revoked: Number(result.changes || 0) > 0 };
}

function listSkinGrants(presetId, { activeOnly = true } = {}) {
  const id = String(presetId || '').trim();
  return db.prepare(`
    SELECT steam_id, preset_id, granted_by_steam_id, note, granted_at, revoked_at
    FROM economy_skin_grants
    WHERE preset_id = ? ${activeOnly ? 'AND revoked_at IS NULL' : ''}
    ORDER BY granted_at DESC
  `).all(id);
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
  const clauses = ['p.active = 1', 'p.published = 1', 'COALESCE(p.exclusive, 0) = 0'];
  const filters = [];
  if (species) {
    clauses.push('lower(p.species) = lower(?)');
    filters.push(String(species));
  }

  if (!steamId) {
    return db.prepare(`
      SELECT p.*, 0 AS owned_flag, 0 AS granted_flag, '' AS grant_note, NULL AS granted_at
      FROM economy_skin_presets p
      WHERE ${clauses.join(' AND ')}
      ORDER BY p.is_premium DESC, p.price ASC, p.created_at DESC
      LIMIT ?
    `).all(...filters, safeLimit).map((row) => mapSkinPreset(row, { owned: false }));
  }

  const steam = validateSteamId(steamId);
  return db.prepare(`
    SELECT p.*,
      CASE WHEN p.owner_steam_id = ? OR p.is_premium = 1 OR u.preset_id IS NOT NULL OR g.preset_id IS NOT NULL THEN 1 ELSE 0 END AS owned_flag,
      CASE WHEN g.preset_id IS NOT NULL THEN 1 ELSE 0 END AS granted_flag,
      COALESCE(g.note, '') AS grant_note,
      g.custom_species AS grant_custom_species,
      g.custom_name AS grant_custom_name,
      g.custom_description AS grant_custom_description,
      g.custom_skin_json AS grant_custom_skin_json,
      g.customized_at AS grant_customized_at,
      g.granted_at AS granted_at
    FROM economy_skin_presets p
    LEFT JOIN economy_skin_unlocks u ON u.preset_id = p.id AND u.steam_id = ?
    LEFT JOIN economy_skin_grants g ON g.preset_id = p.id AND g.steam_id = ? AND g.revoked_at IS NULL
    WHERE ${clauses.join(' AND ')}
    ORDER BY p.is_premium DESC, p.price ASC, p.created_at DESC
    LIMIT ?
  `).all(steam, steam, steam, ...filters, safeLimit)
    .map((row) => mapSkinPreset(row, { owned: Boolean(row.owned_flag) }));
}

function listOwnedSkinPresets(steamId, { limit = 300 } = {}) {
  const steam = validateSteamId(steamId);
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 300));
  return db.prepare(`
    SELECT p.*,
      1 AS owned_flag,
      CASE WHEN g.preset_id IS NOT NULL THEN 1 ELSE 0 END AS granted_flag,
      COALESCE(g.note, '') AS grant_note,
      g.custom_species AS grant_custom_species,
      g.custom_name AS grant_custom_name,
      g.custom_description AS grant_custom_description,
      g.custom_skin_json AS grant_custom_skin_json,
      g.customized_at AS grant_customized_at,
      g.granted_at AS granted_at
    FROM economy_skin_presets p
    LEFT JOIN economy_skin_unlocks u ON u.preset_id = p.id AND u.steam_id = ?
    LEFT JOIN economy_skin_grants g ON g.preset_id = p.id AND g.steam_id = ? AND g.revoked_at IS NULL
    WHERE p.active = 1
      AND (p.owner_steam_id = ? OR p.is_premium = 1 OR u.preset_id IS NOT NULL OR g.preset_id IS NOT NULL)
    ORDER BY
      CASE WHEN p.owner_steam_id = ? THEN 0 WHEN g.preset_id IS NOT NULL THEN 1 ELSE 2 END,
      p.published DESC,
      p.created_at DESC
    LIMIT ?
  `).all(steam, steam, steam, steam, safeLimit)
    .map((row) => mapSkinPreset(row, { owned: true }));
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
  hasSkinGrant,
  getSkinGrant,
  customizeSkinGrant,
  grantSkinPreset,
  revokeSkinGrant,
  listSkinGrants,
  listSkinPresets,
  listSkinStore,
  listOwnedSkinPresets,
  getDinoListing,
  getDinoListingByIdempotency,
  listDinoListings,
  getOrder,
  listOrders,
};
