const express = require("express");
const { timingSafeEqual } = require("node:crypto");
const { db } = require("../db");
const territoryCombatSync = require("../services/territoryCombatSync");
const territoryMomentum = require("../services/territoryMomentum");
const { controlRatePerMinute } = require("../services/territoryControl");

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




router.post("/preview-death-presence", requireTerritoryInternalToken, (req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({
        error: "Territory Wars preview controls are disabled",
      });
    }

    const mode = String(req.body?.mode || "prepare").trim().toLowerCase();
    const attackerOne = ensurePreviewUser("999000000000000050");
    const attackerTwo = ensurePreviewUser("999000000000000051");
    const defender = ensurePreviewUser("999000000000000052");

    if (!attackerOne || !attackerTwo || !defender) {
      return res.status(500).json({
        error: "Unable to create death-presence preview fighters",
      });
    }

    let group = groupForUser(attackerOne.id);
    if (!group) {
      const created = db.prepare(`
        INSERT INTO territory_groups (name, tag, leader_user_id)
        VALUES ('Preview Death Group', 'DEATH', ?)
      `).run(attackerOne.id);
      const groupId = Number(created.lastInsertRowid);
      db.prepare(`
        INSERT INTO territory_group_members (group_id, user_id, role)
        VALUES (?, ?, 'leader')
      `).run(groupId, attackerOne.id);
      db.prepare(
        "INSERT OR IGNORE INTO territory_group_stats (group_id) VALUES (?)"
      ).run(groupId);
      group = groupForUser(attackerOne.id);
    }

    const attackerTwoMember = ensurePreviewGroupMember(
      "999000000000000051",
      group.id
    );
    if (!attackerTwoMember) {
      return res.status(409).json({
        error: "Unable to place second preview attacker in the Group",
      });
    }

    db.prepare("UPDATE users SET is_admin = 1 WHERE id = ?")
      .run(defender.id);

    let event = latestEventRaw();
    if (!event || event.status === "ended") {
      const created = db.prepare(`
        INSERT INTO territory_events
          (name, territory_key, territory_name, status, owner_name,
           challenger_name, control_score, owner_control, challenger_control,
           starts_at, ends_at)
        VALUES (?, 'south-plains', 'South Plains', 'live', 'Admin', ?, -100, 100, 0, ?, ?)
      `).run(
        "South Plains Death Presence Test",
        group.name,
        new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString()
      );
      event = eventById(Number(created.lastInsertRowid));
    }

    const activeAttackForFixture = () => db.prepare(`
      SELECT *
      FROM territory_attacks
      WHERE event_id = ? AND status = 'active'
      ORDER BY id DESC
      LIMIT 1
    `).get(event.id) || null;

    if (mode === "prepare") {
      const now = Date.now();
      const activeFrom = new Date(now - 10 * 60 * 1000).toISOString();
      const startedAt = new Date(now - 5 * 60 * 1000).toISOString();
      const contestStartedAt = new Date(now - 3 * 60 * 1000).toISOString();
      const lastTickAt = new Date(now - 60 * 1000).toISOString();
      const endsAt = new Date(now + 5 * 60 * 60 * 1000).toISOString();

      let attackId = null;
      runTransaction(() => {
        db.prepare(`
          UPDATE territory_events
          SET status = 'live',
              owner_name = 'Admin',
              challenger_name = ?,
              control_score = -100,
              owner_control = 100,
              challenger_control = 0,
              protection_until = NULL,
              starts_at = ?,
              ends_at = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `).run(
          group.name,
          new Date(now - 10 * 60 * 1000).toISOString(),
          endsAt,
          event.id
        );

        db.prepare(`
          INSERT INTO territory_event_registrations
            (event_id, group_id, registered_by_user_id, status)
          VALUES (?, ?, ?, 'registered')
          ON CONFLICT(event_id, group_id) DO UPDATE SET status = 'registered'
        `).run(event.id, group.id, attackerOne.id);

        db.prepare(
          "DELETE FROM territory_event_lineups WHERE event_id = ? AND group_id = ?"
        ).run(event.id, group.id);

        const lineupInsert = db.prepare(`
          INSERT INTO territory_event_lineups
            (event_id, group_id, user_id, selected_by_user_id, active_from, selected_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `);
        lineupInsert.run(
          event.id, group.id, attackerOne.id, attackerOne.id, activeFrom
        );
        lineupInsert.run(
          event.id, group.id, attackerTwo.id, attackerOne.id, activeFrom
        );

        db.prepare(
          "DELETE FROM territory_preview_presence WHERE event_id = ?"
        ).run(event.id);
        db.prepare(
          "DELETE FROM territory_presence_grace WHERE event_id = ?"
        ).run(event.id);
        try {
          db.prepare(
            "DELETE FROM territory_presence_deaths WHERE event_id = ?"
          ).run(event.id);
        } catch {}
        try {
          db.prepare(
            "DELETE FROM territory_kill_momentum WHERE event_id = ?"
          ).run(event.id);
        } catch {}
        db.prepare(
          "DELETE FROM territory_combat_events WHERE event_id = ?"
        ).run(event.id);

        const presenceInsert = db.prepare(`
          INSERT INTO territory_preview_presence
            (event_id, user_id, side, in_battlefield, in_claim, updated_at)
          VALUES (?, ?, ?, 1, 1, ?)
        `);
        const nowText = nowIso();
        presenceInsert.run(
          event.id, attackerOne.id, "attacker", nowText
        );
        presenceInsert.run(
          event.id, attackerTwo.id, "attacker", nowText
        );
        presenceInsert.run(
          event.id, defender.id, "defender", nowText
        );

        db.prepare(`
          UPDATE territory_attacks
          SET status = 'cancelled',
              resolved_at = ?,
              outcome = 'preview-death-reset'
          WHERE event_id = ? AND status IN ('warning', 'active')
        `).run(nowText, event.id);

        const inserted = db.prepare(`
          INSERT INTO territory_attacks
            (event_id, attacker_group_id, defender_group_id, status,
             declared_by_user_id, declared_at, starts_at,
             contest_started_at, last_tick_at)
          VALUES (?, ?, NULL, 'active', ?, ?, ?, ?, ?)
        `).run(
          event.id,
          group.id,
          attackerOne.id,
          startedAt,
          startedAt,
          contestStartedAt,
          lastTickAt
        );
        attackId = Number(inserted.lastInsertRowid);
      });

      return res.json({
        ok: true,
        mode,
        eventId: Number(event.id),
        attackId,
        victimSteamId: String(attackerTwo.steam_id),
        defenderSteamId: String(defender.steam_id),
        controlBefore: -100,
        attackersBefore: 2,
      });
    }

    const attack = activeAttackForFixture();
    if (!attack) {
      return res.status(409).json({
        error: "Prepare the death-presence test first",
      });
    }

    if (mode === "kill") {
      const location = { x: -302000, y: 250000, z: 0 };
      const occurredAt = nowIso();
      const result = territoryCombatSync._test.processCombatEvent(
        {
          id: `preview-death-presence-${event.id}-${attack.id}`,
          occurredAt,
          killerSteamId: String(defender.steam_id),
          victimSteamId: String(attackerTwo.steam_id),
          killerName: defender.username,
          victimName: attackerTwo.username,
          killerLocation: location,
          victimLocation: location,
          presenceSampledAt: occurredAt,
        },
        eventById(event.id)
      );

      const deathRow = db.prepare(`
        SELECT killed_at, seen_absent
        FROM territory_presence_deaths
        WHERE event_id = ? AND user_id = ?
      `).get(event.id, attackerTwo.id) || null;

      return res.json({
        ok: true,
        mode,
        eventId: Number(event.id),
        attackId: Number(attack.id),
        combat: result,
        deathLock: Boolean(deathRow),
        seenAbsent: Boolean(deathRow?.seen_absent),
      });
    }

    if (mode === "absent") {
      db.prepare(`
        UPDATE territory_preview_presence
        SET in_claim = 0, in_battlefield = 0, updated_at = ?
        WHERE event_id = ? AND user_id = ?
      `).run(nowIso(), event.id, attackerTwo.id);

      return res.json({
        ok: true,
        mode,
        eventId: Number(event.id),
        attackId: Number(attack.id),
      });
    }

    if (mode === "return") {
      db.prepare(`
        UPDATE territory_preview_presence
        SET in_claim = 1, in_battlefield = 1, updated_at = ?
        WHERE event_id = ? AND user_id = ?
      `).run(nowIso(), event.id, attackerTwo.id);

      return res.json({
        ok: true,
        mode,
        eventId: Number(event.id),
        attackId: Number(attack.id),
      });
    }

    return res.status(400).json({
      error: "Death-presence mode must be prepare, kill, absent, or return",
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview death-presence test failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to run the Territory death-presence test",
    });
  }
});

