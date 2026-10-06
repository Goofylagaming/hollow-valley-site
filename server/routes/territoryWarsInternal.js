const express = require("express");
const { timingSafeEqual } = require("node:crypto");
const { db } = require("../db");
const territoryCombatSync = require("../services/territoryCombatSync");
const territoryMomentum = require("../services/territoryMomentum");

const router = express.Router();

const ATTACK_WARNING_MS = 5 * 60 * 1000;
const MIN_ATTACKERS_TO_CONTEST = 2;

db.exec(`
  CREATE TABLE IF NOT EXISTS territory_preview_presence (
    event_id INTEGER NOT NULL REFERENCES territory_events(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    side TEXT NOT NULL CHECK(side IN ('attacker', 'defender')),
    in_battlefield INTEGER NOT NULL DEFAULT 1,
    in_claim INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (event_id, user_id)
  );
`);

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

function previewSeedEnabled() {
  return ["1", "true", "yes", "on"].includes(
    String(process.env.TERRITORY_WARS_PREVIEW_SEED || "")
      .trim()
      .toLowerCase()
  );
}

function previewSteamId(discordId) {
  const digits = String(discordId || "").replace(/\D/g, "");
  return `76561199${digits.slice(-9).padStart(9, "0")}`;
}

function ensurePreviewUser(discordId) {
  if (!previewSeedEnabled()) return null;

  const id = String(discordId || "").trim();
  if (!/^\d{15,22}$/.test(id)) return null;

  let user = userByDiscordId(id);
  if (user) return user;

  const result = db.prepare(`
    INSERT INTO users (discord_id, steam_id, username, is_admin)
    VALUES (?, ?, ?, 0)
  `).run(
    id,
    previewSteamId(id),
    `Preview-${id.slice(-6)}`
  );

  db.prepare(
    "INSERT OR IGNORE INTO wallets (user_id, balance) VALUES (?, 0)"
  ).run(Number(result.lastInsertRowid));

  return db.prepare(`
    SELECT id, discord_id, steam_id, username, is_admin
    FROM users
    WHERE id = ?
  `).get(Number(result.lastInsertRowid)) || null;
}

function ensurePreviewLeader(discordId) {
  const user = ensurePreviewUser(discordId);
  if (!user) return null;

  let group = groupForUser(user.id);
  if (group) return { user, group };

  const tag = `P${String(user.id).padStart(5, "0").slice(-5)}`;
  const created = db.prepare(`
    INSERT INTO territory_groups (name, tag, leader_user_id)
    VALUES (?, ?, ?)
  `).run(
    `Preview Group ${user.id}`,
    tag,
    user.id
  );

  const groupId = Number(created.lastInsertRowid);

  db.prepare(`
    INSERT INTO territory_group_members (group_id, user_id, role)
    VALUES (?, ?, 'leader')
  `).run(groupId, user.id);

  db.prepare(
    "INSERT OR IGNORE INTO territory_group_stats (group_id) VALUES (?)"
  ).run(groupId);

  group = groupForUser(user.id);
  return { user, group };
}

function ensurePreviewGroupMember(discordId, groupId) {
  const user = ensurePreviewUser(discordId);
  if (!user) return null;

  const existingGroup = groupForUser(user.id);
  if (existingGroup) {
    return Number(existingGroup.id) === Number(groupId)
      ? user
      : null;
  }

  db.prepare(`
    INSERT INTO territory_group_members (group_id, user_id, role)
    VALUES (?, ?, 'member')
  `).run(Number(groupId), user.id);

  return user;
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

function eventLineup(eventId, groupId) {
  if (!eventId || !groupId) return [];
  return db.prepare(`
    SELECT l.user_id, l.active_from, l.selected_at,
           u.username, u.steam_id, u.discord_id, gm.role
    FROM territory_event_lineups l
    JOIN users u ON u.id = l.user_id
    JOIN territory_group_members gm
      ON gm.group_id = l.group_id AND gm.user_id = l.user_id
    WHERE l.event_id = ? AND l.group_id = ?
    ORDER BY CASE gm.role WHEN 'leader' THEN 0 WHEN 'officer' THEN 1 ELSE 2 END,
             u.username COLLATE NOCASE
  `).all(Number(eventId), Number(groupId));
}

function linkedUsersByDiscordIds(discordIds) {
  const ids = [...new Set(
    (Array.isArray(discordIds) ? discordIds : [])
      .map((value) => String(value || "").trim())
      .filter((value) => /^\d{15,22}$/.test(value))
  )];

  if (!ids.length) return [];

  const placeholders = ids.map(() => "?").join(",");
  return db.prepare(`
    SELECT id, username, steam_id, discord_id
    FROM users
    WHERE discord_id IN (${placeholders})
  `).all(...ids);
}

function latestUsableEvent(requestedEventId = null) {
  const id = Number(requestedEventId);
  if (Number.isInteger(id) && id > 0) return eventById(id);
  return latestEventRaw();
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

router.post("/register", requireTerritoryInternalToken, (req, res) => {
  try {
    const discordId = String(req.body?.discordId || "").trim();
    if (!/^\d{15,22}$/.test(discordId)) {
      return res.status(400).json({ error: "A valid Discord user ID is required" });
    }

    let user = userByDiscordId(discordId);
    let previewProvisioned = false;

    if (!user && previewSeedEnabled()) {
      const provisioned = ensurePreviewLeader(discordId);
      user = provisioned?.user || null;
      previewProvisioned = Boolean(provisioned);
    }

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

    let group = groupForUser(user.id);

    if (!group && previewSeedEnabled()) {
      group = ensurePreviewLeader(discordId)?.group || null;
      previewProvisioned = Boolean(group);
    }

    if (!group) {
      return res.status(409).json({
        error: "You must create or join a permanent Hollow Valley Group first.",
      });
    }

    if (String(group.role || "").toLowerCase() !== "leader") {
      return res.status(403).json({
        error: "Only the Group Leader can register the Group for a Territory War.",
      });
    }

    const event = latestUsableEvent(req.body?.eventId);
    if (!event) {
      return res.status(404).json({ error: "No Territory War event is available." });
    }

    if (event.status === "ended") {
      return res.status(409).json({ error: "That Territory War has already ended." });
    }

    db.prepare(`
      INSERT INTO territory_event_registrations
        (event_id, group_id, registered_by_user_id, status)
      VALUES (?, ?, ?, 'registered')
      ON CONFLICT(event_id, group_id) DO UPDATE SET status = 'registered'
    `).run(event.id, group.id, user.id);

    addLog(
      event.id,
      "registration",
      `${group.name} registered for the event`,
      user.id
    );

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
      event: decorateEvent(eventById(event.id)),
      registration: eventRegistration(event.id, group.id),
      lineup: eventLineup(event.id, group.id),
      previewProvisioned,
    });
  } catch (error) {
    console.error("[TerritoryWars] HerbyBot registration failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to register for Territory Wars.",
    });
  }
});

