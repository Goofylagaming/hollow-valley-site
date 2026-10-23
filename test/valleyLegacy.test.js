"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const {
  createLegacyStore,
} = require("../automation-platform/src/services/valleyLegacyStore");
const A = "76561198000000001",
  B = "76561198000000002",
  C = "76561198000000003";
function setup(t) {
  const db = new DatabaseSync(":memory:");
  let time = Date.parse("2026-10-23T00:00:00Z");
  const s = createLegacyStore(db, { now: () => time });
  t.after(() => db.close());
  return {
    s,
    db,
    at: () => time,
    advance: (n) => (time += n),
    p: (id = A, sp = "Rex", x = 0) => ({
      steamId: id,
      name: "Player",
      species: sp,
      growth: 0.5,
      location: { x, y: 0 },
    }),
  };
}
function record(s, metric, scope = "all") {
  return (
    s.overview().rankings[scope].find((r) => r.metric === metric).leaders[0]
      ?.value || 0
  );
}
test("additive migration is repeatable and preserves unrelated data", (t) => {
  const { db, s, at } = setup(t);
  db.exec(
    "CREATE TABLE protected_wallet(balance INTEGER); INSERT INTO protected_wallet VALUES (321)",
  );
  createLegacyStore(db, { now: at });
  assert.equal(
    db.prepare("SELECT balance FROM protected_wallet").get().balance,
    321,
  );
  assert.equal(s.overview().seasons.length, 1);
  assert.equal(db.prepare("PRAGMA quick_check").get().quick_check, "ok");
});
test("verified time, XP, movement, duplicate/stale snapshots and implausible jumps", (t) => {
  const { s, p, at, advance } = setup(t);
  s.snapshot([p()], at());
  advance(300000);
  s.snapshot([p(A, "Rex", 10000)], at());
  assert.equal(s.mine(A).mastery[0].xp, 10);
  assert.equal(record(s, "survival_seconds"), 300);
  assert.equal(record(s, "journey_metres"), 100);
  assert.equal(s.snapshot([p()], at()).duplicate, true);
  s.snapshot([p()], at() - 1);
  assert.equal(record(s, "survival_seconds"), 300);
  advance(300000);
  s.snapshot([p(A, "Rex", 999999999)], at());
  assert.equal(record(s, "journey_metres"), 100);
  assert.equal(record(s, "rex_seconds"), 600);
});
test("species switch and excessive gap never award the preceding species", (t) => {
  const { s, p, at, advance } = setup(t);
  s.snapshot([p()], at());
  advance(300000);
  s.snapshot([p(A, "Trike")], at());
  assert.equal(s.mine(A).mastery.length, 0);
  advance(300000);
  s.snapshot([p(A, "Trike")], at());
  assert.equal(s.mine(A).mastery[0].species, "trike");
  assert.equal(s.mine(A).mastery[0].seconds, 300);
  advance(1000000);
  s.snapshot([p(A, "Trike")], at());
  assert.equal(s.mine(A).mastery[0].seconds, 300);
});
test("gameplay events are idempotent and reject payload changes atomically", (t) => {
  const { s, at, db } = setup(t);
  const e = {
    id: "coins:test",
    type: "gameplay_coins",
    steamId: A,
    at: at(),
    value: 100,
  };
  s.ingest(e);
  assert.equal(s.ingest(e).duplicate, true);
  assert.throws(() => s.ingest({ ...e, value: 200 }), /conflicts/);
  assert.equal(record(s, "gameplay_coins"), 100);
  assert.equal(db.prepare("SELECT count(*) AS n FROM vl_events").get().n, 1);
});
test("late combat deaths recompute streaks and close observed life", (t) => {
  const { s, p, at, advance } = setup(t);
  s.snapshot([p()], at());
  const start = at();
  advance(10000);
  for (const [id, offset] of [
    ["a", 1],
    ["b", 3],
    ["c", 4],
  ])
    s.ingest({ id, type: "combat_kill", steamId: A, at: start + offset });
  assert.equal(record(s, "kill_streak"), 3);
  s.ingest({ id: "death", type: "combat_death", steamId: A, at: start + 2 });
  assert.equal(record(s, "kill_streak"), 2);
  assert.ok(s.mine(A).lives[0].ended_at);
});
test("season reset retains all-time records and freezes Hall of Fame", (t) => {
  const { s, at, advance } = setup(t);
  const start = at();
  s.ingest({
    id: "one",
    type: "gameplay_coins",
    steamId: A,
    at: at(),
    value: 40,
  });
  advance(1000);
  const next = s.rotate("Season two");
  assert.equal(record(s, "gameplay_coins", next.id), 0);
  assert.equal(record(s, "gameplay_coins"), 40);
  assert.throws(
    () =>
      s.ingest({ id: "late", type: "gameplay_coins", steamId: A, at: start }),
    /closed season/,
  );
  s.ingest({
    id: "two",
    type: "gameplay_coins",
    steamId: A,
    at: at(),
    value: 20,
  });
  assert.equal(record(s, "gameplay_coins"), 60);
  assert.equal(
    s
      .overview()
      .hallOfFame[0].winners.find((w) => w.metric === "gameplay_coins").value,
    40,
  );
});
test("nest ownership, duplicate requests, oversubscription and automatic closure", (t) => {
  const { s, p, at } = setup(t);
  s.snapshot([p()], at());
  const parent = s.mine(A).lives[0].id;
  assert.throws(
    () => s.createNest(B, { parent, eggs: 1 }),
    /currently observed/,
  );
  const nest = s.createNest(A, { parent, eggs: 1, name: "Test" }).id;
  const r = s.requestEgg(B, "B", nest);
  assert.equal(s.requestEgg(B, "B", nest).id, r.id);
  const r2 = s.requestEgg(C, "C", nest);
  assert.throws(() => s.manageNest(B, nest, { action: "close" }), /not found/);
  s.manageNest(A, nest, { action: "accept", requestId: r.id });
  s.manageNest(A, nest, { action: "accept", requestId: r.id });
  assert.throws(
    () => s.manageNest(A, nest, { action: "accept", requestId: r2.id }),
    /No eggs/,
  );
  assert.equal(s.overview().nests.length, 0);
  assert.equal(s.mine(A).nests[0].remaining, 0);
  assert.equal(record(s, "offspring"), 0);
});
test("expired nests cannot accept requests", (t) => {
  const { s, p, at, advance } = setup(t);
  s.snapshot([p()], at());
  const n = s.createNest(A, { parent: s.mine(A).lives[0].id, eggs: 6 }).id;
  advance(86400001);
  assert.throws(() => s.requestEgg(B, "B", n), /no longer/);
});
test("verified lineage is immutable, acyclic and increments offspring only once", (t) => {
  const { s, p, at, advance } = setup(t);
  s.snapshot([p()], at());
  const parent = s.mine(A).lives[0].id;
  advance(1000);
  s.snapshot([p(), p(B)], at());
  const child = s.mine(B).lives[0].id;
  const input = { child, parents: [parent], evidence: "test-hatch:1" };
  s.hatch(input);
  assert.equal(s.hatch(input).duplicate, true);
  assert.equal(s.mine(B).lives[0].generation, 2);
  assert.equal(record(s, "offspring"), 1);
  assert.throws(
    () => s.hatch({ child: parent, parents: [child], evidence: "bad" }),
    /earlier/,
  );
  assert.equal(s.mine(A).lives[0].offspring[0].id, child);
});
test("public records exclude Steam IDs and private locations", (t) => {
  const { s, p, at, advance } = setup(t);
  s.snapshot([p()], at());
  advance(300000);
  s.snapshot([p()], at());
  s.ingest({
    id: "coin",
    type: "gameplay_coins",
    steamId: A,
    at: at(),
    value: 5,
  });
  const json = JSON.stringify(s.overview());
  assert.ok(!json.includes(A));
  assert.ok(!json.includes("location"));
});
