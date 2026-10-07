const { db } = require('../db');
const { fromRconLocation } = require('../evrimaMap');
const { territoryGeometry, classifyWorldPosition } = require('./territoryGeometry');
const territoryCombatClient = require('./territoryCombatClient');
const territoryMomentum = require('./territoryMomentum');

const SYNC_INTERVAL_MS = 15 * 1000;
const REPEAT_KILL_COOLDOWN_MS = 10 * 60 * 1000;
const REFRESH_OVERLAP_MS = 60 * 1000;

let timer = null;
let running = false;
let lastError = null;
let lastSyncAt = null;

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS territory_combat_events (
      combat_event_id TEXT PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES territory_events(id) ON DELETE CASCADE,
      attack_id INTEGER REFERENCES territory_attacks(id) ON DELETE SET NULL,
      occurred_at TEXT NOT NULL,
      killer_steam_id TEXT,
      victim_steam_id TEXT NOT NULL,
      killer_group_id INTEGER REFERENCES territory_groups(id) ON DELETE SET NULL,
      victim_group_id INTEGER REFERENCES territory_groups(id) ON DELETE SET NULL,
      inside_battlefield INTEGER NOT NULL DEFAULT 0,
      counted INTEGER NOT NULL DEFAULT 0,
      reason TEXT,
      presence_sampled_at TEXT,
      processed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_territory_combat_event_time
      ON territory_combat_events(event_id, occurred_at DESC);
    CREATE INDEX IF NOT EXISTS idx_territory_combat_repeat
      ON territory_combat_events(event_id, killer_steam_id, victim_steam_id, counted, occurred_at DESC);
  `);
  territoryMomentum.ensureSchema();
}

function cleanText(value, max = 240) {
  return String(value || '').replace(/[\x00-\x1f\x7f]/g, '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function parseDate(value) {
  const date = new Date(value || '');
  return Number.isFinite(date.getTime()) ? date : null;
}

function latestLiveEvent() {
  return db.prepare(`
    SELECT *
    FROM territory_events
    WHERE status = 'live'
    ORDER BY id DESC
    LIMIT 1
  `).get() || null;
}

function geometryForEvent(event) {
  if (!event) return null;
  return territoryGeometry({
    territoryName: event.territory_name,
    territoryKey: event.territory_key,
  });
}

function lineupMembershipAt(eventId, steamId, occurredAt) {
  if (!eventId || !/^\d{17}$/.test(String(steamId || ''))) return null;
  const at = parseDate(occurredAt);
  if (!at) return null;
  return db.prepare(`
    SELECT l.user_id, l.group_id, l.active_from,
           g.name AS group_name, g.tag AS group_tag,
           u.username
    FROM territory_event_lineups l
    JOIN users u ON u.id = l.user_id
    JOIN territory_groups g ON g.id = l.group_id
    WHERE l.event_id = ?
      AND u.steam_id = ?
      AND datetime(l.active_from) <= datetime(?)
    LIMIT 1
  `).get(Number(eventId), String(steamId), at.toISOString()) || null;
}

function systemAdminDefenderAt(attack, steamId) {
  if (!attack || attack.defender_group_id || !/^\d{17}$/.test(String(steamId || ''))) return null;
  const user = db.prepare(`
    SELECT id AS user_id, username, steam_id
    FROM users
    WHERE is_admin = 1 AND steam_id = ?
    LIMIT 1
  `).get(String(steamId));
  if (!user) return null;
  return {
    ...user,
    group_id: null,
    group_name: 'Admin',
    group_tag: 'ADMIN',
    system_defender: true,
  };
}

function attackAt(eventId, occurredAt) {
  const at = parseDate(occurredAt);
  if (!eventId || !at) return null;
  return db.prepare(`
    SELECT *
    FROM territory_attacks
    WHERE event_id = ?
      AND datetime(starts_at) <= datetime(?)
      AND (resolved_at IS NULL OR datetime(resolved_at) >= datetime(?))
    ORDER BY id DESC
    LIMIT 1
  `).get(Number(eventId), at.toISOString(), at.toISOString()) || null;
}

function attackSide(attack, member) {
  if (!attack || !member) return null;
  if (member.system_defender === true && !attack.defender_group_id) return 'defender';
  const groupId = Number(member.group_id);
  if (groupId && groupId === Number(attack.attacker_group_id)) return 'attacker';
  if (groupId && attack.defender_group_id && groupId === Number(attack.defender_group_id)) return 'defender';
  return null;
}

function isOpposingAttackMembers(attack, killerMember, victimMember) {
  const killerSide = attackSide(attack, killerMember);
  const victimSide = attackSide(attack, victimMember);
  return Boolean(killerSide && victimSide && killerSide !== victimSide);
}

function classifyLocation(location, geometry) {
  if (!location || !geometry) return null;
  const x = Number(location.x);
  const y = Number(location.y);
  const z = Number(location.z);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const mapped = fromRconLocation({ x, y, z: Number.isFinite(z) ? z : 0 });
  return classifyWorldPosition(mapped.x, mapped.y, geometry);
}

function repeatKillWithinCooldown(eventId, killerSteamId, victimSteamId, occurredAt) {
  const at = parseDate(occurredAt);
  if (!at || !killerSteamId || !victimSteamId) return false;
  const since = new Date(at.getTime() - REPEAT_KILL_COOLDOWN_MS).toISOString();
  return Boolean(db.prepare(`
    SELECT combat_event_id
    FROM territory_combat_events
    WHERE event_id = ?
      AND killer_steam_id = ?
      AND victim_steam_id = ?
      AND counted = 1
      AND datetime(occurred_at) >= datetime(?)
      AND datetime(occurred_at) <= datetime(?)
    ORDER BY occurred_at DESC
    LIMIT 1
  `).get(Number(eventId), String(killerSteamId), String(victimSteamId), since, at.toISOString()));
}

function alreadyProcessed(combatEventId) {
  if (!combatEventId) return false;
  return Boolean(db.prepare('SELECT combat_event_id FROM territory_combat_events WHERE combat_event_id = ?').get(String(combatEventId)));
}

function writeAudit({
  combatEventId,
  eventId,
  attackId = null,
  occurredAt,
  killerSteamId = null,
  victimSteamId,
  killerGroupId = null,
  victimGroupId = null,
  insideBattlefield = false,
  counted = false,
  reason,
  presenceSampledAt = null,
}) {
  db.prepare(`
    INSERT OR IGNORE INTO territory_combat_events
      (combat_event_id, event_id, attack_id, occurred_at,
       killer_steam_id, victim_steam_id, killer_group_id, victim_group_id,
       inside_battlefield, counted, reason, presence_sampled_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(combatEventId),
    Number(eventId),
    attackId ? Number(attackId) : null,
    String(occurredAt),
    killerSteamId ? String(killerSteamId) : null,
    String(victimSteamId),
    killerGroupId ? Number(killerGroupId) : null,
    victimGroupId ? Number(victimGroupId) : null,
    insideBattlefield ? 1 : 0,
    counted ? 1 : 0,
    cleanText(reason || (counted ? 'counted' : 'ignored'), 80),
    presenceSampledAt ? String(presenceSampledAt) : null
  );
}

