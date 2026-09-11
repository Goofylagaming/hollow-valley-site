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
    status TEXT NOT NULL DEFAULT 'active',
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
`);

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
  return db.prepare("SELECT * FROM roster WHERE user_id = ? ORDER BY created_at DESC").all(userId);
}

function getLeaderboards() {
  const kills = db
    .prepare(
      `SELECT u.username, s.kills, s.deaths, s.playtime_minutes
       FROM player_stats s JOIN users u ON u.id = s.user_id
       ORDER BY s.kills DESC LIMIT 10`
    )
    .all();
  return { kills };
}

module.exports = {
  db,
  findOrCreateUser,
  getWallet,
  creditWallet,
  periodKeyFor,
  hasClaimed,
  recordClaim,
  getRoster,
  getLeaderboards,
};
