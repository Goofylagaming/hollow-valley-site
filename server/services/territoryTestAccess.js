// Steam-authoritative access list for invited non-admin Territory Wars testers.
// Deliberately separate from the website's users, Groups, Wallet and admin roles.
const { db } = require("../db");

let initialized = false;
function ensureSchema() {
  if (initialized) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS territory_test_participants (
      steam_id TEXT PRIMARY KEY,
      approved_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      approved_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  initialized = true;
}

function validSteamId(value) {
  return /^\d{17}$/.test(String(value || "").trim());
}

function isApproved(steamId) {
  if (!validSteamId(steamId)) return false;
  ensureSchema();
  return Boolean(db.prepare("SELECT 1 FROM territory_test_participants WHERE steam_id = ?").get(String(steamId).trim()));
}

function list() {
  ensureSchema();
  return db.prepare(`
    SELECT p.steam_id AS steamId, p.approved_at AS approvedAt,
           u.username AS username, u.avatar AS avatar,
           a.username AS approvedBy
    FROM territory_test_participants p
    LEFT JOIN users u ON u.steam_id = p.steam_id
    LEFT JOIN users a ON a.id = p.approved_by_user_id
    ORDER BY p.approved_at DESC, p.steam_id
  `).all();
}

function add(steamId, approvedByUserId) {
  const id = String(steamId || "").trim();
  if (!validSteamId(id)) {
    const error = new Error("Enter a valid 17-digit Steam ID.");
    error.status = 400;
    throw error;
  }
  ensureSchema();
  db.prepare(`
    INSERT INTO territory_test_participants (steam_id, approved_by_user_id)
    VALUES (?, ?)
    ON CONFLICT(steam_id) DO NOTHING
  `).run(id, Number(approvedByUserId) || null);
  return list().find(row => row.steamId === id);
}

function remove(steamId) {
  const id = String(steamId || "").trim();
  if (!validSteamId(id)) {
    const error = new Error("Enter a valid 17-digit Steam ID.");
    error.status = 400;
    throw error;
  }
  ensureSchema();
  return db.prepare("DELETE FROM territory_test_participants WHERE steam_id = ?").run(id).changes > 0;
}

function search(query) {
  const q = String(query || "").trim().slice(0, 80);
  if (q.length < 2) return [];
  const wildcard = "%" + q.replace(/[\\%_]/g, "\\$&") + "%";
  return db.prepare(`
    SELECT u.steam_id AS steamId, u.username AS username,
           CASE WHEN p.steam_id IS NULL THEN 0 ELSE 1 END AS approved
    FROM users u
    LEFT JOIN territory_test_participants p ON p.steam_id = u.steam_id
    WHERE u.steam_id IS NOT NULL AND u.steam_id <> ''
      AND (u.steam_id LIKE ? ESCAPE '\\' OR u.username LIKE ? ESCAPE '\\' COLLATE NOCASE)
    ORDER BY u.username COLLATE NOCASE ASC
    LIMIT 15
  `).all(wildcard, wildcard);
}

module.exports = { ensureSchema, isApproved, list, add, remove, search, validSteamId };