router.post("/preview-phase-chain", requireTerritoryInternalToken, (req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({
        error: "Territory Wars preview controls are disabled",
      });
    }

    const mode = String(req.body?.mode || "prepare").trim().toLowerCase();
    const leaderDiscordId = "999000000000000040";
    const memberDiscordId = "999000000000000041";

    const leader = ensurePreviewUser(leaderDiscordId);
    if (!leader) {
      return res.status(500).json({ error: "Unable to create phase-chain leader" });
    }

    let group = groupForUser(leader.id);
    if (!group) {
      const created = db.prepare(`
        INSERT INTO territory_groups (name, tag, leader_user_id)
        VALUES ('Preview Phase Group', 'PHASE', ?)
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

    const member = ensurePreviewGroupMember(memberDiscordId, group.id);
    if (!member) {
      return res.status(409).json({ error: "Unable to create phase-chain member" });
    }

    let event = latestEventRaw();
    if (!event || event.status === "ended") {
      const created = db.prepare(`
        INSERT INTO territory_events
          (name, territory_key, territory_name, status, owner_name, control_score,
           owner_control, challenger_control, starts_at, ends_at)
        VALUES (?, 'south-plains', 'South Plains', 'live', 'Admin', -100, 100, 0, ?, ?)
      `).run(
        "South Plains Phase Chain Test",
        new Date(Date.now() - 60 * 1000).toISOString(),
        new Date(Date.now() + 5 * 60 * 60 * 1000).toISOString()
      );
      event = eventById(Number(created.lastInsertRowid));
    }

    const findAttack = () => db.prepare(`
      SELECT *
      FROM territory_attacks
      WHERE event_id = ?
        AND status IN ('warning', 'active')
      ORDER BY id DESC
      LIMIT 1
    `).get(event.id) || null;

    if (mode === "prepare") {
      const now = Date.now();
      const activeFrom = new Date(now - 10 * 60 * 1000).toISOString();
      const declaredAt = new Date(now).toISOString();
      const startsAt = new Date(now + ATTACK_WARNING_MS).toISOString();
      const endsAt = new Date(now + 5 * 60 * 60 * 1000).toISOString();

      let attackId = null;
      runTransaction(() => {
        db.prepare(`
          UPDATE territory_events
          SET status = 'live',
              owner_name = 'Admin',
              challenger_name = ?,
              control_score = -100,
              owner_control = 100,
              challenger_control = 0,
              protection_until = NULL,
              starts_at = ?,
              ends_at = ?,
              updated_at = datetime('now')
          WHERE id = ?
        `).run(
          group.name,
          new Date(now - 60 * 1000).toISOString(),
          endsAt,
          event.id
        );

        db.prepare(`
          INSERT INTO territory_event_registrations
            (event_id, group_id, registered_by_user_id, status)
          VALUES (?, ?, ?, 'registered')
          ON CONFLICT(event_id, group_id) DO UPDATE SET status = 'registered'
        `).run(event.id, group.id, leader.id);

        db.prepare(
          "DELETE FROM territory_event_lineups WHERE event_id = ? AND group_id = ?"
        ).run(event.id, group.id);

        const lineupInsert = db.prepare(`
          INSERT INTO territory_event_lineups
            (event_id, group_id, user_id, selected_by_user_id, active_from, selected_at)
          VALUES (?, ?, ?, ?, ?, datetime('now'))
        `);
        lineupInsert.run(event.id, group.id, leader.id, leader.id, activeFrom);
        lineupInsert.run(event.id, group.id, member.id, leader.id, activeFrom);

        db.prepare(
          "DELETE FROM territory_preview_presence WHERE event_id = ?"
        ).run(event.id);
        db.prepare(
          "DELETE FROM territory_presence_grace WHERE event_id = ?"
        ).run(event.id);
        db.prepare(`
          UPDATE territory_attacks
          SET status = 'cancelled', resolved_at = ?, outcome = 'preview-phase-reset'
          WHERE event_id = ? AND status IN ('warning', 'active')
        `).run(declaredAt, event.id);

        try {
          db.prepare(
            "DELETE FROM territory_kill_momentum WHERE event_id = ?"
          ).run(event.id);
        } catch {}

        const inserted = db.prepare(`
          INSERT INTO territory_attacks
            (event_id, attacker_group_id, defender_group_id, status,
             declared_by_user_id, declared_at, starts_at,
             contest_started_at, last_tick_at)
          VALUES (?, ?, NULL, 'warning', ?, ?, ?, NULL, NULL)
        `).run(
          event.id,
          group.id,
          leader.id,
          declaredAt,
          startsAt
        );
        attackId = Number(inserted.lastInsertRowid);
      });

      addLog(
        event.id,
        "preview",
        "Preview phase-chain test prepared at the five-minute warning",
        null
      );

      return res.json({
        ok: true,
        mode,
        eventId: Number(event.id),
        attackId,
        groupId: Number(group.id),
        warningMinutes: ATTACK_WARNING_MS / 60000,
        contestArmMinutes: 2,
        controlBefore: -100,
      });
    }

    const attack = findAttack();
    if (!attack) {
      return res.status(409).json({
        error: "Prepare the Territory phase-chain test first",
      });
    }

    if (mode === "warning-expired") {
      db.prepare(`
        UPDATE territory_attacks
        SET starts_at = ?, status = 'warning',
            contest_started_at = NULL, last_tick_at = NULL
        WHERE id = ?
      `).run(
        new Date(Date.now() - 1000).toISOString(),
        attack.id
      );

      return res.json({
        ok: true,
        mode,
        eventId: Number(event.id),
        attackId: Number(attack.id),
      });
    }

    if (mode === "claim-entered") {
      const active = activeLineup(event.id, group.id);
      if (active.length < MIN_ATTACKERS_TO_CONTEST) {
        return res.status(409).json({
          error: "Phase-chain test needs two active lineup attackers",
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
        const now = nowIso();
        for (const fighter of active.slice(0, MIN_ATTACKERS_TO_CONTEST)) {
          insert.run(event.id, fighter.user_id, now);
        }

        db.prepare(`
          UPDATE territory_attacks
          SET status = 'active', contest_started_at = NULL, last_tick_at = ?
          WHERE id = ?
        `).run(now, attack.id);
      });

      return res.json({
        ok: true,
        mode,
        eventId: Number(event.id),
        attackId: Number(attack.id),
        attackers: MIN_ATTACKERS_TO_CONTEST,
      });
    }

    if (mode === "claim-broken") {
      const active = activeLineup(event.id, group.id);
      if (active.length < 1) {
        return res.status(409).json({
          error: "Phase-chain test needs an active lineup attacker",
        });
      }

      runTransaction(() => {
        db.prepare(
          "DELETE FROM territory_preview_presence WHERE event_id = ?"
        ).run(event.id);

        db.prepare(`
          INSERT INTO territory_preview_presence
            (event_id, user_id, side, in_battlefield, in_claim, updated_at)
          VALUES (?, ?, 'attacker', 1, 1, ?)
        `).run(event.id, active[0].user_id, nowIso());
      });

      return res.json({
        ok: true,
        mode,
        eventId: Number(event.id),
        attackId: Number(attack.id),
        attackers: 1,
      });
    }

    if (mode === "claim-grace-expired") {
      const active = activeLineup(event.id, group.id);
      if (active.length < MIN_ATTACKERS_TO_CONTEST) {
        return res.status(409).json({
          error: "Phase-chain test needs two active lineup attackers",
        });
      }

      const expiredAt = new Date(Date.now() - (31 * 1000)).toISOString();
      db.prepare(`
        INSERT INTO territory_presence_grace
          (event_id, user_id, last_inside_at)
        VALUES (?, ?, ?)
        ON CONFLICT(event_id, user_id)
        DO UPDATE SET last_inside_at = excluded.last_inside_at
      `).run(
        event.id,
        active[1].user_id,
        expiredAt
      );

      return res.json({
        ok: true,
        mode,
        eventId: Number(event.id),
        attackId: Number(attack.id),
        graceSeconds: 30,
        expiredUserId: Number(active[1].user_id),
        expiredAt,
      });
    }

    if (mode === "arm-expired") {
      const now = Date.now();
      db.prepare(`
        UPDATE territory_attacks
        SET status = 'active',
            contest_started_at = ?,
            last_tick_at = ?
        WHERE id = ?
      `).run(
        new Date(now - (2 * 60 * 1000) - 1000).toISOString(),
        new Date(now - 60 * 1000).toISOString(),
        attack.id
      );

      return res.json({
        ok: true,
        mode,
        eventId: Number(event.id),
        attackId: Number(attack.id),
        expectedControlAfterOneMinute: controlRatePerMinute({
          attackers: MIN_ATTACKERS_TO_CONTEST,
          defenders: 0,
          momentumRate: 0,
        }).rate - 100,
      });
    }

    return res.status(400).json({
      error: "Phase-chain mode must be prepare, warning-expired, claim-entered, claim-broken, claim-grace-expired, or arm-expired",
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview phase-chain test failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to run the Territory phase-chain test",
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

router.post("/preview-lineup-eligibility", requireTerritoryInternalToken, (req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({ error: "Territory preview controls are disabled" });
    }

    const mode = String(req.body?.mode || "prepare").trim().toLowerCase();
    if (!["prepare", "score"].includes(mode)) {
      return res.status(400).json({ error: "Mode must be prepare or score" });
    }

    const event = latestEventRaw();
    const leaderDiscordId = "999000000000000020";
    const otherDiscordIds = [
      "999000000000000021",
      "999000000000000022",
      "999000000000000023",
      "999000000000000024",
      "999000000000000025",
      "999000000000000026",
    ];
    const allDiscordIds = [leaderDiscordId, ...otherDiscordIds];
    const leader = userByDiscordId(leaderDiscordId);
    const group = leader ? groupForUser(leader.id) : null;
    const attack = event ? activeAttack(event.id) : null;

    if (
      !event || event.status !== "live" ||
      !leader || !group ||
      !attack || attack.status !== "active" ||
      Number(attack.attacker_group_id) !== Number(group.id)
    ) {
      return res.status(409).json({
        error: "Prepare the contributor-cap preview test before lineup eligibility",
      });
    }

    if (mode === "prepare") {
      for (const discordId of otherDiscordIds) {
        if (!ensurePreviewGroupMember(discordId, group.id)) {
          return res.status(409).json({
            error: "Unable to add all seven test members to the same preview Group",
          });
        }
      }

      db.prepare(`
        INSERT INTO territory_event_registrations
          (event_id, group_id, registered_by_user_id, status)
        VALUES (?, ?, ?, 'registered')
        ON CONFLICT(event_id, group_id)
        DO UPDATE SET status = 'registered'
      `).run(event.id, group.id, leader.id);

      return res.json({
        ok: true,
        mode,
        eventId: Number(event.id),
        groupId: Number(group.id),
        leaderDiscordId,
        allDiscordIds,
        selectedDiscordIds: allDiscordIds.slice(0, 2),
        lineupBefore: eventLineup(event.id, group.id).length,
      });
    }

    const lineup = eventLineup(event.id, group.id);
    const active = activeLineup(event.id, group.id);
    if (lineup.length !== 2 || active.length !== 2) {
      return res.status(409).json({
        error: "Select exactly two already-active lineup fighters before the eligibility score test",
      });
    }

    const sevenUsers = allDiscordIds.map((discordId) => userByDiscordId(discordId));
    if (sevenUsers.some((user) => !user || Number(groupForUser(user.id)?.id) !== Number(group.id))) {
      return res.status(409).json({ error: "All seven preview players must be in the same Group" });
    }

    const contestStartedAt = new Date(Date.now() - 3 * 60 * 1000).toISOString();
    const lastTickAt = new Date(Date.now() - 60 * 1000).toISOString();
    const currentTime = nowIso();

    runTransaction(() => {
      db.prepare(`
        UPDATE territory_events
        SET control_score = 0, owner_control = 50, challenger_control = 50,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(event.id);

      db.prepare("DELETE FROM territory_preview_presence WHERE event_id = ?")
        .run(event.id);
      db.prepare("DELETE FROM territory_presence_grace WHERE event_id = ?")
        .run(event.id);

      try {
        db.prepare("DELETE FROM territory_kill_momentum WHERE event_id = ?")
          .run(event.id);
      } catch {}

      const insert = db.prepare(`
        INSERT INTO territory_preview_presence
          (event_id, user_id, side, in_battlefield, in_claim, updated_at)
        VALUES (?, ?, 'attacker', 1, 1, ?)
      `);
      for (const user of sevenUsers) {
        insert.run(event.id, user.id, currentTime);
      }

      db.prepare(`
        UPDATE territory_attacks
        SET contest_started_at = ?, last_tick_at = ?
        WHERE id = ?
      `).run(contestStartedAt, lastTickAt, attack.id);
    });

    addLog(
      event.id,
      "preview",
      "Preview lineup eligibility: 7 bodies in Claim Zone; only 2 selected and active",
      null
    );

    return res.json({
      ok: true,
      mode,
      eventId: Number(event.id),
      groupId: Number(group.id),
      lineupSize: lineup.length,
      eligibleAttackers: active.length,
      playersPresent: sevenUsers.length,
      controlBefore: 0,
      expectedControlAfterOneMinute: controlRatePerMinute({
        attackers: active.length,
        defenders: 0,
        momentumRate: 0,
      }).rate,
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview lineup eligibility test failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to prepare the preview lineup eligibility test",
    });
  }
});

