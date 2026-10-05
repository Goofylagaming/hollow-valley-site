const express = require("express");
const { db } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");
const serverStatus = require("../services/serverStatus");
const { REGIONS, fromRconLocation, nearestRegion } = require("../evrimaMap");

const router = express.Router();
const LINEUP_CAP = 6;
const LIVE_SUB_DELAY_MS = 10 * 60 * 1000;

// Territory Wars deliberately lives in the portal database so the website,
// live map and Discord/Herbybot can share one source of truth.
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

  CREATE TABLE IF NOT EXISTS territory_group_invites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES territory_groups(id) ON DELETE CASCADE,
    invited_steam_id TEXT NOT NULL,
    invited_by_user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    responded_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_territory_group_invites_steam
    ON territory_group_invites(invited_steam_id, status, created_at DESC);

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

  CREATE TABLE IF NOT EXISTS territory_event_registrations (
    event_id INTEGER NOT NULL REFERENCES territory_events(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES territory_groups(id) ON DELETE CASCADE,
    registered_by_user_id INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'registered',
    registered_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (event_id, group_id)
  );

  CREATE TABLE IF NOT EXISTS territory_event_lineups (
    event_id INTEGER NOT NULL REFERENCES territory_events(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES territory_groups(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    selected_by_user_id INTEGER NOT NULL REFERENCES users(id),
    active_from TEXT NOT NULL DEFAULT (datetime('now')),
    selected_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (event_id, group_id, user_id)
  );

  CREATE INDEX IF NOT EXISTS idx_territory_event_lineups_event
    ON territory_event_lineups(event_id, group_id, active_from);

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
const GROUP_ROLES = new Set(["leader", "officer", "member"]);

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

function normalizeRegion(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function territoryRegionName(event) {
  const wanted = normalizeRegion(event?.territory_name || event?.territory_key);
  if (!wanted) return null;
  return REGIONS.map(([name]) => name).find((name) => normalizeRegion(name) === wanted) || null;
}

function territoryPresence(event, includePlayers = false) {
  const state = serverStatus.getState();
  const region = territoryRegionName(event);
  if (!state?.configured || !state?.online || !region) {
    return {
      serverOnline: Boolean(state?.online),
      tracking: Boolean(region),
      region,
      playerCount: 0,
      ...(includePlayers ? { players: [] } : {}),
      lastChecked: state?.lastChecked || null,
    };
  }

  const players = [];
  for (const character of Array.isArray(state.characters) ? state.characters : []) {
    const { x, y } = fromRconLocation(character?.location);
    if (nearestRegion(x, y) !== region) continue;
    const steamId = String(character?.steamId || "");
    const membership = /^\d{17}$/.test(steamId)
      ? db.prepare(`
          SELECT g.id AS group_id, g.name AS group_name, g.tag AS group_tag, gm.role
          FROM territory_group_members gm
          JOIN territory_groups g ON g.id = gm.group_id
          JOIN users u ON u.id = gm.user_id
          WHERE u.steam_id = ?
          ORDER BY gm.joined_at DESC
          LIMIT 1
        `).get(steamId)
      : null;
    players.push({
      steamId,
      name: character?.name || "Unknown player",
      species: character?.species || "Unknown species",
      isPrime: Boolean(character?.isPrime),
      ...(membership ? {
        groupId: membership.group_id,
        groupName: membership.group_name,
        groupTag: membership.group_tag,
        groupRole: membership.role,
      } : {}),
    });
  }

  return {
    serverOnline: true,
    tracking: true,
    region,
    playerCount: players.length,
    ...(includePlayers ? { players } : {}),
    lastChecked: state.lastChecked || null,
  };
}

function groupForUser(userId) {
  return db.prepare(`
    SELECT g.id, g.name, g.tag, g.leader_user_id, gm.role,
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

function pendingInvitesForSteam(steamId) {
  if (!/^\d{17}$/.test(String(steamId || ""))) return [];
  return db.prepare(`
    SELECT i.id, i.group_id, i.created_at, g.name AS group_name, g.tag AS group_tag,
           u.username AS invited_by
    FROM territory_group_invites i
    JOIN territory_groups g ON g.id = i.group_id
    JOIN users u ON u.id = i.invited_by_user_id
    WHERE i.invited_steam_id = ? AND i.status = 'pending'
    ORDER BY i.id DESC
  `).all(String(steamId));
}

function eventRegistration(eventId, groupId) {
  if (!eventId || !groupId) return null;
  return db.prepare(`
    SELECT event_id, group_id, status, registered_at
    FROM territory_event_registrations
    WHERE event_id = ? AND group_id = ?
  `).get(Number(eventId), Number(groupId)) || null;
}

function eventLineup(eventId, groupId) {
  if (!eventId || !groupId) return [];
  return db.prepare(`
    SELECT l.user_id, l.active_from, l.selected_at,
           u.username, u.steam_id, u.discord_id, gm.role
    FROM territory_event_lineups l
    JOIN users u ON u.id = l.user_id
    JOIN territory_group_members gm ON gm.group_id = l.group_id AND gm.user_id = l.user_id
    WHERE l.event_id = ? AND l.group_id = ?
    ORDER BY CASE gm.role WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END,
             u.username COLLATE NOCASE
  `).all(Number(eventId), Number(groupId));
}

function registrationsForEvent(eventId) {
  if (!eventId) return [];
  return db.prepare(`
    SELECT r.event_id, r.group_id, r.status, r.registered_at,
           g.name AS group_name, g.tag AS group_tag,
           COUNT(l.user_id) AS lineup_count
    FROM territory_event_registrations r
    JOIN territory_groups g ON g.id = r.group_id
    LEFT JOIN territory_event_lineups l ON l.event_id = r.event_id AND l.group_id = r.group_id
    WHERE r.event_id = ?
    GROUP BY r.event_id, r.group_id, r.status, r.registered_at, g.name, g.tag
    ORDER BY r.registered_at ASC
  `).all(Number(eventId));
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

function publicState({ includePlayers = false, includeRegistrations = false } = {}) {
  const event = latestEvent();
  return {
    event,
    presence: territoryPresence(event, includePlayers),
    log: event ? eventLog(event.id, 12) : [],
    leaderboard: leaderboard(),
    registrationCount: event ? registrationsForEvent(event.id).length : 0,
    ...(includeRegistrations ? { registrations: event ? registrationsForEvent(event.id) : [] } : {}),
  };
}

function requireGroupRole(req, allowedRoles) {
  const group = groupForUser(req.user.id);
  if (!group) return { error: "Create or join a permanent Group first" };
  if (!allowedRoles.includes(group.role)) return { error: "Your Group role cannot perform that action" };
  return { group };
}

router.get("/state", (_req, res) => {
  res.json({ ok: true, ...publicState() });
});

router.get("/me", requireAuth, (req, res) => {
  const registration = db.prepare("SELECT registered_at, updated_at FROM territory_registrations WHERE user_id = ?").get(req.user.id) || null;
  const group = groupForUser(req.user.id);
  const event = latestEvent();
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
    invites: pendingInvitesForSteam(req.user.steam_id),
    event,
    eventRegistration: group && event ? eventRegistration(event.id, group.id) : null,
    lineup: group && event ? eventLineup(event.id, group.id) : [],
    lineupCap: LINEUP_CAP,
    liveSubstitutionDelayMinutes: LIVE_SUB_DELAY_MS / 60000,
  });
});

router.post("/register", requireAuth, (req, res) => {
  if (!/^\d{17}$/.test(String(req.user.steam_id || ""))) {
    return res.status(403).json({ error: "Link or sign in with Steam before registering for Territory Wars" });
  }

  db.prepare(`
    INSERT INTO territory_registrations (user_id, registered_at, updated_at)
    VALUES (?, datetime('now'), datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET updated_at = datetime('now')
  `).run(req.user.id);

  const registration = db.prepare("SELECT registered_at, updated_at FROM territory_registrations WHERE user_id = ?").get(req.user.id);
  res.json({ ok: true, registered: true, registration });
});

router.post("/group", requireAuth, (req, res) => {
  if (!/^\d{17}$/.test(String(req.user.steam_id || ""))) {
    return res.status(403).json({ error: "A linked Steam account is required to create a Group" });
  }
  if (groupForUser(req.user.id)) return res.status(409).json({ error: "You are already in a permanent Group" });

  const name = cleanText(req.body?.name, "", 40);
  const tag = cleanText(req.body?.tag, "", 6).toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (name.length < 3) return res.status(400).json({ error: "Group name must be at least 3 characters" });
  if (tag.length < 2) return res.status(400).json({ error: "Group tag must be 2 to 6 letters or numbers" });

  try {
    const result = db.prepare(`
      INSERT INTO territory_groups (name, tag, leader_user_id)
      VALUES (?, ?, ?)
    `).run(name, tag, req.user.id);
    const groupId = Number(result.lastInsertRowid);
    db.prepare(`
      INSERT INTO territory_group_members (group_id, user_id, role)
      VALUES (?, ?, 'leader')
    `).run(groupId, req.user.id);
    db.prepare("INSERT OR IGNORE INTO territory_group_stats (group_id) VALUES (?)").run(groupId);
    res.json({ ok: true, group: groupForUser(req.user.id), roster: groupRoster(groupId) });
  } catch (error) {
    if (String(error?.message || "").includes("UNIQUE")) {
      return res.status(409).json({ error: "That Group tag is already in use" });
    }
    throw error;
  }
});

router.post("/group/invite", requireAuth, (req, res) => {
  const access = requireGroupRole(req, ["leader", "officer"]);
  if (access.error) return res.status(403).json({ error: access.error });
  const steamId = String(req.body?.steamId || "").trim();
  if (!/^\d{17}$/.test(steamId)) return res.status(400).json({ error: "Enter a valid 17-digit Steam ID" });
  if (steamId === String(req.user.steam_id || "")) return res.status(400).json({ error: "You are already in this Group" });

  const target = db.prepare("SELECT id FROM users WHERE steam_id = ?").get(steamId);
  if (target && groupForUser(target.id)) return res.status(409).json({ error: "That player is already in a permanent Group" });
  const existing = db.prepare(`
    SELECT id FROM territory_group_invites
    WHERE group_id = ? AND invited_steam_id = ? AND status = 'pending'
    ORDER BY id DESC LIMIT 1
  `).get(access.group.id, steamId);
  if (existing) return res.json({ ok: true, inviteId: existing.id, duplicate: true });

  const result = db.prepare(`
    INSERT INTO territory_group_invites (group_id, invited_steam_id, invited_by_user_id)
    VALUES (?, ?, ?)
  `).run(access.group.id, steamId, req.user.id);
  res.json({ ok: true, inviteId: Number(result.lastInsertRowid) });
});

router.post("/group/invite/accept", requireAuth, (req, res) => {
  if (groupForUser(req.user.id)) return res.status(409).json({ error: "You are already in a permanent Group" });
  const inviteId = Number(req.body?.inviteId);
  const invite = db.prepare(`
    SELECT * FROM territory_group_invites
    WHERE id = ? AND status = 'pending'
  `).get(inviteId);
  if (!invite) return res.status(404).json({ error: "Group invite not found" });
  if (String(invite.invited_steam_id) !== String(req.user.steam_id || "")) {
    return res.status(403).json({ error: "That Group invite belongs to another Steam account" });
  }

  db.prepare(`
    INSERT INTO territory_group_members (group_id, user_id, role)
    VALUES (?, ?, 'member')
  `).run(invite.group_id, req.user.id);
  db.prepare("UPDATE territory_group_invites SET status = 'accepted', responded_at = datetime('now') WHERE id = ?").run(invite.id);
  res.json({ ok: true, group: groupForUser(req.user.id), roster: groupRoster(invite.group_id) });
});

router.post("/event-register", requireAuth, (req, res) => {
  const access = requireGroupRole(req, ["leader"]);
  if (access.error) return res.status(403).json({ error: access.error });
  const event = eventById(req.body?.eventId) || latestEvent();
  if (!event) return res.status(404).json({ error: "No Territory War event is available" });
  if (event.status === "ended") return res.status(409).json({ error: "That Territory War has already ended" });

  db.prepare(`
    INSERT INTO territory_event_registrations (event_id, group_id, registered_by_user_id, status)
    VALUES (?, ?, ?, 'registered')
    ON CONFLICT(event_id, group_id) DO UPDATE SET status = 'registered'
  `).run(event.id, access.group.id, req.user.id);
  addLog(event.id, "registration", `${access.group.name} registered for the event`, req.user.id);
  res.json({
    ok: true,
    eventRegistration: eventRegistration(event.id, access.group.id),
    lineup: eventLineup(event.id, access.group.id),
  });
});

router.post("/lineup", requireAuth, (req, res) => {
  const access = requireGroupRole(req, ["leader", "officer"]);
  if (access.error) return res.status(403).json({ error: access.error });
  const event = eventById(req.body?.eventId) || latestEvent();
  if (!event) return res.status(404).json({ error: "No Territory War event is available" });
  if (!eventRegistration(event.id, access.group.id)) {
    return res.status(409).json({ error: "Your Group must register for this event before selecting a lineup" });
  }
  if (event.status === "ended") return res.status(409).json({ error: "That Territory War has already ended" });

  const requested = Array.isArray(req.body?.memberUserIds)
    ? [...new Set(req.body.memberUserIds.map(Number).filter(Number.isInteger))]
    : [];
  if (requested.length > LINEUP_CAP) return res.status(400).json({ error: `Lineups are capped at ${LINEUP_CAP} fighters` });

  const roster = groupRoster(access.group.id);
  const allowed = new Set(roster.map((member) => Number(member.id)));
  if (requested.some((userId) => !allowed.has(userId))) {
    return res.status(400).json({ error: "Every lineup fighter must be a current Group member" });
  }
  const missingSteam = roster.filter((member) => requested.includes(Number(member.id)) && !/^\d{17}$/.test(String(member.steam_id || "")));
  if (missingSteam.length) return res.status(400).json({ error: "Every lineup fighter needs a linked Steam account" });

  const existing = eventLineup(event.id, access.group.id);
  const existingByUser = new Map(existing.map((member) => [Number(member.user_id), member]));
  const activeFromForNew = event.status === "live"
    ? new Date(Date.now() + LIVE_SUB_DELAY_MS).toISOString()
    : new Date().toISOString();

  const transaction = db.transaction(() => {
    if (requested.length) {
      const placeholders = requested.map(() => "?").join(",");
      db.prepare(`
        DELETE FROM territory_event_lineups
        WHERE event_id = ? AND group_id = ? AND user_id NOT IN (${placeholders})
      `).run(event.id, access.group.id, ...requested);
    } else {
      db.prepare("DELETE FROM territory_event_lineups WHERE event_id = ? AND group_id = ?").run(event.id, access.group.id);
    }

    const insert = db.prepare(`
      INSERT INTO territory_event_lineups
        (event_id, group_id, user_id, selected_by_user_id, active_from, selected_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(event_id, group_id, user_id) DO UPDATE SET
        selected_by_user_id = excluded.selected_by_user_id
    `);
    for (const userId of requested) {
      const previous = existingByUser.get(userId);
      insert.run(
        event.id,
        access.group.id,
        userId,
        req.user.id,
        previous?.active_from || activeFromForNew
      );
    }
  });
  transaction();
  addLog(event.id, "lineup", `${access.group.name} set a ${requested.length}-fighter lineup`, req.user.id);
  res.json({
    ok: true,
    lineup: eventLineup(event.id, access.group.id),
    lineupCap: LINEUP_CAP,
    liveSubstitutionDelayMinutes: LIVE_SUB_DELAY_MS / 60000,
  });
});

router.get("/admin/state", requireAdmin, (_req, res) => {
  res.json({ ok: true, ...publicState({ includePlayers: true, includeRegistrations: true }) });
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

  res.json({ ok: true, event, log: eventLog(event.id), registrations: registrationsForEvent(event.id) });
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
