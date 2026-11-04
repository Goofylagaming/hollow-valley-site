"use strict";

const { db, getSupporterStatus } = require("../db");
const membershipEntitlements = require("./membershipEntitlements");

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 5;
const MAX_TITLE = 80;
const MAX_DESCRIPTION = 180;
const MAX_DURATION_DAYS = 31;

class SkinVoteError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS membership_skin_vote_ballots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('open','closed')),
      opens_at INTEGER NOT NULL,
      closes_at INTEGER NOT NULL,
      created_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_membership_skin_vote_ballots_status
      ON membership_skin_vote_ballots(status, closes_at);
    CREATE TABLE IF NOT EXISTS membership_skin_vote_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ballot_id INTEGER NOT NULL REFERENCES membership_skin_vote_ballots(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL,
      UNIQUE(ballot_id, label)
    );
    CREATE TABLE IF NOT EXISTS membership_skin_votes (
      ballot_id INTEGER NOT NULL REFERENCES membership_skin_vote_ballots(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      option_id INTEGER NOT NULL REFERENCES membership_skin_vote_options(id) ON DELETE CASCADE,
      voted_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY(ballot_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_membership_skin_votes_option
      ON membership_skin_votes(ballot_id, option_id);
  `);
}

function enabled(env = process.env) {
  return membershipEntitlements.enabled(env);
}

function normalizeExpired(now = Date.now()) {
  ensureSchema();
  db.prepare(`
    UPDATE membership_skin_vote_ballots
    SET status='closed', closed_at=COALESCE(closed_at, datetime('now'))
    WHERE status='open' AND closes_at <= ?
  `).run(now);
}

function cleanText(value, max, field) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > max || /[\u0000-\u001f\u007f<>]/.test(text)) {
    throw new SkinVoteError(400, "INVALID_SKIN_VOTE", `Enter a valid ${field}.`);
  }
  return text;
}

function normalizeOptions(items) {
  if (!Array.isArray(items) || items.length < MIN_OPTIONS || items.length > MAX_OPTIONS) {
    throw new SkinVoteError(400, "INVALID_SKIN_VOTE", `Choose between ${MIN_OPTIONS} and ${MAX_OPTIONS} skin options.`);
  }
  const seen = new Set();
  return items.map((item) => {
    const label = cleanText(item?.label, 60, "skin option name");
    const key = label.toLocaleLowerCase("en-AU");
    if (seen.has(key)) throw new SkinVoteError(400, "INVALID_SKIN_VOTE", "Skin option names must be unique.");
    seen.add(key);
    const description = item?.description ? cleanText(item.description, MAX_DESCRIPTION, "skin option description") : "";
    return { label, description };
  });
}

function activeBallot(now = Date.now()) {
  normalizeExpired(now);
  return db.prepare(`
    SELECT * FROM membership_skin_vote_ballots
    WHERE status='open' AND opens_at <= ? AND closes_at > ?
    ORDER BY id DESC LIMIT 1
  `).get(now, now) || null;
}

function ballotOptions(ballotId) {
  return db.prepare(`
    SELECT o.id, o.label, o.description, o.sort_order,
      COUNT(v.user_id) AS votes
    FROM membership_skin_vote_options o
    LEFT JOIN membership_skin_votes v ON v.option_id=o.id AND v.ballot_id=o.ballot_id
    WHERE o.ballot_id=?
    GROUP BY o.id
    ORDER BY o.sort_order, o.id
  `).all(ballotId).map((row) => ({
    id: Number(row.id),
    label: row.label,
    description: row.description,
    votes: Number(row.votes || 0),
  }));
}

function latestWinner() {
  const ballot = db.prepare(`
    SELECT * FROM membership_skin_vote_ballots
    WHERE status='closed'
    ORDER BY COALESCE(closed_at, created_at) DESC, id DESC LIMIT 1
  `).get();
  if (!ballot) return null;
  const options = ballotOptions(ballot.id);
  if (!options.length) return null;
  const max = Math.max(...options.map((option) => option.votes));
  if (max <= 0) return { ballotId: ballot.id, title: ballot.title, tied: false, label: null, votes: 0 };
  const winners = options.filter((option) => option.votes === max);
  return {
    ballotId: ballot.id,
    title: ballot.title,
    tied: winners.length > 1,
    label: winners.length === 1 ? winners[0].label : null,
    votes: max,
  };
}

function entitlementFor(user, { env = process.env, now = Date.now() } = {}) {
  if (!user?.id) return { entitled: false, tier: null, tierLabel: null };
  return membershipEntitlements.entitlement(getSupporterStatus(user.id), { env, now });
}

function currentForUser(user, { env = process.env, now = Date.now() } = {}) {
  if (!enabled(env)) return { enabled: false };
  ensureSchema();
  const active = entitlementFor(user, { env, now });
  const ballot = activeBallot(now);
  const base = {
    enabled: true,
    eligible: active.entitled,
    tier: active.tier,
    tierLabel: active.tierLabel,
    open: Boolean(ballot),
    lastWinner: latestWinner(),
  };
  if (!ballot) return { ...base, ballot: null, options: [], selectedOptionId: null, totalVotes: 0 };
  if (!active.entitled) {
    return {
      ...base,
      ballot: { id: ballot.id, title: ballot.title, closesAt: new Date(ballot.closes_at).toISOString() },
      options: [],
      selectedOptionId: null,
      totalVotes: null,
    };
  }
  const options = ballotOptions(ballot.id);
  const selected = db.prepare("SELECT option_id FROM membership_skin_votes WHERE ballot_id=? AND user_id=?")
    .get(ballot.id, user.id);
  return {
    ...base,
    ballot: {
      id: ballot.id,
      title: ballot.title,
      opensAt: new Date(ballot.opens_at).toISOString(),
      closesAt: new Date(ballot.closes_at).toISOString(),
    },
    options,
    selectedOptionId: selected ? Number(selected.option_id) : null,
    totalVotes: options.reduce((sum, option) => sum + option.votes, 0),
  };
}

function castVote(user, optionId, { env = process.env, now = Date.now() } = {}) {
  if (!enabled(env)) throw new SkinVoteError(503, "SKIN_VOTE_DISABLED", "Member skin voting is being prepared.");
  ensureSchema();
  const active = entitlementFor(user, { env, now });
  if (!active.entitled) throw new SkinVoteError(403, "MEMBERSHIP_REQUIRED", "An active paid membership is required to vote.");
  const ballot = activeBallot(now);
  if (!ballot) throw new SkinVoteError(409, "NO_OPEN_SKIN_VOTE", "There is no member skin vote open right now.");
  const selected = Number(optionId);
  if (!Number.isSafeInteger(selected) || selected <= 0) {
    throw new SkinVoteError(400, "INVALID_SKIN_VOTE_OPTION", "Choose a valid skin option.");
  }
  const option = db.prepare("SELECT id FROM membership_skin_vote_options WHERE id=? AND ballot_id=?")
    .get(selected, ballot.id);
  if (!option) throw new SkinVoteError(400, "INVALID_SKIN_VOTE_OPTION", "Choose a valid skin option.");
  db.prepare(`
    INSERT INTO membership_skin_votes(ballot_id,user_id,option_id)
    VALUES (?,?,?)
    ON CONFLICT(ballot_id,user_id) DO UPDATE SET
      option_id=excluded.option_id, voted_at=datetime('now')
  `).run(ballot.id, user.id, selected);
  return currentForUser(user, { env, now });
}

function createBallot(actor, input, { env = process.env, now = Date.now() } = {}) {
  if (!actor?.is_admin) throw new SkinVoteError(403, "ADMIN_REQUIRED", "Admin access is required.");
  if (!enabled(env)) throw new SkinVoteError(503, "SKIN_VOTE_DISABLED", "Enable membership rewards before opening a skin vote.");
  ensureSchema();
  normalizeExpired(now);
  if (activeBallot(now)) throw new SkinVoteError(409, "SKIN_VOTE_ALREADY_OPEN", "Close the current member skin vote before opening another.");
  const title = cleanText(input?.title || "Choose next month's premium skin", MAX_TITLE, "vote title");
  const options = normalizeOptions(input?.options);
  const durationDays = Number(input?.durationDays);
  if (!Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > MAX_DURATION_DAYS) {
    throw new SkinVoteError(400, "INVALID_SKIN_VOTE", `Vote duration must be between 1 and ${MAX_DURATION_DAYS} days.`);
  }
  const closesAt = now + durationDays * 86400000;
  db.exec("BEGIN IMMEDIATE");
  try {
    const inserted = db.prepare(`
      INSERT INTO membership_skin_vote_ballots(title,status,opens_at,closes_at,created_by)
      VALUES (?,'open',?,?,?)
    `).run(title, now, closesAt, Number(actor.id) || null);
    const ballotId = Number(inserted.lastInsertRowid);
    const insertOption = db.prepare(`
      INSERT INTO membership_skin_vote_options(ballot_id,label,description,sort_order)
      VALUES (?,?,?,?)
    `);
    options.forEach((option, index) => insertOption.run(ballotId, option.label, option.description, index));
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
  return adminState({ env, now });
}

function closeBallot(actor, { env = process.env, now = Date.now() } = {}) {
  if (!actor?.is_admin) throw new SkinVoteError(403, "ADMIN_REQUIRED", "Admin access is required.");
  if (!enabled(env)) throw new SkinVoteError(503, "SKIN_VOTE_DISABLED", "Member skin voting is not enabled.");
  ensureSchema();
  const ballot = activeBallot(now);
  if (!ballot) throw new SkinVoteError(409, "NO_OPEN_SKIN_VOTE", "There is no open member skin vote to close.");
  db.prepare("UPDATE membership_skin_vote_ballots SET status='closed', closes_at=?, closed_at=datetime('now') WHERE id=?")
    .run(now, ballot.id);
  return adminState({ env, now });
}

function adminState({ env = process.env, now = Date.now() } = {}) {
  if (!enabled(env)) return { enabled: false, current: null, lastWinner: latestWinner() };
  ensureSchema();
  const ballot = activeBallot(now);
  return {
    enabled: true,
    current: ballot ? {
      id: ballot.id,
      title: ballot.title,
      opensAt: new Date(ballot.opens_at).toISOString(),
      closesAt: new Date(ballot.closes_at).toISOString(),
      options: ballotOptions(ballot.id),
    } : null,
    lastWinner: latestWinner(),
  };
}

module.exports = {
  SkinVoteError,
  ensureSchema,
  enabled,
  currentForUser,
  castVote,
  createBallot,
  closeBallot,
  adminState,
  _test: { normalizeOptions, activeBallot, ballotOptions, latestWinner },
};