function addEventLog(eventId, message) {
  db.prepare(`
    INSERT INTO territory_event_log (event_id, kind, message)
    VALUES (?, 'kill', ?)
  `).run(Number(eventId), cleanText(message, 240));
}

function displayGroup(member) {
  if (!member) return 'Unknown Group';
  return member.group_tag
    ? `${member.group_name} [${member.group_tag}]`
    : member.group_name || 'Unknown Group';
}

function displayPlayer(eventName, fallbackSteamId) {
  const name = cleanText(eventName, 80);
  return name || String(fallbackSteamId || 'Unknown player');
}

function incrementGroupStat(groupId, column) {
  if (!groupId || !['kills', 'deaths'].includes(column)) return;
  db.prepare(`
    INSERT INTO territory_group_stats (group_id, ${column})
    VALUES (?, 1)
    ON CONFLICT(group_id) DO UPDATE SET ${column} = ${column} + 1
  `).run(Number(groupId));
}

function processCombatEvent(event, territoryEvent = latestLiveEvent()) {
  ensureSchema();
  if (!territoryEvent || territoryEvent.status !== 'live') return { counted: false, reason: 'no-live-event' };

  const combatEventId = String(event?.id || event?.eventId || '').trim();
  if (!combatEventId) return { counted: false, reason: 'missing-event-id' };
  if (alreadyProcessed(combatEventId)) return { counted: false, reason: 'duplicate' };

  const occurredAt = parseDate(event?.occurredAt);
  const victimSteamId = String(event?.victimSteamId || '').trim();
  const killerSteamId = String(event?.killerSteamId || '').trim();
  const baseAudit = {
    combatEventId,
    eventId: territoryEvent.id,
    occurredAt: occurredAt?.toISOString() || String(event?.occurredAt || ''),
    killerSteamId: /^\d{17}$/.test(killerSteamId) ? killerSteamId : null,
    victimSteamId,
    presenceSampledAt: event?.presenceSampledAt || null,
  };

  if (!occurredAt || !/^\d{17}$/.test(victimSteamId)) {
    return { counted: false, reason: 'invalid-combat-event' };
  }
  if (!/^\d{17}$/.test(killerSteamId)) {
    writeAudit({ ...baseAudit, reason: 'natural-or-environmental-death' });
    return { counted: false, reason: 'natural-or-environmental-death' };
  }
  if (killerSteamId === victimSteamId) {
    writeAudit({ ...baseAudit, reason: 'self-kill' });
    return { counted: false, reason: 'self-kill' };
  }

  const eventStart = parseDate(territoryEvent.starts_at);
  const eventEnd = parseDate(territoryEvent.ends_at);
  if (eventStart && occurredAt < eventStart) {
    writeAudit({ ...baseAudit, reason: 'before-event-window' });
    return { counted: false, reason: 'before-event-window' };
  }
  if (eventEnd && occurredAt > eventEnd) {
    writeAudit({ ...baseAudit, reason: 'after-event-window' });
    return { counted: false, reason: 'after-event-window' };
  }

  const geometry = geometryForEvent(territoryEvent);
  const killerZone = classifyLocation(event?.killerLocation, geometry);
  const victimZone = classifyLocation(event?.victimLocation, geometry);
  const insideBattlefield = Boolean(killerZone?.inBattlefield && victimZone?.inBattlefield);
  if (!insideBattlefield) {
    writeAudit({ ...baseAudit, insideBattlefield: false, reason: 'outside-or-unverified-battlefield' });
    return { counted: false, reason: 'outside-or-unverified-battlefield' };
  }

  const attack = attackAt(territoryEvent.id, occurredAt);
  if (!attack) {
    writeAudit({ ...baseAudit, insideBattlefield: true, reason: 'no-active-attack-at-kill-time' });
    return { counted: false, reason: 'no-active-attack-at-kill-time' };
  }

  const killerMember = lineupMembershipAt(territoryEvent.id, killerSteamId, occurredAt)
    || systemAdminDefenderAt(attack, killerSteamId);
  const victimMember = lineupMembershipAt(territoryEvent.id, victimSteamId, occurredAt)
    || systemAdminDefenderAt(attack, victimSteamId);
  const enrichedAudit = {
    ...baseAudit,
    attackId: attack.id,
    killerGroupId: killerMember?.group_id || null,
    victimGroupId: victimMember?.group_id || null,
    insideBattlefield: true,
  };

  if (!killerMember || !victimMember) {
    writeAudit({ ...enrichedAudit, reason: 'fighter-not-active-lineup' });
    return { counted: false, reason: 'fighter-not-active-lineup' };
  }
  if (!isOpposingAttackMembers(attack, killerMember, victimMember)) {
    writeAudit({ ...enrichedAudit, reason: 'not-opposing-attack-groups' });
    return { counted: false, reason: 'not-opposing-attack-groups' };
  }
  if (repeatKillWithinCooldown(territoryEvent.id, killerSteamId, victimSteamId, occurredAt)) {
    writeAudit({ ...enrichedAudit, reason: 'repeat-kill-cooldown' });
    return { counted: false, reason: 'repeat-kill-cooldown' };
  }

  const killerSide = attackSide(attack, killerMember);
  const victimSide = attackSide(attack, victimMember);
  db.exec('BEGIN IMMEDIATE');
  try {
    writeAudit({ ...enrichedAudit, counted: true, reason: 'counted' });
    incrementGroupStat(killerMember.group_id, 'kills');
    incrementGroupStat(victimMember.group_id, 'deaths');
    territoryMomentum.recordKill({
      combatEventId,
      eventId: territoryEvent.id,
      attackId: attack.id,
      side: killerSide,
      occurredAt: occurredAt.toISOString(),
    });
    addEventLog(
      territoryEvent.id,
      `${displayPlayer(event?.killerName, killerSteamId)} · ${displayGroup(killerMember)} defeated ${displayPlayer(event?.victimName, victimSteamId)} · ${displayGroup(victimMember)} inside ${territoryEvent.territory_name || 'the territory'} Battlefield.`
    );
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }

  return {
    counted: true,
    reason: 'counted',
    eventId: territoryEvent.id,
    attackId: attack.id,
    killerGroupId: killerMember.group_id ? Number(killerMember.group_id) : null,
    victimGroupId: victimMember.group_id ? Number(victimMember.group_id) : null,
    killerSide,
    victimSide,
  };
}

