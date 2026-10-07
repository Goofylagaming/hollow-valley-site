const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

const { db } = require('../server/db');
require('../server/routes/territoryWars');
const sync = require('../server/services/territoryCombatSync');

let sequence = 0;

function insertUser(name) {
  sequence += 1;
  const steamId = `76561198${String(200000000 + sequence).slice(-9)}`;
  const result = db.prepare(`
    INSERT INTO users (steam_id, username)
    VALUES (?, ?)
  `).run(steamId, name || `CombatTester${sequence}`);
  return { id: Number(result.lastInsertRowid), steamId, name: name || `CombatTester${sequence}` };
}

function seedWar() {
  const attacker = insertUser('Ridge Hunter');
  const defender = insertUser('Valley Guard');
  const suffix = String(sequence).padStart(3, '0').slice(-3);
  const attackerTag = `R${suffix}`;
  const defenderTag = `H${suffix}`;

  const attackerGroupId = Number(db.prepare(`
    INSERT INTO territory_groups (name, tag, leader_user_id)
    VALUES (?, ?, ?)
  `).run(`Ridge Runners ${suffix}`, attackerTag, attacker.id).lastInsertRowid);
  const defenderGroupName = `Valley Guard ${suffix}`;
  const defenderGroupId = Number(db.prepare(`
    INSERT INTO territory_groups (name, tag, leader_user_id)
    VALUES (?, ?, ?)
  `).run(defenderGroupName, defenderTag, defender.id).lastInsertRowid);

  db.prepare(`INSERT INTO territory_group_members (group_id, user_id, role) VALUES (?, ?, 'leader')`).run(attackerGroupId, attacker.id);
  db.prepare(`INSERT INTO territory_group_members (group_id, user_id, role) VALUES (?, ?, 'leader')`).run(defenderGroupId, defender.id);
  db.prepare(`INSERT INTO territory_group_stats (group_id) VALUES (?)`).run(attackerGroupId);
  db.prepare(`INSERT INTO territory_group_stats (group_id) VALUES (?)`).run(defenderGroupId);

  const eventId = Number(db.prepare(`
    INSERT INTO territory_events
      (name, territory_key, territory_name, status, starts_at, ends_at, owner_name, control_score)
    VALUES (?, 'south-plains', 'South Plains', 'live', ?, ?, ?, -100)
  `).run(`South Plains War ${suffix}`, '2026-10-05T07:00:00.000Z', '2026-10-05T12:00:00.000Z', defenderGroupName).lastInsertRowid);

  const lineup = db.prepare(`
    INSERT INTO territory_event_lineups
      (event_id, group_id, user_id, selected_by_user_id, active_from, selected_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  lineup.run(eventId, attackerGroupId, attacker.id, attacker.id, '2026-10-05T07:00:00.000Z', '2026-10-05T07:00:00.000Z');
  lineup.run(eventId, defenderGroupId, defender.id, defender.id, '2026-10-05T07:00:00.000Z', '2026-10-05T07:00:00.000Z');

  const attackId = Number(db.prepare(`
    INSERT INTO territory_attacks
      (event_id, attacker_group_id, defender_group_id, status, declared_by_user_id, declared_at, starts_at, contest_started_at, last_tick_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
  `).run(
    eventId,
    attackerGroupId,
    defenderGroupId,
    attacker.id,
    '2026-10-05T07:20:00.000Z',
    '2026-10-05T07:25:00.000Z',
    '2026-10-05T07:27:00.000Z',
    '2026-10-05T07:30:00.000Z'
  ).lastInsertRowid);

  return { attacker, defender, attackerGroupId, defenderGroupId, eventId, attackId };
}

function combatEvent(seed, overrides = {}) {
  return {
    id: `combat-sync-${++sequence}`,
    occurredAt: '2026-10-05T08:00:00.000Z',
    killerSteamId: seed.attacker.steamId,
    killerName: seed.attacker.name,
    victimSteamId: seed.defender.steamId,
    victimName: seed.defender.name,
    killerLocation: { x: -302000, y: 250000, z: 0 },
    victimLocation: { x: -301500, y: 250500, z: 0 },
    presenceSampledAt: '2026-10-05T08:00:10.000Z',
    ...overrides,
  };
}

test('South Plains raw presence coordinates classify inside the Battlefield', () => {
  const war = seedWar();
  const geometry = sync._test.geometryForEvent(db.prepare('SELECT * FROM territory_events WHERE id = ?').get(war.eventId));
  const zone = sync._test.classifyLocation({ x: -302000, y: 250000, z: 0 }, geometry);
  assert.equal(zone.inBattlefield, true);
  assert.equal(zone.inClaim, true);
});

test('verified opposing lineup kill inside the Battlefield increments war kills/deaths and feed once', () => {
  const war = seedWar();
  const territoryEvent = db.prepare('SELECT * FROM territory_events WHERE id = ?').get(war.eventId);
  const event = combatEvent(war);

  const result = sync._test.processCombatEvent(event, territoryEvent);
  assert.equal(result.counted, true);
  assert.equal(result.attackId, war.attackId);
  assert.equal(result.killerGroupId, war.attackerGroupId);
  assert.equal(result.victimGroupId, war.defenderGroupId);

  const attackerStats = db.prepare('SELECT kills, deaths FROM territory_group_stats WHERE group_id = ?').get(war.attackerGroupId);
  const defenderStats = db.prepare('SELECT kills, deaths FROM territory_group_stats WHERE group_id = ?').get(war.defenderGroupId);
  assert.equal(attackerStats.kills, 1);
  assert.equal(attackerStats.deaths, 0);
  assert.equal(defenderStats.kills, 0);
  assert.equal(defenderStats.deaths, 1);

  const audit = db.prepare('SELECT counted, inside_battlefield, reason FROM territory_combat_events WHERE combat_event_id = ?').get(event.id);
  assert.equal(audit.counted, 1);
  assert.equal(audit.inside_battlefield, 1);
  assert.equal(audit.reason, 'counted');

  const log = db.prepare(`SELECT kind, message FROM territory_event_log WHERE event_id = ? ORDER BY id DESC LIMIT 1`).get(war.eventId);
  assert.equal(log.kind, 'kill');
  assert.match(log.message, /Ridge Hunter/);
  assert.match(log.message, /Valley Guard/);
  assert.match(log.message, /South Plains Battlefield/);

  const duplicate = sync._test.processCombatEvent(event, territoryEvent);
  assert.equal(duplicate.counted, false);
  assert.equal(duplicate.reason, 'duplicate');
  assert.equal(db.prepare('SELECT kills FROM territory_group_stats WHERE group_id = ?').get(war.attackerGroupId).kills, 1);
});

test('kills outside the Battlefield or without qualified locations are audited but do not score', () => {
  const war = seedWar();
  const territoryEvent = db.prepare('SELECT * FROM territory_events WHERE id = ?').get(war.eventId);

  const outside = combatEvent(war, {
    killerLocation: { x: 0, y: 0, z: 0 },
    victimLocation: { x: 0, y: 0, z: 0 },
  });
  let result = sync._test.processCombatEvent(outside, territoryEvent);
  assert.equal(result.counted, false);
  assert.equal(result.reason, 'outside-or-unverified-battlefield');

  const unverified = combatEvent(war, {
    killerLocation: null,
    victimLocation: null,
    occurredAt: '2026-10-05T08:01:00.000Z',
  });
  result = sync._test.processCombatEvent(unverified, territoryEvent);
  assert.equal(result.counted, false);
  assert.equal(result.reason, 'outside-or-unverified-battlefield');

  assert.equal(db.prepare('SELECT kills FROM territory_group_stats WHERE group_id = ?').get(war.attackerGroupId).kills, 0);
});

test('same killer and victim cannot farm another Territory kill inside ten minutes', () => {
  const war = seedWar();
  const territoryEvent = db.prepare('SELECT * FROM territory_events WHERE id = ?').get(war.eventId);

  const first = combatEvent(war, { occurredAt: '2026-10-05T08:00:00.000Z' });
  const repeated = combatEvent(war, { occurredAt: '2026-10-05T08:09:59.000Z' });
  const later = combatEvent(war, { occurredAt: '2026-10-05T08:10:01.000Z' });

  assert.equal(sync._test.processCombatEvent(first, territoryEvent).counted, true);
  const repeatResult = sync._test.processCombatEvent(repeated, territoryEvent);
  assert.equal(repeatResult.counted, false);
  assert.equal(repeatResult.reason, 'repeat-kill-cooldown');
  assert.equal(sync._test.processCombatEvent(later, territoryEvent).counted, true);

  assert.equal(db.prepare('SELECT kills FROM territory_group_stats WHERE group_id = ?').get(war.attackerGroupId).kills, 2);
  const cooldownAudit = db.prepare('SELECT counted, reason FROM territory_combat_events WHERE combat_event_id = ?').get(repeated.id);
  assert.equal(cooldownAudit.counted, 0);
  assert.equal(cooldownAudit.reason, 'repeat-kill-cooldown');
});

test('same killer and victim are blocked even when two combat events share the exact same timestamp', () => {
  const war = seedWar();
  const territoryEvent = db.prepare('SELECT * FROM territory_events WHERE id = ?').get(war.eventId);

  const first = combatEvent(war, { occurredAt: '2026-10-05T08:00:00.000Z' });
  const repeatedSameTimestamp = combatEvent(war, { occurredAt: '2026-10-05T08:00:00.000Z' });

  assert.notEqual(first.id, repeatedSameTimestamp.id);
  assert.equal(sync._test.processCombatEvent(first, territoryEvent).counted, true);

  const repeatResult = sync._test.processCombatEvent(repeatedSameTimestamp, territoryEvent);
  assert.equal(repeatResult.counted, false);
  assert.equal(repeatResult.reason, 'repeat-kill-cooldown');

  assert.equal(
    db.prepare('SELECT kills FROM territory_group_stats WHERE group_id = ?').get(war.attackerGroupId).kills,
    1
  );

  const cooldownAudit = db.prepare(
    'SELECT counted, reason FROM territory_combat_events WHERE combat_event_id = ?'
  ).get(repeatedSameTimestamp.id);
  assert.equal(cooldownAudit.counted, 0);
  assert.equal(cooldownAudit.reason, 'repeat-kill-cooldown');
});

test('natural deaths and non-lineup fighters never award Territory kills', () => {
  const war = seedWar();
  const territoryEvent = db.prepare('SELECT * FROM territory_events WHERE id = ?').get(war.eventId);

  const natural = combatEvent(war, {
    killerSteamId: null,
    killerName: null,
  });
  let result = sync._test.processCombatEvent(natural, territoryEvent);
  assert.equal(result.counted, false);
  assert.equal(result.reason, 'natural-or-environmental-death');

  const outsider = insertUser('Spectator');
  const outsiderKill = combatEvent(war, {
    killerSteamId: outsider.steamId,
    killerName: outsider.name,
    occurredAt: '2026-10-05T08:02:00.000Z',
  });
  result = sync._test.processCombatEvent(outsiderKill, territoryEvent);
  assert.equal(result.counted, false);
  assert.equal(result.reason, 'fighter-not-active-lineup');

  assert.equal(db.prepare('SELECT kills FROM territory_group_stats WHERE group_id = ?').get(war.attackerGroupId).kills, 0);
});

test('Admin owner is a real system defender faction for verified Battlefield kills', () => {
  const war = seedWar();
  db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(war.defender.id);
  db.prepare('DELETE FROM territory_event_lineups WHERE event_id = ? AND user_id = ?').run(war.eventId, war.defender.id);
  db.prepare('UPDATE territory_attacks SET defender_group_id = NULL WHERE id = ?').run(war.attackId);
  db.prepare("UPDATE territory_events SET owner_name = 'Admin' WHERE id = ?").run(war.eventId);
  const territoryEvent = db.prepare('SELECT * FROM territory_events WHERE id = ?').get(war.eventId);

  const attackerKill = combatEvent(war, { occurredAt: '2026-10-05T08:00:00.000Z' });
  let result = sync._test.processCombatEvent(attackerKill, territoryEvent);
  assert.equal(result.counted, true);
  assert.equal(result.killerSide, 'attacker');
  assert.equal(result.victimSide, 'defender');
  assert.equal(result.killerGroupId, war.attackerGroupId);
  assert.equal(result.victimGroupId, null);

  const adminKill = combatEvent(war, {
    occurredAt: '2026-10-05T08:01:00.000Z',
    killerSteamId: war.defender.steamId,
    killerName: war.defender.name,
    victimSteamId: war.attacker.steamId,
    victimName: war.attacker.name,
  });
  result = sync._test.processCombatEvent(adminKill, territoryEvent);
  assert.equal(result.counted, true);
  assert.equal(result.killerSide, 'defender');
  assert.equal(result.victimSide, 'attacker');
  assert.equal(result.killerGroupId, null);
  assert.equal(result.victimGroupId, war.attackerGroupId);

  const attackerStats = db.prepare('SELECT kills, deaths FROM territory_group_stats WHERE group_id = ?').get(war.attackerGroupId);
  assert.equal(attackerStats.kills, 1);
  assert.equal(attackerStats.deaths, 1);

  const logRows = db.prepare(`
    SELECT message FROM territory_event_log
    WHERE event_id = ? AND kind = 'kill'
    ORDER BY id ASC
  `).all(war.eventId);
  assert.equal(logRows.length, 2);
  assert.match(logRows[0].message, /Admin \[ADMIN\]/);
  assert.match(logRows[1].message, /Admin \[ADMIN\]/);
});
