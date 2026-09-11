// SQLite persistence layer. Uses Node's built-in node:sqlite module (Node 22+)
// so there is no native module to compile — this keeps deployment simple on any host.
const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "..", "data", "hollowvalley.sqlite");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT UNIQUE NOT NULL,
    username TEXT NOT NULL,
    avatar TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS wallets (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    balance INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS wallet_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    amount INTEGER NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS quest_claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    quest_id TEXT NOT NULL,
    period_key TEXT NOT NULL,
    claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, quest_id, period_key)
  );

  CREATE TABLE IF NOT EXISTS roster (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    species_id TEXT NOT NULL,
    nickname TEXT,
    status TEXT NOT NULL DEFAULT 'parked',
    is_prime INTEGER NOT NULL DEFAULT 0,
    skin_id INTEGER REFERENCES skins(id),
    health INTEGER NOT NULL DEFAULT 100,
    stamina INTEGER NOT NULL DEFAULT 100,
    water INTEGER NOT NULL DEFAULT 100,
    food INTEGER NOT NULL DEFAULT 100,
    blood INTEGER NOT NULL DEFAULT 100,
    size_percent INTEGER NOT NULL DEFAULT 10,
    mutations TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS player_stats (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    kills INTEGER NOT NULL DEFAULT 0,
    deaths INTEGER NOT NULL DEFAULT 0,
    playtime_minutes INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expires INTEGER NOT NULL
  );

  -- Official catalog of dinos the server offers for Valley Coin (admin-curated, not per-user fake data).
  CREATE TABLE IF NOT EXISTS marketplace_catalog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    species_id TEXT NOT NULL,
    price INTEGER NOT NULL,
    size_percent INTEGER NOT NULL DEFAULT 10,
    active INTEGER NOT NULL DEFAULT 1
  );

  -- Peer-to-peer resale listings: a user offering one of their own roster dinos for Valley Coin.
  CREATE TABLE IF NOT EXISTS marketplace_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    roster_id INTEGER NOT NULL REFERENCES roster(id),
    seller_id INTEGER NOT NULL REFERENCES users(id),
    price INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'active'
  );

  CREATE TABLE IF NOT EXISTS skins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_user_id INTEGER REFERENCES users(id),
    species_id TEXT NOT NULL,
    name TEXT NOT NULL,
    is_premium INTEGER NOT NULL DEFAULT 0,
    price INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS supporter_subscriptions (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    tier TEXT NOT NULL,
    auto_renew INTEGER NOT NULL DEFAULT 1,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    renews_at TEXT,
    cancelled_at TEXT
  );

  CREATE TABLE IF NOT EXISTS daily_bonus_claims (
    user_id INTEGER NOT NULL REFERENCES users(id),
    period_key TEXT NOT NULL,
    amount INTEGER NOT NULL,
    claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(user_id, period_key)
  );
