const express = require("express");
const { timingSafeEqual } = require("node:crypto");
const { db } = require("../db");

const router = express.Router();

const ATTACK_WARNING_MS = 5 * 60 * 1000;
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

function nowIso() {
  return new Date().toISOString();
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

function secureTokenEquals(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function requireTerritoryInternalToken(req, res, next) {
  const expected = String(process.env.TERRITORY_WARS_INTERNAL_TOKEN || "").trim();
  if (!expected) {
    return res.status(503).json({
      error: "Territory Wars internal authentication is not configured",
    });
  }

  const authorization = String(req.headers.authorization || "").trim();
  const supplied = authorization.startsWith("Bearer ")
    ? authorization.slice(7).trim()
    : "";

  if (!secureTokenEquals(supplied, expected)) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
}

function userByDiscordId(discordId) {
  const id = String(discordId || "").trim();
  if (!/^\d{15,22}$/.test(id)) return null;
  return db.prepare(`
    SELECT id, discord_id, steam_id, username, is_admin
    FROM users
    WHERE discord_id = ?
    LIMIT 1
  `).get(id) || null;
}

function groupForUser(userId) {
  return db.prepare(`
    SELECT g.id, g.name, g.tag, g.leader_user_id, gm.role
    FROM territory_group_members gm
    JOIN territory_groups g ON g.id = gm.group_id
    WHERE gm.user_id = ?
    ORDER BY gm.joined_at DESC
    LIMIT 1
  `).get(Number(userId)) || null;
}

function latestEventRaw() {
  return db.prepare(`
    SELECT * FROM territory_events
    ORDER BY CASE status
      WHEN 'live' THEN 0
      WHEN 'paused' THEN 1
      WHEN 'scheduled' THEN 2
      ELSE 3
    END, id DESC
    LIMIT 1
  `).get() || null;
}

function eventById(id) {
  return db.prepare("SELECT * FROM territory_events WHERE id = ?")
    .get(Number(id)) || null;
}

function eventRegistration(eventId, groupId) {
  if (!eventId || !groupId) return null;
  return db.prepare(`
    SELECT event_id, group_id, status, registered_at
    FROM territory_event_registrations
    WHERE event_id = ? AND group_id = ?
  `).get(Number(eventId), Number(groupId)) || null;
}

function activeLineup(eventId, groupId, at = Date.now()) {
  if (!eventId || !groupId) return [];
  return db.prepare(`
    SELECT l.user_id, l.active_from, u.username, u.steam_id
    FROM territory_event_lineups l
    JOIN users u ON u.id = l.user_id
    WHERE l.event_id = ? AND l.group_id = ?
  `).all(Number(eventId), Number(groupId)).filter((member) => {
    const activeAt = parseDate(member.active_from);
    return Boolean(
      activeAt &&
      activeAt.getTime() <= at &&
      /^\d{17}$/.test(String(member.steam_id || ""))
    );
  });
}

function activeAttack(eventId) {
  if (!eventId) return null;
  return db.prepare(`
    SELECT * FROM territory_attacks
    WHERE event_id = ? AND status IN ('warning', 'active')
    ORDER BY id DESC
    LIMIT 1
  `).get(Number(eventId)) || null;
}

function groupMatchingOwner(ownerName) {
  const name = String(ownerName || "").trim();
  if (!name) return null;
  return db.prepare(`
    SELECT id, name, tag, leader_user_id
    FROM territory_groups
    WHERE lower(name) = lower(?) OR lower(tag) = lower(?)
    ORDER BY id DESC
    LIMIT 1
  `).get(name, name.replace(/^\[|\]$/g, "")) || null;
}

function addLog(eventId, kind, message, actorUserId = null) {
  if (!eventId) return;
  db.prepare(`
    INSERT INTO territory_event_log (event_id, kind, message, actor_user_id)
    VALUES (?, ?, ?, ?)
  `).run(
    Number(eventId),
    String(kind || "update").trim().slice(0, 32),
    String(message || "Territory updated").trim().slice(0, 240),
    actorUserId || null
  );
}

function decorateEvent(event) {
  if (!event) return null;
  return {
    ...event,
    owner_control: Number(event.owner_control ?? 100),
    challenger_control: Number(event.challenger_control ?? 0),
  };
}

function decorateAttack(attack) {
  if (!attack) return null;
  const attacker = db.prepare(
    "SELECT id, name, tag FROM territory_groups WHERE id = ?"
  ).get(Number(attack.attacker_group_id));
  const defender = attack.defender_group_id
    ? db.prepare("SELECT id, name, tag FROM territory_groups WHERE id = ?")
        .get(Number(attack.defender_group_id))
    : null;

  return {
    ...attack,
    attacker_name: attacker?.name || "Unknown attacker",
    attacker_tag: attacker?.tag || null,
    defender_name: defender?.name || (attack.defender_group_id ? null : "Admin"),
    defender_tag: defender?.tag || (attack.defender_group_id ? null : "ADMIN"),
  };
}

router.post("/attack", requireTerritoryInternalToken, (req, res) => {
  try {
    const discordId = String(req.body?.discordId || "").trim();
    if (!/^\d{15,22}$/.test(discordId)) {
      return res.status(400).json({ error: "A valid Discord user ID is required" });
    }

    const user = userByDiscordId(discordId);
    if (!user) {
      return res.status(404).json({
        error: "Your Discord account is not linked to a Hollow Valley account. Link Discord on the website first.",
      });
    }

    if (!/^\d{17}$/.test(String(user.steam_id || ""))) {
      return res.status(409).json({
        error: "Your Hollow Valley account does not have a linked Steam account.",
      });
    }

    const group = groupForUser(user.id);
    if (!group) {
      return res.status(409).json({
        error: "You must create or join a permanent Hollow Valley Group first.",
      });
    }

    if (!["leader", "officer"].includes(String(group.role || "").toLowerCase())) {
      return res.status(403).json({
        error: "Only the Group Leader or an Officer can declare a Territory War.",
      });
    }

    const requestedEventId = Number(req.body?.eventId);
    const event = Number.isInteger(requestedEventId) && requestedEventId > 0
      ? eventById(requestedEventId)
      : latestEventRaw();

    if (!event) {
      return res.status(404).json({ error: "No Territory War event is available." });
    }

    if (event.status !== "live") {
      return res.status(409).json({
        error: "Attacks can only be declared while the Territory War is live.",
      });
    }

    if (!eventRegistration(event.id, group.id)) {
      return res.status(409).json({
        error: "Your Group must be registered for this event.",
      });
    }

    if (activeLineup(event.id, group.id).length < MIN_ATTACKERS_TO_CONTEST) {
      return res.status(409).json({
        error: `Your Group needs at least ${MIN_ATTACKERS_TO_CONTEST} active lineup fighters before declaring an attack.`,
      });
    }

    if (
      String(event.owner_name || "").toLowerCase() ===
      String(group.name || "").toLowerCase()
    ) {
      return res.status(409).json({ error: "Your Group already owns this territory." });
    }

    const protectionUntil = parseDate(event.protection_until);
    if (protectionUntil && Date.now() < protectionUntil.getTime()) {
      return res.status(409).json({
        error: `Territory is protected until ${protectionUntil.toISOString()}`,
      });
    }

    if (activeAttack(event.id)) {
      return res.status(409).json({
        error: "Another attack is already active for this territory.",
      });
    }

    const defender = groupMatchingOwner(event.owner_name);
    const declaredAt = nowIso();
    const startsAt = new Date(Date.now() + ATTACK_WARNING_MS).toISOString();

    const attackId = runTransaction(() => {
      const inserted = db.prepare(`
        INSERT INTO territory_attacks
          (event_id, attacker_group_id, defender_group_id, status, declared_by_user_id, declared_at, starts_at)
        VALUES (?, ?, ?, 'warning', ?, ?, ?)
      `).run(
        event.id,
        group.id,
        defender?.id || null,
        user.id,
        declaredAt,
        startsAt
      );

      db.prepare(`
        UPDATE territory_events
        SET challenger_name = ?, control_score = -100, owner_control = 100,
            challenger_control = 0, updated_at = datetime('now')
        WHERE id = ?
      `).run(group.name, event.id);

      return Number(inserted.lastInsertRowid);
    });

    addLog(
      event.id,
      "attack",
      `${group.name} declared an attack. Five-minute warning started.`,
      user.id
    );

    const updatedEvent = eventById(event.id);
    const attack = db.prepare("SELECT * FROM territory_attacks WHERE id = ?")
      .get(attackId);

    return res.json({
      ok: true,
      player: {
        id: Number(user.id),
        username: user.username,
        steamId: user.steam_id,
        discordId: user.discord_id,
      },
      group: {
        id: Number(group.id),
        name: group.name,
        tag: group.tag || null,
        role: group.role,
      },
      event: decorateEvent(updatedEvent),
      attack: decorateAttack(attack),
      warningMinutes: ATTACK_WARNING_MS / 60000,
    });
  } catch (error) {
    console.error("[TerritoryWars] HerbyBot attack failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to declare Territory War.",
    });
  }
});

module.exports = router;
