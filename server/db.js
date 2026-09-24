// SQLite persistence layer. Uses Node's built-in node:sqlite module (Node 22+)
// so there is no native module to compile ? this keeps deployment simple on any host.
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
    discord_id TEXT UNIQUE,
    steam_id TEXT UNIQUE,
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
    size_percent INTEGER NOT NULL DEFAULT 75,
    mutations TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS player_stats (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    kills INTEGER NOT NULL DEFAULT 0,
    deaths INTEGER NOT NULL DEFAULT 0,
    playtime_minutes INTEGER NOT NULL DEFAULT 0,
    playtime_seconds INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS player_activity (
    steam_id TEXT PRIMARY KEY,
    last_seen_at INTEGER NOT NULL
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
    size_percent INTEGER NOT NULL DEFAULT 75,
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

  CREATE TABLE IF NOT EXISTS body_drop_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    steam_id TEXT NOT NULL,
    drop_type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    bridge_request_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );
`);

// Migration for databases created before Steam login existed: the old schema
// required discord_id NOT NULL and had no steam_id column. SQLite can't drop
// a NOT NULL constraint in place, so rebuild the table when needed.
(function ensureUsersSchema() {
  const columns = db.prepare("PRAGMA table_info(users)").all();
  const discordColumn = columns.find((column) => column.name === "discord_id");
  const hasSteamColumn = columns.some((column) => column.name === "steam_id");

  if (discordColumn && discordColumn.notnull === 1) {
    db.exec(`
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_id TEXT UNIQUE,
        steam_id TEXT UNIQUE,
        username TEXT NOT NULL,
        avatar TEXT,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO users_new (id, discord_id, username, avatar, is_admin, created_at)
        SELECT id, discord_id, username, avatar, is_admin, created_at FROM users;
      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);
  } else if (!hasSteamColumn) {
    db.exec("ALTER TABLE users ADD COLUMN steam_id TEXT;");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_steam_id ON users(steam_id);");
  }
})();

(function ensurePlayerStatsSchema() {
  const columns = db.prepare("PRAGMA table_info(player_stats)").all();
  if (!columns.some((column) => column.name === "playtime_seconds")) {
    db.exec("ALTER TABLE player_stats ADD COLUMN playtime_seconds INTEGER NOT NULL DEFAULT 0;");
    db.exec("UPDATE player_stats SET playtime_seconds = playtime_minutes * 60 WHERE playtime_seconds = 0;");
  }
})();