function lastProcessedAt(eventId) {
  if (!eventId) return null;
  return db.prepare(`
    SELECT MAX(occurred_at) AS occurred_at
    FROM territory_combat_events
    WHERE event_id = ?
  `).get(Number(eventId))?.occurred_at || null;
}

function syncSince(event) {
  const processed = parseDate(lastProcessedAt(event?.id));
  const starts = parseDate(event?.starts_at);
  const base = processed || starts || new Date(Date.now() - 10 * 60 * 1000);
  return new Date(base.getTime() - REFRESH_OVERLAP_MS).toISOString();
}

async function syncOnce() {
  ensureSchema();
  if (running) return { skipped: true, reason: 'already-running' };
  const event = latestLiveEvent();
  if (!event) return { skipped: true, reason: 'no-live-event' };

  running = true;
  try {
    const payload = await territoryCombatClient.listEvents({
      since: syncSince(event),
      limit: 250,
    });
    const events = Array.isArray(payload?.events) ? payload.events : [];
    let counted = 0;
    let ignored = 0;
    let duplicates = 0;
    for (const combatEvent of events) {
      const result = processCombatEvent(combatEvent, event);
      if (result.counted) counted += 1;
      else if (result.reason === 'duplicate') duplicates += 1;
      else ignored += 1;
    }
    lastError = null;
    lastSyncAt = new Date().toISOString();
    return { skipped: false, received: events.length, counted, ignored, duplicates, lastSyncAt };
  } catch (error) {
    lastError = error.message || String(error);
    throw error;
  } finally {
    running = false;
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      await syncOnce();
    } catch (error) {
      console.warn('[territory-combat]', error.message);
    } finally {
      schedule();
    }
  }, SYNC_INTERVAL_MS);
  timer.unref?.();
}

function start() {
  if (timer) return;
  ensureSchema();
  syncOnce().catch((error) => {
    lastError = error.message || String(error);
    console.warn('[territory-combat]', lastError);
  }).finally(schedule);
}

function stop() {
  clearTimeout(timer);
  timer = null;
}

function state() {
  return {
    running,
    started: Boolean(timer),
    lastSyncAt,
    lastError,
    intervalSeconds: SYNC_INTERVAL_MS / 1000,
    repeatKillCooldownMinutes: REPEAT_KILL_COOLDOWN_MS / 60000,
  };
}

module.exports = {
  start,
  stop,
  syncOnce,
  state,
  _test: {
    ensureSchema,
    processCombatEvent,
    lineupMembershipAt,
    systemAdminDefenderAt,
    attackAt,
    attackSide,
    repeatKillWithinCooldown,
    geometryForEvent,
    classifyLocation,
    db,
    REPEAT_KILL_COOLDOWN_MS,
  },
};