router.post("/preview-contributor-cap", requireTerritoryInternalToken, (req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({
        error: "Territory Wars preview controls are disabled",
      });
    }

    const mode = String(req.body?.mode || "prepare").trim().toLowerCase();
    const leaderDiscordId = "999000000000000020";
    const memberDiscordIds = [
      "999000000000000021",
      "999000000000000022",
      "999000000000000023",
      "999000000000000024",
      "999000000000000025",
    ];

    const leader = ensurePreviewUser(leaderDiscordId);
    if (!leader) {
      return res.status(500).json({
        error: "Unable to create contributor-cap leader",
      });
    }

    let group = groupForUser(leader.id);
    if (!group) {
      const created = db.prepare(`
        INSERT INTO territory_groups (name, tag, leader_user_id)
        VALUES ('Preview Cap Group', 'PCAP', ?)
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

    const members = [leader];
    for (const discordId of memberDiscordIds) {
      const member = ensurePreviewGroupMember(discordId, group.id);
      if (!member) {
        return res.status(409).json({
          error: "Unable to create all six preview lineup members",
        });
      }
      members.push(member);
    }

    let event = latestEventRaw();
    if (!event) {
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
        VALUES (?, 'south-plains', 'South Plains', 'live', 'Admin', ?, 0, 50, 50, ?, ?)
      `).run(
        "South Plains Contributor Cap Test",
        group.name,
        new Date(Date.now() - (5 * 60 * 1000)).toISOString(),
        new Date(Date.now() + (5 * 60 * 60 * 1000)).toISOString()
      );
      event = eventById(Number(created.lastInsertRowid));
    }

    const activeFrom = new Date(Date.now() - 1000).toISOString();
    const now = nowIso();
    const startsAt = new Date(Date.now() - (5 * 60 * 1000)).toISOString();
    const endsAt = new Date(Date.now() + (5 * 60 * 60 * 1000)).toISOString();
    const contestStartedAt = new Date(Date.now() - (3 * 60 * 1000)).toISOString();
    const lastTickAt = new Date(Date.now() - (60 * 1000)).toISOString();

    let attack = activeAttack(event.id);

    if (mode === "prepare") {
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

        for (const member of members) {
          lineupInsert.run(
            event.id,
            group.id,
            member.id,
            leader.id,
            activeFrom
          );
        }

        db.prepare(
          "DELETE FROM territory_preview_presence WHERE event_id = ?"
        ).run(event.id);

        db.prepare(
          "DELETE FROM territory_presence_grace WHERE event_id = ?"
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

        attack = {
          id: Number(inserted.lastInsertRowid),
        };
      });

      addLog(
        event.id,
        "preview",
        "Preview contributor-cap test prepared with a six-fighter active lineup",
        null
      );

      return res.json({
        ok: true,
        mode: "prepare",
        eventId: Number(event.id),
        attackId: Number(attack.id),
        groupId: Number(group.id),
        lineupSize: members.length,
      });
    }

    attack = db.prepare(
      "SELECT * FROM territory_attacks WHERE event_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1"
    ).get(event.id);

    if (!attack) {
      return res.status(409).json({
        error: "Prepare the contributor-cap test first",
      });
    }

    const attackerCount = mode === "six" ? 6 : mode === "four" ? 4 : 0;
    if (!attackerCount) {
      return res.status(400).json({
        error: "Contributor-cap mode must be prepare, four, or six",
      });
    }

    runTransaction(() => {
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

      const presenceInsert = db.prepare(`
        INSERT INTO territory_preview_presence
          (event_id, user_id, side, in_battlefield, in_claim, updated_at)
        VALUES (?, ?, 'attacker', 1, 1, ?)
      `);

      for (const member of members.slice(0, attackerCount)) {
        presenceInsert.run(
          event.id,
          member.id,
          nowIso()
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

    return res.json({
      ok: true,
      mode,
      eventId: Number(event.id),
      attackId: Number(attack.id),
      lineupSize: members.length,
      attackersPresent: attackerCount,
      controlBefore: 0,
      expectedControlAfterOneMinute: 7,
      contributorCap: 4,
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview contributor-cap test failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to run the Territory contributor-cap test.",
    });
  }
});

router.post("/preview-group-takeover", requireTerritoryInternalToken, (_req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({
        error: "Territory Wars preview controls are disabled",
      });
    }

    const ensureNamedGroup = (name, tag, leaderDiscordId, memberDiscordId) => {
      let group = db.prepare(
        "SELECT id, name, tag, leader_user_id FROM territory_groups WHERE name = ? LIMIT 1"
      ).get(name) || null;

      if (!group) {
        const leader = ensurePreviewUser(leaderDiscordId);
        if (!leader) throw new Error(`Unable to create ${name} leader`);

        const existingLeaderGroup = groupForUser(leader.id);
        if (existingLeaderGroup) {
          group = db.prepare(
            "SELECT id, name, tag, leader_user_id FROM territory_groups WHERE id = ?"
          ).get(existingLeaderGroup.id);
        } else {
          const created = db.prepare(`
            INSERT INTO territory_groups (name, tag, leader_user_id)
            VALUES (?, ?, ?)
          `).run(name, tag, leader.id);

          const groupId = Number(created.lastInsertRowid);
          db.prepare(`
            INSERT INTO territory_group_members (group_id, user_id, role)
            VALUES (?, ?, 'leader')
          `).run(groupId, leader.id);
          db.prepare(
            "INSERT OR IGNORE INTO territory_group_stats (group_id) VALUES (?)"
          ).run(groupId);

          group = db.prepare(
            "SELECT id, name, tag, leader_user_id FROM territory_groups WHERE id = ?"
          ).get(groupId);
        }
      }

      const member = ensurePreviewGroupMember(memberDiscordId, group.id);
      if (!member) {
        throw new Error(`Unable to add a member to ${name}`);
      }

      const leader = db.prepare(`
        SELECT u.id, u.discord_id, u.steam_id, u.username
        FROM users u
        WHERE u.id = ?
      `).get(group.leader_user_id);

      return {
        group,
        leader,
        member,
      };
    };

    const defenderSide = ensureNamedGroup(
      "Preview Group 1",
      "P00001",
      "999000000000000010",
      "999000000000000011"
    );

    const attackerSide = ensureNamedGroup(
      "Preview Group 2",
      "P00002",
      "999000000000000012",
      "999000000000000013"
    );

    const defender = defenderSide.group;
    const attacker = attackerSide.group;

    let event = latestEventRaw();
    if (!event) {
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
        VALUES (?, 'south-plains', 'South Plains', 'live', ?, ?, 99, 1, 99, ?, ?)
      `).run(
        "South Plains Group Takeover Test",
        defender.name,
        attacker.name,
        new Date(Date.now() - (5 * 60 * 1000)).toISOString(),
        new Date(Date.now() + (5 * 60 * 60 * 1000)).toISOString()
      );
      event = eventById(Number(created.lastInsertRowid));
    }

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
            owner_name = ?,
            challenger_name = ?,
            control_score = 99,
            owner_control = 1,
            challenger_control = 99,
            protection_until = NULL,
            frozen_owner_name = NULL,
            starts_at = ?,
            ends_at = ?,
            updated_at = datetime('now')
        WHERE id = ?
      `).run(
        defender.name,
        attacker.name,
        startsAt,
        endsAt,
        event.id
      );

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
      `).run(
        event.id,
        attacker.id,
        attacker.leader_user_id,
      );

      db.prepare(`
        DELETE FROM territory_event_lineups
        WHERE event_id = ?
          AND group_id = ?
      `).run(event.id, attacker.id);

      const lineupInsert = db.prepare(`
        INSERT INTO territory_event_lineups
          (event_id, group_id, user_id, selected_by_user_id, active_from, selected_at)
        VALUES (?, ?, ?, ?, ?, datetime('now'))
      `);

      const activeFrom = new Date(Date.now() - 1000).toISOString();

      lineupInsert.run(
        event.id,
        attacker.id,
        attackerSide.leader.id,
        attackerSide.leader.id,
        activeFrom
      );
      lineupInsert.run(
        event.id,
        attacker.id,
        attackerSide.member.id,
        attackerSide.leader.id,
        activeFrom
      );

      db.prepare(
        "DELETE FROM territory_preview_presence WHERE event_id = ?"
      ).run(event.id);

      const presenceInsert = db.prepare(`
        INSERT INTO territory_preview_presence
          (event_id, user_id, side, in_battlefield, in_claim, updated_at)
        VALUES (?, ?, 'attacker', 1, 1, ?)
      `);

      presenceInsert.run(
        event.id,
        attackerSide.leader.id,
        now
      );
      presenceInsert.run(
        event.id,
        attackerSide.member.id,
        now
      );

      db.prepare(
        "DELETE FROM territory_presence_grace WHERE event_id = ?"
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
        VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
      `).run(
        event.id,
        attacker.id,
        defender.id,
        attackerSide.leader.id,
        startsAt,
        startsAt,
        contestStartedAt,
        lastTickAt
      );

      attackId = Number(inserted.lastInsertRowid);
    });

    const statsFor = (groupId) => db.prepare(`
      SELECT wins, losses, captures, kills, deaths, zone_seconds
      FROM territory_group_stats
      WHERE group_id = ?
    `).get(groupId) || {
      wins: 0,
      losses: 0,
      captures: 0,
      kills: 0,
      deaths: 0,
      zone_seconds: 0,
    };

    const attackerBefore = statsFor(attacker.id);
    const defenderBefore = statsFor(defender.id);

    addLog(
      event.id,
      "preview",
      "Preview Group-vs-Group takeover test primed at 99% challenger control",
      null
    );

    return res.json({
      ok: true,
      eventId: Number(event.id),
      attackId,
      ownerBefore: defender.name,
      challengerBefore: attacker.name,
      attackerGroupId: Number(attacker.id),
      defenderGroupId: Number(defender.id),
      attackerStatsBefore: attackerBefore,
      defenderStatsBefore: defenderBefore,
      controlBefore: 99,
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview Group takeover test failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to prepare the Territory Group takeover test.",
    });
  }
});

