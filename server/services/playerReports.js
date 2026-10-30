"use strict";
const { randomUUID } = require("node:crypto");
const { db } = require("../db");

const CATEGORIES = Object.freeze(["harassment", "cheating", "exploit", "combat", "storage", "other"]);
const STATUSES = Object.freeze(["open", "reviewing", "resolved", "dismissed"]);
const EVIDENCE_HOSTS = new Set([
  "cdn.discordapp.com", "media.discordapp.net", "discord.com",
  "steamcommunity.com", "www.youtube.com", "youtube.com", "youtu.be",
  "medal.tv", "www.medal.tv", "streamable.com", "www.streamable.com",
  "clips.twitch.tv", "www.twitch.tv", "twitch.tv",
  "drive.google.com", "i.imgur.com", "imgur.com", "www.imgur.com",
]);

// Additive tables only. Production submission is disabled until the runtime
// flag is deliberately enabled after review and moderator preparation.
db.exec([
  "CREATE TABLE IF NOT EXISTS player_reports (",
  " id TEXT PRIMARY KEY,",
  " reporter_user_id INTEGER NOT NULL REFERENCES users(id),",
  " reporter_steam_id TEXT NOT NULL,",
  " reported_steam_id TEXT,",
  " category TEXT NOT NULL,",
  " description TEXT NOT NULL,",
  " evidence_json TEXT NOT NULL DEFAULT '[]',",
  " occurred_at TEXT,",
  " status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewing','resolved','dismissed')),",
  " created_at TEXT NOT NULL DEFAULT (datetime('now')),",
  " updated_at TEXT NOT NULL DEFAULT (datetime('now')),",
  " reviewed_by_steam_id TEXT",
  ");",
  "CREATE INDEX IF NOT EXISTS idx_player_reports_reporter ON player_reports(reporter_steam_id, created_at DESC);",
  "CREATE INDEX IF NOT EXISTS idx_player_reports_status ON player_reports(status, created_at DESC);",
  "CREATE TABLE IF NOT EXISTS player_report_reviews (",
  " id INTEGER PRIMARY KEY AUTOINCREMENT,",
  " report_id TEXT NOT NULL REFERENCES player_reports(id),",
  " from_status TEXT NOT NULL,",
  " to_status TEXT NOT NULL,",
  " admin_steam_id TEXT NOT NULL,",
  " note TEXT,",
  " created_at TEXT NOT NULL DEFAULT (datetime('now'))",
  ");",
  "CREATE INDEX IF NOT EXISTS idx_player_report_reviews_report ON player_report_reviews(report_id, id DESC);",
].join("\n"));

function submissionsEnabled() {
  return process.env.PLAYER_REPORTS_ENABLED === "true";
}

function problem(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function validSteamId(value) {
  return typeof value === "string" && /^\d{17}$/.test(value);
}

function identity(user) {
  if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 || !validSteamId(user.steam_id)) {
    throw problem("STEAM_REQUIRED", "Sign in with a linked Steam account to submit or view reports.");
  }
  return { userId: user.id, steamId: user.steam_id };
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maxLength + 1);
}

function validateEvidence(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input) || input.length > 3) {
    throw problem("INVALID_EVIDENCE", "Provide up to three supported HTTPS screenshot or video links.");
  }
  const urls = input.map(value => {
    const raw = cleanText(value, 500);
    if (!raw || raw.length > 500) throw problem("INVALID_EVIDENCE", "An evidence link is empty or too long.");
    let parsed;
    try { parsed = new URL(raw); }
    catch { throw problem("INVALID_EVIDENCE", "Evidence links must be valid HTTPS URLs."); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password ||
        parsed.port || !EVIDENCE_HOSTS.has(parsed.hostname.toLowerCase())) {
      throw problem("INVALID_EVIDENCE",
        "Use HTTPS links from Discord, Steam, YouTube, Medal, Streamable, Twitch, Google Drive or Imgur.");
    }
    return parsed.toString();
  });
  if (new Set(urls).size !== urls.length) {
    throw problem("INVALID_EVIDENCE", "Remove duplicate evidence links.");
  }
  return urls;
}

function validateReport(input, reporterSteamId, now = Date.now()) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw problem("INVALID_REPORT", "Invalid report.");
  const category = String(input.category || "").trim();
  const description = cleanText(input.description, 2500);
  const reported = String(input.reportedSteamId || "").trim();
  if (!CATEGORIES.includes(category)) throw problem("INVALID_REPORT", "Choose a valid report category.");
  if (description.length < 30 || description.length > 2500) {
    throw problem("INVALID_REPORT", "Provide a description between 30 and 2,500 characters.");
  }
  if (reported && (!validSteamId(reported) || reported === reporterSteamId)) {
    throw problem("INVALID_REPORT", "Reported player must be another valid 17-digit Steam ID.");
  }
  let occurredAt = null;
  if (input.occurredAt) {
    const time = new Date(input.occurredAt).getTime();
    if (!Number.isFinite(time) || time > now + 15 * 60 * 1000 || time < now - 90 * 24 * 60 * 60 * 1000) {
      throw problem("INVALID_REPORT", "Incident date must be within the past 90 days.");
    }
    occurredAt = new Date(time).toISOString();
  }
  return {
    category, description, reportedSteamId: reported || null, occurredAt,
    evidenceUrls: validateEvidence(input.evidenceUrls),
  };
}