router.post("/roster", requireTerritoryInternalToken, (req, res) => {
  try {
    const discordId = String(req.body?.discordId || "").trim();
    if (!/^\d{15,22}$/.test(discordId)) {
      return res.status(400).json({ error: "A valid Discord user ID is required" });
    }

    const user = userByDiscordId(discordId);
    if (!user) {
      return res.status(404).json({
        error: "Your Discord account is not linked to a Hollow Valley account.",
      });
    }

    const group = groupForUser(user.id);
    if (!group) {
      return res.status(409).json({
        error: "You must create or join a permanent Hollow Valley Group first.",
      });
    }

    const event = latestUsableEvent(req.body?.eventId);
    const lineup = event ? eventLineup(event.id, group.id) : [];
    const activeIds = new Set(
      event ? activeLineup(event.id, group.id).map((member) => Number(member.user_id)) : []
    );

    return res.json({
      ok: true,
      group: {
        id: Number(group.id),
        name: group.name,
        tag: group.tag || null,
        role: group.role,
      },
      event: decorateEvent(event),
      registration: event ? eventRegistration(event.id, group.id) : null,
      roster: groupRoster(group.id).map((member) => ({
        id: Number(member.id),
        username: member.username,
        steamId: member.steam_id || null,
        discordId: member.discord_id || null,
        role: member.role,
        inLineup: lineup.some((entry) => Number(entry.user_id) === Number(member.id)),
        activeNow: activeIds.has(Number(member.id)),
        activeFrom: lineup.find((entry) => Number(entry.user_id) === Number(member.id))?.active_from || null,
      })),
    });
  } catch (error) {
    console.error("[TerritoryWars] HerbyBot roster failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to load Territory Wars roster.",
    });
  }
});

router.post("/lineup", requireTerritoryInternalToken, (req, res) => {
  try {
    const discordId = String(req.body?.discordId || "").trim();
    if (!/^\d{15,22}$/.test(discordId)) {
      return res.status(400).json({ error: "A valid Discord user ID is required" });
    }

    const user = userByDiscordId(discordId);
    if (!user) {
      return res.status(404).json({
        error: "Your Discord account is not linked to a Hollow Valley account.",
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
        error: "Only the Group Leader or an Officer can set the Territory Wars lineup.",
      });
    }

    const event = latestUsableEvent(req.body?.eventId);
    if (!event) {
      return res.status(404).json({ error: "No Territory War event is available." });
    }

    if (!eventRegistration(event.id, group.id)) {
      return res.status(409).json({
        error: "Your Group must register for this event before selecting a lineup.",
      });
    }

    if (event.status === "ended") {
      return res.status(409).json({ error: "That Territory War has already ended." });
    }

    const requestedDiscordIds = [...new Set(
      (Array.isArray(req.body?.memberDiscordIds) ? req.body.memberDiscordIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )];

    if (requestedDiscordIds.length > 6) {
      return res.status(400).json({ error: "Lineups are capped at 6 fighters." });
    }

    if (requestedDiscordIds.some((value) => !/^\d{15,22}$/.test(value))) {
      return res.status(400).json({
        error: "Every lineup fighter must be a valid Discord member.",
      });
    }

    let selectedUsers = linkedUsersByDiscordIds(requestedDiscordIds);

    if (
      previewSeedEnabled() &&
      selectedUsers.length !== requestedDiscordIds.length
    ) {
      for (const memberDiscordId of requestedDiscordIds) {
        if (!selectedUsers.some((member) => String(member.discord_id) === memberDiscordId)) {
          ensurePreviewGroupMember(memberDiscordId, group.id);
        }
      }
      selectedUsers = linkedUsersByDiscordIds(requestedDiscordIds);
    }

    if (selectedUsers.length !== requestedDiscordIds.length) {
      return res.status(400).json({
        error: "Every lineup fighter must have Discord linked to their Hollow Valley account.",
      });
    }

    const roster = groupRoster(group.id);
    const allowedUserIds = new Set(roster.map((member) => Number(member.id)));

    if (selectedUsers.some((member) => !allowedUserIds.has(Number(member.id)))) {
      return res.status(400).json({
        error: "Every lineup fighter must be a current member of your permanent Group.",
      });
    }

    if (selectedUsers.some((member) => !/^\d{17}$/.test(String(member.steam_id || "")))) {
      return res.status(400).json({
        error: "Every lineup fighter must have a linked Steam account.",
      });
    }

    const requestedUserIds = selectedUsers.map((member) => Number(member.id));
    const existing = eventLineup(event.id, group.id);
    const existingByUser = new Map(
      existing.map((member) => [Number(member.user_id), member])
    );
    const activeFromForNew = event.status === "live"
      ? new Date(Date.now() + (10 * 60 * 1000)).toISOString()
      : nowIso();

    runTransaction(() => {
      if (requestedUserIds.length) {
        const placeholders = requestedUserIds.map(() => "?").join(",");
        db.prepare(`
          DELETE FROM territory_event_lineups
          WHERE event_id = ? AND group_id = ?
            AND user_id NOT IN (${placeholders})
        `).run(event.id, group.id, ...requestedUserIds);
      } else {
        db.prepare(
          "DELETE FROM territory_event_lineups WHERE event_id = ? AND group_id = ?"
        ).run(event.id, group.id);
      }

      const insert = db.prepare(`
        INSERT INTO territory_event_lineups
          (event_id, group_id, user_id, selected_by_user_id, active_from, selected_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(event_id, group_id, user_id)
        DO UPDATE SET selected_by_user_id = excluded.selected_by_user_id
      `);

      for (const member of selectedUsers) {
        insert.run(
          event.id,
          group.id,
          member.id,
          user.id,
          existingByUser.get(Number(member.id))?.active_from || activeFromForNew
        );
      }
    });

    addLog(
      event.id,
      "lineup",
      `${group.name} set a ${requestedUserIds.length}-fighter lineup`,
      user.id
    );

    return res.json({
      ok: true,
      group: {
        id: Number(group.id),
        name: group.name,
        tag: group.tag || null,
        role: group.role,
      },
      event: decorateEvent(eventById(event.id)),
      lineup: eventLineup(event.id, group.id),
      lineupCap: 6,
      liveSubstitutionDelayMinutes: 10,
    });
  } catch (error) {
    console.error("[TerritoryWars] HerbyBot lineup failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to set Territory Wars lineup.",
    });
  }
});

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