`);

function getUserByUsername(username) {
  return db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username);
}

function findOrCreateUser({ discordId, username, avatar }) {
  const existing = db.prepare("SELECT * FROM users WHERE discord_id = ?").get(discordId);
  if (existing) {
    db.prepare("UPDATE users SET username = ?, avatar = ? WHERE id = ?").run(username, avatar, existing.id);
    return db.prepare("SELECT * FROM users WHERE id = ?").get(existing.id);
  }
  const info = db.prepare("INSERT INTO users (discord_id, username, avatar) VALUES (?, ?, ?)").run(discordId, username, avatar);
  const userId = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO wallets (user_id, balance) VALUES (?, 0)").run(userId);
  db.prepare("INSERT INTO player_stats (user_id) VALUES (?)").run(userId);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

function getWallet(userId) {
  const wallet = db.prepare("SELECT * FROM wallets WHERE user_id = ?").get(userId) || { balance: 0 };
  const transactions = db
    .prepare("SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 25")
    .all(userId);
  return { balance: wallet.balance, transactions };
}

function creditWallet(userId, amount, reason) {
  db.prepare("UPDATE wallets SET balance = balance + ? WHERE user_id = ?").run(amount, userId);
  db.prepare("INSERT INTO wallet_transactions (user_id, amount, reason) VALUES (?, ?, ?)").run(userId, amount, reason);
  return getWallet(userId);
}

function periodKeyFor(cadence, date = new Date()) {
  if (cadence === "weekly") {
    const firstDayOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
    const diffDays = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - firstDayOfYear) / 86400000);
    const week = Math.floor(diffDays / 7);
    return `${date.getUTCFullYear()}-W${week}`;
  }
  return date.toISOString().slice(0, 10); // daily -> YYYY-MM-DD
}

function hasClaimed(userId, questId, periodKey) {
  return Boolean(
    db.prepare("SELECT 1 FROM quest_claims WHERE user_id = ? AND quest_id = ? AND period_key = ?").get(userId, questId, periodKey)
  );
}

function recordClaim(userId, questId, periodKey) {
  db.prepare("INSERT INTO quest_claims (user_id, quest_id, period_key) VALUES (?, ?, ?)").run(userId, questId, periodKey);
}

function getRoster(userId) {
  const rows = db.prepare("SELECT * FROM roster WHERE user_id = ? ORDER BY created_at DESC").all(userId);
  return rows.map((row) => ({ ...row, mutations: JSON.parse(row.mutations || "[]") }));
}

function getRosterEntry(id) {
  return db.prepare("SELECT * FROM roster WHERE id = ?").get(id);
}

function addRosterDino(userId, speciesId, sizePercent = 10) {
  const info = db
    .prepare("INSERT INTO roster (user_id, species_id, size_percent) VALUES (?, ?, ?)")
    .run(userId, speciesId, sizePercent);
  return getRosterEntry(Number(info.lastInsertRowid));
}

function setRosterStatus(id, status) {
  // Only one dino can be "active" at a time per user.
  const dino = getRosterEntry(id);
  if (!dino) return null;
  if (status === "active") {
    db.prepare("UPDATE roster SET status = 'parked' WHERE user_id = ? AND status = 'active'").run(dino.user_id);
  }
  db.prepare("UPDATE roster SET status = ? WHERE id = ?").run(status, id);
  return getRosterEntry(id);
}

function setRosterPrime(id, isPrime) {
  db.prepare("UPDATE roster SET is_prime = ? WHERE id = ?").run(isPrime ? 1 : 0, id);
  return getRosterEntry(id);
}

function applySkinToRoster(rosterId, skinId) {
  db.prepare("UPDATE roster SET skin_id = ? WHERE id = ?").run(skinId, rosterId);
  return getRosterEntry(rosterId);
}

function removeRosterDino(id) {
  db.prepare("DELETE FROM roster WHERE id = ?").run(id);
}

function transferRosterDino(id, toUserId) {
  db.prepare("UPDATE roster SET user_id = ?, status = 'parked' WHERE id = ?").run(toUserId, id);
  return getRosterEntry(id);
}

function getLeaderboards() {
  const rows = db
    .prepare(
      `SELECT u.username, s.kills, s.deaths, s.playtime_minutes
       FROM player_stats s JOIN users u ON u.id = s.user_id
       WHERE s.kills > 0 OR s.deaths > 0 OR s.playtime_minutes > 0`
    )
    .all();
  const withRatio = rows.map((row) => ({
    ...row,
    kd: row.deaths > 0 ? Number((row.kills / row.deaths).toFixed(2)) : row.kills,
  }));
  const mostKills = [...withRatio].sort((a, b) => b.kills - a.kills).slice(0, 10);
  const bestKd = [...withRatio].sort((a, b) => b.kd - a.kd).slice(0, 10);
  const mostPlaytime = [...withRatio].sort((a, b) => b.playtime_minutes - a.playtime_minutes).slice(0, 10);
  return { mostKills, bestKd, mostPlaytime, kills: mostKills };
}

// ---------- Marketplace ----------
function getMarketplaceCatalog() {
  return db.prepare("SELECT * FROM marketplace_catalog WHERE active = 1 ORDER BY price ASC").all();
}

function seedMarketplaceCatalogIfEmpty(entries) {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM marketplace_catalog").get();
  if (count > 0) return;
  const insert = db.prepare(
    "INSERT INTO marketplace_catalog (species_id, price, size_percent) VALUES (?, ?, ?)"
  );
  for (const entry of entries) {
    insert.run(entry.speciesId, entry.price, entry.sizePercent ?? 10);
  }
}

function getCatalogEntry(id) {
  return db.prepare("SELECT * FROM marketplace_catalog WHERE id = ? AND active = 1").get(id);
}

function getMarketplaceListings() {
  return db
    .prepare(
      `SELECT l.*, r.species_id, r.nickname, r.size_percent, u.username AS seller_username
       FROM marketplace_listings l
       JOIN roster r ON r.id = l.roster_id
       JOIN users u ON u.id = l.seller_id
       WHERE l.status = 'active'
       ORDER BY l.created_at DESC`
    )
    .all();
}

function getListingEntry(id) {
  return db.prepare("SELECT * FROM marketplace_listings WHERE id = ? AND status = 'active'").get(id);
}

function createListing(rosterId, sellerId, price) {
  const info = db
    .prepare("INSERT INTO marketplace_listings (roster_id, seller_id, price) VALUES (?, ?, ?)")
    .run(rosterId, sellerId, price);
  return db.prepare("SELECT * FROM marketplace_listings WHERE id = ?").get(Number(info.lastInsertRowid));
}

function closeListing(id, status) {
  db.prepare("UPDATE marketplace_listings SET status = ? WHERE id = ?").run(status, id);
}

// ---------- Skins ----------
function getSkinsForSpecies(speciesId) {
  return db.prepare("SELECT * FROM skins WHERE species_id = ? ORDER BY is_premium DESC, created_at DESC").all(speciesId);
}

function getUserSkins(userId) {
  return db.prepare("SELECT * FROM skins WHERE owner_user_id = ? ORDER BY created_at DESC").all(userId);
}

function createSkin({ ownerUserId, speciesId, name, isPremium = false, price = 0 }) {
  const info = db
    .prepare("INSERT INTO skins (owner_user_id, species_id, name, is_premium, price) VALUES (?, ?, ?, ?, ?)")
    .run(ownerUserId, speciesId, name, isPremium ? 1 : 0, price);
  return db.prepare("SELECT * FROM skins WHERE id = ?").get(Number(info.lastInsertRowid));
}

function getSkinEntry(id) {
  return db.prepare("SELECT * FROM skins WHERE id = ?").get(id);
}

// ---------- Supporter subscriptions ----------
function getSupporterStatus(userId) {
  return db.prepare("SELECT * FROM supporter_subscriptions WHERE user_id = ?").get(userId) || null;
}

function setSupporterTier(userId, tier, renewsAt) {
  db.prepare(
    `INSERT INTO supporter_subscriptions (user_id, tier, auto_renew, renews_at, cancelled_at)
     VALUES (?, ?, 1, ?, NULL)
     ON CONFLICT(user_id) DO UPDATE SET tier = excluded.tier, auto_renew = 1, renews_at = excluded.renews_at, cancelled_at = NULL`
  ).run(userId, tier, renewsAt);
  return getSupporterStatus(userId);
}

function cancelSupporterAutoRenew(userId) {
  db.prepare(
    "UPDATE supporter_subscriptions SET auto_renew = 0, cancelled_at = datetime('now') WHERE user_id = ?"
  ).run(userId);
  return getSupporterStatus(userId);
}

// ---------- Daily bonus ----------
function hasDailyBonusClaim(userId, periodKey) {
  return Boolean(
    db.prepare("SELECT 1 FROM daily_bonus_claims WHERE user_id = ? AND period_key = ?").get(userId, periodKey)
  );
}

function recordDailyBonusClaim(userId, periodKey, amount) {
  db.prepare("INSERT INTO daily_bonus_claims (user_id, period_key, amount) VALUES (?, ?, ?)").run(
    userId,
    periodKey,
    amount
  );
}

// ---------- Dashboard ----------
function getDashboardSummary(userId) {
  const wallet = getWallet(userId);
  const dinoCount = db.prepare("SELECT COUNT(*) AS count FROM roster WHERE user_id = ?").get(userId).count;
  const recentActivity = db
    .prepare("SELECT * FROM wallet_transactions WHERE user_id = ? ORDER BY id DESC LIMIT 5")
    .all(userId);
  const supporter = getSupporterStatus(userId);
  return {
    dinoCount,
    recentActivity,
    supporter,
    walletBalance: wallet.balance,
  };
}

module.exports = {
  db,
  findOrCreateUser,
  getUserByUsername,
  getWallet,
  creditWallet,
  periodKeyFor,
  hasClaimed,
  recordClaim,
  getRoster,
  getRosterEntry,
  addRosterDino,
  setRosterStatus,
  setRosterPrime,
  applySkinToRoster,
  removeRosterDino,
  transferRosterDino,
  getLeaderboards,
  getMarketplaceCatalog,
  seedMarketplaceCatalogIfEmpty,
  getCatalogEntry,
  getMarketplaceListings,
  getListingEntry,
  createListing,
  closeListing,
  getSkinsForSpecies,
  getUserSkins,
  createSkin,
  getSkinEntry,
  getSupporterStatus,
  setSupporterTier,
  cancelSupporterAutoRenew,
  hasDailyBonusClaim,
  recordDailyBonusClaim,
  getDashboardSummary,
};