router.post("/preview-group-takeover-result", requireTerritoryInternalToken, (req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({
        error: "Territory Wars preview controls are disabled",
      });
    }

    const eventId = Number(req.body?.eventId || 0);
    const attackId = Number(req.body?.attackId || 0);
    const attackerGroupId = Number(req.body?.attackerGroupId || 0);
    const defenderGroupId = Number(req.body?.defenderGroupId || 0);

    if (!eventId || !attackId || !attackerGroupId || !defenderGroupId) {
      return res.status(400).json({
        error: "Valid takeover test IDs are required",
      });
    }

    const event = eventById(eventId);
    const attack = db.prepare(
      "SELECT * FROM territory_attacks WHERE id = ? AND event_id = ?"
    ).get(attackId, eventId) || null;

    const statsFor = (groupId) => db.prepare(`
      SELECT wins, losses, captures, kills, deaths, zone_seconds
      FROM territory_group_stats
      WHERE group_id = ?
    `).get(groupId) || {
      wins: 0,
      losses: 0,
      captures: 0,
      kills: 0,
      deaths: 0,
      zone_seconds: 0,
    };

    return res.json({
      ok: true,
      event: decorateEvent(event),
      attack: decorateAttack(attack),
      attackerStats: statsFor(attackerGroupId),
      defenderStats: statsFor(defenderGroupId),
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview Group takeover result failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to inspect the Territory Group takeover result.",
    });
  }
});