router.post("/preview-kill-guardrails", requireTerritoryInternalToken, (_req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({
        error: "Territory Wars preview controls are disabled",
      });
    }

    let event = latestEventRaw();
    if (!event) {
      return res.status(409).json({
        error: "A Territory preview event is required",
      });
    }

    const leader = ensurePreviewUser("999000000000000002");
    const member = ensurePreviewUser("999000000000000003");
    const defenderOne = ensurePreviewUser("999000000000000006");
    const defenderTwo = ensurePreviewUser("999000000000000007");
    const defenderThree = ensurePreviewUser("999000000000000008");

    if (!leader || !member || !defenderOne || !defenderTwo || !defenderThree) {
      return res.status(500).json({
        error: "Unable to create preview kill-guardrail fighters",
      });
    }

    let group = groupForUser(leader.id);
    if (!group) {
      const created = db.prepare(`
        INSERT INTO territory_groups (name, tag, leader_user_id)
        VALUES ('Preview Group 2', 'P00002', ?)
      `).run(leader.id);
      const groupId = Number(created.lastInsertRowid);
      db.prepare(`
        INSERT INTO territory_group_members (group_id, user_id, role)
        VALUES (?, ?, 'leader')
      `).run(groupId, leader.id);
      db.prepare(
        "INSERT OR IGNORE INTO territory_group_stats (group_id) VALUES (?)"
      ).run(groupId);
      group = groupForUser(leader.id);
    }

    ensurePreviewGroupMember("999000000000000003", group.id);

    db.prepare("UPDATE users SET is_admin = 1 WHERE id IN (?, ?, ?)")
      .run(defenderOne.id, defenderTwo.id, defenderThree.id);

    const now = nowIso();
    const startsAt = new Date(Date.now() - (5 * 60 * 1000)).toISOString();
    const endsAt = new Date(Date.now() + (5 * 60 * 60 * 1000)).toISOString();
    const contestStartedAt = new Date(Date.now() - (3 * 60 * 1000)).toISOString();
    const lastTickAt = new Date(Date.now() - (60 * 1000)).toISOString();

    let attackId = null;

    runTransaction(() => {
      db.prepare(`
        UPDATE territory_events
        SET status = 'live',
            owner_name = 'Admin',
            challenger_name = ?,
            control_score = 0,
            owner_control = 50,
            challenger_control = 50,
            protection_until = NULL,
            frozen_owner_name = NULL,
            starts_at = ?,
            ends_at = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(group.name, startsAt, endsAt, event.id);

      db.prepare(`
        UPDATE territory_attacks
        SET status = 'cancelled',
            resolved_at = ?,
            outcome = 'preview-reset'
        WHERE event_id = ?
          AND status IN ('warning', 'active')
      `).run(now, event.id);

      db.prepare(`
        DELETE FROM territory_event_lineups
        WHERE event_id = ? AND group_id = ?
      `).run(event.id, group.id);

      const lineupInsert = db.prepare(`
        INSERT INTO territory_event_lineups
          (event_id, group_id, user_id, selected_by_user_id, active_from, selected_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `);
      const activeFrom = new Date(Date.now() - 1000).toISOString();
      lineupInsert.run(event.id, group.id, leader.id, leader.id, activeFrom);
      lineupInsert.run(event.id, group.id, member.id, leader.id, activeFrom);

      db.prepare(
        "DELETE FROM territory_preview_presence WHERE event_id = ?"
      ).run(event.id);

      const presenceInsert = db.prepare(`
        INSERT INTO territory_preview_presence
          (event_id, user_id, side, in_battlefield, in_claim, updated_at)
        VALUES (?, ?, ?, 1, 1, ?)
      `);
      presenceInsert.run(event.id, leader.id, "attacker", now);
      presenceInsert.run(event.id, member.id, "attacker", now);
      presenceInsert.run(event.id, defenderOne.id, "defender", now);
      presenceInsert.run(event.id, defenderTwo.id, "defender", now);

      db.prepare(
        "DELETE FROM territory_presence_grace WHERE event_id = ?"
      ).run(event.id);
      db.prepare(
        "DELETE FROM territory_combat_events WHERE event_id = ?"
      ).run(event.id);
      try {
        db.prepare(
          "DELETE FROM territory_kill_momentum WHERE event_id = ?"
        ).run(event.id);
      } catch {}

      const inserted = db.prepare(`
        INSERT INTO territory_attacks
          (
            event_id,
            attacker_group_id,
            defender_group_id,
            status,
            declared_by_user_id,
            declared_at,
            starts_at,
            contest_started_at,
            last_tick_at
          )
        VALUES (?, ?, NULL, 'active', ?, ?, ?, ?, ?)
      `).run(
        event.id,
        group.id,
        leader.id,
        startsAt,
        startsAt,
        contestStartedAt,
        lastTickAt
      );
      attackId = Number(inserted.lastInsertRowid);
    });

    event = eventById(event.id);

    const location = { x: -302000, y: 250000, z: 0 };
    const occurredAt = nowIso();

    const kill = (id, victim) => territoryCombatSync._test.processCombatEvent(
      {
        id,
        occurredAt,
        killerSteamId: String(leader.steam_id),
        victimSteamId: String(victim.steam_id),
        killerName: leader.username,
        victimName: victim.username,
        killerLocation: location,
        victimLocation: location,
        presenceSampledAt: occurredAt,
      },
      event
    );

    const firstId = `preview-guardrail-${event.id}-${attackId}-1`;
    const killOne = kill(firstId, defenderOne);
    const duplicate = kill(firstId, defenderOne);
    const repeatPair = kill(
      `preview-guardrail-${event.id}-${attackId}-repeat`,
      defenderOne
    );
    const killTwo = kill(
      `preview-guardrail-${event.id}-${attackId}-2`,
      defenderTwo
    );
    const killThree = kill(
      `preview-guardrail-${event.id}-${attackId}-3`,
      defenderThree
    );

    const momentum = territoryMomentum.recentMomentum(
      event.id,
      attackId,
      Date.now()
    );

    addLog(
      event.id,
      "kill",
      "Preview kill guardrail test verified momentum cap, duplicate suppression, and repeat-pair cooldown",
      null
    );

    return res.json({
      ok: true,
      eventId: Number(event.id),
      attackId,
      controlBefore: 0,
      attackers: 2,
      defenders: 2,
      validKills: [killOne, killTwo, killThree],
      duplicate,
      repeatPair,
      momentum,
      expectedControlAfterOneMinute: 2,
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview kill guardrails failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to run the Territory kill-guardrail test.",
    });
  }
});

router.post("/preview-kill-momentum", requireTerritoryInternalToken, (_req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({
        error: "Territory Wars preview controls are disabled",
      });
    }

    let event = latestEventRaw();
    if (!event || event.status === "ended") {
      const startsAt = new Date(Date.now() - (5 * 60 * 1000)).toISOString();
      const endsAt = new Date(Date.now() + (5 * 60 * 60 * 1000)).toISOString();
      const created = db.prepare(`
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
        VALUES (?, 'south-plains', 'South Plains', 'live', 'Admin', NULL, 0, 50, 50, ?, ?)
      `).run(
        "South Plains Kill Momentum Test",
        startsAt,
        endsAt
      );
      event = eventById(Number(created.lastInsertRowid));
    }

    const leaderDiscordId = "999000000000000002";
    const memberDiscordId = "999000000000000003";
    const leader = ensurePreviewUser(leaderDiscordId);
    const member = ensurePreviewUser(memberDiscordId);

    if (!leader || !member) {
      return res.status(500).json({
        error: "Unable to create preview attacker lineup",
      });
    }

    let group = groupForUser(leader.id);
    if (!group) {
      const created = db.prepare(`
        INSERT INTO territory_groups (name, tag, leader_user_id)
        VALUES ('Preview Group 2', 'P00002', ?)
      `).run(leader.id);
      const groupId = Number(created.lastInsertRowid);
      db.prepare(`
        INSERT INTO territory_group_members (group_id, user_id, role)
        VALUES (?, ?, 'leader')
      `).run(groupId, leader.id);
      db.prepare(
        "INSERT OR IGNORE INTO territory_group_stats (group_id) VALUES (?)"
      ).run(groupId);
      group = groupForUser(leader.id);
    }

    ensurePreviewGroupMember(memberDiscordId, group.id);

    const adminOne = ensurePreviewUser("999000000000000006");
    const adminTwo = ensurePreviewUser("999000000000000007");
    if (!adminOne || !adminTwo) {
      return res.status(500).json({
        error: "Unable to create preview system defenders",
      });
    }

    db.prepare("UPDATE users SET is_admin = 1 WHERE id IN (?, ?)")
      .run(adminOne.id, adminTwo.id);

    const now = nowIso();
    const startsAt = new Date(Date.now() - (5 * 60 * 1000)).toISOString();
    const endsAt = new Date(Date.now() + (5 * 60 * 60 * 1000)).toISOString();
    const contestStartedAt = new Date(Date.now() - (3 * 60 * 1000)).toISOString();
    const lastTickAt = new Date(Date.now() - (60 * 1000)).toISOString();

    let attackId = null;

    runTransaction(() => {
      db.prepare(`
        UPDATE territory_events
        SET status = 'live',
            owner_name = 'Admin',
            challenger_name = ?,
            control_score = 0,
            owner_control = 50,
            challenger_control = 50,
            protection_until = NULL,
            frozen_owner_name = NULL,
            starts_at = ?,
            ends_at = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(group.name, startsAt, endsAt, event.id);

      db.prepare(`
        UPDATE territory_attacks
        SET status = 'cancelled',
            resolved_at = ?,
            outcome = 'preview-reset'
        WHERE event_id = ?
          AND status IN ('warning', 'active')
      `).run(now, event.id);

      db.prepare(`
        INSERT INTO territory_event_registrations
          (event_id, group_id, registered_by_user_id, status)
        VALUES (?, ?, ?, 'registered')
        ON CONFLICT(event_id, group_id)
        DO UPDATE SET status = 'registered'
      `).run(event.id, group.id, leader.id);

      db.prepare(`
        DELETE FROM territory_event_lineups
        WHERE event_id = ? AND group_id = ?
      `).run(event.id, group.id);

      const lineupInsert = db.prepare(`
        INSERT INTO territory_event_lineups
          (event_id, group_id, user_id, selected_by_user_id, active_from, selected_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `);

      lineupInsert.run(
        event.id,
        group.id,
        leader.id,
        leader.id,
        new Date(Date.now() - 1000).toISOString()
      );
      lineupInsert.run(
        event.id,
        group.id,
        member.id,
        leader.id,
        new Date(Date.now() - 1000).toISOString()
      );

      db.prepare(
        "DELETE FROM territory_preview_presence WHERE event_id = ?"
      ).run(event.id);

      const presenceInsert = db.prepare(`
        INSERT INTO territory_preview_presence
          (event_id, user_id, side, in_battlefield, in_claim, updated_at)
        VALUES (?, ?, ?, 1, 1, ?)
      `);

      presenceInsert.run(event.id, leader.id, "attacker", now);
      presenceInsert.run(event.id, member.id, "attacker", now);
      presenceInsert.run(event.id, adminOne.id, "defender", now);
      presenceInsert.run(event.id, adminTwo.id, "defender", now);

      db.prepare(
        "DELETE FROM territory_presence_grace WHERE event_id = ?"
      ).run(event.id);

      db.prepare(
        "DELETE FROM territory_combat_events WHERE event_id = ?"
      ).run(event.id);

      try {
        db.prepare(
          "DELETE FROM territory_kill_momentum WHERE event_id = ?"
        ).run(event.id);
      } catch {}

      const inserted = db.prepare(`
        INSERT INTO territory_attacks
          (
            event_id,
            attacker_group_id,
            defender_group_id,
            status,
            declared_by_user_id,
            declared_at,
            starts_at,
            contest_started_at,
            last_tick_at
          )
        VALUES (?, ?, NULL, 'active', ?, ?, ?, ?, ?)
      `).run(
        event.id,
        group.id,
        leader.id,
        startsAt,
        startsAt,
        contestStartedAt,
        lastTickAt
      );

      attackId = Number(inserted.lastInsertRowid);
    });

    event = eventById(event.id);

    const location = {
      x: -302000,
      y: 250000,
      z: 0,
    };

    const combatEventId = `preview-kill-momentum-${event.id}-${attackId}-1`;
    const combatResult = territoryCombatSync._test.processCombatEvent(
      {
        id: combatEventId,
        occurredAt: nowIso(),
        killerSteamId: String(leader.steam_id),
        victimSteamId: String(adminOne.steam_id),
        killerName: leader.username,
        victimName: adminOne.username,
        killerLocation: location,
        victimLocation: location,
        presenceSampledAt: nowIso(),
      },
      event
    );

    const momentum = territoryMomentum.recentMomentum(
      event.id,
      attackId,
      Date.now()
    );

    addLog(
      event.id,
      "kill",
      "Preview kill-momentum test recorded one verified attacker kill at equal Claim Zone presence",
      null
    );

    return res.json({
      ok: true,
      eventId: Number(event.id),
      attackId,
      combatCounted: Boolean(combatResult?.counted),
      combatReason: combatResult?.reason || null,
      momentum,
      controlBefore: 0,
      attackers: 2,
      defenders: 2,
      expectedControlAfterOneMinute: 1,
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview kill momentum test failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to run the Territory kill-momentum test.",
    });
  }
});

