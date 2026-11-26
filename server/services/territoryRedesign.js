const { db } = require("../db");
const groups = require("../groupsStore");
const serverStatus = require("./serverStatus");
const { fromRconLocation } = require("../evrimaMap");
const { classifyWorldPosition } = require("./territoryGeometry");
const { advanceControlScore, normalizeControlScore } = require("./territoryControl");
const zones = require("./territoryZones");
const warWindow = require("./territoryWindow");
const automation = require("./automationWebsiteClient");

const LINEUP_CAP = 6;
const LIVE_SUB_DELAY_MS = 10 * 60 * 1000;
const ATTACK_WARNING_MS = 5 * 60 * 1000;
const CONTEST_ARM_MS = 2 * 60 * 1000;
const MIN_ATTACKERS_TO_CONTEST = 2;
const REPEAT_KILL_COOLDOWN_MS = 10 * 60 * 1000;
const SEASON_MS = 28 * 24 * 60 * 60 * 1000;
const REWARD_CATCHUP_HOURS = 48;

function enabled(env = process.env) {
  return env.TERRITORY_WARS_REDESIGN_ENABLED === "1";
}

function rewardsEnabled(env = process.env) {
  return env.TERRITORY_WARS_HOLDER_REWARDS_ENABLED === "1";
}

function seasonsEnabled(env = process.env) {
  return env.TERRITORY_WARS_SEASONS_ENABLED === "1";
}

function coinsPerHour(env = process.env) {
  const value = Number(env.TERRITORY_WARS_HOLDER_COINS_PER_HOUR ?? 25);
  return Number.isSafeInteger(value) ? Math.max(0, Math.min(500, value)) : 25;
}

// TERRITORY_WARS_PROTECTION_MINUTES sits with the other Territory Wars tuning
// vars (TERRITORY_WARS_REDESIGN_ENABLED, TERRITORY_WARS_HOLDER_REWARDS_ENABLED,
// TERRITORY_WARS_SEASONS_ENABLED, TERRITORY_WARS_HOLDER_COINS_PER_HOUR, and the
// TERRITORY_WARS_WINDOW_* clock). Unset defaults to 30 minutes of protection
// after a capture or successful defence, then the zone can be challenged again
// inside the same window. 0 keeps the previous lock until the next window.
function protectionMinutes(env = process.env) {
  const raw = env.TERRITORY_WARS_PROTECTION_MINUTES;
  if (raw === undefined || String(raw).trim() === "") return 30;
  const value = Number(String(raw).trim());
  if (!Number.isInteger(value) || value < 0) return 30;
  return value;
}