router.post("/preview-combat-eligibility", requireTerritoryInternalToken, (req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({ error: "Territory preview controls are disabled" });
    }

    const eventId = Number(req.body?.eventId || 0);
    const attackId = Number(req.body?.attackId || 0);

    if (!Number.isInteger(eventId) || eventId <= 0 || !Number.isInteger(attackId) || attackId <= 0) {
      return res.status(400).json({ error: "Valid event and attack IDs are required" });
    }

    const event = eventById(eventId);
    const attack = db.prepare(
      "SELECT * FROM territory_attacks WHERE id = ? AND event_id = ?"
    ).get(attackId, eventId);

    if (!event || event.status !== "live" || !attack || attack.status !== "active") {
      return res.status(409).json({ error: "A live preview event with an active attack is required" });
    }

    const attackerGroup = db.prepare(
      "SELECT id, leader_user_id FROM territory_groups WHERE id = ?"
    ).get(Number(attack.attacker_group_id));

    if (!attackerGroup) {
      return res.status(409).json({ error: "Preview attacker Group was not found" });
    }

    const activeAttackers = activeLineup(eventId, attackerGroup.id);
    if (activeAttackers.length < 2) {
      return res.status(409).json({ error: "At least two active attackers are required" });
    }

    const unselectedDiscordId = "999000000000000009";
    const unselected = ensurePreviewGroupMember(unselectedDiscordId, attackerGroup.id);
    if (!unselected) {
      return res.status(409).json({ error: "Unable to create the unselected preview fighter" });
    }

    db.prepare(
      "DELETE FROM territory_event_lineups WHERE event_id = ? AND group_id = ? AND user_id = ?"
    ).run(eventId, attackerGroup.id, unselected.id);

    const defenders = db.prepare(`
      SELECT id, steam_id, username
      FROM users
      WHERE is_admin = 1
        AND steam_id IS NOT NULL
        AND id NOT IN (
          SELECT user_id
          FROM territory_event_lineups
          WHERE event_id = ? AND group_id = ?
        )
      ORDER BY id ASC
      LIMIT 3
    `).all(eventId, attackerGroup.id);

    if (defenders.length < 2) {
      return res.status(409).json({
        error: "Preview combat eligibility test needs at least two system defenders",
      });
    }

    const inside = { x: -302000, y: 250000, z: 0 };
    const outside = { x: 9999999, y: 9999999, z: 0 };
    const occurredAt = nowIso();

    const nonLineupKill = territoryCombatSync._test.processCombatEvent(
      {
        id: `preview-combat-eligibility-${eventId}-${attackId}-nonlineup`,
        occurredAt,
        killerSteamId: String(unselected.steam_id),
        victimSteamId: String(defenders[0].steam_id),
        killerName: unselected.username,
        victimName: defenders[0].username,
        killerLocation: inside,
        victimLocation: inside,
        presenceSampledAt: occurredAt,
      },
      event
    );

    const selected = activeAttackers[1];
    const outsideKill = territoryCombatSync._test.processCombatEvent(
      {
        id: `preview-combat-eligibility-${eventId}-${attackId}-outside`,
        occurredAt,
        killerSteamId: String(selected.steam_id),
        victimSteamId: String(defenders[1].steam_id),
        killerName: selected.username,
        victimName: defenders[1].username,
        killerLocation: outside,
        victimLocation: outside,
        presenceSampledAt: occurredAt,
      },
      event
    );

    addLog(
      eventId,
      "preview",
      "Preview combat eligibility verified non-lineup and outside-Battlefield kills are ignored",
      null
    );

    return res.json({
      ok: true,
      eventId,
      attackId,
      nonLineup: nonLineupKill,
      outsideBattlefield: outsideKill,
      expectedNonLineupReason: "fighter-not-active-lineup",
      expectedOutsideReason: "outside-or-unverified-battlefield",
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview combat eligibility test failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to run the Territory combat eligibility test",
    });
  }
});