router.post("/preview-substitution-prepare", requireTerritoryInternalToken, (_req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({
        error: "Territory Wars preview controls are disabled",
      });
    }

    let event = latestEventRaw();

    if (!event || event.status === "ended") {
      const startsAt = nowIso();
      const endsAt = new Date(Date.now() + (5 * 60 * 60 * 1000)).toISOString();

      const created = db.prepare(`
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
        VALUES (?, 'south-plains', 'South Plains', 'live', 'Admin', NULL, -100, 100, 0, ?, ?)
      `).run(
        "South Plains Live Substitution Test",
        startsAt,
        endsAt
      );

      event = eventById(Number(created.lastInsertRowid));
    } else {
      const startsAt = nowIso();
      const endsAt = new Date(Date.now() + (5 * 60 * 60 * 1000)).toISOString();

      db.prepare(`
        UPDATE territory_events
        SET status = 'live',
            owner_name = 'Admin',
            challenger_name = NULL,
            control_score = -100,
            owner_control = 100,
            challenger_control = 0,
            protection_until = NULL,
            frozen_owner_name = NULL,
            starts_at = ?,
            ends_at = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(startsAt, endsAt, event.id);

      db.prepare(`
        UPDATE territory_attacks
        SET status = 'cancelled',
            resolved_at = ?,
            outcome = 'preview-reset'
        WHERE event_id = ?
          AND status IN ('warning', 'active')
      `).run(nowIso(), event.id);

      event = eventById(event.id);
    }

    const leaderDiscordId = "999000000000000002";
    const memberDiscordId = "999000000000000003";
    const substituteDiscordId = "999000000000000005";

    const leader = ensurePreviewUser(leaderDiscordId);
    const member = ensurePreviewUser(memberDiscordId);

    if (!leader || !member) {
      return res.status(500).json({
        error: "Unable to create preview substitution users",
      });
    }

    let group = groupForUser(leader.id);
    if (!group) {
      const created = db.prepare(`
        INSERT INTO territory_groups (name, tag, leader_user_id)
        VALUES ('Preview Group 2', 'P00002', ?)
      `).run(leader.id);

      const groupId = Number(created.lastInsertRowid);

      db.prepare(`
        INSERT INTO territory_group_members (group_id, user_id, role)
        VALUES (?, ?, 'leader')
      `).run(groupId, leader.id);

      db.prepare(`
        INSERT OR IGNORE INTO territory_group_stats (group_id)
        VALUES (?)
      `).run(groupId);

      group = groupForUser(leader.id);
    }

    ensurePreviewGroupMember(memberDiscordId, group.id);

    db.prepare(`
      INSERT INTO territory_event_registrations
        (event_id, group_id, registered_by_user_id, status)
      VALUES (?, ?, ?, 'registered')
      ON CONFLICT(event_id, group_id)
      DO UPDATE SET status = 'registered'
    `).run(event.id, group.id, leader.id);

    const activeFrom = new Date(Date.now() - 1000).toISOString();

    runTransaction(() => {
      db.prepare(`
        DELETE FROM territory_event_lineups
        WHERE event_id = ?
          AND group_id = ?
      `).run(event.id, group.id);

      const insert = db.prepare(`
        INSERT INTO territory_event_lineups
          (event_id, group_id, user_id, selected_by_user_id, active_from, selected_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `);

      insert.run(
        event.id,
        group.id,
        leader.id,
        leader.id,
        activeFrom
      );

      insert.run(
        event.id,
        group.id,
        member.id,
        leader.id,
        activeFrom
      );
    });

    addLog(
      event.id,
      "lineup",
      "Preview live-substitution test prepared with 2 active fighters",
      null
    );

    return res.json({
      ok: true,
      event: decorateEvent(eventById(event.id)),
      group: {
        id: Number(group.id),
        name: group.name,
        tag: group.tag || null,
      },
      leaderDiscordId,
      memberDiscordIds: [
        leaderDiscordId,
        memberDiscordId,
        substituteDiscordId,
      ],
      substituteDiscordId,
      liveSubstitutionDelayMinutes: 10,
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview substitution prepare failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to prepare the Territory substitution test.",
    });
  }
});

router.post("/preview-substitution-fast-forward", requireTerritoryInternalToken, (req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({
        error: "Territory Wars preview controls are disabled",
      });
    }

    const eventId = Number(req.body?.eventId || 0);
    const groupId = Number(req.body?.groupId || 0);
    const substituteDiscordId = String(req.body?.substituteDiscordId || "").trim();

    if (!eventId || !groupId || !/^\d{15,22}$/.test(substituteDiscordId)) {
      return res.status(400).json({
        error: "Valid event, group, and substitute Discord IDs are required",
      });
    }

    const substitute = userByDiscordId(substituteDiscordId);
    if (!substitute) {
      return res.status(404).json({
        error: "Preview substitute was not found",
      });
    }

    const activeFrom = new Date(Date.now() - 1000).toISOString();

    const result = db.prepare(`
      UPDATE territory_event_lineups
      SET active_from = ?
      WHERE event_id = ?
        AND group_id = ?
        AND user_id = ?
    `).run(
      activeFrom,
      eventId,
      groupId,
      substitute.id
    );

    if (!result.changes) {
      return res.status(404).json({
        error: "Preview substitute is not in the event lineup",
      });
    }

    addLog(
      eventId,
      "lineup",
      "Preview live-substitution delay fast-forwarded for verification",
      null
    );

    return res.json({
      ok: true,
      activeFrom,
      substituteUserId: Number(substitute.id),
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview substitution fast-forward failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to fast-forward the Territory substitution test.",
    });
  }
});

router.post("/preview-event-end", requireTerritoryInternalToken, (_req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({
        error: "Territory Wars preview controls are disabled",
      });
    }

    const event = latestEventRaw();
    if (!event || event.status !== "live") {
      return res.status(409).json({
        error: "A live Territory Wars preview event is required",
      });
    }

    let attack = activeAttack(event.id);
    if (!attack) {
      return res.status(409).json({
        error: "An active Territory attack is required",
      });
    }

    if (attack.status === "warning") {
      const activatedAt = new Date(Date.now() - 1000).toISOString();
      db.prepare(`
        UPDATE territory_attacks
        SET status = 'active',
            starts_at = ?,
            last_tick_at = ?
        WHERE id = ?
      `).run(activatedAt, activatedAt, attack.id);
      attack = activeAttack(event.id);
    }

    if (!attack || attack.status !== "active") {
      return res.status(409).json({
        error: "The Territory attack could not be activated",
      });
    }

    const attackerLineup = activeLineup(
      event.id,
      attack.attacker_group_id
    );

    if (attackerLineup.length < MIN_ATTACKERS_TO_CONTEST) {
      return res.status(409).json({
        error: `Event-end test needs at least ${MIN_ATTACKERS_TO_CONTEST} active attackers`,
      });
    }

    const now = nowIso();
    const endedAt = new Date(Date.now() - 1000).toISOString();
    const contestStartedAt = new Date(
      Date.now() - (3 * 60 * 1000)
    ).toISOString();
    const lastTickAt = new Date(
      Date.now() - (60 * 1000)
    ).toISOString();

    runTransaction(() => {
      db.prepare(`
        UPDATE territory_events
        SET control_score = 99,
            owner_control = 1,
            challenger_control = 99,
            ends_at = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(endedAt, event.id);

      db.prepare(
        "DELETE FROM territory_preview_presence WHERE event_id = ?"
      ).run(event.id);

      const insert = db.prepare(`
        INSERT INTO territory_preview_presence
          (event_id, user_id, side, in_battlefield, in_claim, updated_at)
        VALUES (?, ?, 'attacker', 1, 1, ?)
      `);

      for (const member of attackerLineup.slice(0, MIN_ATTACKERS_TO_CONTEST)) {
        insert.run(event.id, member.user_id, now);
      }

      db.prepare(`
        UPDATE territory_attacks
        SET status = 'active',
            contest_started_at = ?,
            last_tick_at = ?
        WHERE id = ?
      `).run(
        contestStartedAt,
        lastTickAt,
        attack.id
      );
    });

    addLog(
      event.id,
      "preview",
      "Preview event-end test primed at 99% challenger control with an active attack",
      null
    );

    return res.json({
      ok: true,
      eventId: Number(event.id),
      ownerBefore: event.owner_name,
      challengerBefore: event.challenger_name,
      controlBefore: 99,
      endedAt,
      attackId: Number(attack.id),
      nextStep: "Read public Territory state so the normal runtime ends the event before scoring",
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview event-end test failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to prime the Territory event-end test.",
    });
  }
});