function protectionDeadline(nowMs, env = process.env) {
  const minutes = protectionMinutes(env);
  if (minutes === 0) return warWindow.nextWindowStart(nowMs, env).toISOString();
  return new Date(nowMs + minutes * 60 * 1000).toISOString();
}

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS territory_holdings (
      territory_key TEXT PRIMARY KEY,
      owner_hv_group_id INTEGER,
      control_score REAL NOT NULL DEFAULT -100,
      protection_until TEXT,
      held_since TEXT,
      rewarded_until TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS territory_holding_attacks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      territory_key TEXT NOT NULL,
      attacker_hv_group_id INTEGER NOT NULL,
      defender_hv_group_id INTEGER,
      declared_by_steam_id TEXT NOT NULL,
      declared_at TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      contest_started_at TEXT,
      last_tick_at TEXT,
      status TEXT NOT NULL,
      outcome TEXT,
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_territory_holding_attacks_open
      ON territory_holding_attacks(territory_key, status, id DESC);
    CREATE TABLE IF NOT EXISTS territory_holding_lineups (
      territory_key TEXT NOT NULL,
      hv_group_id INTEGER NOT NULL,
      steam_id TEXT NOT NULL,
      active_from TEXT NOT NULL,
      selected_by_steam_id TEXT NOT NULL,
      PRIMARY KEY (territory_key, hv_group_id, steam_id)
    );
    CREATE TABLE IF NOT EXISTS territory_holding_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      territory_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      fed INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS territory_holding_kills (
      combat_event_id TEXT NOT NULL,
      territory_key TEXT NOT NULL,
      attack_id INTEGER NOT NULL,
      killer_steam_id TEXT NOT NULL,
      victim_steam_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      counted INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,
      PRIMARY KEY (combat_event_id, territory_key)
    );
    CREATE TABLE IF NOT EXISTS territory_holding_momentum (
      combat_event_id TEXT NOT NULL,
      territory_key TEXT NOT NULL,
      attack_id INTEGER NOT NULL,
      side TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      PRIMARY KEY (combat_event_id, territory_key)
    );
    CREATE TABLE IF NOT EXISTS territory_season_clock (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      season_index INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      ends_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS territory_season_hold (
      season_index INTEGER NOT NULL,
      territory_key TEXT NOT NULL,
      hv_group_id INTEGER NOT NULL,
      held_seconds INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (season_index, territory_key, hv_group_id)
    );
    CREATE TABLE IF NOT EXISTS territory_season_archives (
      season_index INTEGER PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      legacy_status TEXT NOT NULL DEFAULT 'local'
    );
    CREATE TABLE IF NOT EXISTS territory_holder_reward_outbox (
      idempotency_key TEXT PRIMARY KEY,
      steam_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS territory_redesign_runtime (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      open_window_key TEXT,
      last_tick_at TEXT
    );
  `);
  db.prepare("INSERT OR IGNORE INTO territory_redesign_runtime (id) VALUES (1)").run();
  for (const zone of zones.catalog()) {
    db.prepare("INSERT OR IGNORE INTO territory_holdings (territory_key) VALUES (?)").run(zone.key);
  }
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function parseDate(value) {
  const date = new Date(value || "");
  return Number.isFinite(date.getTime()) ? date : null;
}

function fail(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function percents(scoreValue) {
  const score = Math.max(-100, Math.min(100, Number(scoreValue) || 0));
  return {
    owner: Math.round((100 - score) / 2),
    challenger: Math.round((100 + score) / 2),
  };
}

function groupById(id) {
  const groupId = Number(id);
  if (!Number.isInteger(groupId) || groupId < 1) return null;
  const row = db.prepare(`
    SELECT id, name, tag, owner_steam_id AS ownerSteamId, status
    FROM hv_groups WHERE id = ? AND status = 'active'
  `).get(groupId);
  if (!row) return null;
  return { ...row, members: groupsMembers(groupId) };
}

function groupsMembers(groupId) {
  return db.prepare(`
    SELECT m.steam_id AS steamId, m.role, COALESCE(u.username, 'Steam player') AS username, u.discord_id AS discordId
    FROM hv_group_members m
    LEFT JOIN users u ON u.steam_id = m.steam_id
    WHERE m.group_id = ?
    ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END, m.joined_at
  `).all(Number(groupId));
}

function groupForSteam(steamId) {
  if (!/^\d{17}$/.test(String(steamId || ""))) return null;
  const row = db.prepare(`
    SELECT g.id
    FROM hv_group_members m
    JOIN hv_groups g ON g.id = m.group_id
    WHERE m.steam_id = ? AND g.status = 'active'
  `).get(String(steamId));
  return row ? groupById(row.id) : null;
}

function holding(key) {
  ensureSchema();
  return db.prepare("SELECT * FROM territory_holdings WHERE territory_key = ?").get(String(key)) || null;
}

function activeAttack(key) {
  return db.prepare(`
    SELECT * FROM territory_holding_attacks
    WHERE territory_key = ? AND status IN ('warning', 'active')
    ORDER BY id DESC LIMIT 1
  `).get(String(key)) || null;
}

function outgoingAttack(groupId) {
  return db.prepare(`
    SELECT * FROM territory_holding_attacks
    WHERE attacker_hv_group_id = ? AND status IN ('warning', 'active')
    ORDER BY id DESC LIMIT 1
  `).get(Number(groupId)) || null;
}

function addLog(key, kind, message) {
  db.prepare(`
    INSERT INTO territory_holding_log (territory_key, kind, message) VALUES (?, ?, ?)
  `).run(String(key), String(kind), String(message).slice(0, 400));
}

function lineupRows(key, groupId, atMs) {
  return db.prepare(`
    SELECT steam_id AS steamId, active_from AS activeFrom
    FROM territory_holding_lineups
    WHERE territory_key = ? AND hv_group_id = ?
  `).all(String(key), Number(groupId)).filter((row) => {
    const from = parseDate(row.activeFrom);
    return from && from.getTime() <= atMs && /^\d{17}$/.test(row.steamId);
  });
}

function characters() {
  const state = serverStatus.getState?.() || {};
  const rows = Array.isArray(state.characters) ? state.characters : [];
  return {
    online: Boolean(state.online),
    configured: state.configured !== false,
    rows,
  };
}

function positionOf(character) {
  const location = character?.location || character?.Location || null;
  if (!location) return null;
  const mapped = fromRconLocation({
    x: Number(location.x),
    y: Number(location.y),
    z: Number(location.z),
  });
  if (!Number.isFinite(mapped.x) || !Number.isFinite(mapped.y)) return null;
  return mapped;
}

function presence(zone, attack, nowMs) {
  const live = characters();
  const geometry = zone.geometry;
  const attackerIds = new Set((attack ? lineupRows(zone.key, attack.attacker_hv_group_id, nowMs) : []).map((row) => row.steamId));
  const defenderIds = new Set((attack?.defender_hv_group_id ? lineupRows(zone.key, attack.defender_hv_group_id, nowMs) : []).map((row) => row.steamId));
  let attackers = 0;
  let defenders = 0;
  const byGroup = new Map();
  for (const character of live.rows) {
    const steamId = String(character.steamId || character.steam_id || "");
    const mapped = positionOf(character);
    if (!mapped) continue;
    const zoneHit = classifyWorldPosition(mapped.x, mapped.y, geometry);
    if (!zoneHit.inClaim) continue;
    if (attackerIds.has(steamId)) attackers += 1;
    else if (defenderIds.has(steamId)) defenders += 1;
    const membership = db.prepare(`
      SELECT g.id AS groupId
      FROM hv_group_members m JOIN hv_groups g ON g.id = m.group_id
      WHERE m.steam_id = ? AND g.status = 'active'
    `).get(steamId);
    if (!membership) continue;
    const active = lineupRows(zone.key, membership.groupId, nowMs).some((row) => row.steamId === steamId);
    if (!active) continue;
    byGroup.set(membership.groupId, (byGroup.get(membership.groupId) || 0) + 1);
  }
  return { online: live.online, attackers, defenders, byGroup, usable: live.online || live.rows.length > 0 };
}

function setLineup(steamId, territoryKey, steamIds) {
  ensureSchema();
  const zone = zones.byKey(territoryKey);
  if (!zone) throw fail("Unknown territory.");
  const group = groupForSteam(steamId);
  if (!group || group.ownerSteamId !== steamId) throw fail("Only the group owner can set the lineup.", 403);
  const requested = [...new Set((Array.isArray(steamIds) ? steamIds : []).map((id) => String(id || "").trim()))];
  if (requested.length > LINEUP_CAP) throw fail(`A lineup can include at most ${LINEUP_CAP} fighters.`);
  const members = new Set(group.members.map((member) => member.steamId));
  if (requested.some((id) => !members.has(id))) throw fail("Every fighter must be a current member of your group.");
  const attack = activeAttack(zone.key);
  const windowOpen = warWindow.isOpen(Date.now());
  const contestLive = Boolean(attack && attack.status === "active" && windowOpen);
  const nowMs = Date.now();
  const existing = new Map(db.prepare(`
    SELECT steam_id AS steamId, active_from AS activeFrom
    FROM territory_holding_lineups WHERE territory_key = ? AND hv_group_id = ?
  `).all(zone.key, group.id).map((row) => [row.steamId, row.activeFrom]));
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM territory_holding_lineups WHERE territory_key = ? AND hv_group_id = ?").run(zone.key, group.id);
    for (const id of requested) {
      const kept = existing.get(id);
      const activeFrom = kept || iso(contestLive ? nowMs + LIVE_SUB_DELAY_MS : nowMs);
      db.prepare(`
        INSERT INTO territory_holding_lineups
          (territory_key, hv_group_id, steam_id, active_from, selected_by_steam_id)
        VALUES (?, ?, ?, ?, ?)
      `).run(zone.key, group.id, id, activeFrom, steamId);
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
  return playerState({ steam_id: steamId });
}

function declareAttack(steamId, territoryKey, nowMs = Date.now()) {
  ensureSchema();
  const zone = zones.byKey(territoryKey);
  if (!zone) throw fail("Unknown territory.");
  const group = groupForSteam(steamId);
  if (!group || group.ownerSteamId !== steamId) throw fail("Only the group owner can declare a challenge.", 403);
  if (!/^[A-Z0-9]{2,6}$/.test(String(group.tag || ""))) {
    throw fail("Set a 2 to 6 character group tag on your website Group before challenging.");
  }
  const row = holding(zone.key);
  if (row.owner_hv_group_id && Number(row.owner_hv_group_id) === group.id) {
    throw fail("Your group already holds this territory.");
  }
  const protection = parseDate(row.protection_until);
  if (protection && protection.getTime() > nowMs) {
    throw fail(`This territory is protected until ${protection.toISOString()}.`);
  }
  if (activeAttack(zone.key)) throw fail("This territory already has a challenge in progress.");
  if (outgoingAttack(group.id)) throw fail("Your group already has a challenge in progress.");
  const fighters = lineupRows(zone.key, group.id, nowMs + LIVE_SUB_DELAY_MS);
  if (fighters.length < MIN_ATTACKERS_TO_CONTEST) {
    throw fail("Choose at least two lineup fighters before declaring. New live substitutions wait 10 minutes.");
  }
  const starts = iso(nowMs + ATTACK_WARNING_MS);
  const attackId = Number(db.prepare(`
    INSERT INTO territory_holding_attacks
      (territory_key, attacker_hv_group_id, defender_hv_group_id, declared_by_steam_id, declared_at, starts_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 'warning')
  `).run(
    zone.key,
    group.id,
    row.owner_hv_group_id || null,
    steamId,
    iso(nowMs),
    starts
  ).lastInsertRowid);
  db.prepare("UPDATE territory_holdings SET control_score = -100, updated_at = datetime('now') WHERE territory_key = ?").run(zone.key);
  const owner = row.owner_hv_group_id ? groupById(row.owner_hv_group_id) : null;
  addLog(zone.key, "attack", `${tagName(group)} declared on ${zone.name}. Five-minute warning started.`);
  const attack = db.prepare("SELECT * FROM territory_holding_attacks WHERE id = ?").get(attackId);
  return attackPayload(zone, group, owner, attack);
}

function tagName(group) {
  if (!group) return "Unclaimed";
  return group.tag ? `[${group.tag}] ${group.name}` : group.name;
}

function attackPayload(zone, group, owner, attack) {
  return {
    ok: true,
    warningMinutes: ATTACK_WARNING_MS / 60000,
    group: group ? { id: group.id, name: group.name, tag: group.tag || null, role: "owner" } : null,
    event: {
      territory_name: zone.name,
      territory_key: zone.key,
      owner_name: owner ? owner.name : "Unclaimed",
    },
    attack: attack ? { status: attack.status, starts_at: attack.starts_at, attacker_name: group?.name || null } : null,
  };
}

function userByDiscord(discordId) {
  const id = String(discordId || "").trim();
  if (!/^\d{15,22}$/.test(id)) return null;
  return db.prepare("SELECT id, username, steam_id, discord_id FROM users WHERE discord_id = ?").get(id) || null;
}

function declareForDiscord(discordId, territoryKey) {
  const user = userByDiscord(discordId);
  if (!user?.steam_id) throw fail("Link Discord to your Hollow Valley Steam account before declaring.", 403);
  if (territoryKey) return declareAttack(user.steam_id, territoryKey);
  const group = groupForSteam(user.steam_id);
  const nowMs = Date.now();
  const choice = zones.catalog().find((zone) => {
    const row = holding(zone.key);
    if (group && row?.owner_hv_group_id && Number(row.owner_hv_group_id) === group.id) return false;
    if (activeAttack(zone.key)) return false;
    const protection = parseDate(row?.protection_until);
    return !(protection && protection.getTime() > nowMs);
  });
  if (!choice) throw fail("No territory is open to challenge.");
  return declareAttack(user.steam_id, choice.key);
}

function closeAttack(attack, outcome, nowMs) {
  db.prepare(`
    UPDATE territory_holding_attacks
    SET status = 'resolved', outcome = ?, resolved_at = ?
    WHERE id = ? AND status IN ('warning', 'active')
  `).run(outcome, iso(nowMs), attack.id);
}

function capture(zone, attack, nowMs) {
  const attacker = groupById(attack.attacker_hv_group_id);
  const protection = protectionDeadline(nowMs);
  db.prepare(`
    UPDATE territory_holdings
    SET owner_hv_group_id = ?, control_score = -100, protection_until = ?, held_since = ?, rewarded_until = ?, updated_at = datetime('now')
    WHERE territory_key = ?
  `).run(attack.attacker_hv_group_id, protection, iso(nowMs), iso(nowMs), zone.key);
  closeAttack(attack, "capture", nowMs);
  addLog(zone.key, "capture", `${tagName(attacker)} captured ${zone.name}. Protected until ${protection}.`);
}

function defend(zone, attack, nowMs, reason) {
  const owner = attack.defender_hv_group_id ? groupById(attack.defender_hv_group_id) : null;
  closeAttack(attack, owner ? "defence" : "expired", nowMs);
  if (owner) {
    const protection = protectionDeadline(nowMs);
    db.prepare(`
      UPDATE territory_holdings
      SET control_score = -100, protection_until = ?, updated_at = datetime('now')
      WHERE territory_key = ?
    `).run(protection, zone.key);
    addLog(zone.key, "defence", `${tagName(owner)} defended ${zone.name}. Protected until ${protection}. ${reason}`);
    return;
  }
  db.prepare("UPDATE territory_holdings SET control_score = -100, updated_at = datetime('now') WHERE territory_key = ?").run(zone.key);
  addLog(zone.key, "status", `${zone.name} was not captured. ${reason}`);
}

function maybeAutoClaim(zone, row, nowMs) {
  if (row.owner_hv_group_id || activeAttack(zone.key)) return;
  const seen = presence(zone, null, nowMs);
  const ready = [...seen.byGroup.entries()].filter(([, count]) => count >= MIN_ATTACKERS_TO_CONTEST);
  if (ready.length !== 1) return;
  const [groupId] = ready[0];
  const group = groupById(groupId);
  if (!group || !/^[A-Z0-9]{2,6}$/.test(String(group.tag || ""))) return;
  db.prepare(`
    INSERT INTO territory_holding_attacks
      (territory_key, attacker_hv_group_id, defender_hv_group_id, declared_by_steam_id, declared_at, starts_at, status)
    VALUES (?, ?, NULL, ?, ?, ?, 'active')
  `).run(zone.key, group.id, group.ownerSteamId, iso(nowMs), iso(nowMs));
  addLog(zone.key, "contest", `${tagName(group)} started a claim on unowned ${zone.name}.`);
}

function momentumRate(key, attackId, nowMs) {
  const since = iso(nowMs - 60 * 1000);
  const rows = db.prepare(`
    SELECT side, COUNT(*) AS n FROM territory_holding_momentum
    WHERE territory_key = ? AND attack_id = ? AND datetime(occurred_at) >= datetime(?) AND datetime(occurred_at) <= datetime(?)
    GROUP BY side
  `).all(String(key), Number(attackId), since, iso(nowMs));
  const counts = Object.fromEntries(rows.map((row) => [row.side, Number(row.n) || 0]));
  const net = (counts.attacker || 0) - (counts.defender || 0);
  return Math.max(-2, Math.min(2, net));
}

function tickHolding(zone, nowMs, windowOpen) {
  let row = holding(zone.key);
  let attack = activeAttack(zone.key);
  if (attack && attack.status === "warning") {
    const starts = parseDate(attack.starts_at);
    if (starts && nowMs >= starts.getTime()) {
      db.prepare("UPDATE territory_holding_attacks SET status = 'active' WHERE id = ?").run(attack.id);
      addLog(zone.key, "attack", `${tagName(groupById(attack.attacker_hv_group_id))} attack on ${zone.name} is now active.`);
      attack = activeAttack(zone.key);
    }
  }
  if (!windowOpen) return;
  const protection = parseDate(row.protection_until);
  if (protection && protection.getTime() > nowMs) return;
  if (!attack) {
    maybeAutoClaim(zone, row, nowMs);
    return;
  }
  if (attack.status !== "active") return;
  const seen = presence(zone, attack, nowMs);
  if (!seen.usable) return;
  if (seen.attackers < MIN_ATTACKERS_TO_CONTEST) {
    if (attack.contest_started_at) {
      db.prepare("UPDATE territory_holding_attacks SET contest_started_at = NULL, last_tick_at = ? WHERE id = ?").run(iso(nowMs), attack.id);
    }
    return;
  }
  if (!attack.contest_started_at) {
    db.prepare("UPDATE territory_holding_attacks SET contest_started_at = ?, last_tick_at = ? WHERE id = ?").run(iso(nowMs), iso(nowMs), attack.id);
    addLog(zone.key, "contest", `${seen.attackers} eligible attackers entered the ${zone.name} claim zone. Two-minute contest timer started.`);
    return;
  }
  const armed = parseDate(attack.contest_started_at);
  if (!armed || nowMs - armed.getTime() < CONTEST_ARM_MS) return;
  const last = parseDate(attack.last_tick_at) || new Date(nowMs);
  const elapsedSeconds = Math.max(0, Math.min(60, (nowMs - last.getTime()) / 1000));
  if (elapsedSeconds < 5) return;
  const step = advanceControlScore({
    score: normalizeControlScore(row.control_score, -100),
    attackers: seen.attackers,
    defenders: seen.defenders,
    elapsedSeconds,
    momentumRate: momentumRate(zone.key, attack.id, nowMs),
  });
  db.prepare(`
    UPDATE territory_holdings SET control_score = ?, updated_at = datetime('now') WHERE territory_key = ?
  `).run(step.score, zone.key);
  db.prepare("UPDATE territory_holding_attacks SET last_tick_at = ? WHERE id = ?").run(iso(nowMs), attack.id);
  if (step.score >= 100) capture(zone, attack, nowMs);
}

function accrueSeason(zone, row, nowMs, elapsedSeconds) {
  if (!seasonsEnabled() || !row.owner_hv_group_id || elapsedSeconds <= 0) return;
  const clock = ensureSeason(nowMs);
  db.prepare(`
    INSERT INTO territory_season_hold (season_index, territory_key, hv_group_id, held_seconds)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(season_index, territory_key, hv_group_id)
    DO UPDATE SET held_seconds = held_seconds + excluded.held_seconds
  `).run(clock.season_index, zone.key, row.owner_hv_group_id, Math.round(elapsedSeconds));
}

function ensureSeason(nowMs) {
  let clock = db.prepare("SELECT * FROM territory_season_clock WHERE id = 1").get();
  if (!clock) {
    db.prepare(`
      INSERT INTO territory_season_clock (id, season_index, started_at, ends_at) VALUES (1, 1, ?, ?)
    `).run(iso(nowMs), iso(nowMs + SEASON_MS));
    clock = db.prepare("SELECT * FROM territory_season_clock WHERE id = 1").get();
  }
  const ends = parseDate(clock.ends_at);
  if (ends && nowMs >= ends.getTime()) {
    archiveSeason(clock, nowMs);
    const next = Number(clock.season_index) + 1;
    db.prepare("UPDATE territory_season_clock SET season_index = ?, started_at = ?, ends_at = ? WHERE id = 1")
      .run(next, iso(nowMs), iso(nowMs + SEASON_MS));
    clock = db.prepare("SELECT * FROM territory_season_clock WHERE id = 1").get();
  }
  return clock;
}

function seasonStandings(index) {
  return db.prepare(`
    SELECT h.hv_group_id AS groupId, h.held_seconds AS heldSeconds, g.name, g.tag
    FROM territory_season_hold h
    LEFT JOIN hv_groups g ON g.id = h.hv_group_id
    WHERE h.season_index = ?
    ORDER BY h.held_seconds DESC, h.hv_group_id ASC
  `).all(Number(index)).map((row) => ({
    groupId: row.groupId,
    name: row.name || "Retired group",
    tag: row.tag || null,
    heldSeconds: Number(row.heldSeconds) || 0,
    hours: Math.round((Number(row.heldSeconds) || 0) / 36) / 100,
  }));
}

function archiveSeason(clock, nowMs) {
  const payload = {
    version: 1,
    seasonIndex: Number(clock.season_index),
    startedAt: clock.started_at,
    endedAt: iso(nowMs),
    standings: seasonStandings(clock.season_index),
  };
  db.prepare(`
    INSERT OR REPLACE INTO territory_season_archives (season_index, started_at, ended_at, payload_json, legacy_status)
    VALUES (?, ?, ?, ?, 'pending')
  `).run(payload.seasonIndex, payload.startedAt, payload.endedAt, JSON.stringify(payload));
}

async function flushSeasonArchives() {
  if (process.env.VALLEY_LEGACY_ENABLED !== "1") return;
  const rows = db.prepare("SELECT * FROM territory_season_archives WHERE legacy_status = 'pending'").all();
  for (const row of rows) {
    try {
      await automation.postTerritorySeasonArchive(JSON.parse(row.payload_json));
      db.prepare("UPDATE territory_season_archives SET legacy_status = 'delivered' WHERE season_index = ?").run(row.season_index);
    } catch (error) {
      db.prepare("UPDATE territory_season_archives SET legacy_status = 'pending' WHERE season_index = ?").run(row.season_index);
      console.warn("[territory-season]", error.message);
    }
  }
}

function queueRewards(zone, row, nowMs) {
  if (!rewardsEnabled() || !row.owner_hv_group_id || !row.held_since) return;
  const owner = groupById(row.owner_hv_group_id);
  if (!owner) return;
  const perHour = coinsPerHour();
  if (perHour <= 0) return;
  let cursor = parseDate(row.rewarded_until) || parseDate(row.held_since);
  if (!cursor) return;
  let hours = 0;
  while (cursor.getTime() + 60 * 60 * 1000 <= nowMs && hours < REWARD_CATCHUP_HOURS) {
    const hourStart = new Date(cursor.getTime());
    cursor = new Date(cursor.getTime() + 60 * 60 * 1000);
    hours += 1;
    const shares = splitCoins(perHour, owner.members, owner.ownerSteamId);
    for (const share of shares) {
      const key = `territory-hold:${zone.key}:${hourStart.toISOString()}:${share.steamId}`;
      db.prepare(`
        INSERT OR IGNORE INTO territory_holder_reward_outbox (idempotency_key, steam_id, amount, payload_json)
        VALUES (?, ?, ?, ?)
      `).run(key, share.steamId, share.amount, JSON.stringify({
        steamId: share.steamId,
        amount: share.amount,
        idempotencyKey: key,
        territoryKey: zone.key,
        territoryName: zone.name,
        hourStart: hourStart.toISOString(),
        groupId: owner.id,
        rule: "valley-arcade-option-a",
      }));
    }
  }
  if (hours) {
    db.prepare("UPDATE territory_holdings SET rewarded_until = ? WHERE territory_key = ?").run(cursor.toISOString(), zone.key);
  }
}

function splitCoins(total, members, ownerSteamId) {
  const list = (members || []).filter((member) => /^\d{17}$/.test(String(member.steamId || "")));
  if (!list.length || total <= 0) return [];
  const base = Math.floor(total / list.length);
  let remainder = total - base * list.length;
  const ordered = [...list].sort((a, b) => Number(b.steamId === ownerSteamId) - Number(a.steamId === ownerSteamId));
  return ordered.map((member) => {
    const amount = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    return { steamId: member.steamId, amount };
  }).filter((share) => share.amount > 0);
}

async function flushRewards() {
  const pending = db.prepare(`
    SELECT * FROM territory_holder_reward_outbox WHERE status = 'pending' ORDER BY idempotency_key LIMIT 40
  `).all();
  if (!pending.length) return;
  try {
    await automation.postTerritoryHolderRewards({
      credits: pending.map((row) => JSON.parse(row.payload_json)),
    });
    const mark = db.prepare("UPDATE territory_holder_reward_outbox SET status = 'delivered', attempts = attempts + 1 WHERE idempotency_key = ?");
    for (const row of pending) mark.run(row.idempotency_key);
  } catch (error) {
    db.prepare("UPDATE territory_holder_reward_outbox SET attempts = attempts + 1 WHERE status = 'pending'").run();
    console.warn("[territory-holder-reward]", error.message);
  }
}

function tick(nowMs = Date.now()) {
  if (!enabled()) return null;
  ensureSchema();
  const runtime = db.prepare("SELECT * FROM territory_redesign_runtime WHERE id = 1").get();
  const open = warWindow.isOpen(nowMs);
  const windowKey = open ? warWindow.windowStartContaining(nowMs).toISOString() : null;
  const wasOpen = runtime?.open_window_key || null;
  if (open && windowKey && windowKey !== wasOpen) {
    for (const zone of zones.catalog()) addLog(zone.key, "status", `${zone.name} war window is open.`);
    db.prepare("UPDATE territory_redesign_runtime SET open_window_key = ? WHERE id = 1").run(windowKey);
  }
  if (!open && wasOpen) {
    for (const zone of zones.catalog()) {
      const attack = activeAttack(zone.key);
      if (attack) defend(zone, attack, nowMs, "The war window closed.");
    }
    db.prepare("UPDATE territory_redesign_runtime SET open_window_key = NULL WHERE id = 1").run();
  }
  const last = parseDate(runtime?.last_tick_at);
  const elapsed = last ? Math.max(0, Math.min(60, (nowMs - last.getTime()) / 1000)) : 0;
  for (const zone of zones.catalog()) {
    const row = holding(zone.key);
    accrueSeason(zone, row, nowMs, elapsed);
    queueRewards(zone, row, nowMs);
    tickHolding(zone, nowMs, open);
  }
  if (seasonsEnabled()) ensureSeason(nowMs);
  db.prepare("UPDATE territory_redesign_runtime SET last_tick_at = ? WHERE id = 1").run(iso(nowMs));
  flushRewards().catch((error) => console.warn("[territory-holder-reward]", error.message));
  flushSeasonArchives().catch((error) => console.warn("[territory-season]", error.message));
  return publicState(nowMs, { tickAlready: true });
}

function decorateHolding(zone, nowMs = Date.now()) {
  const row = holding(zone.key);
  const attack = activeAttack(zone.key);
  const owner = row?.owner_hv_group_id ? groupById(row.owner_hv_group_id) : null;
  const attacker = attack ? groupById(attack.attacker_hv_group_id) : null;
  const score = normalizeControlScore(row?.control_score, -100);
  const control = percents(score);
  return {
    key: zone.key,
    name: zone.name,
    seededFrom: zone.seededFrom,
    center: zone.geometry?.center || null,
    claimRadius: zone.claimRadius,
    battlefieldRadius: zone.battlefieldRadius,
    ownerGroupId: owner?.id || null,
    ownerName: owner?.name || null,
    ownerTag: owner?.tag || null,
    ownerLabel: tagName(owner),
    controlScore: score,
    ownerControl: control.owner,
    challengerControl: control.challenger,
    protectionUntil: row?.protection_until || null,
    protected: Boolean(parseDate(row?.protection_until) && parseDate(row.protection_until).getTime() > nowMs),
    heldSince: row?.held_since || null,
    attack: attack ? {
      id: attack.id,
      status: attack.status,
      startsAt: attack.starts_at,
      attackerName: attacker?.name || null,
      attackerTag: attacker?.tag || null,
      attackerLabel: tagName(attacker),
    } : null,
  };
}

function publicState(nowMs = Date.now(), { tickAlready = false } = {}) {
  if (!tickAlready) tick(nowMs);
  const holdings = zones.catalog().map((zone) => decorateHolding(zone, nowMs));
  const focus = holdings.find((item) => item.attack) || holdings.find((item) => item.ownerGroupId) || holdings[0] || null;
  const season = seasonsEnabled() ? currentSeason() : null;
  return {
    ok: true,
    redesign: true,
    window: warWindow.describe(nowMs),
    zonesFile: "server/data/territoryZones.json",
    howToEditZones: zones.howToEdit,
    rewards: {
      enabled: rewardsEnabled(),
      coinsPerHour: coinsPerHour(),
      split: "evenly across current members, remainder coins to the owner first",
      rule: "valley-arcade-option-a",
    },
    lineupCap: LINEUP_CAP,
    liveSubstitutionDelayMinutes: LIVE_SUB_DELAY_MS / 60000,
    protectionMinutes: protectionMinutes(),
    holdings,
    season,
    event: focus ? {
      territory_name: focus.name,
      territory_key: focus.key,
      owner_name: focus.ownerName || "Unclaimed",
      challenger_name: focus.attack?.attackerName || null,
      owner_control: focus.ownerControl,
      challenger_control: focus.challengerControl,
      status: warWindow.isOpen(nowMs) ? "live" : "protected",
      starts_at: warWindow.describe(nowMs).currentStart,
      ends_at: null,
      protection_until: focus.protectionUntil,
    } : null,
    attack: focus?.attack ? { attacker_name: focus.attack.attackerName, status: focus.attack.status, starts_at: focus.attack.startsAt } : null,
    presence: { eligibleClaimCount: 0, claimCount: 0, playerCount: 0 },
    log: recentLog(),
    leaderboard: season?.standings || [],
  };
}

function recentLog() {
  ensureSchema();
  return db.prepare(`
    SELECT id, territory_key AS territoryKey, kind, message, created_at AS createdAt
    FROM territory_holding_log ORDER BY id DESC LIMIT 30
  `).all();
}

function currentSeason() {
  ensureSchema();
  const clock = db.prepare("SELECT * FROM territory_season_clock WHERE id = 1").get();
  if (!clock) return null;
  return {
    index: clock.season_index,
    startedAt: clock.started_at,
    endsAt: clock.ends_at,
    standings: seasonStandings(clock.season_index),
  };
}

function playerState(user) {
  ensureSchema();
  const steamId = String(user?.steam_id || "");
  const group = groupForSteam(steamId);
  const lineup = group ? db.prepare(`
    SELECT territory_key AS territoryKey, steam_id AS steamId, active_from AS activeFrom
    FROM territory_holding_lineups WHERE hv_group_id = ?
  `).all(group.id) : [];
  return {
    redesign: true,
    registered: Boolean(group),
    group: group ? {
      id: group.id,
      name: group.name,
      tag: group.tag || null,
      role: group.ownerSteamId === steamId ? "owner" : "member",
      members: group.members,
    } : null,
    roster: group?.members || [],
    lineup,
    holdings: zones.catalog().map((zone) => decorateHolding(zone)),
    window: warWindow.describe(),
    usesWebsiteGroups: true,
  };
}

function resetHoldings(nowMs = Date.now()) {
  ensureSchema();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE territory_holding_attacks
      SET status = 'resolved', outcome = 'admin-reset', resolved_at = ?
      WHERE status IN ('warning', 'active')
    `).run(iso(nowMs));
    db.prepare(`
      UPDATE territory_holdings
      SET owner_hv_group_id = NULL, control_score = -100, protection_until = NULL, held_since = NULL, rewarded_until = NULL, updated_at = datetime('now')
    `).run();
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
  const activeCount = zones.catalog().length;
  const resetMessage = activeCount === 1
    ? "Admin reset the active territory holding."
    : `Admin reset all ${activeCount} territory holdings.`;
  addLog(zones.catalog()[0]?.key || "south-plains", "status", resetMessage);
  return publicState(nowMs);
}

function ingestCombat(events, nowMs = Date.now()) {
  if (!enabled()) return { counted: 0, ignored: 0 };
  ensureSchema();
  let counted = 0;
  let ignored = 0;
  for (const event of events || []) {
    const result = ingestOne(event, nowMs);
    if (result.counted) counted += 1;
    else ignored += 1;
  }
  return { counted, ignored, received: (events || []).length };
}

function ingestOne(event, nowMs) {
  const combatEventId = String(event?.id || event?.eventId || "").trim();
  const occurred = parseDate(event?.occurredAt);
  const killer = String(event?.killerSteamId || "");
  const victim = String(event?.victimSteamId || "");
  if (!combatEventId || !occurred || !/^\d{17}$/.test(killer) || !/^\d{17}$/.test(victim) || killer === victim) {
    return { counted: false, reason: "invalid-combat-event" };
  }
  const killerZone = locate(event?.killerLocation);
  const victimZone = locate(event?.victimLocation);
  const zone = killerZone && victimZone && killerZone.key === victimZone.key && killerZone.inBattlefield && victimZone.inBattlefield
    ? killerZone
    : null;
  if (!zone) return { counted: false, reason: "outside-or-unverified-battlefield" };
  if (!warWindow.isOpen(occurred.getTime())) return { counted: false, reason: "outside-war-window" };
  const attack = db.prepare(`
    SELECT * FROM territory_holding_attacks
    WHERE territory_key = ? AND status = 'active' AND datetime(starts_at) <= datetime(?)
      AND (resolved_at IS NULL OR datetime(resolved_at) >= datetime(?))
    ORDER BY id DESC LIMIT 1
  `).get(zone.key, occurred.toISOString(), occurred.toISOString());
  if (!attack) return { counted: false, reason: "no-active-attack-at-kill-time" };
  const killerMember = lineupRows(zone.key, attack.attacker_hv_group_id, occurred.getTime()).some((row) => row.steamId === killer)
    ? "attacker"
    : (attack.defender_hv_group_id && lineupRows(zone.key, attack.defender_hv_group_id, occurred.getTime()).some((row) => row.steamId === killer) ? "defender" : null);
  const victimMember = lineupRows(zone.key, attack.attacker_hv_group_id, occurred.getTime()).some((row) => row.steamId === victim)
    ? "attacker"
    : (attack.defender_hv_group_id && lineupRows(zone.key, attack.defender_hv_group_id, occurred.getTime()).some((row) => row.steamId === victim) ? "defender" : null);
  if (!killerMember || !victimMember || killerMember === victimMember) {
    remember(combatEventId, zone.key, attack.id, killer, victim, occurred, false, "not-opposing-lineups");
    return { counted: false, reason: "not-opposing-lineups" };
  }
  const since = iso(occurred.getTime() - REPEAT_KILL_COOLDOWN_MS);
  const repeat = db.prepare(`
    SELECT combat_event_id FROM territory_holding_kills
    WHERE territory_key = ? AND killer_steam_id = ? AND victim_steam_id = ? AND counted = 1
      AND datetime(occurred_at) >= datetime(?) AND datetime(occurred_at) < datetime(?)
  `).get(zone.key, killer, victim, since, occurred.toISOString());
  if (repeat) {
    remember(combatEventId, zone.key, attack.id, killer, victim, occurred, false, "repeat-kill-cooldown");
    return { counted: false, reason: "repeat-kill-cooldown" };
  }
  remember(combatEventId, zone.key, attack.id, killer, victim, occurred, true, "counted");
  db.prepare(`
    INSERT OR IGNORE INTO territory_holding_momentum
      (combat_event_id, territory_key, attack_id, side, occurred_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(combatEventId, zone.key, attack.id, killerMember, occurred.toISOString());
  addLog(zone.key, "kill", `A verified opposing kill in the ${zone.name} battlefield nudged ${killerMember} momentum.`);
  return { counted: true, reason: "counted", territoryKey: zone.key, attackId: attack.id, side: killerMember, nowMs };
}

function remember(combatEventId, key, attackId, killer, victim, occurred, counted, reason) {
  db.prepare(`
    INSERT OR IGNORE INTO territory_holding_kills
      (combat_event_id, territory_key, attack_id, killer_steam_id, victim_steam_id, occurred_at, counted, reason)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(combatEventId, key, attackId, killer, victim, occurred.toISOString(), counted ? 1 : 0, reason);
}

function locate(location) {
  if (!location) return null;
  const mapped = fromRconLocation({
    x: Number(location.x),
    y: Number(location.y),
    z: Number(location.z || 0),
  });
  if (!Number.isFinite(mapped.x) || !Number.isFinite(mapped.y)) return null;
  let best = null;
  for (const zone of zones.catalog()) {
    const hit = classifyWorldPosition(mapped.x, mapped.y, zone.geometry);
    if (!hit.inBattlefield) continue;
    if (!best || hit.distance < best.distance) best = { ...zone, ...hit };
  }
  return best;
}

function combatSince(nowMs = Date.now()) {
  const row = db.prepare("SELECT MAX(occurred_at) AS occurred_at FROM territory_holding_kills").get();
  const processed = parseDate(row?.occurred_at);
  return iso((processed ? processed.getTime() : nowMs) - 60 * 1000);
}

function pendingFeedRows(limit = 25) {
  ensureSchema();
  return db.prepare(`
    SELECT l.id AS logId, l.territory_key AS territoryKey, l.kind, l.message, l.created_at AS loggedAt,
           h.owner_hv_group_id AS ownerGroupId
    FROM territory_holding_log l
    LEFT JOIN territory_holdings h ON h.territory_key = l.territory_key
    WHERE l.fed = 0
    ORDER BY l.id ASC
    LIMIT ?
  `).all(Math.max(1, Math.min(25, Number(limit) || 25))).map((row) => {
    const zone = zones.byKey(row.territoryKey);
    const owner = row.ownerGroupId ? groupById(row.ownerGroupId) : null;
    const attack = activeAttack(row.territoryKey);
    const challenger = attack ? groupById(attack.attacker_hv_group_id) : null;
    const warning = row.kind === "attack" && /five-minute warning started/i.test(row.message);
    return {
      source: "holding",
      logId: row.logId,
      eventId: row.logId,
      kind: row.kind,
      message: row.message,
      territoryName: zone?.name || row.territoryKey,
      ownerName: owner?.name || "Unclaimed",
      challengerName: challenger?.name || null,
      fiveMinuteWarning: warning,
      defenderDiscordIds: warning ? defenderDiscordIds(attack) : [],
      attackStartsAt: warning ? attack?.starts_at || null : null,
    };
  });
}

function defenderDiscordIds(attack) {
  if (!attack?.defender_hv_group_id) return [];
  return groupsMembers(attack.defender_hv_group_id)
    .map((member) => String(member.discordId || ""))
    .filter((id) => /^\d{17,20}$/.test(id))
    .slice(0, 6);
}

function advanceFeed(logId) {
  db.prepare("UPDATE territory_holding_log SET fed = 1 WHERE id = ?").run(Number(logId));
}

function overlayHoldings(nowMs = Date.now()) {
  if (!enabled()) return null;
  ensureSchema();
  return zones.catalog().map((zone) => {
    const view = decorateHolding(zone, nowMs);
    const geometry = zone.geometry;
    return {
      ...view,
      zones: geometry ? {
        territoryName: zone.name,
        holderTag: view.ownerTag,
        holderName: view.ownerName,
        battlefieldRadiusMetres: Math.round(geometry.battlefieldRadius * 10),
        claimRadiusMetres: Math.round(geometry.claimRadius * 10),
        center: geometry.center,
      } : null,
    };
  });
}

module.exports = {
  enabled,
  ensureSchema,
  tick,
  publicState,
  playerState,
  setLineup,
  declareAttack,
  declareForDiscord,
  resetHoldings,
  ingestCombat,
  combatSince,
  pendingFeedRows,
  advanceFeed,
  overlayHoldings,
  splitCoins,
  coinsPerHour,
  protectionMinutes,
  LINEUP_CAP,
};