router.post("/preview-combat-integrity", requireTerritoryInternalToken, (req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({ error: "Territory preview controls are disabled" });
    }

    const eventId = Number(req.body?.eventId || 0);
    const attackId = Number(req.body?.attackId || 0);

    if (!Number.isInteger(eventId) || eventId <= 0 || !Number.isInteger(attackId) || attackId <= 0) {
      return res.status(400).json({ error: "Valid event and attack IDs are required" });
    }

    const event = eventById(eventId);
    const attack = db.prepare(
      "SELECT * FROM territory_attacks WHERE id = ? AND event_id = ?"
    ).get(attackId, eventId);

    if (!event || event.status !== "live" || !attack || attack.status !== "active") {
      return res.status(409).json({
        error: "A live Territory preview event with an active attack is required",
      });
    }

    const attackers = activeLineup(eventId, attack.attacker_group_id);
    if (attackers.length < 2) {
      return res.status(409).json({
        error: "Combat integrity test needs at least two active attackers",
      });
    }

    const inside = { x: -302000, y: 250000, z: 0 };
    const occurredAt = nowIso();
    const momentumBefore = territoryMomentum.recentMomentum(
      eventId,
      attackId,
      Date.now()
    );

    const natural = territoryCombatSync._test.processCombatEvent(
      {
        id: `preview-combat-integrity-${eventId}-${attackId}-natural`,
        occurredAt,
        killerSteamId: "",
        victimSteamId: String(attackers[0].steam_id),
        victimName: attackers[0].username,
        killerLocation: inside,
        victimLocation: inside,
        presenceSampledAt: occurredAt,
      },
      event
    );

    const selfKill = territoryCombatSync._test.processCombatEvent(
      {
        id: `preview-combat-integrity-${eventId}-${attackId}-self`,
        occurredAt,
        killerSteamId: String(attackers[0].steam_id),
        victimSteamId: String(attackers[0].steam_id),
        killerName: attackers[0].username,
        victimName: attackers[0].username,
        killerLocation: inside,
        victimLocation: inside,
        presenceSampledAt: occurredAt,
      },
      event
    );

    const sameSide = territoryCombatSync._test.processCombatEvent(
      {
        id: `preview-combat-integrity-${eventId}-${attackId}-friendly`,
        occurredAt,
        killerSteamId: String(attackers[0].steam_id),
        victimSteamId: String(attackers[1].steam_id),
        killerName: attackers[0].username,
        victimName: attackers[1].username,
        killerLocation: inside,
        victimLocation: inside,
        presenceSampledAt: occurredAt,
      },
      event
    );

    const momentumAfter = territoryMomentum.recentMomentum(
      eventId,
      attackId,
      Date.now()
    );

    addLog(
      eventId,
      "preview",
      "Preview combat integrity verified natural, self, and same-side kills are ignored",
      null
    );

    return res.json({
      ok: true,
      natural,
      selfKill,
      sameSide,
      momentumBefore,
      momentumAfter,
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview combat integrity test failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to run the Territory combat integrity test",
    });
  }
});