router.post("/preview-event-end-result", requireTerritoryInternalToken, (req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({
        error: "Territory Wars preview controls are disabled",
      });
    }

    const eventId = Number(req.body?.eventId || 0);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      return res.status(400).json({
        error: "A valid preview event ID is required",
      });
    }

    const event = eventById(eventId);
    if (!event) {
      return res.status(404).json({
        error: "Preview Territory event was not found",
      });
    }

    const latestAttack = db.prepare(`
      SELECT *
      FROM territory_attacks
      WHERE event_id = ?
      ORDER BY id DESC
      LIMIT 1
    `).get(eventId) || null;

    return res.json({
      ok: true,
      event: decorateEvent(event),
      attack: decorateAttack(latestAttack),
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview event-end result failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to inspect the Territory event-end result.",
    });
  }
});

router.post("/preview-boundary-grace", requireTerritoryInternalToken, (req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({
        error: "Territory Wars preview controls are disabled",
      });
    }

    const event = latestEventRaw();
    if (!event || event.status !== "live") {
      return res.status(409).json({
        error: "A live Territory Wars preview event is required",
      });
    }

    let attack = activeAttack(event.id);
    if (!attack) {
      return res.status(409).json({
        error: "An active Territory attack is required",
      });
    }

    if (attack.status === "warning") {
      const activatedAt = new Date(Date.now() - 1000).toISOString();
      db.prepare(`
        UPDATE territory_attacks
        SET status = 'active',
            starts_at = ?,
            last_tick_at = ?
        WHERE id = ?
      `).run(activatedAt, activatedAt, attack.id);
      attack = activeAttack(event.id);
    }

    if (!attack || attack.status !== "active") {
      return res.status(409).json({
        error: "The Territory attack could not be activated",
      });
    }

    const attackerLineup = activeLineup(
      event.id,
      attack.attacker_group_id
    );

    if (attackerLineup.length < 2) {
      return res.status(409).json({
        error: "Boundary-grace test needs at least 2 active attackers",
      });
    }

    const mode = String(req.body?.mode || "prime")
      .trim()
      .toLowerCase();

    if (mode === "prime") {
      const now = nowIso();

      runTransaction(() => {
        db.prepare(
          "DELETE FROM territory_preview_presence WHERE event_id = ?"
        ).run(event.id);

        db.prepare(
          "DELETE FROM territory_presence_grace WHERE event_id = ?"
        ).run(event.id);

        const insert = db.prepare(`
          INSERT INTO territory_preview_presence
            (event_id, user_id, side, in_battlefield, in_claim, updated_at)
          VALUES (?, ?, 'attacker', 1, 1, ?)
        `);

        for (const member of attackerLineup.slice(0, 2)) {
          insert.run(event.id, member.user_id, now);
        }

        db.prepare(`
          UPDATE territory_attacks
          SET contest_started_at = ?,
              last_tick_at = ?
          WHERE id = ?
        `).run(now, now, attack.id);
      });

      addLog(
        event.id,
        "presence",
        "Preview boundary-grace test primed with 2 attackers inside the Claim Zone",
        null
      );

      return res.json({
        ok: true,
        mode: "prime",
        attackers: 2,
        graceSeconds: 30,
        attack: decorateAttack(activeAttack(event.id)),
      });
    }

    const simulated = db.prepare(`
      SELECT p.user_id, u.username
      FROM territory_preview_presence p
      JOIN users u ON u.id = p.user_id
      WHERE p.event_id = ?
        AND p.side = 'attacker'
      ORDER BY p.user_id ASC
    `).all(event.id);

    if (simulated.length < 2) {
      return res.status(409).json({
        error: "Prime the boundary-grace test first",
      });
    }

    const steppingUserId = Number(simulated[1].user_id);

    if (mode === "step-out") {
      db.prepare(`
        UPDATE territory_preview_presence
        SET in_claim = 0,
            updated_at = ?
        WHERE event_id = ?
          AND user_id = ?
      `).run(nowIso(), event.id, steppingUserId);

      addLog(
        event.id,
        "presence",
        `Preview boundary-grace test: ${simulated[1].username || "attacker"} stepped outside the Claim Zone`,
        null
      );

      return res.json({
        ok: true,
        mode: "step-out",
        steppedOutUserId: steppingUserId,
        steppedOutName: simulated[1].username || null,
        attack: decorateAttack(activeAttack(event.id)),
      });
    }

    if (mode === "expire") {
      const expired = new Date(Date.now() - (31 * 1000)).toISOString();

      db.prepare(`
        UPDATE territory_presence_grace
        SET last_inside_at = ?
        WHERE event_id = ?
          AND user_id = ?
      `).run(expired, event.id, steppingUserId);

      addLog(
        event.id,
        "presence",
        "Preview boundary-grace test expired one attacker's 30-second grace window",
        null
      );

      return res.json({
        ok: true,
        mode: "expire",
        expiredUserId: steppingUserId,
        expiredAt: expired,
        attack: decorateAttack(activeAttack(event.id)),
      });
    }

    return res.status(400).json({
      error: "Boundary-grace mode must be prime, step-out, or expire",
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview boundary-grace simulation failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to run the Territory boundary-grace test.",
    });
  }
});

