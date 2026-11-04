const { randomUUID } = require('node:crypto');

const BONUS_SLOTS = Object.freeze({ supporter: 1, guardian: 2, legend: 4 });
const SERVER_ACK = 'all-storage-intake-paths-verified';
const LOCK_MS = 60000;
const schemaReady = new WeakSet();

function error(code, message, status = 409) {
  return Object.assign(new Error(message), { code, status });
}

function validateSteamId(value) {
  const steamId = String(value || '').trim();
  if (!/^\d{17}$/.test(steamId)) throw error('INVALID_STEAM_ID', 'A valid Steam account is required.', 400);
  return steamId;
}

function validateSlot(value) {
  const slot = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(slot)) throw error('INVALID_STORAGE_SLOT', 'Invalid dinosaur storage slot.', 400);
  return slot;
}

function enabled(env = process.env) {
  return String(env.DINOSTORAGE_MEMBERSHIP_CAPACITY_ENABLED || '').toLowerCase() === 'true';
}

function configuration(env = process.env) {
  const base = Number(env.DINOSTORAGE_BASE_SLOTS);
  const baseSlots = Number.isSafeInteger(base) && base > 0 ? base : null;
  const baseUrl = String(env.HOLLOW_VALLEY_API_BASE_URL || env.HOLLOW_VALLEY_SITE_URL || '').trim().replace(/\/$/, '');
  const token = String(env.HOLLOW_VALLEY_API_TOKEN || '').trim();
  const serverVerified = env.DINOSTORAGE_CAPACITY_SERVER_ACK === SERVER_ACK;
  const configured = Boolean(baseSlots && /^https?:\/\//i.test(baseUrl) && token && serverVerified);
  return { enabled: enabled(env), configured, baseSlots, baseUrl, token, serverVerified };
}

function requireConfiguration(env) {
  const config = configuration(env);
  if (!config.configured) {
    throw error('DINOSTORAGE_CAPACITY_UNCONFIGURED', 'Extra storage is still being prepared. Please try storing again after setup is complete; existing dinosaurs can still be retrieved.', 503);
  }
  return config;
}

function database() {
  // Lazy access keeps this disabled rollout independent of existing economy
  // startup and allows the same transaction to protect purchases and admissions.
  const db = require('./economyStore').db;
  if (!schemaReady.has(db)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS membership_storage_reservations (
        operation_key TEXT PRIMARY KEY,
        steam_id TEXT NOT NULL,
        slot TEXT NOT NULL COLLATE NOCASE,
        command_id TEXT,
        materialized_at_ms INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (steam_id, slot)
      );
      CREATE INDEX IF NOT EXISTS idx_membership_storage_reservations_steam
        ON membership_storage_reservations(steam_id);
      CREATE TABLE IF NOT EXISTS membership_storage_admission_locks (
        steam_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        expires_at_ms INTEGER NOT NULL
      );
    `);
    schemaReady.add(db);
  }
  return db;
}

function initialize() {
  database();
}

function operationKey(value) {
  const key = String(value || '').trim();
  if (!key || key.length > 240 || /[\x00-\x1f]/.test(key)) throw error('INVALID_STORAGE_OPERATION', 'Invalid storage operation.', 400);
  return key;
}

function officialSlot(orderId) {
  return `shop_${String(orderId || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`;
}

function reservationsForSteam(steamId, db = database()) {
  return db.prepare('SELECT * FROM membership_storage_reservations WHERE steam_id = ?').all(steamId);
}

function ownedIncoming(steamId, db = database()) {
  const incoming = new Map();
  for (const row of db.prepare("SELECT id FROM economy_marketplace_orders WHERE steam_id = ? AND status = 'pending'").all(steamId)) {
    incoming.set(officialSlot(row.id), `official:${row.id}`);
  }
  for (const row of db.prepare("SELECT id, buyer_slot FROM economy_dino_listings WHERE buyer_steam_id = ? AND status IN ('reserved','transfer_uncertain')").all(steamId)) {
    if (row.buyer_slot) incoming.set(row.buyer_slot, `p2p:${row.id}`);
  }
  return incoming;
}

function ownedEscrowCount(steamId, db = database()) {
  // Listing a dinosaur does not create a free extra slot that could be filled
  // and then bypassed by cancelling the listing. Returns remain unrestricted.
  return Number(db.prepare("SELECT count(*) AS n FROM economy_dino_listings WHERE seller_steam_id = ? AND status IN ('escrowing','active','reserved','transfer_uncertain','cancelling')").get(steamId).n);
}

function countUsage(steamId, dinos, db = database(), snapshotStartedAt = 0) {
  const stored = new Set(dinos.map((dino) => validateSlot(dino.slot).toLowerCase()));
  const incoming = ownedIncoming(steamId, db);
  const reservations = reservationsForSteam(steamId, db);
  const retired = reservations.filter((row) => row.materialized_at_ms && row.materialized_at_ms < snapshotStartedAt && !stored.has(row.slot.toLowerCase()));
  const retiredKeys = new Set(retired.map((row) => row.operation_key));
  const slots = new Set([...stored, ...incoming.keys(), ...reservations.filter((row) => !retiredKeys.has(row.operation_key)).map((row) => row.slot.toLowerCase())]);
  const escrow = ownedEscrowCount(steamId, db);
  return {
    used: slots.size + escrow,
    stored: stored.size,
    escrow,
    pending: [...slots].filter((slot) => !stored.has(slot)).length,
    storedSlots: stored,
    incoming,
    reservations,
    retired,
  };
}

async function entitlement(steamId, { env = process.env, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const config = requireConfiguration(env);
  let response;
  try {
    response = await fetchImpl(`${config.baseUrl}/api/internal/membership-rewards/entitlements`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ steamIds: [steamId] }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const records = Array.isArray(payload?.memberships) ? payload.memberships : null;
    const record = records?.find((item) => item?.steamId === steamId);
    if (!record || typeof record.entitled !== 'boolean') throw new Error('Invalid membership response');
    const aliases = { member: 'supporter', elite: 'guardian' };
    const tier = aliases[record.tier] || record.tier;
    const expiresAt = Date.parse(record.expiresAt || '');
    const active = record.entitled && Object.hasOwn(BONUS_SLOTS, tier) && Number.isFinite(expiresAt) && expiresAt > now;
    return { tier: active ? tier : null, bonusSlots: active ? BONUS_SLOTS[tier] : 0, expiresAt: active ? new Date(expiresAt).toISOString() : null };
  } catch {
    throw error('DINOSTORAGE_MEMBERSHIP_UNAVAILABLE', 'Your storage allowance could not be checked. Please try again; existing dinosaurs can still be retrieved.', 503);
  }
}

async function freshDinos(steamId) {
  return require('./dinoStorageService').listStoredDinosFresh(steamId);
}

function assertReservation({ steamId, slot, operation }, env = process.env) {
  if (!enabled(env)) return null;
  requireConfiguration(env);
  const row = database().prepare('SELECT * FROM membership_storage_reservations WHERE operation_key = ?').get(operationKey(operation));
  if (!row || row.steam_id !== validateSteamId(steamId) || row.slot !== validateSlot(slot)) {
    throw error('DINOSTORAGE_ADMISSION_REQUIRED', 'Storage space must be reserved before this purchase.', 409);
  }
  return row;
}

async function reserveIncoming({ steamId, slot, operation, commandId = null, allowExisting = false }, {
  env = process.env,
  fetchImpl = globalThis.fetch,
  listStored = freshDinos,
} = {}) {
  const steam = validateSteamId(steamId);
  const selectedSlot = validateSlot(slot);
  const key = operationKey(operation);
  if (!enabled(env)) return { enabled: false, operation: key, steamId: steam, slot: selectedSlot };
  const config = requireConfiguration(env);
  const db = database();
  const existing = db.prepare('SELECT * FROM membership_storage_reservations WHERE operation_key = ?').get(key);
  if (existing) {
    if (existing.steam_id !== steam || existing.slot !== selectedSlot) throw error('DINOSTORAGE_ADMISSION_CONFLICT', 'This storage operation already belongs to another dinosaur.');
    if (commandId) db.prepare('UPDATE membership_storage_reservations SET command_id = ? WHERE operation_key = ?').run(commandId, key);
    return { enabled: true, duplicate: true, operation: key, steamId: steam, slot: selectedSlot };
  }

  const owner = randomUUID();
  const now = Date.now();
  const lock = db.prepare(`INSERT INTO membership_storage_admission_locks(steam_id, owner, expires_at_ms)
    VALUES (?, ?, ?) ON CONFLICT(steam_id) DO UPDATE SET owner=excluded.owner, expires_at_ms=excluded.expires_at_ms
    WHERE membership_storage_admission_locks.expires_at_ms < ?`).run(steam, owner, now + LOCK_MS, now);
  if (lock.changes !== 1) throw error('DINOSTORAGE_CAPACITY_BUSY', 'Another storage request is being checked. Please wait for it to finish.');

  try {
    const snapshotStartedAt = Date.now();
    const [member, dinos] = await Promise.all([
      entitlement(steam, { env, fetchImpl }),
      listStored(steam),
    ]);
    if (!Array.isArray(dinos)) throw error('DINOSTORAGE_CAPACITY_UNAVAILABLE', 'The stored dinosaur list could not be verified.', 503);
    db.exec('BEGIN IMMEDIATE');
    try {
      const currentLock = db.prepare('SELECT owner, expires_at_ms FROM membership_storage_admission_locks WHERE steam_id = ?').get(steam);
      if (currentLock?.owner !== owner || currentLock.expires_at_ms < Date.now()) throw error('DINOSTORAGE_CAPACITY_BUSY', 'The storage check expired. Please try again.');
      const usage = countUsage(steam, dinos, db, snapshotStartedAt);
      // Once a fresh, serialized snapshot contains a reserved slot, its stored
      // copy replaces that reservation. Unknown/unobserved writes keep theirs.
      for (const row of usage.reservations) {
        if (usage.storedSlots.has(row.slot.toLowerCase()) || usage.retired.includes(row)) db.prepare('DELETE FROM membership_storage_reservations WHERE operation_key = ?').run(row.operation_key);
      }
      const sameSlot = db.prepare('SELECT operation_key FROM membership_storage_reservations WHERE steam_id = ? AND slot = ?').get(steam, selectedSlot);
      if (sameSlot && sameSlot.operation_key !== key) throw error('DINOSTORAGE_SLOT_RESERVED', 'This dinosaur storage slot already has a pending request.');
      if (usage.storedSlots.has(selectedSlot.toLowerCase())) {
        if (!allowExisting) throw error('DINO_TARGET_EXISTS', 'This dinosaur storage slot is already occupied.');
        db.exec('COMMIT');
        return { enabled: true, existing: true, operation: key, steamId: steam, slot: selectedSlot };
      }
      const admittedPurchase = usage.incoming.get(selectedSlot) === key;
      if (usage.incoming.has(selectedSlot) && !admittedPurchase) throw error('DINOSTORAGE_SLOT_RESERVED', 'This slot is reserved for an existing purchase.');
      const limit = config.baseSlots + member.bonusSlots;
      if (!admittedPurchase && usage.used >= limit) {
        throw error('DINOSTORAGE_CAPACITY_FULL', `Your dinosaur storage is full (${usage.used}/${limit}). Retrieve a dinosaur before storing or buying another. Your existing dinosaurs are safe.`);
      }
      db.prepare('INSERT INTO membership_storage_reservations(operation_key, steam_id, slot, command_id) VALUES (?, ?, ?, ?)')
        .run(key, steam, selectedSlot, commandId);
      db.exec('COMMIT');
      return { enabled: true, operation: key, steamId: steam, slot: selectedSlot, limit };
    } catch (cause) {
      try { db.exec('ROLLBACK'); } catch {}
      throw cause;
    }
  } finally {
    db.prepare('DELETE FROM membership_storage_admission_locks WHERE steam_id = ? AND owner = ?').run(steam, owner);
  }
}

function releaseReservation(operation) {
  return database().prepare('DELETE FROM membership_storage_reservations WHERE operation_key = ?').run(operationKey(operation)).changes;
}

function markMaterialized(operation, commandId = null) {
  if (!enabled()) return;
  const db = database();
  if (commandId) {
    db.prepare('UPDATE membership_storage_reservations SET materialized_at_ms = ? WHERE operation_key = ? AND command_id = ?')
      .run(Date.now(), operationKey(operation), commandId);
  } else {
    db.prepare('UPDATE membership_storage_reservations SET materialized_at_ms = ? WHERE operation_key = ?')
      .run(Date.now(), operationKey(operation));
  }
}

function commandDeposit(command) {
  const tokens = command?.args?.args || [];
  if (command?.verb === 'dino_store') return { slot: tokens[0], operation: `command:${command.id}`, allowExisting: false };
  if (command?.verb === 'dino_grant') return { slot: tokens[0], operation: tokens[4] ? `official:${tokens[4]}` : `command:${command.id}`, allowExisting: true };
  if (command?.verb === 'bd' && tokens[0] === 'marketplace' && tokens[1] === 'transfer') {
    return { slot: tokens[3], operation: `p2p:${tokens[2]}`, allowExisting: true };
  }
  return null;
}

async function guardCommand(command) {
  if (!enabled()) return null;
  const deposit = commandDeposit(command);
  if (!deposit) return null;
  return reserveIncoming({ ...deposit, steamId: command.steam, commandId: command.id });
}

function noteCommandOutcome(command, outcome) {
  if (!enabled()) return outcome;
  const deposit = commandDeposit(command);
  if (deposit && outcome?.state === 'confirmed') markMaterialized(deposit.operation, command.id);
  if (outcome?.state !== 'failed') return outcome;
  // Marketplace transfers can report an uncertain partial transfer. Their
  // service only releases a reservation when it knows no transfer occurred.
  if (deposit && command.verb !== 'bd') {
    database().prepare('DELETE FROM membership_storage_reservations WHERE operation_key = ? AND command_id = ?')
      .run(deposit.operation, command.id);
  }
  return outcome;
}

async function getStatus(steamId, { env = process.env, fetchImpl = globalThis.fetch, listStored = freshDinos } = {}) {
  const steam = validateSteamId(steamId);
  const config = configuration(env);
  const base = {
    enabled: config.enabled,
    configured: config.configured,
    baseSlots: config.baseSlots,
    bonusSlots: 0,
    limit: null,
    used: null,
    pending: 0,
    withdrawOnly: false,
    reason: !config.enabled ? 'not-enabled' : !config.configured ? 'setup-required' : null,
  };
  if (!config.enabled || !config.configured) return base;
  const snapshotStartedAt = Date.now();
  const [member, dinos] = await Promise.all([entitlement(steam, { env, fetchImpl }), listStored(steam)]);
  const usage = countUsage(steam, dinos, database(), snapshotStartedAt);
  const limit = config.baseSlots + member.bonusSlots;
  return { ...base, tier: member.tier, expiresAt: member.expiresAt, bonusSlots: member.bonusSlots, limit,
    used: usage.used, stored: usage.stored, escrow: usage.escrow, pending: usage.pending,
    withdrawOnly: usage.used >= limit, reason: usage.used >= limit ? 'capacity-reached' : null };
}

module.exports = {
  BONUS_SLOTS, SERVER_ACK, enabled, configuration, entitlement, officialSlot, initialize,
  assertReservation, reserveIncoming, releaseReservation, markMaterialized, guardCommand, noteCommandOutcome, getStatus,
  _test: { database, countUsage, commandDeposit },
};