router.post("/preview-combat-timing", requireTerritoryInternalToken, (req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({ error: "Territory preview controls are disabled" });
    }

    const eventId = Number(req.body?.eventId || 0);
    const attackId = Number(req.body?.attackId || 0);

    if (!Number.isInteger(eventId) || eventId <= 0 || !Number.isInteger(attackId) || attackId <= 0) {
      return res.status(400).json({ error: "Valid event and attack IDs are required" });
    }

    const event = eventById(eventId);
    const attack = db.prepare(
      "SELECT * FROM territory_attacks WHERE id = ? AND event_id = ?"
    ).get(attackId, eventId);

    if (!event || event.status !== "live" || !attack || attack.status !== "active") {
      return res.status(409).json({
        error: "A live Territory preview event with an active attack is required",
      });
    }

    const attackers = activeLineup(eventId, attack.attacker_group_id);
    const defenders = db.prepare(`
      SELECT id, steam_id, username
      FROM users
      WHERE is_admin = 1
        AND steam_id IS NOT NULL
      ORDER BY id ASC
      LIMIT 1
    `).all();

    if (attackers.length < 1 || defenders.length < 1) {
      return res.status(409).json({
        error: "Combat timing test needs an active attacker and a system defender",
      });
    }

    const attacker = attackers[0];
    const defender = defenders[0];
    const inside = { x: -302000, y: 250000, z: 0 };

    const eventStart = parseDate(event.starts_at);
    const eventEnd = parseDate(event.ends_at);
    const earliestAttackStartRaw = db.prepare(`
      SELECT MIN(starts_at) AS starts_at
      FROM territory_attacks
      WHERE event_id = ?
        AND starts_at IS NOT NULL
    `).get(eventId)?.starts_at || attack.starts_at;
    const earliestAttackStart = parseDate(earliestAttackStartRaw);

    if (!eventStart || !eventEnd || !earliestAttackStart) {
      return res.status(409).json({
        error: "Preview event or attack timestamps are invalid",
      });
    }

    const beforeEventAt = new Date(eventStart.getTime() - 1000).toISOString();
    const afterEventAt = new Date(eventEnd.getTime() + 1000).toISOString();

    // Pick a timestamp before the earliest attack ever recorded for this event.
    // Widen only the in-memory event window so the production verifier reaches
    // the no-active-attack check without mutating the actual event or attacks.
    const noAttackAt = new Date(
      earliestAttackStart.getTime() - 60 * 1000
    ).toISOString();
    const timingEvent = {
      ...event,
      starts_at: new Date(
        earliestAttackStart.getTime() - 5 * 60 * 1000
      ).toISOString(),
      ends_at: event.ends_at,
    };

    const momentumBefore = territoryMomentum.recentMomentum(
      eventId,
      attackId,
      Date.now()
    );

    const base = {
      killerSteamId: String(attacker.steam_id),
      victimSteamId: String(defender.steam_id),
      killerName: attacker.username,
      victimName: defender.username,
      killerLocation: inside,
      victimLocation: inside,
    };

    const beforeEvent = territoryCombatSync._test.processCombatEvent(
      {
        ...base,
        id: `preview-combat-timing-${eventId}-${attackId}-before`,
        occurredAt: beforeEventAt,
        presenceSampledAt: beforeEventAt,
      },
      event
    );

    const afterEvent = territoryCombatSync._test.processCombatEvent(
      {
        ...base,
        id: `preview-combat-timing-${eventId}-${attackId}-after`,
        occurredAt: afterEventAt,
        presenceSampledAt: afterEventAt,
      },
      event
    );

    const noActiveAttack = territoryCombatSync._test.processCombatEvent(
      {
        ...base,
        id: `preview-combat-timing-${eventId}-${attackId}-no-attack`,
        occurredAt: noAttackAt,
        presenceSampledAt: noAttackAt,
      },
      timingEvent
    );

    const momentumAfter = territoryMomentum.recentMomentum(
      eventId,
      attackId,
      Date.now()
    );

    addLog(
      eventId,
      "preview",
      "Preview combat timing verified before-event, after-event, and no-active-attack kills are ignored",
      null
    );

    return res.json({
      ok: true,
      beforeEvent,
      afterEvent,
      noActiveAttack,
      momentumBefore,
      momentumAfter,
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview combat timing test failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to run the Territory combat timing test",
    });
  }
});