router.post("/preview-defender-advantage", requireTerritoryInternalToken, (_req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({
        error: "Territory Wars preview controls are disabled",
      });
    }

    const event = latestEventRaw();
    if (!event || event.status !== "live") {
      return res.status(409).json({
        error: "A live Territory Wars preview event is required",
      });
    }

    let attack = activeAttack(event.id);
    if (!attack) {
      return res.status(409).json({
        error: "An active Territory attack is required",
      });
    }

    if (attack.status === "warning") {
      const activatedAt = new Date(Date.now() - 1000).toISOString();
      db.prepare(`
        UPDATE territory_attacks
        SET status = 'active',
            starts_at = ?,
            last_tick_at = ?
        WHERE id = ?
      `).run(activatedAt, activatedAt, attack.id);
      attack = activeAttack(event.id);
    }

    const attackerLineup = activeLineup(
      event.id,
      attack.attacker_group_id
    );

    const defender = groupMatchingOwner(event.owner_name);
    if (!defender) {
      return res.status(409).json({
        error: "The current Territory owner is not a permanent Group",
      });
    }

    let defenderLineup = activeLineup(event.id, defender.id);

    if (defenderLineup.length < 3) {
      const extraDiscordId = "999000000000000004";
      const extra = ensurePreviewUser(extraDiscordId);

      if (!extra) {
        return res.status(500).json({
          error: "Unable to create the preview defender",
        });
      }

      const extraGroup = groupForUser(extra.id);
      if (!extraGroup) {
        db.prepare(`
          INSERT INTO territory_group_members (group_id, user_id, role)
          VALUES (?, ?, 'member')
        `).run(defender.id, extra.id);
      } else if (Number(extraGroup.id) !== Number(defender.id)) {
        return res.status(409).json({
          error: "Preview defender is already assigned to another Group",
        });
      }

      db.prepare(`
        INSERT INTO territory_event_lineups
          (event_id, group_id, user_id, selected_by_user_id, active_from, selected_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(event_id, group_id, user_id)
        DO UPDATE SET active_from = excluded.active_from
      `).run(
        event.id,
        defender.id,
        extra.id,
        defender.leader_user_id || extra.id,
        nowIso()
      );

      defenderLineup = activeLineup(event.id, defender.id);
    }

    if (attackerLineup.length < 2 || defenderLineup.length < 3) {
      return res.status(409).json({
        error: "Defender advantage test needs 2 attackers and 3 defenders",
      });
    }

    const now = nowIso();
    const contestStartedAt = new Date(
      Date.now() - (3 * 60 * 1000)
    ).toISOString();
    const lastTickAt = new Date(
      Date.now() - (60 * 1000)
    ).toISOString();

    runTransaction(() => {
      try {
        db.prepare(
          "DELETE FROM territory_kill_momentum WHERE event_id = ? AND attack_id = ?"
        ).run(event.id, attack.id);
      } catch {}

      db.prepare(`
        UPDATE territory_events
        SET control_score = 0,
            owner_control = 50,
            challenger_control = 50,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(event.id);

      db.prepare(
        "DELETE FROM territory_preview_presence WHERE event_id = ?"
      ).run(event.id);

      const insert = db.prepare(`
        INSERT INTO territory_preview_presence
          (event_id, user_id, side, in_battlefield, in_claim, updated_at)
        VALUES (?, ?, ?, 1, 1, ?)
      `);

      for (const member of attackerLineup.slice(0, 2)) {
        insert.run(event.id, member.user_id, "attacker", now);
      }

      for (const member of defenderLineup.slice(0, 3)) {
        insert.run(event.id, member.user_id, "defender", now);
      }

      db.prepare(`
        UPDATE territory_attacks
        SET contest_started_at = ?,
            last_tick_at = ?
        WHERE id = ?
      `).run(
        contestStartedAt,
        lastTickAt,
        attack.id
      );
    });

    addLog(
      event.id,
      "contest",
      "Preview simulation: defender advantage test started at 2 attackers vs 3 defenders",
      null
    );

    return res.json({
      ok: true,
      attackers: 2,
      defenders: 3,
      controlBefore: 0,
      event: decorateEvent(eventById(event.id)),
      attack: decorateAttack(activeAttack(event.id)),
      simulated: true,
      nextStep: "Read public Territory state to process the normal defender-favoured scoring tick",
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview defender advantage simulation failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to simulate defender advantage.",
    });
  }
});

router.post("/preview-contested", requireTerritoryInternalToken, (_req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({
        error: "Territory Wars preview controls are disabled",
      });
    }

    const event = latestEventRaw();
    if (!event || event.status !== "live") {
      return res.status(409).json({
        error: "A live Territory Wars preview event is required",
      });
    }

    let attack = activeAttack(event.id);
    if (!attack) {
      return res.status(409).json({
        error: "An active or warning Territory attack is required",
      });
    }

    if (attack.status === "warning") {
      const activatedAt = new Date(Date.now() - 1000).toISOString();
      db.prepare(`
        UPDATE territory_attacks
        SET status = 'active',
            starts_at = ?,
            last_tick_at = ?
        WHERE id = ?
      `).run(
        activatedAt,
        activatedAt,
        attack.id
      );

      addLog(
        event.id,
        "attack",
        "Preview test fast-forwarded the five-minute warning to ACTIVE",
        null
      );

      attack = activeAttack(event.id);
    }

    if (!attack || attack.status !== "active") {
      return res.status(409).json({
        error: "The Territory attack could not be activated",
      });
    }

    const attackerLineup = activeLineup(
      event.id,
      attack.attacker_group_id
    );

    const defender = groupMatchingOwner(event.owner_name);
    const defenderLineup = defender
      ? activeLineup(event.id, defender.id)
      : [];

    if (attackerLineup.length < 2) {
      return res.status(409).json({
        error: "Preview contested test needs at least 2 active attackers",
      });
    }

    if (defenderLineup.length < 2) {
      return res.status(409).json({
        error: "Preview contested test needs at least 2 active defenders",
      });
    }

    const now = nowIso();
    const contestStartedAt = new Date(
      Date.now() - (3 * 60 * 1000)
    ).toISOString();
    const lastTickAt = new Date(
      Date.now() - (60 * 1000)
    ).toISOString();

    runTransaction(() => {
      db.prepare(
        "DELETE FROM territory_preview_presence WHERE event_id = ?"
      ).run(event.id);

      const insert = db.prepare(`
        INSERT INTO territory_preview_presence
          (event_id, user_id, side, in_battlefield, in_claim, updated_at)
        VALUES (?, ?, ?, 1, 1, ?)
      `);

      for (const member of attackerLineup.slice(0, 2)) {
        insert.run(
          event.id,
          member.user_id,
          "attacker",
          now
        );
      }

      for (const member of defenderLineup.slice(0, 2)) {
        insert.run(
          event.id,
          member.user_id,
          "defender",
          now
        );
      }

      db.prepare(`
        UPDATE territory_attacks
        SET contest_started_at = ?,
            last_tick_at = ?
        WHERE id = ?
      `).run(
        contestStartedAt,
        lastTickAt,
        attack.id
      );
    });

    addLog(
      event.id,
      "contest",
      "Preview simulation: 2 attackers and 2 defenders are contesting the Claim Zone",
      null
    );

    const current = eventById(event.id);

    return res.json({
      ok: true,
      event: decorateEvent(current),
      attack: decorateAttack(activeAttack(event.id)),
      attackers: 2,
      defenders: 2,
      controlBefore: Number(current.control_score || 0),
      simulated: true,
      nextStep: "Read public Territory state to process the normal scoring tick",
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview contested simulation failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to simulate contested Territory presence.",
    });
  }
});

router.post("/preview-expire-protection", requireTerritoryInternalToken, (_req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({
        error: "Territory Wars preview controls are disabled",
      });
    }

    const event = latestEventRaw();
    if (!event || event.status !== "live") {
      return res.status(409).json({
        error: "A live Territory Wars preview event is required",
      });
    }

    const expiredAt = new Date(Date.now() - 1000).toISOString();

    runTransaction(() => {
      db.prepare(`
        UPDATE territory_events
        SET protection_until = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(expiredAt, event.id);

      db.prepare(
        "DELETE FROM territory_preview_presence WHERE event_id = ?"
      ).run(event.id);
    });

    addLog(
      event.id,
      "protection",
      "Preview test expired the capture-protection window",
      null
    );

    return res.json({
      ok: true,
      event: decorateEvent(eventById(event.id)),
      expiredAt,
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview protection expiry failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to expire preview protection.",
    });
  }
});

