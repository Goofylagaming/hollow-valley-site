const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DB_PATH = ':memory:';

const { db } = require('../server/db');
require('../server/routes/territoryWars');
const momentum = require('../server/services/territoryMomentum');

let sequence = 0;

function seedAttack() {
  sequence += 1;
  const attackerUser = Number(db.prepare(`INSERT INTO users (steam_id, username) VALUES (?, ?)`)
    .run(`76561198${String(300000000 + sequence).slice(-9)}`, `MomentumAttacker${sequence}`).lastInsertRowid);
  sequence += 1;
  const defenderUser = Number(db.prepare(`INSERT INTO users (steam_id, username) VALUES (?, ?)`)
    .run(`76561198${String(300000000 + sequence).slice(-9)}`, `MomentumDefender${sequence}`).lastInsertRowid);

  const attackerGroup = Number(db.prepare(`INSERT INTO territory_groups (name, tag, leader_user_id) VALUES (?, ?, ?)`)
    .run(`Momentum Attack ${sequence}`, `MA${sequence}`, attackerUser).lastInsertRowid);
  const defenderGroup = Number(db.prepare(`INSERT INTO territory_groups (name, tag, leader_user_id) VALUES (?, ?, ?)`)
    .run(`Momentum Defend ${sequence}`, `MD${sequence}`, defenderUser).lastInsertRowid);
  const eventId = Number(db.prepare(`
    INSERT INTO territory_events (name, status, owner_name)
    VALUES (?, 'live', ?)
  `).run(`Momentum War ${sequence}`, `Momentum Defend ${sequence}`).lastInsertRowid);
  const attackId = Number(db.prepare(`
    INSERT INTO territory_attacks
      (event_id, attacker_group_id, defender_group_id, status, declared_by_user_id, declared_at, starts_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?)
  `).run(eventId, attackerGroup, defenderGroup, attackerUser, '2026-10-05T08:00:00.000Z', '2026-10-05T08:05:00.000Z').lastInsertRowid);

  return { eventId, attackId };
}

test('verified kills create sixty seconds of capped temporary momentum', () => {
  const seeded = seedAttack();
  const now = Date.parse('2026-10-05T08:10:00.000Z');

  momentum.recordKill({ combatEventId: 'mom-a1', ...seeded, side: 'attacker', occurredAt: '2026-10-05T08:09:30.000Z' });
  momentum.recordKill({ combatEventId: 'mom-a2', ...seeded, side: 'attacker', occurredAt: '2026-10-05T08:09:40.000Z' });
  momentum.recordKill({ combatEventId: 'mom-a3', ...seeded, side: 'attacker', occurredAt: '2026-10-05T08:09:50.000Z' });

  const result = momentum.recentMomentum(seeded.eventId, seeded.attackId, now);
  assert.equal(result.attackerKills, 3);
  assert.equal(result.defenderKills, 0);
  assert.equal(result.netKills, 2);
  assert.equal(result.ratePerMinute, 2);
  assert.equal(result.windowSeconds, 60);
  assert.equal(result.rateCap, 2);
});

test('attacker and defender kills cancel each other before the cap is applied', () => {
  const seeded = seedAttack();
  const now = Date.parse('2026-10-05T08:10:00.000Z');

  momentum.recordKill({ combatEventId: 'mom-b1', ...seeded, side: 'attacker', occurredAt: '2026-10-05T08:09:20.000Z' });
  momentum.recordKill({ combatEventId: 'mom-b2', ...seeded, side: 'attacker', occurredAt: '2026-10-05T08:09:30.000Z' });
  momentum.recordKill({ combatEventId: 'mom-b3', ...seeded, side: 'defender', occurredAt: '2026-10-05T08:09:40.000Z' });

  const result = momentum.recentMomentum(seeded.eventId, seeded.attackId, now);
  assert.equal(result.attackerKills, 2);
  assert.equal(result.defenderKills, 1);
  assert.equal(result.netKills, 1);
  assert.equal(result.ratePerMinute, 1);
});

test('kills expire from momentum after sixty seconds', () => {
  const seeded = seedAttack();
  const now = Date.parse('2026-10-05T08:10:00.000Z');

  momentum.recordKill({ combatEventId: 'mom-c1', ...seeded, side: 'attacker', occurredAt: '2026-10-05T08:08:59.000Z' });
  momentum.recordKill({ combatEventId: 'mom-c2', ...seeded, side: 'defender', occurredAt: '2026-10-05T08:09:30.000Z' });

  const result = momentum.recentMomentum(seeded.eventId, seeded.attackId, now);
  assert.equal(result.attackerKills, 0);
  assert.equal(result.defenderKills, 1);
  assert.equal(result.netKills, -1);
  assert.equal(result.ratePerMinute, -1);
});

test('duplicate combat event IDs cannot create duplicate momentum', () => {
  const seeded = seedAttack();
  const now = Date.parse('2026-10-05T08:10:00.000Z');

  assert.equal(momentum.recordKill({ combatEventId: 'mom-d1', ...seeded, side: 'attacker', occurredAt: '2026-10-05T08:09:30.000Z' }), true);
  assert.equal(momentum.recordKill({ combatEventId: 'mom-d1', ...seeded, side: 'attacker', occurredAt: '2026-10-05T08:09:40.000Z' }), false);

  const result = momentum.recentMomentum(seeded.eventId, seeded.attackId, now);
  assert.equal(result.attackerKills, 1);
  assert.equal(result.ratePerMinute, 1);
});
