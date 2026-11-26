const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-territory-combat-"));
process.env.DB_PATH = path.join(dir, "site.sqlite");
delete process.env.TERRITORY_WARS_REDESIGN_ENABLED;
const { db } = require("../server/db");
require("../server/routes/territoryWars");
const combat = require("../server/services/territoryCombatSync");

test.after(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

let fixtureSerial = 0;
function fixture() {
  fixtureSerial += 1;
  const killer = `765611980000009${fixtureSerial}1`;
  const victim = `765611980000009${fixtureSerial}2`;
  const killerId = Number(db.prepare("INSERT INTO users (username, steam_id) VALUES ('Killer', ?)").run(killer).lastInsertRowid);
  const victimId = Number(db.prepare("INSERT INTO users (username, steam_id) VALUES ('Victim', ?)").run(victim).lastInsertRowid);
  const attackers = Number(db.prepare("INSERT INTO territory_groups (name, tag, leader_user_id) VALUES (?, ?, ?)").run(`Attackers ${fixtureSerial}`, `A${fixtureSerial}`, killerId).lastInsertRowid);
  const defenders = Number(db.prepare("INSERT INTO territory_groups (name, tag, leader_user_id) VALUES (?, ?, ?)").run(`Defenders ${fixtureSerial}`, `D${fixtureSerial}`, victimId).lastInsertRowid);
  db.prepare("INSERT INTO territory_group_members (group_id, user_id, role) VALUES (?, ?, 'leader')").run(attackers, killerId);
  db.prepare("INSERT INTO territory_group_members (group_id, user_id, role) VALUES (?, ?, 'leader')").run(defenders, victimId);
  const eventId = Number(db.prepare(`
    INSERT INTO territory_events (name, territory_key, territory_name, status, owner_name, starts_at, ends_at)
    VALUES ('Live', 'south-plains', 'South Plains', 'live', 'Defenders', ?, ?)
  `).run(new Date(Date.now() - 60000).toISOString(), new Date(Date.now() + 3600000).toISOString()).lastInsertRowid);
  db.prepare("INSERT INTO territory_event_registrations (event_id, group_id, registered_by_user_id) VALUES (?, ?, ?)").run(eventId, attackers, killerId);
  const activeFrom = new Date(Date.now() - 60000).toISOString();
  db.prepare("INSERT INTO territory_event_lineups (event_id, group_id, user_id, selected_by_user_id, active_from) VALUES (?, ?, ?, ?, ?)").run(eventId, attackers, killerId, killerId, activeFrom);
  db.prepare("INSERT INTO territory_event_lineups (event_id, group_id, user_id, selected_by_user_id, active_from) VALUES (?, ?, ?, ?, ?)").run(eventId, defenders, victimId, victimId, activeFrom);
  const attackId = Number(db.prepare(`
    INSERT INTO territory_attacks
      (event_id, attacker_group_id, defender_group_id, declared_by_user_id, declared_at, starts_at, status)
    VALUES (?, ?, ?, ?, ?, ?, 'active')
  `).run(eventId, attackers, defenders, killerId, activeFrom, activeFrom).lastInsertRowid);
  const event = db.prepare("SELECT * FROM territory_events WHERE id = ?").get(eventId);
  return { event, attackId, killer, victim };
}

test("a kill without coordinates is not counted", () => {
  const { event, killer, victim } = fixture();
  const result = combat._test.processCombatEvent({
    id: "missing-location",
    occurredAt: new Date().toISOString(),
    killerSteamId: killer,
    victimSteamId: victim,
  }, event);
  assert.equal(result.counted, false);
  assert.equal(result.reason, "outside-or-unverified-battlefield");
});

test("a kill inside the battlefield counts and records momentum for that attack only", () => {
  const { event, attackId, killer, victim } = fixture();
  const result = combat._test.processCombatEvent({
    id: "inside-location",
    occurredAt: new Date().toISOString(),
    killerSteamId: killer,
    victimSteamId: victim,
    killerLocation: { x: -302000, y: 250000, z: 10 },
    victimLocation: { x: -302000, y: 250000, z: 10 },
  }, event);
  assert.equal(result.counted, true);
  const momentum = db.prepare("SELECT attack_id, side FROM territory_kill_momentum WHERE combat_event_id = ?").get("inside-location");
  assert.equal(momentum.attack_id, attackId);
  assert.equal(momentum.side, "attacker");
});
