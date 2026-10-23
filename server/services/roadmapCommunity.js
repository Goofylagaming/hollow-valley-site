"use strict";

// Roadmap voting is website-only. It never calls the game server, wallet or
// Territory Wars runtime. Steam IDs provide one durable ballot per player.
const { db } = require("../db");

const MAX_VOTES = 3;
const VOTABLE_FEATURE_IDS = Object.freeze([
  1, 2, 3, 4, 5, 6, 10, 11, 12, 14, 15, 16, 17,
  18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
]);
const eligible = new Set(VOTABLE_FEATURE_IDS);

db.exec([
  "CREATE TABLE IF NOT EXISTS roadmap_votes (",
  " steam_id TEXT NOT NULL,",
  " feature_id INTEGER NOT NULL,",
  " created_at TEXT NOT NULL DEFAULT (datetime('now')),",
  " PRIMARY KEY(steam_id, feature_id),",
  " CHECK(feature_id BETWEEN 1 AND 30)",
  ");",
  "CREATE INDEX IF NOT EXISTS idx_roadmap_votes_feature ON roadmap_votes(feature_id);",
  "CREATE TABLE IF NOT EXISTS roadmap_suggestions (",
  " id INTEGER PRIMARY KEY AUTOINCREMENT,",
  " steam_id TEXT NOT NULL,",
  " title TEXT NOT NULL,",
  " description TEXT NOT NULL,",
  " status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),",
  " created_at TEXT NOT NULL DEFAULT (datetime('now')),",
  " reviewed_at TEXT,",
  " reviewed_by TEXT",
  ");",
  "CREATE INDEX IF NOT EXISTS idx_roadmap_suggestions_status ON roadmap_suggestions(status, id DESC);",
  "CREATE INDEX IF NOT EXISTS idx_roadmap_suggestions_author ON roadmap_suggestions(steam_id, created_at);",
].join("\n"));

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function validSteamId(value) {
  return typeof value === "string" && /^\d{17}$/.test(value);
}
function validateSteam(steamId) {
  if (!validSteamId(steamId)) {
    throw failure("STEAM_REQUIRED", "A linked Steam account is required to vote or submit ideas.");
  }
}
function voteSummary(steamId = null) {
  const rows = db.prepare(
    "SELECT feature_id, COUNT(*) AS total FROM roadmap_votes GROUP BY feature_id"
  ).all();
  const counts = Object.fromEntries(rows.map(row => [row.feature_id, Number(row.total)]));
  const myVotes = validSteamId(steamId)
    ? db.prepare("SELECT feature_id FROM roadmap_votes WHERE steam_id = ? ORDER BY feature_id").all(steamId).map(row => row.feature_id)
    : [];
  return {
    counts,
    myVotes,
    maxVotes: MAX_VOTES,
    eligibleFeatureIds: VOTABLE_FEATURE_IDS,
    requiresSteam: !validSteamId(steamId),
  };
}
function setVote(steamId, featureId, selected) {
  validateSteam(steamId);
  if (!Number.isInteger(featureId) || !eligible.has(featureId)) {
    throw failure("FEATURE_NOT_VOTABLE", "Voting is open for idea-stage features only.");
  }
  if (typeof selected !== "boolean") {
    throw failure("INVALID_BALLOT", "Select or remove a vote explicitly.");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const exists = db.prepare(
      "SELECT 1 AS found FROM roadmap_votes WHERE steam_id = ? AND feature_id = ?"
    ).get(steamId, featureId);
    if (selected && !exists) {
      const count = db.prepare(
        "SELECT COUNT(*) AS total FROM roadmap_votes WHERE steam_id = ?"
      ).get(steamId).total;
      if (count >= MAX_VOTES) {
        throw failure("VOTE_LIMIT", "You've used your three votes. Remove an existing vote to choose another idea.");
      }
      db.prepare("INSERT INTO roadmap_votes (steam_id, feature_id) VALUES (?, ?)").run(steamId, featureId);
    } else if (!selected && exists) {
      db.prepare("DELETE FROM roadmap_votes WHERE steam_id = ? AND feature_id = ?").run(steamId, featureId);
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
  return voteSummary(steamId);
}

function cleanText(input, maxLength) {
  if (typeof input !== "string") return "";
  return input.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength + 1);
}
function submitSuggestion(steamId, titleInput, descriptionInput) {
  validateSteam(steamId);
  const title = cleanText(titleInput, 90);
  const description = cleanText(descriptionInput, 500);
  if (title.length < 6 || title.length > 90 || description.length < 20 || description.length > 500) {
    throw failure("INVALID_SUGGESTION", "Provide a 6–90 character title and a 20–500 character description.");
  }
  db.exec("BEGIN IMMEDIATE");
  try {
    const today = db.prepare(
      "SELECT COUNT(*) AS total FROM roadmap_suggestions WHERE steam_id = ? AND created_at >= datetime('now', '-1 day')"
    ).get(steamId).total;
    const pending = db.prepare(
      "SELECT COUNT(*) AS total FROM roadmap_suggestions WHERE steam_id = ? AND status = 'pending'"
    ).get(steamId).total;
    if (today >= 3 || pending >= 5) {
      throw failure("SUGGESTION_LIMIT", "You've reached the suggestion limit. Try again after earlier ideas are reviewed.");
    }
    const duplicate = db.prepare(
      "SELECT 1 AS found FROM roadmap_suggestions WHERE steam_id = ? AND lower(title) = lower(?) AND status IN ('pending','approved')"
    ).get(steamId, title);
    if (duplicate) {
      throw failure("SUGGESTION_DUPLICATE", "You've already submitted an idea with this title.");
    }
    const result = db.prepare(
      "INSERT INTO roadmap_suggestions (steam_id, title, description) VALUES (?, ?, ?)"
    ).run(steamId, title, description);
    db.exec("COMMIT");
    return { id: Number(result.lastInsertRowid), status: "pending" };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}
function approvedSuggestions() {
  return db.prepare(
    "SELECT id, title, description, created_at AS createdAt FROM roadmap_suggestions WHERE status = 'approved' ORDER BY id DESC LIMIT 30"
  ).all();
}
function adminSuggestions() {
  return db.prepare(
    "SELECT id, title, description, steam_id AS steamId, status, created_at AS createdAt, reviewed_at AS reviewedAt, reviewed_by AS reviewedBy FROM roadmap_suggestions ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, id DESC LIMIT 200"
  ).all();
}
function moderateSuggestion(id, decision, adminSteamId) {
  validateSteam(adminSteamId);
  if (!Number.isSafeInteger(id) || id <= 0 || !["approved", "rejected"].includes(decision)) {
    throw failure("INVALID_MODERATION", "Choose a valid suggestion and approve or reject.");
  }
  const result = db.prepare(
    "UPDATE roadmap_suggestions SET status = ?, reviewed_at = datetime('now'), reviewed_by = ? WHERE id = ? AND status = 'pending'"
  ).run(decision, adminSteamId, id);
  if (result.changes !== 1) {
    throw failure("SUGGESTION_NOT_PENDING", "That suggestion is not pending review.");
  }
  return { id, status: decision };
}
module.exports = {
  MAX_VOTES,
  VOTABLE_FEATURE_IDS,
  voteSummary,
  setVote,
  submitSuggestion,
  approvedSuggestions,
  adminSuggestions,
  moderateSuggestion,
};
