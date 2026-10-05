const express = require("express");
const { db } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");

const router = express.Router();

// Territory Wars deliberately lives in the portal database so the website and
// Discord/Herbybot can share one source of truth. Live game presence/combat can
// update these same records later through the automation bridge.
db.exec(`
  CREATE TABLE IF NOT EXISTS territory_registrations (
    user_id INTEGER PRIMARY KEY REFERENCES users(id),
    registered_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS territory_groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    tag TEXT,
    leader_user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_territory_groups_tag
    ON territory_groups(tag)
    WHERE tag IS NOT NULL AND tag <> '';

  CREATE TABLE IF NOT EXISTS territory_group_members (
    group_id INTEGER NOT NULL REFERENCES territory_groups(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'member',
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (group_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_territory_group_members_user
    ON territory_group_members(user_id);

  CREATE TABLE IF NOT EXISTS territory_group_stats (
    group_id INTEGER PRIMARY KEY REFERENCES territory_groups(id) ON DELETE CASCADE,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    captures INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,
    deaths INTEGER NOT NULL DEFAULT 0,
    zone_seconds INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS territory_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    territory_key TEXT NOT NULL DEFAULT 'south-plains',
    territory_name TEXT NOT NULL DEFAULT 'South Plains',
    status TEXT NOT NULL DEFAULT 'scheduled',
    starts_at TEXT,
    ends_at TEXT,
    owner_name TEXT NOT NULL DEFAULT 'Admin',
    challenger_name TEXT,
    owner_control INTEGER NOT NULL DEFAULT 100,
    challenger_control INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS territory_event_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES territory_events(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    actor_user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const EVENT_STATUSES = new Set(["scheduled", "live", "paused", "ended"]);

function cleanText(value, fallback = "", max = 80) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return (text || fallback).slice(0, max);
}

function cleanDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function clampPercent(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function latestEvent() {
  return db.prepare(`
    SELECT * FROM territory_events
    ORDER BY CASE status WHEN 'live' THEN 0 WHEN 'paused' THEN 1 WHEN 'scheduled' THEN 2 ELSE 3 END,
             id DESC
    LIMIT 1
  `).get() || null;
}

function eventById(id) {
  return db.prepare("SELECT * FROM territory_events WHERE id = ?").get(Number(id)) || null;
}

function eventLog(eventId, limit = 20) {
  if (!eventId) return [];
  return db.prepare(`
    SELECT id, kind, message, created_at
    FROM territory_event_log
    WHERE event_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(Number(eventId), Math.max(1, Math.min(50, Number(limit) || 20)));
}

function addLog(eventId, kind, message, actorUserId = null) {
  if (!eventId) return;
  db.prepare(`
    INSERT INTO territory_event_log (event_id, kind, message, actor_user_id)
    VALUES (?, ?, ?, ?)
  `).run(Number(eventId), cleanText(kind, "update", 32), cleanText(message, "Territory updated", 240), actorUserId || null);
}

function groupForUser(userId) {
  return db.prepare(`
    SELECT g.id, g.name, g.tag, gm.role,
           COALESCE(s.wins, 0) AS wins,
           COALESCE(s.losses, 0) AS losses,
           COALESCE(s.captures, 0) AS captures,
           COALESCE(s.kills, 0) AS kills,
           COALESCE(s.deaths, 0) AS deaths,
           COALESCE(s.zone_seconds, 0) AS zone_seconds
    FROM territory_group_members gm
    JOIN territory_groups g ON g.id = gm.group_id
    LEFT JOIN territory_group_stats s ON s.group_id = g.id
    WHERE gm.user_id = ?
    ORDER BY gm.joined_at DESC
    LIMIT 1
  `).get(Number(userId)) || null;
}

function groupRoster(groupId) {
  if (!groupId) return [];
  return db.prepare(`
    SELECT u.id, u.username, u.steam_id, u.discord_id, gm.role, gm.joined_at
    FROM territory_group_members gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.group_id = ?
    ORDER BY CASE gm.role WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END,
             u.username COLLATE NOCASE
  `).all(Number(groupId));
}

function leaderboard() {
  return db.prepare(`
    SELECT g.id, g.name, g.tag,
           COALESCE(s.wins, 0) AS wins,
           COALESCE(s.losses, 0) AS losses,
           COALESCE(s.captures, 0) AS captures,
           COALESCE(s.kills, 0) AS kills,
           COALESCE(s.deaths, 0) AS deaths,
           COALESCE(s.zone_seconds, 0) AS zone_seconds
    FROM territory_groups g
    LEFT JOIN territory_group_stats s ON s.group_id = g.id
    ORDER BY wins DESC, captures DESC, kills DESC, zone_seconds DESC, g.name COLLATE NOCASE
    LIMIT 10
  `).all();
}

function publicState() {
  const event = latestEvent();
  return {
    event,
    log: event ? eventLog(event.id, 12) : [],
    leaderboard: leaderboard(),
  };
}

router.get("/state", (_req, res) => {
  res.json({ ok: true, ...publicState() });
});

router.get("/me", requireAuth, (req, res) => {
  const registration = db.prepare("SELECT registered_at, updated_at FROM territory_registrations WHERE user_id = ?").get(req.user.id) || null;
  const group = groupForUser(req.user.id);
  res.json({
    ok: true,
    registered: Boolean(registration),
    registration,
    player: {
      id: req.user.id,
      username: req.user.username,
      steamId: req.user.steam_id || null,
      discordId: req.user.discord_id || null,
    },
    group,
    roster: group ? groupRoster(group.id) : [],
  });
});