function rowToReport(row, admin = false) {
  if (!row) return null;
  let evidenceUrls = [];
  try { evidenceUrls = JSON.parse(row.evidence_json || "[]"); } catch {}
  const result = {
    id: row.id,
    category: row.category,
    description: row.description,
    reportedSteamId: row.reported_steam_id,
    evidenceUrls: Array.isArray(evidenceUrls) ? evidenceUrls : [],
    occurredAt: row.occurred_at,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (admin) {
    result.reporterSteamId = row.reporter_steam_id;
    result.reporterName = row.reporter_name || "Unknown player";
    result.reviewedBySteamId = row.reviewed_by_steam_id;
  }
  return result;
}

function createReport(user, payload) {
  if (!submissionsEnabled()) throw problem("REPORTS_DISABLED", "Player reporting is not open yet.");
  const actor = identity(user);
  const details = validateReport(payload, actor.steamId);
  db.exec("BEGIN IMMEDIATE");
  try {
    const daily = db.prepare(
      "SELECT COUNT(*) AS total FROM player_reports WHERE reporter_steam_id = ? AND created_at >= datetime('now', '-1 day')"
    ).get(actor.steamId).total;
    const latest = db.prepare(
      "SELECT (strftime('%s','now') - strftime('%s', created_at)) AS age FROM player_reports WHERE reporter_steam_id = ? ORDER BY created_at DESC LIMIT 1"
    ).get(actor.steamId);
    if (daily >= 3 || (latest && Number(latest.age) < 120)) {
      throw problem("REPORT_LIMIT", "Report limit reached. Submit at most three per day, at least two minutes apart.");
    }
    const id = randomUUID();
    db.prepare(
      "INSERT INTO player_reports (id, reporter_user_id, reporter_steam_id, reported_steam_id, category, description, evidence_json, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, actor.userId, actor.steamId, details.reportedSteamId, details.category,
      details.description, JSON.stringify(details.evidenceUrls), details.occurredAt);
    const row = db.prepare("SELECT * FROM player_reports WHERE id = ?").get(id);
    db.exec("COMMIT");
    return rowToReport(row);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function listMine(user) {
  const actor = identity(user);
  return db.prepare("SELECT * FROM player_reports WHERE reporter_steam_id = ? ORDER BY created_at DESC, id DESC LIMIT 50")
    .all(actor.steamId).map(row => rowToReport(row));
}

function listAdmin({ status = "", q = "", limit = 50 } = {}) {
  const safeStatus = STATUSES.includes(status) ? status : "";
  const query = cleanText(q, 90).toLowerCase();
  const count = Number(limit);
  const safeLimit = Number.isSafeInteger(count) ? Math.max(1, Math.min(100, count)) : 50;
  const where = [];
  const args = [];
  if (safeStatus) { where.push("r.status = ?"); args.push(safeStatus); }
  if (query) {
    where.push("(lower(r.reporter_steam_id) LIKE ? OR lower(coalesce(u.username,'')) LIKE ? OR lower(coalesce(r.reported_steam_id,'')) LIKE ? OR lower(r.category) LIKE ? OR lower(r.id) LIKE ?)");
    for (let i = 0; i < 5; i++) args.push("%" + query + "%");
  }
  const clause = where.length ? " WHERE " + where.join(" AND ") : "";
  return db.prepare(
    "SELECT r.*, u.username AS reporter_name FROM player_reports r LEFT JOIN users u ON u.id = r.reporter_user_id" +
    clause + " ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END, r.created_at DESC LIMIT ?"
  ).all(...args, safeLimit).map(row => rowToReport(row, true));
}

function adminDetail(id) {
  const report = rowToReport(db.prepare(
    "SELECT r.*, u.username AS reporter_name FROM player_reports r LEFT JOIN users u ON u.id = r.reporter_user_id WHERE r.id = ?"
  ).get(String(id || "").trim()), true);
  if (!report) return null;
  return {
    report,
    reviews: db.prepare(
      "SELECT from_status AS fromStatus, to_status AS toStatus, admin_steam_id AS adminSteamId, note, created_at AS createdAt FROM player_report_reviews WHERE report_id = ? ORDER BY id DESC LIMIT 50"
    ).all(report.id),
  };
}

function reviewReport(id, admin, nextStatus, noteInput) {
  const actor = identity(admin);
  if (!admin.is_admin) throw problem("ADMIN_REQUIRED", "Admin review access required.");
  const status = String(nextStatus || "").trim();
  if (!STATUSES.includes(status)) throw problem("INVALID_REVIEW", "Choose a valid report status.");
  const note = cleanText(noteInput || "", 500);
  if (note.length > 500) throw problem("INVALID_REVIEW", "Admin note must be no more than 500 characters.");
  const reportId = String(id || "").trim();
  if (!/^[0-9a-f-]{36}$/.test(reportId)) throw problem("INVALID_REVIEW", "Invalid report ID.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const current = db.prepare("SELECT status FROM player_reports WHERE id = ?").get(reportId);
    if (!current) throw problem("NOT_FOUND", "Report was not found.");
    if (current.status === status && !note) {
      const existing = adminDetail(reportId);
      db.exec("COMMIT");
      return { changed: false, ...existing };
    }
    db.prepare(
      "UPDATE player_reports SET status = ?, updated_at = datetime('now'), reviewed_by_steam_id = ? WHERE id = ?"
    ).run(status, actor.steamId, reportId);
    db.prepare(
      "INSERT INTO player_report_reviews (report_id, from_status, to_status, admin_steam_id, note) VALUES (?, ?, ?, ?, ?)"
    ).run(reportId, current.status, status, actor.steamId, note || null);
    const result = adminDetail(reportId);
    db.exec("COMMIT");
    return { changed: true, ...result };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

module.exports = {
  CATEGORIES, STATUSES, submissionsEnabled, identity, validateEvidence,
  validateReport, createReport, listMine, listAdmin, adminDetail, reviewReport,
};