router.post("/preview-counterattacker", requireTerritoryInternalToken, (_req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({
        error: "Territory Wars preview controls are disabled",
      });
    }

    const event = latestEventRaw();
    if (!event || event.status !== "live") {
      return res.status(409).json({
        error: "A live Territory Wars preview event is required",
      });
    }

    const leaderDiscordId = "999000000000000002";
    const memberDiscordId = "999000000000000003";
    const leader = ensurePreviewUser(leaderDiscordId);
    const member = ensurePreviewUser(memberDiscordId);

    if (!leader || !member) {
      return res.status(500).json({
        error: "Unable to create preview counterattack users",
      });
    }

    let group = groupForUser(leader.id);

    if (!group) {
      const created = db.prepare(`
        INSERT INTO territory_groups (name, tag, leader_user_id)
        VALUES ('Preview Group 2', 'P00002', ?)
      `).run(leader.id);

      const groupId = Number(created.lastInsertRowid);

      db.prepare(`
        INSERT INTO territory_group_members (group_id, user_id, role)
        VALUES (?, ?, 'leader')
      `).run(groupId, leader.id);

      db.prepare(`
        INSERT OR IGNORE INTO territory_group_stats (group_id)
        VALUES (?)
      `).run(groupId);

      group = groupForUser(leader.id);
    }

    const memberGroup = groupForUser(member.id);
    if (!memberGroup) {
      db.prepare(`
        INSERT INTO territory_group_members (group_id, user_id, role)
        VALUES (?, ?, 'member')
      `).run(group.id, member.id);
    }

    db.prepare(`
      INSERT INTO territory_event_registrations
        (event_id, group_id, registered_by_user_id, status)
      VALUES (?, ?, ?, 'registered')
      ON CONFLICT(event_id, group_id)
      DO UPDATE SET status = 'registered'
    `).run(event.id, group.id, leader.id);

    const lineupInsert = db.prepare(`
      INSERT INTO territory_event_lineups
        (event_id, group_id, user_id, selected_by_user_id, active_from, selected_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(event_id, group_id, user_id)
      DO UPDATE SET active_from = excluded.active_from,
                    selected_by_user_id = excluded.selected_by_user_id
    `);

    const activeFrom = nowIso();
    lineupInsert.run(
      event.id,
      group.id,
      leader.id,
      leader.id,
      activeFrom
    );
    lineupInsert.run(
      event.id,
      group.id,
      member.id,
      leader.id,
      activeFrom
    );

    return res.json({
      ok: true,
      leaderDiscordId,
      group: {
        id: Number(group.id),
        name: group.name,
        tag: group.tag || null,
      },
      event: decorateEvent(eventById(event.id)),
      lineup: eventLineup(event.id, group.id),
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview counterattacker seed failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to create preview counterattacker.",
    });
  }
});