router.post("/register", requireAuth, (req, res) => {
  db.prepare(`
    INSERT INTO territory_registrations (user_id, registered_at, updated_at)
    VALUES (?, datetime('now'), datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET updated_at = datetime('now')
  `).run(req.user.id);

  const registration = db.prepare("SELECT registered_at, updated_at FROM territory_registrations WHERE user_id = ?").get(req.user.id);
  res.json({ ok: true, registered: true, registration });
});

router.get("/admin/state", requireAdmin, (_req, res) => {
  res.json({ ok: true, ...publicState() });
});

router.post("/admin/event", requireAdmin, (req, res) => {
  const body = req.body || {};
  const id = Number(body.id);
  const name = cleanText(body.name, "South Plains Territory War", 100);
  const territoryKey = cleanText(body.territoryKey, "south-plains", 48).toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const territoryName = cleanText(body.territoryName, "South Plains", 80);
  const ownerName = cleanText(body.ownerName, "Admin", 80);
  const challengerName = cleanText(body.challengerName, "", 80) || null;
  const startsAt = cleanDate(body.startsAt);
  const endsAt = cleanDate(body.endsAt);

  let event;
  if (id && eventById(id)) {
    db.prepare(`
      UPDATE territory_events
      SET name = ?, territory_key = ?, territory_name = ?, starts_at = ?, ends_at = ?,
          owner_name = ?, challenger_name = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(name, territoryKey, territoryName, startsAt, endsAt, ownerName, challengerName, id);
    event = eventById(id);
    addLog(id, "config", "Event details updated", req.user.id);
  } else {
    const result = db.prepare(`
      INSERT INTO territory_events
        (name, territory_key, territory_name, status, starts_at, ends_at, owner_name, challenger_name, created_by)
      VALUES (?, ?, ?, 'scheduled', ?, ?, ?, ?, ?)
    `).run(name, territoryKey, territoryName, startsAt, endsAt, ownerName, challengerName, req.user.id);
    event = eventById(result.lastInsertRowid);
    addLog(event.id, "created", `${event.name} created`, req.user.id);
  }

  res.json({ ok: true, event, log: eventLog(event.id) });
});

router.post("/admin/status", requireAdmin, (req, res) => {
  const event = eventById(req.body?.id) || latestEvent();
  if (!event) return res.status(404).json({ error: "No Territory War event exists yet" });

  const status = cleanText(req.body?.status, "", 16).toLowerCase();
  if (!EVENT_STATUSES.has(status)) return res.status(400).json({ error: "Invalid event status" });

  db.prepare("UPDATE territory_events SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, event.id);
  addLog(event.id, "status", `Event ${status}`, req.user.id);
  res.json({ ok: true, event: eventById(event.id), log: eventLog(event.id) });
});

router.post("/admin/control", requireAdmin, (req, res) => {
  const event = eventById(req.body?.id) || latestEvent();
  if (!event) return res.status(404).json({ error: "No Territory War event exists yet" });

  const ownerControl = clampPercent(req.body?.ownerControl, event.owner_control);
  const challengerControl = 100 - ownerControl;
  db.prepare(`
    UPDATE territory_events
    SET owner_control = ?, challenger_control = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(ownerControl, challengerControl, event.id);
  addLog(event.id, "control", `Control adjusted: ${ownerControl}% owner / ${challengerControl}% challenger`, req.user.id);
  res.json({ ok: true, event: eventById(event.id) });
});

router.post("/admin/reset", requireAdmin, (req, res) => {
  const event = eventById(req.body?.id) || latestEvent();
  if (!event) return res.status(404).json({ error: "No Territory War event exists yet" });

  db.prepare(`
    UPDATE territory_events
    SET status = 'scheduled', owner_control = 100, challenger_control = 0, updated_at = datetime('now')
    WHERE id = ?
  `).run(event.id);
  addLog(event.id, "reset", "Territory control reset to the current owner", req.user.id);
  res.json({ ok: true, event: eventById(event.id), log: eventLog(event.id) });
});

router.post("/admin/remove-challenger", requireAdmin, (req, res) => {
  const event = eventById(req.body?.id) || latestEvent();
  if (!event) return res.status(404).json({ error: "No Territory War event exists yet" });

  db.prepare(`
    UPDATE territory_events
    SET challenger_name = NULL, owner_control = 100, challenger_control = 0, updated_at = datetime('now')
    WHERE id = ?
  `).run(event.id);
  addLog(event.id, "team", "Challenger removed", req.user.id);
  res.json({ ok: true, event: eventById(event.id), log: eventLog(event.id) });
});

router.post("/admin/force-capture", requireAdmin, (req, res) => {
  const event = eventById(req.body?.id) || latestEvent();
  if (!event) return res.status(404).json({ error: "No Territory War event exists yet" });

  const winner = cleanText(req.body?.winner, "", 16).toLowerCase();
  if (!["owner", "challenger"].includes(winner)) return res.status(400).json({ error: "Winner must be owner or challenger" });

  if (winner === "challenger") {
    if (!event.challenger_name) return res.status(400).json({ error: "There is no challenger to award the territory to" });
    const newOwner = event.challenger_name;
    db.prepare(`
      UPDATE territory_events
      SET owner_name = ?, challenger_name = NULL, owner_control = 100, challenger_control = 0,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(newOwner, event.id);
    addLog(event.id, "capture", `${newOwner} captured ${event.territory_name}`, req.user.id);
  } else {
    db.prepare(`
      UPDATE territory_events
      SET owner_control = 100, challenger_control = 0, updated_at = datetime('now')
      WHERE id = ?
    `).run(event.id);
    addLog(event.id, "defence", `${event.owner_name} retained ${event.territory_name}`, req.user.id);
  }

  res.json({ ok: true, event: eventById(event.id), log: eventLog(event.id) });
});

module.exports = router;