(function ensureFriendsSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS friend_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_steam_id TEXT NOT NULL,
      receiver_steam_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      responded_at TEXT,
      UNIQUE(sender_steam_id, receiver_steam_id)
    );
    CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver
      ON friend_requests(receiver_steam_id, status, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_friend_requests_sender
      ON friend_requests(sender_steam_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS friendships (
      steam_a TEXT NOT NULL,
      steam_b TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (steam_a, steam_b),
      CHECK (steam_a < steam_b)
    );
    CREATE INDEX IF NOT EXISTS idx_friendships_a ON friendships(steam_a, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_friendships_b ON friendships(steam_b, created_at DESC);

    CREATE TABLE IF NOT EXISTS friend_blocks (
      blocker_steam_id TEXT NOT NULL,
      blocked_steam_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (blocker_steam_id, blocked_steam_id)
    );
    CREATE INDEX IF NOT EXISTS idx_friend_blocks_blocked
      ON friend_blocks(blocked_steam_id, created_at DESC);
  `);
})();

function getUserByUsername(username) {
  return db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username);
}

function listSteamLinkedUsers({ query = "", limit = 200 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const q = String(query || "").trim();
  if (!q) {
    return db.prepare(
      "SELECT id, steam_id, username, avatar FROM users WHERE steam_id IS NOT NULL AND steam_id <> '' ORDER BY username COLLATE NOCASE ASC LIMIT ?"
    ).all(safeLimit);
  }
  const like = `%${q}%`;
  return db.prepare(
    "SELECT id, steam_id, username, avatar FROM users WHERE steam_id IS NOT NULL AND steam_id <> '' AND (username LIKE ? COLLATE NOCASE OR steam_id LIKE ?) ORDER BY username COLLATE NOCASE ASC LIMIT ?"
  ).all(like, like, safeLimit);
}

function findOrCreateUser({ currentUserId, discordId, username, avatar }) {
  const existingDiscordUser = db.prepare("SELECT * FROM users WHERE discord_id = ?").get(discordId);

  if (currentUserId) {
    const currentUser = db.prepare("SELECT * FROM users WHERE id = ?").get(currentUserId);
    if (currentUser) {
      if (existingDiscordUser && existingDiscordUser.id !== currentUser.id) {
        const targetId = currentUser.id;
        const sourceId = existingDiscordUser.id;
        db.prepare("UPDATE roster SET user_id = ? WHERE user_id = ?").run(targetId, sourceId);
        const sourceWallet = db.prepare("SELECT balance FROM wallets WHERE user_id = ?").get(sourceId);
        if (sourceWallet && sourceWallet.balance > 0) {
          db.prepare("UPDATE wallets SET balance = balance + ? WHERE user_id = ?").run(sourceWallet.balance, targetId);
        }
        db.prepare("UPDATE wallet_transactions SET user_id = ? WHERE user_id = ?").run(targetId, sourceId);
        db.prepare("UPDATE skins SET owner_user_id = ? WHERE owner_user_id = ?").run(targetId, sourceId);
        db.prepare("DELETE FROM wallets WHERE user_id = ?").run(sourceId);
        db.prepare("DELETE FROM player_stats WHERE user_id = ?").run(sourceId);
        db.prepare("DELETE FROM users WHERE id = ?").run(sourceId);
      }
      db.prepare("UPDATE users SET discord_id = ?, username = ?, avatar = ? WHERE id = ?").run(discordId, username, avatar, currentUser.id);
      return db.prepare("SELECT * FROM users WHERE id = ?").get(currentUser.id);
    }
  }

  if (existingDiscordUser) {
    db.prepare("UPDATE users SET username = ?, avatar = ? WHERE id = ?").run(username, avatar, existingDiscordUser.id);
    return db.prepare("SELECT * FROM users WHERE id = ?").get(existingDiscordUser.id);
  }

  const info = db.prepare("INSERT INTO users (discord_id, username, avatar) VALUES (?, ?, ?)").run(discordId, username, avatar);
  const userId = Number(info.lastInsertRowid);
  db.prepare("INSERT INTO wallets (user_id, balance) VALUES (?, 0)").run(userId);
  db.prepare("INSERT INTO player_stats (user_id) VALUES (?)").run(userId);
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

function findOrCreateUserBySteam({ currentUserId, steamId, username, avatar, hasRealProfile = false }) {
  const existingSteamUser = db.prepare("SELECT * FROM users WHERE steam_id = ?").get(steamId);

  if (currentUserId) {
    const currentUser = db.prepare("SELECT * FROM users WHERE id = ?").get(currentUserId);
    if (currentUser) {
      if (existingSteamUser && existingSteamUser.id !== currentUser.id) {
        const targetId = currentUser.id;
        const sourceId = existingSteamUser.id;
        db.prepare("UPDATE roster SET user_id = ? WHERE user_id = ?").run(targetId, sourceId);
        const sourceWallet = db.prepare("SELECT balance FROM wallets WHERE user_id = ?").get(sourceId);
        if (sourceWallet && sourceWallet.balance > 0) {
          db.prepare("UPDATE wallets SET balance = balance + ? WHERE user_id = ?").run(sourceWallet.balance, targetId);
        }
        db.prepare("UPDATE wallet_transactions SET user_id = ? WHERE user_id = ?").run(targetId, sourceId);
        db.prepare("UPDATE skins SET owner_user_id = ? WHERE owner_user_id = ?").run(targetId, sourceId);
        db.prepare("DELETE FROM wallets WHERE user_id = ?").run(sourceId);
        db.prepare("DELETE FROM player_stats WHERE user_id = ?").run(sourceId);
        db.prepare("DELETE FROM users WHERE id = ?").run(sourceId);
      }
      let newName = currentUser.username;
      if (hasRealProfile && username) {
        newName = username;
      } else if (!newName || /^Survivor\d+$/i.test(newName)) {
        newName = username || `Survivor${steamId.slice(-5)}`;
      }
      const newAvatar = avatar || currentUser.avatar;
      db.prepare("UPDATE users SET steam_id = ?, username = ?, avatar = ? WHERE id = ?").run(steamId, newName, newAvatar, currentUser.id);
      return db.prepare("SELECT * FROM users WHERE id = ?").get(currentUser.id);
    }
  }

  if (existingSteamUser) {
    if (hasRealProfile && username) {
      db.prepare("UPDATE users SET username = ?, avatar = COALESCE(?, avatar) WHERE id = ?").run(username, avatar, existingSteamUser.id);
    } else if (!existingSteamUser.username || /^Survivor\d+$/i.test(existingSteamUser.username)) {
      if (username) {
        db.prepare("UPDATE users SET username = ?, avatar = COALESCE(?, avatar) WHERE id = ?").run(username, avatar, existingSteamUser.id);
      }
    }
    return db.prepare("SELECT * FROM users WHERE id = ?").get(existingSteamUser.id);
  }

  const info = db
    .prepare("INSERT INTO users (steam_id, username, avatar) VALUES (?, ?, ?)")
    .run(steamId, username, avatar);
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

function addRosterDino(userId, speciesId, sizePercent = 75, isPrime = 0, status = "parked") {
  const info = db
    .prepare("INSERT INTO roster (user_id, species_id, size_percent, is_prime, status) VALUES (?, ?, ?, ?, ?)")
    .run(userId, speciesId, sizePercent, isPrime ? 1 : 0, status);
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

function recordLivePlaytime(players, now = Date.now()) {
  const getUser = db.prepare("SELECT id FROM users WHERE steam_id = ?");
  const getActivity = db.prepare("SELECT last_seen_at FROM player_activity WHERE steam_id = ?");
  const touchActivity = db.prepare(
    "INSERT INTO player_activity (steam_id, last_seen_at) VALUES (?, ?) ON CONFLICT(steam_id) DO UPDATE SET last_seen_at = excluded.last_seen_at"
  );
  const ensureStats = db.prepare("INSERT INTO player_stats (user_id) VALUES (?) ON CONFLICT(user_id) DO NOTHING");
  const addTime = db.prepare(
    "UPDATE player_stats SET playtime_seconds = playtime_seconds + ?, playtime_minutes = CAST((playtime_seconds + ?) / 60 AS INTEGER) WHERE user_id = ?"
  );

  for (const player of players) {
    if (!player?.steamId) continue;
    const user = getUser.get(String(player.steamId));
    const prior = getActivity.get(String(player.steamId));
    // Count only a normal polling interval, never an arbitrary offline gap.
    const elapsedMs = prior ? Math.max(0, Math.min(now - prior.last_seen_at, 60_000)) : 0;
    const elapsedSeconds = Math.floor(elapsedMs / 1000);
    if (user && elapsedSeconds > 0) {
      ensureStats.run(user.id);
      addTime.run(elapsedSeconds, elapsedSeconds, user.id);
    }
    touchActivity.run(String(player.steamId), now);
  }
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
  const mostKills = withRatio.filter((row) => row.kills > 0).sort((a, b) => b.kills - a.kills).slice(0, 10);
  const bestKd = withRatio.filter((row) => row.deaths > 0).sort((a, b) => b.kd - a.kd).slice(0, 10);
  const mostPlaytime = withRatio.filter((row) => row.playtime_minutes > 0).sort((a, b) => b.playtime_minutes - a.playtime_minutes).slice(0, 10);
  return { mostKills, bestKd, mostPlaytime, kills: mostKills };
}

// ---------- Marketplace ----------
function getMarketplaceCatalog() {
  return db.prepare("SELECT * FROM marketplace_catalog WHERE active = 1 ORDER BY price ASC").all();
}

function seedMarketplaceCatalogIfEmpty(entries) {
  const { count } = db.prepare("SELECT COUNT(*) AS count FROM marketplace_catalog").get();
  if (count === 0) {
    const insert = db.prepare(
      "INSERT INTO marketplace_catalog (species_id, price, size_percent) VALUES (?, ?, ?)"
    );
    for (const entry of entries) {
      insert.run(entry.speciesId, entry.price, entry.sizePercent ?? 75);
    }
  } else {
    const update = db.prepare(
      "UPDATE marketplace_catalog SET size_percent = ?, price = ? WHERE species_id = ?"
    );
    for (const entry of entries) {
      update.run(entry.sizePercent ?? 75, entry.price, entry.speciesId);
    }
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

// ---------- Body drops ----------
function createBodyDropRequest({ userId, steamId, dropType }) {
  const info = db
    .prepare("INSERT INTO body_drop_requests (user_id, steam_id, drop_type) VALUES (?, ?, ?)")
    .run(userId, steamId, dropType);
  return getBodyDropRequest(Number(info.lastInsertRowid));
}

function getBodyDropRequest(id) {
  return db.prepare("SELECT * FROM body_drop_requests WHERE id = ?").get(id);
}

function updateBodyDropRequest(id, { status, bridgeRequestId = null, error = null }) {
  db.prepare(
    `UPDATE body_drop_requests
     SET status = ?, bridge_request_id = COALESCE(?, bridge_request_id), error = ?, completed_at = CASE WHEN ? IN ('completed', 'failed') THEN datetime('now') ELSE completed_at END
     WHERE id = ?`
  ).run(status, bridgeRequestId, error, status, id);
  return getBodyDropRequest(id);
}

function getLatestBodyDropRequest(userId) {
  return db
    .prepare("SELECT * FROM body_drop_requests WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
    .get(userId) || null;
}

function getRecentBodyDropRequests(userId, limit = 5) {
  return db
    .prepare("SELECT * FROM body_drop_requests WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(userId, limit);
}

// ---------- Friends ----------
const FRIEND_ONLINE_WINDOW_MS = 5 * 60 * 1000;

function normalizeFriendPair(firstSteamId, secondSteamId) {
  const first = String(firstSteamId || "").trim();
  const second = String(secondSteamId || "").trim();
  if (!/^\d{17}$/.test(first) || !/^\d{17}$/.test(second)) throw new Error("A valid 17-digit Steam ID is required");
  if (first === second) throw new Error("You cannot add yourself as a friend");
  return first < second ? [first, second] : [second, first];
}

function getFriendUser(steamId) {
  return db.prepare(
    "SELECT id, steam_id, username, avatar FROM users WHERE steam_id = ?"
  ).get(String(steamId || "").trim()) || null;
}

function isFriendBlocked(firstSteamId, secondSteamId) {
  return Boolean(db.prepare(`
    SELECT 1 FROM friend_blocks
    WHERE (blocker_steam_id = ? AND blocked_steam_id = ?)
       OR (blocker_steam_id = ? AND blocked_steam_id = ?)
    LIMIT 1
  `).get(firstSteamId, secondSteamId, secondSteamId, firstSteamId));
}

function areFriends(firstSteamId, secondSteamId) {
  const [steamA, steamB] = normalizeFriendPair(firstSteamId, secondSteamId);
  return Boolean(db.prepare(
    "SELECT 1 FROM friendships WHERE steam_a = ? AND steam_b = ?"
  ).get(steamA, steamB));
}

function friendPresence(steamId, now = Date.now()) {
  const row = db.prepare("SELECT last_seen_at FROM player_activity WHERE steam_id = ?").get(String(steamId));
  const lastSeenAt = Number(row?.last_seen_at || 0);
  return {
    online: lastSeenAt > 0 && now - lastSeenAt <= FRIEND_ONLINE_WINDOW_MS,
    lastSeenAt: lastSeenAt || null,
  };
}

function decorateFriendUser(user, now = Date.now()) {
  if (!user) return null;
  const presence = friendPresence(user.steam_id, now);
  return {
    id: user.id,
    steamId: user.steam_id,
    username: user.username,
    avatar: user.avatar || null,
    online: presence.online,
    lastSeenAt: presence.lastSeenAt,
  };
}

function getFriendState(steamId) {
  const steam = String(steamId || "").trim();
  if (!/^\d{17}$/.test(steam)) throw new Error("A valid 17-digit Steam ID is required");
  const now = Date.now();

  const friendRows = db.prepare(`
    SELECT CASE WHEN steam_a = ? THEN steam_b ELSE steam_a END AS friend_steam_id, created_at
    FROM friendships
    WHERE steam_a = ? OR steam_b = ?
    ORDER BY created_at DESC
  `).all(steam, steam, steam);

  const incomingRows = db.prepare(`
    SELECT id, sender_steam_id, created_at
    FROM friend_requests
    WHERE receiver_steam_id = ? AND status = 'pending'
    ORDER BY created_at DESC
  `).all(steam);

  const outgoingRows = db.prepare(`
    SELECT id, receiver_steam_id, created_at
    FROM friend_requests
    WHERE sender_steam_id = ? AND status = 'pending'
    ORDER BY created_at DESC
  `).all(steam);

  const blockedRows = db.prepare(`
    SELECT blocked_steam_id, created_at
    FROM friend_blocks
    WHERE blocker_steam_id = ?
    ORDER BY created_at DESC
  `).all(steam);

  const friends = friendRows.map((row) => ({
    ...decorateFriendUser(getFriendUser(row.friend_steam_id), now),
    friendsSince: row.created_at,
  })).filter((row) => row.steamId);

  const incoming = incomingRows.map((row) => ({
    requestId: row.id,
    createdAt: row.created_at,
    user: decorateFriendUser(getFriendUser(row.sender_steam_id), now),
  })).filter((row) => row.user);

  const outgoing = outgoingRows.map((row) => ({
    requestId: row.id,
    createdAt: row.created_at,
    user: decorateFriendUser(getFriendUser(row.receiver_steam_id), now),
  })).filter((row) => row.user);

  const blocked = blockedRows.map((row) => ({
    blockedAt: row.created_at,
    user: decorateFriendUser(getFriendUser(row.blocked_steam_id), now),
  })).filter((row) => row.user);

  return { friends, incoming, outgoing, blocked };
}

function searchFriendUsers(steamId, query, { limit = 20 } = {}) {
  const steam = String(steamId || "").trim();
  if (!/^\d{17}$/.test(steam)) throw new Error("A valid 17-digit Steam ID is required");
  const q = String(query || "").trim();
  if (q.length < 2) return [];
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
  const like = `%${q}%`;
  const rows = db.prepare(`
    SELECT id, steam_id, username, avatar
    FROM users
    WHERE steam_id IS NOT NULL
      AND steam_id <> ''
      AND steam_id <> ?
      AND (username LIKE ? COLLATE NOCASE OR steam_id LIKE ?)
    ORDER BY username COLLATE NOCASE ASC
    LIMIT ?
  `).all(steam, like, like, safeLimit);

  const now = Date.now();
  return rows.map((user) => {
    const pendingIncoming = db.prepare(`
      SELECT id FROM friend_requests
      WHERE sender_steam_id = ? AND receiver_steam_id = ? AND status = 'pending'
    `).get(user.steam_id, steam);
    const pendingOutgoing = db.prepare(`
      SELECT id FROM friend_requests
      WHERE sender_steam_id = ? AND receiver_steam_id = ? AND status = 'pending'
    `).get(steam, user.steam_id);
    const blockedByMe = Boolean(db.prepare(
      "SELECT 1 FROM friend_blocks WHERE blocker_steam_id = ? AND blocked_steam_id = ?"
    ).get(steam, user.steam_id));
    const blockedMe = Boolean(db.prepare(
      "SELECT 1 FROM friend_blocks WHERE blocker_steam_id = ? AND blocked_steam_id = ?"
    ).get(user.steam_id, steam));
    return {
      ...decorateFriendUser(user, now),
      relationship: areFriends(steam, user.steam_id) ? "friend" :
        pendingIncoming ? "incoming" :
        pendingOutgoing ? "outgoing" :
        blockedByMe ? "blocked" :
        blockedMe ? "unavailable" : "none",
      requestId: pendingIncoming?.id || pendingOutgoing?.id || null,
    };
  });
}

function sendFriendRequest(senderSteamId, receiverSteamId) {
  const sender = String(senderSteamId || "").trim();
  const receiver = String(receiverSteamId || "").trim();
  normalizeFriendPair(sender, receiver);
  if (!getFriendUser(receiver)) throw new Error("That Hollow Valley player was not found");
  if (isFriendBlocked(sender, receiver)) {
    const error = new Error("A friend request cannot be sent between these accounts");
    error.code = "FRIEND_BLOCKED";
    throw error;
  }
  if (areFriends(sender, receiver)) return { alreadyFriends: true };

  const reciprocal = db.prepare(`
    SELECT id FROM friend_requests
    WHERE sender_steam_id = ? AND receiver_steam_id = ? AND status = 'pending'
  `).get(receiver, sender);
  if (reciprocal) {
    return acceptFriendRequest(sender, reciprocal.id);
  }

  db.prepare(`
    INSERT INTO friend_requests (sender_steam_id, receiver_steam_id, status, created_at, responded_at)
    VALUES (?, ?, 'pending', datetime('now'), NULL)
    ON CONFLICT(sender_steam_id, receiver_steam_id) DO UPDATE SET
      status = 'pending',
      created_at = datetime('now'),
      responded_at = NULL
  `).run(sender, receiver);

  return db.prepare(`
    SELECT id, sender_steam_id, receiver_steam_id, status, created_at
    FROM friend_requests
    WHERE sender_steam_id = ? AND receiver_steam_id = ?
  `).get(sender, receiver);
}

function acceptFriendRequest(receiverSteamId, requestId) {
  const receiver = String(receiverSteamId || "").trim();
  const id = Number(requestId);
  const request = db.prepare(`
    SELECT * FROM friend_requests
    WHERE id = ? AND receiver_steam_id = ? AND status = 'pending'
  `).get(id, receiver);
  if (!request) {
    const error = new Error("Friend request was not found");
    error.code = "FRIEND_REQUEST_NOT_FOUND";
    throw error;
  }
  if (isFriendBlocked(request.sender_steam_id, receiver)) {
    const error = new Error("This friend request is no longer available");
    error.code = "FRIEND_BLOCKED";
    throw error;
  }

  const [steamA, steamB] = normalizeFriendPair(request.sender_steam_id, receiver);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO friendships (steam_a, steam_b)
      VALUES (?, ?)
      ON CONFLICT(steam_a, steam_b) DO NOTHING
    `).run(steamA, steamB);
    db.prepare(`
      UPDATE friend_requests
      SET status = 'accepted', responded_at = datetime('now')
      WHERE id = ?
    `).run(id);
    db.prepare(`
      UPDATE friend_requests
      SET status = 'accepted', responded_at = datetime('now')
      WHERE sender_steam_id = ? AND receiver_steam_id = ? AND status = 'pending'
    `).run(receiver, request.sender_steam_id);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
  return { accepted: true, friend: decorateFriendUser(getFriendUser(request.sender_steam_id)) };
}

function declineFriendRequest(receiverSteamId, requestId) {
  const receiver = String(receiverSteamId || "").trim();
  const result = db.prepare(`
    UPDATE friend_requests
    SET status = 'declined', responded_at = datetime('now')
    WHERE id = ? AND receiver_steam_id = ? AND status = 'pending'
  `).run(Number(requestId), receiver);
  if (!result.changes) {
    const error = new Error("Friend request was not found");
    error.code = "FRIEND_REQUEST_NOT_FOUND";
    throw error;
  }
  return { declined: true };
}

function cancelFriendRequest(senderSteamId, requestId) {
  const sender = String(senderSteamId || "").trim();
  const result = db.prepare(`
    UPDATE friend_requests
    SET status = 'cancelled', responded_at = datetime('now')
    WHERE id = ? AND sender_steam_id = ? AND status = 'pending'
  `).run(Number(requestId), sender);
  if (!result.changes) {
    const error = new Error("Friend request was not found");
    error.code = "FRIEND_REQUEST_NOT_FOUND";
    throw error;
  }
  return { cancelled: true };
}

function removeFriend(steamId, friendSteamId) {
  const [steamA, steamB] = normalizeFriendPair(steamId, friendSteamId);
  const result = db.prepare(
    "DELETE FROM friendships WHERE steam_a = ? AND steam_b = ?"
  ).run(steamA, steamB);
  return { removed: Number(result.changes || 0) > 0 };
}

function blockFriendUser(steamId, blockedSteamId) {
  const blocker = String(steamId || "").trim();
  const blocked = String(blockedSteamId || "").trim();
  normalizeFriendPair(blocker, blocked);
  if (!getFriendUser(blocked)) throw new Error("That Hollow Valley player was not found");

  db.exec("BEGIN IMMEDIATE");
  try {
    const [steamA, steamB] = normalizeFriendPair(blocker, blocked);
    db.prepare("DELETE FROM friendships WHERE steam_a = ? AND steam_b = ?").run(steamA, steamB);
    db.prepare(`
      UPDATE friend_requests
      SET status = 'cancelled', responded_at = datetime('now')
      WHERE status = 'pending'
        AND ((sender_steam_id = ? AND receiver_steam_id = ?)
          OR (sender_steam_id = ? AND receiver_steam_id = ?))
    `).run(blocker, blocked, blocked, blocker);
    db.prepare(`
      INSERT INTO friend_blocks (blocker_steam_id, blocked_steam_id)
      VALUES (?, ?)
      ON CONFLICT(blocker_steam_id, blocked_steam_id) DO NOTHING
    `).run(blocker, blocked);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
  return { blocked: true };
}

function unblockFriendUser(steamId, blockedSteamId) {
  const blocker = String(steamId || "").trim();
  const blocked = String(blockedSteamId || "").trim();
  const result = db.prepare(
    "DELETE FROM friend_blocks WHERE blocker_steam_id = ? AND blocked_steam_id = ?"
  ).run(blocker, blocked);
  return { unblocked: Number(result.changes || 0) > 0 };
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
  findOrCreateUserBySteam,
  getUserByUsername,
  listSteamLinkedUsers,
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
  recordLivePlaytime,
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
  createBodyDropRequest,
  updateBodyDropRequest,
  getLatestBodyDropRequest,
  getRecentBodyDropRequests,
  getFriendState,
  searchFriendUsers,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  removeFriend,
  blockFriendUser,
  unblockFriendUser,
  getDashboardSummary,
};