router.post("/preview-near-capture", requireTerritoryInternalToken, (_req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({
        error: "Territory Wars preview controls are disabled",
      });
    }

    const event = latestEventRaw();
    if (!event || event.status !== "live") {
      return res.status(409).json({
        error: "A live Territory Wars preview event is required",
      });
    }

    const attack = activeAttack(event.id);
    if (!attack || attack.status !== "active") {
      return res.status(409).json({
        error: "An ACTIVE Territory attack is required",
      });
    }

    const simulatedAttackers = db.prepare(`
      SELECT COUNT(*) AS total
      FROM territory_preview_presence
      WHERE event_id = ?
        AND side = 'attacker'
        AND in_claim = 1
    `).get(event.id);

    if (Number(simulatedAttackers?.total || 0) < MIN_ATTACKERS_TO_CONTEST) {
      return res.status(409).json({
        error: `At least ${MIN_ATTACKERS_TO_CONTEST} simulated attackers must remain in the Claim Zone`,
      });
    }

    const nowMs = Date.now();
    const contestStartedAt = new Date(nowMs - (3 * 60 * 1000)).toISOString();
    const lastTickAt = new Date(nowMs - (60 * 1000)).toISOString();

    runTransaction(() => {
      db.prepare(`
        UPDATE territory_events
        SET control_score = 99,
            owner_control = 1,
            challenger_control = 99,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(event.id);

      db.prepare(`
        UPDATE territory_attacks
        SET status = 'active',
            contest_started_at = ?,
            last_tick_at = ?
        WHERE id = ?
      `).run(
        contestStartedAt,
        lastTickAt,
        attack.id
      );
    });

    addLog(
      event.id,
      "preview",
      "Preview capture test primed at 99% challenger control",
      null
    );

    return res.json({
      ok: true,
      primed: true,
      event: decorateEvent(eventById(event.id)),
      attack: decorateAttack(activeAttack(event.id)),
      simulatedAttackers: Number(simulatedAttackers.total || 0),
      nextStep: "Refresh Territory state to let the normal runtime resolve the capture",
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview near-capture failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to prime the Territory capture test.",
    });
  }
});

router.post("/preview-presence", requireTerritoryInternalToken, (req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({
        error: "Territory Wars preview controls are disabled",
      });
    }

    const event = latestEventRaw();
    if (!event || event.status !== "live") {
      return res.status(409).json({
        error: "A live Territory Wars preview event is required",
      });
    }

    const mode = String(req.body?.mode || "attackers-claim")
      .trim()
      .toLowerCase();

    if (mode === "clear") {
      db.prepare(
        "DELETE FROM territory_preview_presence WHERE event_id = ?"
      ).run(event.id);

      addLog(
        event.id,
        "presence",
        "Preview Claim Zone simulation cleared",
        null
      );

      return res.json({
        ok: true,
        mode: "clear",
        event: decorateEvent(event),
        attackers: 0,
        defenders: 0,
      });
    }

    const attack = activeAttack(event.id);
    if (!attack || attack.status !== "active") {
      return res.status(409).json({
        error: "Wait until the five-minute warning ends and the attack is ACTIVE",
      });
    }

    const attackerLineup = activeLineup(
      event.id,
      attack.attacker_group_id
    );

    const requestedAttackers = Math.max(
      0,
      Math.min(
        attackerLineup.length,
        Number.isFinite(Number(req.body?.attackers))
          ? Math.floor(Number(req.body.attackers))
          : attackerLineup.length
      )
    );

    if (requestedAttackers < MIN_ATTACKERS_TO_CONTEST) {
      return res.status(409).json({
        error: `Preview capture testing needs at least ${MIN_ATTACKERS_TO_CONTEST} active attackers`,
      });
    }

    runTransaction(() => {
      db.prepare(
        "DELETE FROM territory_preview_presence WHERE event_id = ?"
      ).run(event.id);

      const insert = db.prepare(`
        INSERT INTO territory_preview_presence
          (event_id, user_id, side, in_battlefield, in_claim, updated_at)
        VALUES (?, ?, 'attacker', 1, 1, ?)
      `);

      for (const member of attackerLineup.slice(0, requestedAttackers)) {
        insert.run(
          event.id,
          member.user_id,
          nowIso()
        );
      }
    });

    const attackerNames = attackerLineup
      .slice(0, requestedAttackers)
      .map((member) => member.username || `Player ${member.user_id}`);

    addLog(
      event.id,
      "presence",
      `Preview simulation: ${requestedAttackers} eligible attackers entered the South Plains Claim Zone`,
      null
    );

    return res.json({
      ok: true,
      mode: "attackers-claim",
      event: decorateEvent(eventById(event.id)),
      attack: decorateAttack(activeAttack(event.id)),
      attackers: requestedAttackers,
      defenders: 0,
      fighters: attackerNames,
      contestArmMinutes: 2,
      simulated: true,
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview presence simulation failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to simulate Territory Wars presence.",
    });
  }
});

router.post("/set-preview-live", requireTerritoryInternalToken, (_req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({
        error: "Territory Wars preview controls are disabled",
      });
    }

    const event = db.prepare(`
      SELECT *
      FROM territory_events
      WHERE territory_key = 'south-plains'
        AND status != 'ended'
      ORDER BY CASE status
        WHEN 'live' THEN 0
        WHEN 'paused' THEN 1
        WHEN 'scheduled' THEN 2
        ELSE 3
      END, id DESC
      LIMIT 1
    `).get();

    if (!event) {
      return res.status(404).json({
        error: "No active South Plains preview event exists yet",
      });
    }

    if (event.status === "ended") {
      return res.status(409).json({
        error: "South Plains Preview Test has already ended",
      });
    }

    const startsAt = nowIso();
    const endsAt = new Date(Date.now() + (5 * 60 * 60 * 1000)).toISOString();

    db.prepare(`
      UPDATE territory_events
      SET status = 'live',
          starts_at = ?,
          ends_at = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(startsAt, endsAt, event.id);

    addLog(
      event.id,
      "status",
      `${event.name || "South Plains"} preview event set LIVE for attack testing`,
      null
    );

    return res.json({
      ok: true,
      event: decorateEvent(eventById(event.id)),
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview live switch failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to set Territory Wars preview live.",
    });
  }
});

router.post("/seed-preview", requireTerritoryInternalToken, (_req, res) => {
  try {
    const enabled = String(
      process.env.TERRITORY_WARS_PREVIEW_SEED || ""
    ).trim().toLowerCase();

    if (!["1", "true", "yes", "on"].includes(enabled)) {
      return res.status(403).json({
        error: "Territory Wars preview seeding is disabled",
      });
    }

    const existing = db.prepare(
      "SELECT * FROM territory_events WHERE name = ? ORDER BY id DESC LIMIT 1"
    ).get("South Plains Preview Test");

    if (existing) {
      return res.json({
        ok: true,
        created: false,
        event: decorateEvent(existing),
      });
    }

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
      VALUES (?, ?, ?, 'scheduled', 'Admin', NULL, -100, 100, 0, ?, ?)
    `).run(
      "South Plains Preview Test",
      "south-plains",
      "South Plains",
      "2026-10-10T07:00:00.000Z",
      "2026-10-10T12:00:00.000Z"
    );

    const eventId = Number(result.lastInsertRowid);

    addLog(
      eventId,
      "created",
      "South Plains preview test event seeded automatically",
      null
    );

    return res.json({
      ok: true,
      created: true,
      event: decorateEvent(eventById(eventId)),
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview seed failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to seed Territory Wars preview event.",
    });
  }
});


module.exports = router;
