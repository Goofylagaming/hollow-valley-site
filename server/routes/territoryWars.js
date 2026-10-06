const express = require("express");
const { db } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");
const serverStatus = require("../services/serverStatus");
const { fromRconLocation } = require("../evrimaMap");
const {
  DEFAULT_BATTLEFIELD_RADIUS,
  DEFAULT_CLAIM_RADIUS,
  territoryGeometry,
  classifyWorldPosition,
} = require("../services/territoryGeometry");
const {
  CONTROL_CONTRIBUTOR_CAP,
  normalizeControlScore,
  advanceControlScore,
} = require("../services/territoryControl");

const router = express.Router();
const LINEUP_CAP = 6;
const LIVE_SUB_DELAY_MS = 10 * 60 * 1000;
const ATTACK_WARNING_MS = 5 * 60 * 1000;
const CONTEST_ARM_MS = 2 * 60 * 1000;
const BOUNDARY_GRACE_MS = 30 * 1000;
const CAPTURE_PROTECTION_MS = 10 * 60 * 1000;
const MIN_ATTACKERS_TO_CONTEST = 2;

function runTransaction(work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = work();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

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
    control_score REAL NOT NULL DEFAULT -100,
    protection_until TEXT,
    frozen_owner_name TEXT,
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

  CREATE TABLE IF NOT EXISTS territory_attacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL REFERENCES territory_events(id) ON DELETE CASCADE,
    attacker_group_id INTEGER NOT NULL REFERENCES territory_groups(id),
    defender_group_id INTEGER REFERENCES territory_groups(id),
    status TEXT NOT NULL DEFAULT 'warning',
    declared_by_user_id INTEGER NOT NULL REFERENCES users(id),
    declared_at TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    contest_started_at TEXT,
    last_tick_at TEXT,
    resolved_at TEXT,
    outcome TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_territory_attacks_event_status
    ON territory_attacks(event_id, status, id DESC);

  CREATE TABLE IF NOT EXISTS territory_presence_grace (
    event_id INTEGER NOT NULL REFERENCES territory_events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_inside_at TEXT NOT NULL,
    PRIMARY KEY (event_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS territory_preview_presence (
    event_id INTEGER NOT NULL REFERENCES territory_events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    side TEXT NOT NULL CHECK(side IN ('attacker', 'defender')),
    in_battlefield INTEGER NOT NULL DEFAULT 1,
    in_claim INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (event_id, user_id)
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

function ensureEventColumn(name, sql, initialize) {
  const columns = db.prepare("PRAGMA table_info(territory_events)").all();
  if (columns.some((column) => column.name === name)) return;
  db.exec(`ALTER TABLE territory_events ADD COLUMN ${sql}`);
  if (initialize) db.exec(initialize);
}

ensureEventColumn(
  "control_score",
  "control_score REAL NOT NULL DEFAULT -100",
  "UPDATE territory_events SET control_score = MAX(-100, MIN(100, (COALESCE(challenger_control, 0) * 2) - 100))"
);
ensureEventColumn("protection_until", "protection_until TEXT");
ensureEventColumn("frozen_owner_name", "frozen_owner_name TEXT");

const EVENT_STATUSES = new Set(["scheduled", "live", "paused", "ended"]);

function nowIso() {
  return new Date().toISOString();
}

function previewSimulationEnabled() {
  return ["1", "true", "yes", "on"].includes(
    String(process.env.TERRITORY_WARS_PREVIEW_SEED || "")
      .trim()
      .toLowerCase()
  );
}

function previewPresenceRows(eventId) {
  if (!previewSimulationEnabled() || !eventId) return [];

  return db.prepare(`
    SELECT p.event_id, p.user_id, p.side, p.in_battlefield, p.in_claim, p.updated_at,
           u.username, u.steam_id
    FROM territory_preview_presence p
    JOIN users u ON u.id = p.user_id
    WHERE p.event_id = ?
    ORDER BY p.side, p.user_id
  `).all(Number(eventId));
}

function parseDate(value) {
  if (!value) return null;
  const raw = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cleanText(value, fallback = "", max = 80) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return (text || fallback).slice(0, max);
}

function cleanDate(value) {
  const date = parseDate(value);
  return date ? date.toISOString() : null;
}

function clamp(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : min;
}

function scoreToPercents(scoreValue) {
  const score = clamp(scoreValue, -100, 100);
  return {
    owner: Math.round((100 - score) / 2),
    challenger: Math.round((score + 100) / 2),
  };
}

function percentToScore(ownerPercent) {
  return clamp(100 - (clamp(ownerPercent, 0, 100) * 2), -100, 100);
}

function eventGeometry(event) {
  if (!event) return null;
  return territoryGeometry({
    territoryName: event.territory_name,
    territoryKey: event.territory_key,
  });
}

function decorateEvent(event) {
  if (!event) return null;
  const score = clamp(event.control_score, -100, 100);
  const percentages = scoreToPercents(score);
  return {
    ...event,
    control_score: Math.round(score * 10) / 10,
    owner_control: percentages.owner,
    challenger_control: percentages.challenger,
    geometry: eventGeometry(event),
  };
}

function latestEventRaw() {
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

function groupById(groupId) {
  if (!groupId) return null;
  return db.prepare("SELECT id, name, tag, leader_user_id FROM territory_groups WHERE id = ?").get(Number(groupId)) || null;
}

function groupMatchingOwner(ownerName) {
  const name = String(ownerName || "").trim();
  if (!name) return null;
  return db.prepare(`
    SELECT id, name, tag, leader_user_id
    FROM territory_groups
    WHERE lower(name) = lower(?) OR lower(tag) = lower(?)
    ORDER BY id DESC LIMIT 1
  `).get(name, name.replace(/^\[|\]$/g, "")) || null;
}

function isAdminSystemOwner(event) {
  if (!event) return false;
  const owner = String(event.owner_name || "").trim().toLowerCase();
  return owner === "admin" && !groupMatchingOwner(event.owner_name);
}

function adminSystemDefenders(event) {
  if (!isAdminSystemOwner(event)) return [];
  return db.prepare(`
    SELECT id AS user_id, username, steam_id, 'defender' AS role
    FROM users
    WHERE is_admin = 1 AND steam_id IS NOT NULL
    ORDER BY username COLLATE NOCASE
  `).all().filter((user) => /^\d{17}$/.test(String(user.steam_id || "")));
}

function adminSystemDefenderBySteam(event, steamId) {
  if (!isAdminSystemOwner(event) || !/^\d{17}$/.test(String(steamId || ""))) return null;
  return adminSystemDefenders(event).find((member) => String(member.steam_id) === String(steamId)) || null;
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

function activeLineup(eventId, groupId, at = Date.now()) {
  return eventLineup(eventId, groupId).filter((member) => {
    const activeAt = parseDate(member.active_from);
    return activeAt && activeAt.getTime() <= at && /^\d{17}$/.test(String(member.steam_id || ""));
  });
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

function lineupMembershipBySteam(eventId, steamId) {
  if (!eventId || !/^\d{17}$/.test(String(steamId || ""))) return null;
  return db.prepare(`
    SELECT l.user_id, l.group_id, l.active_from,
           g.name AS group_name, g.tag AS group_tag, gm.role
    FROM territory_event_lineups l
    JOIN users u ON u.id = l.user_id
    JOIN territory_groups g ON g.id = l.group_id
    JOIN territory_group_members gm ON gm.group_id = l.group_id AND gm.user_id = l.user_id
    WHERE l.event_id = ? AND u.steam_id = ?
    LIMIT 1
  `).get(Number(eventId), String(steamId)) || null;
}

function territoryPresence(event, includePlayers = false) {
  const state = serverStatus.getState();
  const geometry = eventGeometry(event);
  const previewRows = previewPresenceRows(event?.id);

  if ((!state?.configured || !state?.online) && geometry && previewRows.length) {
    const players = previewRows
      .filter((row) => Boolean(row.in_battlefield))
      .map((row) => ({
        steamId: String(row.steam_id || ""),
        name: row.username || "Preview fighter",
        species: "Preview",
        isPrime: false,
        lineupActive: true,
        systemDefender: row.side === "defender",
        inClaim: Boolean(row.in_claim),
        distanceMetres: 0,
        groupName: row.side === "attacker"
          ? (event?.challenger_name || "Challenger")
          : (event?.owner_name || "Defender"),
        groupTag: row.side === "attacker" ? "PREVIEW" : "ADMIN",
        groupRole: row.side,
      }));

    return {
      serverOnline: true,
      simulated: true,
      tracking: true,
      region: geometry.territoryName,
      geometry,
      playerCount: players.length,
      claimCount: players.filter((player) => player.inClaim).length,
      eligibleCount: players.length,
      eligibleClaimCount: players.filter((player) => player.inClaim).length,
      systemDefenderCount: players.filter((player) => player.systemDefender).length,
      ...(includePlayers ? { players } : {}),
      lastChecked: previewRows[0]?.updated_at || nowIso(),
    };
  }

  if (!state?.configured || !state?.online || !geometry) {
    return {
      serverOnline: Boolean(state?.online),
      simulated: false,
      tracking: Boolean(geometry),
      region: geometry?.territoryName || null,
      geometry,
      playerCount: 0,
      claimCount: 0,
      eligibleCount: 0,
      eligibleClaimCount: 0,
      ...(includePlayers ? { players: [] } : {}),
      lastChecked: state?.lastChecked || null,
    };
  }

  const players = [];
  const nowMs = Date.now();
  for (const character of Array.isArray(state.characters) ? state.characters : []) {
    const { x, y } = fromRconLocation(character?.location);
    const zone = classifyWorldPosition(x, y, geometry);
    if (!zone.inBattlefield) continue;
    const steamId = String(character?.steamId || "");
    const lineup = lineupMembershipBySteam(event?.id, steamId);
    const activeAt = parseDate(lineup?.active_from);
    const lineupActive = Boolean(activeAt && activeAt.getTime() <= nowMs);
    const systemDefender = !lineupActive ? adminSystemDefenderBySteam(event, steamId) : null;
    const eligible = lineupActive || Boolean(systemDefender);
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
    const displayMembership = systemDefender
      ? { group_id: null, group_name: "Admin", group_tag: "ADMIN", role: "defender" }
      : membership;
    players.push({
      steamId,
      name: character?.name || "Unknown player",
      species: character?.species || "Unknown species",
      isPrime: Boolean(character?.isPrime),
      lineupActive: eligible,
      systemDefender: Boolean(systemDefender),
      inClaim: zone.inClaim,
      distanceMetres: zone.distanceMetres,
      ...(displayMembership ? {
        groupId: displayMembership.group_id,
        groupName: displayMembership.group_name,
        groupTag: displayMembership.group_tag,
        groupRole: displayMembership.role,
      } : {}),
    });
  }

  return {
    serverOnline: true,
    tracking: true,
    region: geometry.territoryName,
    geometry,
    playerCount: players.length,
    claimCount: players.filter((player) => player.inClaim).length,
    eligibleCount: players.filter((player) => player.lineupActive).length,
    eligibleClaimCount: players.filter((player) => player.lineupActive && player.inClaim).length,
    systemDefenderCount: players.filter((player) => player.systemDefender).length,
    ...(includePlayers ? { players } : {}),
    lastChecked: state.lastChecked || null,
  };
}

function activeAttack(eventId) {
  if (!eventId) return null;
  return db.prepare(`
    SELECT * FROM territory_attacks
    WHERE event_id = ? AND status IN ('warning', 'active')
    ORDER BY id DESC LIMIT 1
  `).get(Number(eventId)) || null;
}

function decorateAttack(attack) {
  if (!attack) return null;
  const attacker = groupById(attack.attacker_group_id);
  const defender = groupById(attack.defender_group_id);
  return {
    ...attack,
    attacker_name: attacker?.name || "Unknown attacker",
    attacker_tag: attacker?.tag || null,
    defender_name: defender?.name || (attack.defender_group_id ? null : "Admin"),
    defender_tag: defender?.tag || (attack.defender_group_id ? null : "ADMIN"),
  };
}

function updateGrace(eventId, member, insideSteamIds, nowMs) {
  const inside = insideSteamIds.has(String(member.steam_id));
  if (inside) {
    db.prepare(`
      INSERT INTO territory_presence_grace (event_id, user_id, last_inside_at)
      VALUES (?, ?, ?)
      ON CONFLICT(event_id, user_id) DO UPDATE SET last_inside_at = excluded.last_inside_at
    `).run(Number(eventId), Number(member.user_id), new Date(nowMs).toISOString());
    return true;
  }
  const row = db.prepare(`
    SELECT last_inside_at FROM territory_presence_grace
    WHERE event_id = ? AND user_id = ?
  `).get(Number(eventId), Number(member.user_id));
  const lastInside = parseDate(row?.last_inside_at);
  return Boolean(lastInside && nowMs - lastInside.getTime() <= BOUNDARY_GRACE_MS);
}

function contestPresence(event, attack, nowMs) {
  const state = serverStatus.getState();
  const geometry = eventGeometry(event);
  const previewRows = previewPresenceRows(event?.id);

  if ((!state?.configured || !state?.online) && geometry && previewRows.length) {
    return {
      usable: true,
      simulated: true,
      attackers: previewRows.filter(
        (row) => row.side === "attacker" && Boolean(row.in_claim)
      ).length,
      defenders: previewRows.filter(
        (row) => row.side === "defender" && Boolean(row.in_claim)
      ).length,
    };
  }

  if (!state?.configured || !state?.online || !geometry) {
    return { usable: false, simulated: false, attackers: 0, defenders: 0 };
  }

  const insideClaimSteamIds = new Set();
  for (const character of Array.isArray(state.characters) ? state.characters : []) {
    const { x, y } = fromRconLocation(character?.location);
    const zone = classifyWorldPosition(x, y, geometry);
    if (zone.inClaim) insideClaimSteamIds.add(String(character?.steamId || ""));
  }

  const attackerLineup = activeLineup(event.id, attack.attacker_group_id, nowMs);
  const attackers = attackerLineup
    .filter((member) => updateGrace(event.id, member, insideClaimSteamIds, nowMs)).length;
  const attackerSteamIds = new Set(attackerLineup.map((member) => String(member.steam_id)));

  let defenderLineup = [];
  if (attack.defender_group_id) {
    defenderLineup = activeLineup(event.id, attack.defender_group_id, nowMs);
  } else if (isAdminSystemOwner(event)) {
    defenderLineup = adminSystemDefenders(event)
      .filter((member) => !attackerSteamIds.has(String(member.steam_id)));
  }
  const defenders = defenderLineup
    .filter((member) => updateGrace(event.id, member, insideClaimSteamIds, nowMs)).length;

  return { usable: true, attackers, defenders };
}

function captureTerritory(event, attack, atMs, actorUserId = null) {
  const attacker = groupById(attack?.attacker_group_id);
  if (!attacker) return event;
  const protectionUntil = new Date(atMs + CAPTURE_PROTECTION_MS).toISOString();
  runTransaction(() => {
    db.prepare(`
      UPDATE territory_events
      SET owner_name = ?, challenger_name = NULL, control_score = -100,
          owner_control = 100, challenger_control = 0,
          protection_until = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(attacker.name, protectionUntil, event.id);
    if (attack?.id) {
      db.prepare(`
        UPDATE territory_attacks
        SET status = 'resolved', resolved_at = ?, outcome = 'capture'
        WHERE id = ?
      `).run(new Date(atMs).toISOString(), attack.id);
    }
    db.prepare(`
      INSERT INTO territory_group_stats (group_id, wins, captures)
      VALUES (?, 1, 1)
      ON CONFLICT(group_id) DO UPDATE SET wins = wins + 1, captures = captures + 1
    `).run(attacker.id);
    if (attack?.defender_group_id) {
      db.prepare(`
        INSERT INTO territory_group_stats (group_id, losses)
        VALUES (?, 1)
        ON CONFLICT(group_id) DO UPDATE SET losses = losses + 1
      `).run(attack.defender_group_id);
    }

    if (previewSimulationEnabled()) {
      db.prepare(
        "DELETE FROM territory_preview_presence WHERE event_id = ?"
      ).run(event.id);
    }
  });
  addLog(event.id, "capture", `${attacker.name} captured ${event.territory_name}. Territory protected for 10 minutes.`, actorUserId);
  return eventById(event.id);
}

function processEventRuntime(eventInput) {
  let event = eventInput ? eventById(eventInput.id) : latestEventRaw();
  if (!event) return null;
  const nowMs = Date.now();
  const starts = parseDate(event.starts_at);
  const ends = parseDate(event.ends_at);

  if (event.status !== "ended" && ends && nowMs >= ends.getTime()) {
    db.prepare(`
      UPDATE territory_events
      SET status = 'ended', frozen_owner_name = owner_name, challenger_name = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(event.id);
    db.prepare(`
      UPDATE territory_attacks
      SET status = 'cancelled', resolved_at = ?, outcome = 'event-ended'
      WHERE event_id = ? AND status IN ('warning', 'active')
    `).run(nowIso(), event.id);
    addLog(event.id, "status", `Event ended. ${event.owner_name} is frozen as territory owner.`);
    return eventById(event.id);
  }

  if (event.status === "scheduled" && starts && nowMs >= starts.getTime() && (!ends || nowMs < ends.getTime())) {
    db.prepare("UPDATE territory_events SET status = 'live', updated_at = datetime('now') WHERE id = ?").run(event.id);
    addLog(event.id, "status", "Event started automatically at the scheduled time.");
    event = eventById(event.id);
  }

  if (event.status !== "live") return event;

  let attack = activeAttack(event.id);
  if (!attack) return event;

  const attackStarts = parseDate(attack.starts_at);
  if (attack.status === "warning" && attackStarts && nowMs >= attackStarts.getTime()) {
    db.prepare(`
      UPDATE territory_attacks
      SET status = 'active', last_tick_at = ?
      WHERE id = ?
    `).run(nowIso(), attack.id);
    addLog(event.id, "attack", `${groupById(attack.attacker_group_id)?.name || "Challenger"} attack is now active.`);
    attack = activeAttack(event.id);
  }

  if (!attack || attack.status !== "active") return event;

  const protectionUntil = parseDate(event.protection_until);
  if (protectionUntil && nowMs < protectionUntil.getTime()) return event;

  const presence = contestPresence(event, attack, nowMs);
  if (!presence.usable) return event;

  const contestStarted = parseDate(attack.contest_started_at);
  if (presence.attackers < MIN_ATTACKERS_TO_CONTEST) {
    if (contestStarted) {
      db.prepare("UPDATE territory_attacks SET contest_started_at = NULL, last_tick_at = ? WHERE id = ?").run(nowIso(), attack.id);
    }
    return event;
  }

  if (!contestStarted) {
    db.prepare("UPDATE territory_attacks SET contest_started_at = ?, last_tick_at = ? WHERE id = ?").run(nowIso(), nowIso(), attack.id);
    addLog(event.id, "contest", `${presence.attackers} eligible attackers entered the claim zone. Two-minute contest timer started.`);
    return event;
  }

  if (nowMs - contestStarted.getTime() < CONTEST_ARM_MS) return event;

  const lastTick = parseDate(attack.last_tick_at) || new Date(nowMs);
  const elapsedSeconds = Math.max(0, Math.min(60, (nowMs - lastTick.getTime()) / 1000));
  if (elapsedSeconds < 5) return event;

  const controlStep = advanceControlScore({
    score: normalizeControlScore(event.control_score, -100),
    attackers: presence.attackers,
    defenders: presence.defenders,
    elapsedSeconds,
    contributorCap: CONTROL_CONTRIBUTOR_CAP,
  });
  const nextScore = controlStep.score;

  runTransaction(() => {
    db.prepare(`
      UPDATE territory_events
      SET control_score = ?, owner_control = ?, challenger_control = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(nextScore, scoreToPercents(nextScore).owner, scoreToPercents(nextScore).challenger, event.id);
    db.prepare("UPDATE territory_attacks SET last_tick_at = ? WHERE id = ?").run(nowIso(), attack.id);
    if (presence.attackers > 0) {
      db.prepare(`
        INSERT INTO territory_group_stats (group_id, zone_seconds)
        VALUES (?, ?)
        ON CONFLICT(group_id) DO UPDATE SET zone_seconds = zone_seconds + excluded.zone_seconds
      `).run(attack.attacker_group_id, Math.round(presence.attackers * elapsedSeconds));
    }
    if (attack.defender_group_id && presence.defenders > 0) {
      db.prepare(`
        INSERT INTO territory_group_stats (group_id, zone_seconds)
        VALUES (?, ?)
        ON CONFLICT(group_id) DO UPDATE SET zone_seconds = zone_seconds + excluded.zone_seconds
      `).run(attack.defender_group_id, Math.round(presence.defenders * elapsedSeconds));
    }
  });

  event = eventById(event.id);
  if (nextScore >= 100) return captureTerritory(event, attack, nowMs);
  return event;
}

function publicState({ includePlayers = false, includeRegistrations = false } = {}) {
  const eventRaw = processEventRuntime(latestEventRaw());
  const event = decorateEvent(eventRaw);
  const attack = decorateAttack(activeAttack(eventRaw?.id));
  const geometry = eventGeometry(eventRaw);
  return {
    event,
    attack,
    geometry,
    presence: territoryPresence(eventRaw, includePlayers),
    log: eventRaw ? eventLog(eventRaw.id, 12) : [],
    leaderboard: leaderboard(),
    registrationCount: eventRaw ? registrationsForEvent(eventRaw.id).length : 0,
    rules: {
      lineupCap: LINEUP_CAP,
      attackWarningMinutes: ATTACK_WARNING_MS / 60000,
      minimumAttackers: MIN_ATTACKERS_TO_CONTEST,
      contestArmMinutes: CONTEST_ARM_MS / 60000,
      boundaryGraceSeconds: BOUNDARY_GRACE_MS / 1000,
      captureProtectionMinutes: CAPTURE_PROTECTION_MS / 60000,
      controlContributorCap: CONTROL_CONTRIBUTOR_CAP,
      battlefieldRadiusMetres: DEFAULT_BATTLEFIELD_RADIUS * 10,
      claimRadiusMetres: DEFAULT_CLAIM_RADIUS * 10,
      adminSystemDefenders: true,
    },
    ...(includeRegistrations ? { registrations: eventRaw ? registrationsForEvent(eventRaw.id) : [] } : {}),
  };
}

function requireGroupRole(req, allowedRoles) {
  const group = groupForUser(req.user.id);
  if (!group) return { error: "Create or join a permanent Group first" };
  if (!allowedRoles.includes(group.role)) return { error: "Your Group role cannot perform that action" };
  return { group };
}

function ensurePreviewSouthPlainsEvent() {
  const enabled = ["1", "true", "yes", "on"].includes(
    String(process.env.TERRITORY_WARS_PREVIEW_SEED || "")
      .trim()
      .toLowerCase()
  );

  if (!enabled) return null;

  const existing = db.prepare(`
    SELECT *
    FROM territory_events
    WHERE territory_key = 'south-plains'
      AND status != 'ended'
    ORDER BY id DESC
    LIMIT 1
  `).get();

  if (existing) return existing;

  const result = db.prepare(`
    INSERT INTO territory_events
      (
        name,
        territory_key,
        territory_name,
        status,
        owner_name,
        challenger_name,
        control_score,
        owner_control,
        challenger_control,
        starts_at,
        ends_at
      )
    VALUES (?, 'south-plains', 'South Plains', 'scheduled', 'Admin', NULL, -100, 100, 0, ?, ?)
  `).run(
    "South Plains Preview Test",
    "2026-10-10T07:00:00.000Z",
    "2026-10-10T12:00:00.000Z"
  );

  const eventId = Number(result.lastInsertRowid);
  addLog(
    eventId,
    "created",
    "South Plains preview test event seeded automatically"
  );

  console.log(
    "[territory-wars] auto-seeded South Plains preview event id=" + eventId
  );

  return eventById(eventId);
}

router.get("/state", (_req, res) => {
  ensurePreviewSouthPlainsEvent();
  res.json({ ok: true, ...publicState() });
});

router.get("/me", requireAuth, (req, res) => {
  const group = groupForUser(req.user.id);
  const eventRaw = processEventRuntime(latestEventRaw());
  res.json({
    ok: true,
    player: {
      id: req.user.id,
      username: req.user.username,
      steamId: req.user.steam_id || null,
      discordId: req.user.discord_id || null,
    },
    group,
    roster: group ? groupRoster(group.id) : [],
    invites: pendingInvitesForSteam(req.user.steam_id),
    event: decorateEvent(eventRaw),
    attack: decorateAttack(activeAttack(eventRaw?.id)),
    eventRegistration: group && eventRaw ? eventRegistration(eventRaw.id, group.id) : null,
    lineup: group && eventRaw ? eventLineup(eventRaw.id, group.id) : [],
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
  res.json({ ok: true, registered: true });
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
    const groupId = runTransaction(() => {
      const result = db.prepare("INSERT INTO territory_groups (name, tag, leader_user_id) VALUES (?, ?, ?)").run(name, tag, req.user.id);
      const id = Number(result.lastInsertRowid);
      db.prepare("INSERT INTO territory_group_members (group_id, user_id, role) VALUES (?, ?, 'leader')").run(id, req.user.id);
      db.prepare("INSERT OR IGNORE INTO territory_group_stats (group_id) VALUES (?)").run(id);
      return id;
    });
    res.json({ ok: true, group: groupForUser(req.user.id), roster: groupRoster(groupId) });
  } catch (error) {
    if (String(error?.message || "").includes("UNIQUE")) return res.status(409).json({ error: "That Group tag is already in use" });
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
  const invite = db.prepare("SELECT * FROM territory_group_invites WHERE id = ? AND status = 'pending'").get(inviteId);
  if (!invite) return res.status(404).json({ error: "Group invite not found" });
  if (String(invite.invited_steam_id) !== String(req.user.steam_id || "")) {
    return res.status(403).json({ error: "That Group invite belongs to another Steam account" });
  }

  runTransaction(() => {
    db.prepare("INSERT INTO territory_group_members (group_id, user_id, role) VALUES (?, ?, 'member')").run(invite.group_id, req.user.id);
    db.prepare("UPDATE territory_group_invites SET status = 'accepted', responded_at = datetime('now') WHERE id = ?").run(invite.id);
  });
  res.json({ ok: true, group: groupForUser(req.user.id), roster: groupRoster(invite.group_id) });
});

router.post("/event-register", requireAuth, (req, res) => {
  const access = requireGroupRole(req, ["leader"]);
  if (access.error) return res.status(403).json({ error: access.error });
  const event = eventById(req.body?.eventId) || processEventRuntime(latestEventRaw());
  if (!event) return res.status(404).json({ error: "No Territory War event is available" });
  if (event.status === "ended") return res.status(409).json({ error: "That Territory War has already ended" });

  db.prepare(`
    INSERT INTO territory_event_registrations (event_id, group_id, registered_by_user_id, status)
    VALUES (?, ?, ?, 'registered')
    ON CONFLICT(event_id, group_id) DO UPDATE SET status = 'registered'
  `).run(event.id, access.group.id, req.user.id);
  addLog(event.id, "registration", `${access.group.name} registered for the event`, req.user.id);
  res.json({ ok: true, eventRegistration: eventRegistration(event.id, access.group.id), lineup: eventLineup(event.id, access.group.id) });
});

router.post("/lineup", requireAuth, (req, res) => {
  const access = requireGroupRole(req, ["leader", "officer"]);
  if (access.error) return res.status(403).json({ error: access.error });
  const event = eventById(req.body?.eventId) || processEventRuntime(latestEventRaw());
  if (!event) return res.status(404).json({ error: "No Territory War event is available" });
  if (!eventRegistration(event.id, access.group.id)) return res.status(409).json({ error: "Your Group must register for this event before selecting a lineup" });
  if (event.status === "ended") return res.status(409).json({ error: "That Territory War has already ended" });

  const requested = Array.isArray(req.body?.memberUserIds)
    ? [...new Set(req.body.memberUserIds.map(Number).filter(Number.isInteger))]
    : [];
  if (requested.length > LINEUP_CAP) return res.status(400).json({ error: `Lineups are capped at ${LINEUP_CAP} fighters` });

  const roster = groupRoster(access.group.id);
  const allowed = new Set(roster.map((member) => Number(member.id)));
  if (requested.some((userId) => !allowed.has(userId))) return res.status(400).json({ error: "Every lineup fighter must be a current Group member" });
  const missingSteam = roster.filter((member) => requested.includes(Number(member.id)) && !/^\d{17}$/.test(String(member.steam_id || "")));
  if (missingSteam.length) return res.status(400).json({ error: "Every lineup fighter needs a linked Steam account" });

  const existing = eventLineup(event.id, access.group.id);
  const existingByUser = new Map(existing.map((member) => [Number(member.user_id), member]));
  const activeFromForNew = event.status === "live"
    ? new Date(Date.now() + LIVE_SUB_DELAY_MS).toISOString()
    : nowIso();

  runTransaction(() => {
    if (requested.length) {
      const placeholders = requested.map(() => "?").join(",");
      db.prepare(`DELETE FROM territory_event_lineups WHERE event_id = ? AND group_id = ? AND user_id NOT IN (${placeholders})`)
        .run(event.id, access.group.id, ...requested);
    } else {
      db.prepare("DELETE FROM territory_event_lineups WHERE event_id = ? AND group_id = ?").run(event.id, access.group.id);
    }

    const insert = db.prepare(`
      INSERT INTO territory_event_lineups
        (event_id, group_id, user_id, selected_by_user_id, active_from, selected_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(event_id, group_id, user_id) DO UPDATE SET selected_by_user_id = excluded.selected_by_user_id
    `);
    for (const userId of requested) {
      insert.run(event.id, access.group.id, userId, req.user.id, existingByUser.get(userId)?.active_from || activeFromForNew);
    }
  });

  addLog(event.id, "lineup", `${access.group.name} set a ${requested.length}-fighter lineup`, req.user.id);
  res.json({ ok: true, lineup: eventLineup(event.id, access.group.id), lineupCap: LINEUP_CAP, liveSubstitutionDelayMinutes: LIVE_SUB_DELAY_MS / 60000 });
});

router.post("/attack-declare", requireAuth, (req, res) => {
  const access = requireGroupRole(req, ["leader", "officer"]);
  if (access.error) return res.status(403).json({ error: access.error });
  const event = processEventRuntime(eventById(req.body?.eventId) || latestEventRaw());
  if (!event) return res.status(404).json({ error: "No Territory War event is available" });
  if (event.status !== "live") return res.status(409).json({ error: "Attacks can only be declared while the Territory War is live" });
  if (!eventRegistration(event.id, access.group.id)) return res.status(409).json({ error: "Your Group must be registered for this event" });
  if (activeLineup(event.id, access.group.id).length < MIN_ATTACKERS_TO_CONTEST) {
    return res.status(409).json({ error: `Your Group needs at least ${MIN_ATTACKERS_TO_CONTEST} active lineup fighters before declaring an attack` });
  }
  if (String(event.owner_name || "").toLowerCase() === String(access.group.name || "").toLowerCase()) {
    return res.status(409).json({ error: "Your Group already owns this territory" });
  }
  const protectionUntil = parseDate(event.protection_until);
  if (protectionUntil && Date.now() < protectionUntil.getTime()) {
    return res.status(409).json({ error: `Territory is protected until ${protectionUntil.toISOString()}` });
  }
  if (activeAttack(event.id)) return res.status(409).json({ error: "Another attack is already active for this territory" });

  const defender = groupMatchingOwner(event.owner_name);
  const declaredAt = nowIso();
  const startsAt = new Date(Date.now() + ATTACK_WARNING_MS).toISOString();
  const result = runTransaction(() => {
    const insert = db.prepare(`
      INSERT INTO territory_attacks
        (event_id, attacker_group_id, defender_group_id, status, declared_by_user_id, declared_at, starts_at)
      VALUES (?, ?, ?, 'warning', ?, ?, ?)
    `).run(event.id, access.group.id, defender?.id || null, req.user.id, declaredAt, startsAt);
    db.prepare(`
      UPDATE territory_events
      SET challenger_name = ?, control_score = -100, owner_control = 100, challenger_control = 0, updated_at = datetime('now')
      WHERE id = ?
    `).run(access.group.name, event.id);
    return Number(insert.lastInsertRowid);
  });
  addLog(event.id, "attack", `${access.group.name} declared an attack. Five-minute warning started.`, req.user.id);
  res.json({ ok: true, event: decorateEvent(eventById(event.id)), attack: decorateAttack(db.prepare("SELECT * FROM territory_attacks WHERE id = ?").get(result)) });
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
        (name, territory_key, territory_name, status, starts_at, ends_at, owner_name, challenger_name, control_score, created_by)
      VALUES (?, ?, ?, 'scheduled', ?, ?, ?, ?, -100, ?)
    `).run(name, territoryKey, territoryName, startsAt, endsAt, ownerName, challengerName, req.user.id);
    event = eventById(result.lastInsertRowid);
    addLog(event.id, "created", `${event.name} created`, req.user.id);
  }

  res.json({ ok: true, event: decorateEvent(event), log: eventLog(event.id), registrations: registrationsForEvent(event.id) });
});

router.post("/admin/status", requireAdmin, (req, res) => {
  let event = eventById(req.body?.id) || latestEventRaw();
  if (!event) return res.status(404).json({ error: "No Territory War event exists yet" });
  const status = cleanText(req.body?.status, "", 16).toLowerCase();
  if (!EVENT_STATUSES.has(status)) return res.status(400).json({ error: "Invalid event status" });

  if (status === "ended") {
    db.prepare(`
      UPDATE territory_events
      SET status = 'ended', frozen_owner_name = owner_name, challenger_name = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(event.id);
    db.prepare(`
      UPDATE territory_attacks SET status = 'cancelled', resolved_at = ?, outcome = 'event-ended'
      WHERE event_id = ? AND status IN ('warning', 'active')
    `).run(nowIso(), event.id);
  } else {
    db.prepare("UPDATE territory_events SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, event.id);
  }
  addLog(event.id, "status", `Event ${status}`, req.user.id);
  event = eventById(event.id);
  res.json({ ok: true, event: decorateEvent(event), log: eventLog(event.id) });
});

router.post("/admin/control", requireAdmin, (req, res) => {
  const event = eventById(req.body?.id) || latestEventRaw();
  if (!event) return res.status(404).json({ error: "No Territory War event exists yet" });
  const ownerControl = clamp(req.body?.ownerControl, 0, 100);
  const score = percentToScore(ownerControl);
  const percentages = scoreToPercents(score);
  db.prepare(`
    UPDATE territory_events
    SET control_score = ?, owner_control = ?, challenger_control = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(score, percentages.owner, percentages.challenger, event.id);
  addLog(event.id, "control", `Control adjusted: ${percentages.owner}% owner / ${percentages.challenger}% challenger`, req.user.id);
  res.json({ ok: true, event: decorateEvent(eventById(event.id)) });
});

router.post("/admin/reset", requireAdmin, (req, res) => {
  const event = eventById(req.body?.id) || latestEventRaw();
  if (!event) return res.status(404).json({ error: "No Territory War event exists yet" });
  runTransaction(() => {
    db.prepare(`
      UPDATE territory_events
      SET status = 'scheduled', challenger_name = NULL, control_score = -100,
          owner_control = 100, challenger_control = 0, protection_until = NULL,
          frozen_owner_name = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(event.id);
    db.prepare(`
      UPDATE territory_attacks SET status = 'cancelled', resolved_at = ?, outcome = 'admin-reset'
      WHERE event_id = ? AND status IN ('warning', 'active')
    `).run(nowIso(), event.id);
  });
  addLog(event.id, "reset", "Territory and active attack reset by admin", req.user.id);
  res.json({ ok: true, event: decorateEvent(eventById(event.id)), log: eventLog(event.id) });
});

router.post("/admin/remove-challenger", requireAdmin, (req, res) => {
  const event = eventById(req.body?.id) || latestEventRaw();
  if (!event) return res.status(404).json({ error: "No Territory War event exists yet" });
  runTransaction(() => {
    db.prepare(`
      UPDATE territory_events
      SET challenger_name = NULL, control_score = -100, owner_control = 100, challenger_control = 0, updated_at = datetime('now')
      WHERE id = ?
    `).run(event.id);
    db.prepare(`
      UPDATE territory_attacks SET status = 'cancelled', resolved_at = ?, outcome = 'challenger-removed'
      WHERE event_id = ? AND status IN ('warning', 'active')
    `).run(nowIso(), event.id);
  });
  addLog(event.id, "team", "Challenger removed", req.user.id);
  res.json({ ok: true, event: decorateEvent(eventById(event.id)), log: eventLog(event.id) });
});

router.post("/admin/force-capture", requireAdmin, (req, res) => {
  const event = eventById(req.body?.id) || latestEventRaw();
  if (!event) return res.status(404).json({ error: "No Territory War event exists yet" });
  const winner = cleanText(req.body?.winner, "", 16).toLowerCase();
  if (!["owner", "challenger"].includes(winner)) return res.status(400).json({ error: "Winner must be owner or challenger" });

  const attack = activeAttack(event.id);
  if (winner === "challenger") {
    let attacker = attack ? groupById(attack.attacker_group_id) : groupMatchingOwner(event.challenger_name);
    if (!attacker && event.challenger_name) {
      attacker = db.prepare("SELECT id, name, tag FROM territory_groups WHERE lower(name) = lower(?) LIMIT 1").get(event.challenger_name);
    }
    if (!attacker) return res.status(400).json({ error: "There is no registered challenger Group to capture this territory" });
    const syntheticAttack = attack || { attacker_group_id: attacker.id, defender_group_id: groupMatchingOwner(event.owner_name)?.id || null };
    captureTerritory(event, syntheticAttack, Date.now(), req.user.id);
  } else {
    runTransaction(() => {
      db.prepare(`
        UPDATE territory_events
        SET challenger_name = NULL, control_score = -100, owner_control = 100, challenger_control = 0, updated_at = datetime('now')
        WHERE id = ?
      `).run(event.id);
      if (attack) {
        db.prepare(`
          UPDATE territory_attacks SET status = 'resolved', resolved_at = ?, outcome = 'defence'
          WHERE id = ?
        `).run(nowIso(), attack.id);
      }
    });
    addLog(event.id, "defence", `${event.owner_name} retained ${event.territory_name}`, req.user.id);
  }
  res.json({ ok: true, event: decorateEvent(eventById(event.id)), log: eventLog(event.id) });
});

module.exports = router;
