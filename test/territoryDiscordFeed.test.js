const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
process.env.DB_PATH = path.join(os.tmpdir(), 'tw-discord-site-' + randomUUID() + '.sqlite');
const { db } = require("../server/db");
// The Territory Wars module creates the isolated territory_* schema.
require("../server/routes/territoryWars");
const feed = require("../server/services/territoryDiscordFeed");

test("website first activation primes cursor and does not replay prior Territory Wars events", () => {
  const id = Number(db.prepare("INSERT INTO users (username, steam_id) VALUES (?, ?)")
    .run("Leader", "76561198000000701").lastInsertRowid);
  const eventId = Number(db.prepare("INSERT INTO territory_events (name, territory_name, owner_name) VALUES ('Live test', 'South Plains', 'Defenders')")
    .run().lastInsertRowid);
  db.prepare("INSERT INTO territory_event_log (event_id, kind, message) VALUES (?, 'status', 'old historical event')").run(eventId);
  feed._test.ensureSchema();
  assert.deepEqual(feed._test.nextLogRows(), []);
  db.prepare("INSERT INTO territory_event_log (event_id, kind, message) VALUES (?, 'attack', 'Five-minute warning started')").run(eventId);
  const next = feed._test.nextLogRows();
  assert.equal(next.length, 1);
  assert.equal(next[0].eventId, eventId);
  feed._test.advanceCursor(next[0].logId);
  assert.deepEqual(feed._test.nextLogRows(), []);
});

test("defender pings use only Steam-linked owner-group members (leader/lineup), not attackers", () => {
  const leader = Number(db.prepare("SELECT id FROM users WHERE steam_id = '76561198000000701'").get()?.id);
  const defender = Number(db.prepare("INSERT INTO users (username, steam_id, discord_id) VALUES ('Defender', '76561198000000702', '123456789012345678')").run().lastInsertRowid);
  const attacker = Number(db.prepare("INSERT INTO users (username, steam_id, discord_id) VALUES ('Attacker', '76561198000000703', '987654321098765432')").run().lastInsertRowid);
  const defenderGroup = Number(db.prepare("INSERT INTO territory_groups (name, tag, leader_user_id) VALUES ('Defenders', 'DEF', ?)").run(leader).lastInsertRowid);
  const attackerGroup = Number(db.prepare("INSERT INTO territory_groups (name, tag, leader_user_id) VALUES ('Attackers', 'ATK', ?)").run(attacker).lastInsertRowid);
  db.prepare("INSERT INTO territory_group_members (group_id,user_id,role) VALUES (?,?,'leader')").run(defenderGroup, defender);
  db.prepare("INSERT INTO territory_group_members (group_id,user_id,role) VALUES (?,?,'leader')").run(attackerGroup, attacker);
  const eventId = Number(db.prepare("SELECT id FROM territory_events ORDER BY id DESC LIMIT 1").get().id);
  db.prepare("INSERT INTO territory_attacks (event_id, attacker_group_id, defender_group_id, declared_by_user_id, declared_at, starts_at, status) VALUES (?,?,?,?,?,?, 'warning')").run(eventId, attackerGroup, defenderGroup, attacker, new Date().toISOString(), new Date(Date.now() + 5 * 60 * 1000).toISOString());
  const ping = feed._test.linkedDefenders(eventId);
  assert.deepEqual(ping.ids, ["123456789012345678"]);
  assert.ok(Date.parse(ping.startsAt) > Date.now());
  const event = feed._test.toFeedEvent({
    eventId, logId: 42, kind: "attack", message: "Five-minute warning started",
    territoryName: "South Plains", ownerName: "Defenders"
  });
  assert.equal(event.fiveMinuteWarning, true);
  assert.deepEqual(event.defenderDiscordIds, ping.ids);
});