router.post("/preview-expire-kill-momentum", requireTerritoryInternalToken, (req, res) => {
  try {
    if (!previewSeedEnabled()) {
      return res.status(403).json({
        error: "Territory Wars preview controls are disabled",
      });
    }

    const eventId = Number(req.body?.eventId || 0);
    const attackId = Number(req.body?.attackId || 0);

    if (!Number.isInteger(eventId) || eventId <= 0 || !Number.isInteger(attackId) || attackId <= 0) {
      return res.status(400).json({
        error: "Valid event and attack IDs are required",
      });
    }

    const event = eventById(eventId);
    const attack = db.prepare(
      "SELECT * FROM territory_attacks WHERE id = ? AND event_id = ?"
    ).get(attackId, eventId);

    if (!event || !attack) {
      return res.status(404).json({
        error: "Preview Territory event or attack was not found",
      });
    }

    const expiredAt = new Date(
      Date.now() - (territoryMomentum.KILL_MOMENTUM_WINDOW_MS + 1000)
    ).toISOString();
    const contestStartedAt = new Date(Date.now() - (3 * 60 * 1000)).toISOString();
    const lastTickAt = new Date(Date.now() - (60 * 1000)).toISOString();

    runTransaction(() => {
      db.prepare(`
        UPDATE territory_kill_momentum
        SET occurred_at = ?
        WHERE event_id = ?
          AND attack_id = ?
      `).run(expiredAt, eventId, attackId);

      db.prepare(`
        UPDATE territory_events
        SET control_score = 0,
            owner_control = 50,
            challenger_control = 50,
            status = 'live',
            updated_at = datetime('now')
        WHERE id = ?
      `).run(eventId);

      db.prepare(`
        UPDATE territory_attacks
        SET status = 'active',
            contest_started_at = ?,
            last_tick_at = ?
        WHERE id = ?
      `).run(
        contestStartedAt,
        lastTickAt,
        attackId
      );
    });

    const momentum = territoryMomentum.recentMomentum(
      eventId,
      attackId,
      Date.now()
    );

    addLog(
      eventId,
      "kill",
      "Preview kill-momentum test expired the 60-second momentum window",
      null
    );

    return res.json({
      ok: true,
      eventId,
      attackId,
      expiredAt,
      momentum,
      controlBefore: 0,
      expectedControlAfterOneMinute: 0,
    });
  } catch (error) {
    console.error("[TerritoryWars] Preview kill momentum expiry failed:", error);
    return res.status(500).json({
      error: error?.message || "Unable to expire preview Territory kill momentum.",
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
