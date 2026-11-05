"use strict";
const test = require('node:test'), assert = require('node:assert/strict'), { DatabaseSync } = require('node:sqlite');
const { describe, createSeasonTrackStore } = require('../src/services/seasonTrackStore');
const { createAchievementSourceTimeStore } = require('../src/services/achievementSourceTime');
const A = '76561198000000401', B = '76561198000000402', START = Date.parse('2027-01-01T00:00:00Z');
const iso = value => new Date(value).toISOString();
function definition() {
  return { id: 'synthetic-achievement-season', title: 'Synthetic achievement points', startsAt: iso(START), endsAt: iso(START + 7 * 86400000), settlesAt: iso(START + 8 * 86400000), retainUntil: iso(START + 30 * 86400000), free: true,
    sources: [{ source: 'quest', policy: 'achievement-time' }], tiers: [{ xp: 25, title: 'First milestone' }, { xp: 100, title: 'Explorer' }],
    achievementPoints: { policy: 'qualifying-source-time', awards: [{ id: 'quest-1', xp: 25 }, { id: 'event-1', xp: 40 }] } };
}
function fixture(t, patch = {}) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`CREATE TABLE progression_xp_ledger(id TEXT PRIMARY KEY,steam_id TEXT,amount INTEGER,source TEXT,reference_type TEXT,created_at TEXT);
    CREATE TABLE progression_xp_source_times(ledger_id TEXT PRIMARY KEY,source_at INTEGER,basis TEXT);
    CREATE TABLE progression_achievements(steam_id TEXT,achievement_id TEXT,metadata_json TEXT,unlocked_at TEXT,PRIMARY KEY(steam_id,achievement_id));
    CREATE TABLE economy_quest_achievements(steam_id TEXT,quest_id TEXT,period_key TEXT,achieved_at TEXT);
    CREATE TABLE event_attendance(steam_id TEXT,event_id TEXT,status TEXT,confirmed_at TEXT);
    CREATE TABLE progression_achievement_review_state(steam_id TEXT,achievement_id TEXT,status TEXT);
    CREATE TABLE progression_achievement_evidence_reviews(steam_id TEXT,achievement_id TEXT,status TEXT);
    CREATE TABLE wallet_fixture(balance INTEGER);INSERT INTO wallet_fixture VALUES(1234);`);
  let clock = START - 1000;
  const sources = createAchievementSourceTimeStore(db, { now: () => clock }), store = createSeasonTrackStore(db, { now: () => clock });
  const def = { ...definition(), ...patch }, digest = describe(def).digest;
  store.stage(def, { digest, reviewer: A }); store.changeState(def.id, { digest, reviewer: A, expectedRevision: 1, action: 'publish' }); clock = START;
  const enroll = (who = A) => store.enroll(def.id, who);
  function award(id = 'quest-1', sourceAt = clock, who = A) {
    const quest = id === 'quest-1';
    if (quest) db.prepare('INSERT INTO economy_quest_achievements VALUES(?,?,?,?)').run(who, 'synthetic-quest-' + who, 'synthetic-period', iso(sourceAt));
    else db.prepare('INSERT INTO event_attendance VALUES(?,?,?,?)').run(who, 'synthetic-event-' + who, 'paid', iso(sourceAt));
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare('INSERT INTO progression_achievements VALUES(?,?,?,?)').run(who, id, JSON.stringify({ type: quest ? 'quests' : 'events', threshold: 1, value: 1 }), iso(clock));
      sources.recordNewAward(who, id); db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function xp() { db.prepare('INSERT INTO progression_xp_ledger VALUES(?,?,?,?,?,?)').run('existing-xp', A, 10, 'quest', 'quest', iso(clock)); db.prepare('INSERT INTO progression_xp_source_times VALUES(?,?,?)').run('existing-xp', clock, 'quest-achievement'); }
  return { db, store, def, digest, enroll, award, xp, clock: value => { clock = value; } };
}
test('achievement rules require explicit bounded amounts and source policy, preserve old digests and reject unsupported families', () => {
  const def = definition(), value = describe(def);
  assert.deepEqual(describe({ ...def, achievementPoints: { ...def.achievementPoints, awards: [...def.achievementPoints.awards].reverse() } }), value);
  for (const achievementPoints of [null, { policy: 'unlock-date', awards: def.achievementPoints.awards },
    { policy: 'qualifying-source-time', awards: [] }, { policy: 'qualifying-source-time', awards: [{ id: 'prime-observed', xp: 1 }] },
    { policy: 'qualifying-source-time', awards: [{ id: '__proto__', xp: 1 }] }, { policy: 'qualifying-source-time', awards: [{ id: 'quest-1', xp: 0 }] },
    { policy: 'qualifying-source-time', awards: [{ id: 'quest-1', xp: 1000001 }] }, { policy: 'qualifying-source-time', awards: [{ id: 'quest-1', xp: 1, coins: 1 }] },
    { policy: 'qualifying-source-time', awards: [{ id: 'quest-1', xp: 1 }, { id: 'quest-1', xp: 2 }] }]) assert.throws(() => describe({ ...def, achievementPoints }));
  const old = { ...def }; delete old.achievementPoints; assert.equal(Object.hasOwn(describe(old).definition, 'achievementPoints'), false);
  assert.notEqual(describe(old).digest, value.digest); assert.equal(describe({ ...def, sources: [] }).definition.sources.length, 0);
});
test('reviewed achievement points add once to seasonal XP, recheck source evidence on reads and never write permanent XP or wallets', t => {
  const f = fixture(t); f.enroll(); f.award(); f.award('event-1', START, B); f.xp();
  assert.equal(f.store.progress(f.def.id, A).xp, 0); assert.equal(f.store.progress(f.def.id, A).pending, true);
  const result = f.store.reconcile(f.def.id, A); assert.equal(result.achievementAccepted, 1);
  assert.equal(f.store.progress(f.def.id, A).xp, 35); assert.equal(f.store.progress(f.def.id, A).achievementXp, 25);
  assert.equal(f.store.reconcile(f.def.id, A).achievementAccepted, 0);
  f.db.prepare('INSERT INTO progression_achievement_review_state VALUES(?,?,?)').run(A, 'quest-1', 'withdrawn');
  assert.equal(f.store.progress(f.def.id, A).xp, 10); assert.equal(f.store.progress(f.def.id, A).evidenceUnavailable, true);
  f.db.exec('DELETE FROM progression_achievement_review_state'); assert.equal(f.store.progress(f.def.id, A).xp, 35);
  f.db.prepare('UPDATE economy_quest_achievements SET achieved_at=? WHERE steam_id=?').run(iso(START - 1), A);
  assert.equal(f.store.progress(f.def.id, A).xp, 10); assert.equal(f.db.prepare('SELECT balance FROM wallet_fixture').get().balance, 1234);
  assert.equal(f.db.prepare('SELECT count(*) n FROM progression_xp_ledger').get().n, 1);
});
test('pre-consent receipts, old source dates, late settlement receipts and future clocks cannot bypass eligibility', t => {
  const early = fixture(t); early.award('quest-1', START + 1000); early.enroll(); early.clock(START + 1000); early.store.reconcile(early.def.id, A); assert.equal(early.store.progress(early.def.id, A).xp, 0);
  const old = fixture(t); old.enroll(); old.award('quest-1', START - 1); old.store.reconcile(old.def.id, A); assert.equal(old.store.progress(old.def.id, A).xp, 0);
  const late = fixture(t); late.enroll(); late.clock(Date.parse(late.def.settlesAt)); late.award('quest-1', START); late.store.reconcile(late.def.id, A); assert.equal(late.store.progress(late.def.id, A).xp, 0);
  const future = fixture(t); future.enroll(); future.award('quest-1', START + 1000); future.store.reconcile(future.def.id, A); assert.equal(future.store.progress(future.def.id, A).xp, 0);
  future.clock(START + 1000); assert.equal(future.store.progress(future.def.id, A).pending, true); future.store.reconcile(future.def.id, A); assert.equal(future.store.progress(future.def.id, A).xp, 25);
});
test('timely delayed achievement receipts reconcile after closure and partial failures roll back copied points and the XP cursor', t => {
  const f = fixture(t); f.enroll(); f.xp(); f.award();
  f.db.exec("CREATE TRIGGER refuse_season_achievement BEFORE INSERT ON progression_season_achievement_evidence BEGIN SELECT RAISE(ABORT,'copy unavailable'); END");
  assert.throws(() => f.store.reconcile(f.def.id, A), /copy unavailable/); assert.equal(f.store.progress(f.def.id, A).xp, 0); assert.equal(f.store.enroll(f.def.id, A).cursor, 0);
  f.db.exec('DROP TRIGGER refuse_season_achievement');
  f.clock(Date.parse(f.def.settlesAt)); f.store.changeState(f.def.id, { action: 'close', reviewer: A, digest: f.digest, expectedRevision: 2 });
  f.store.reconcile(f.def.id, A); assert.equal(f.store.progress(f.def.id, A).xp, 35);
});
test('deletion/rejoin and reviewed retention remove achievement copies and consent floors, preserving original achievements', t => {
  const f = fixture(t, { sources: [] }); f.enroll(); f.award(); f.store.reconcile(f.def.id, A); assert.equal(f.store.progress(f.def.id, A).xp, 25);
  f.store.erase(f.def.id, A); f.enroll(); f.store.reconcile(f.def.id, A); assert.equal(f.store.progress(f.def.id, A).xp, 0);
  f.clock(Date.parse(f.def.retainUntil)); for (let n = 0; n < 10; n++) f.store.maintain({ limit: 1 });
  for (const table of ['progression_season_achievement_evidence','progression_season_achievement_cursors']) assert.equal(f.db.prepare('SELECT count(*) n FROM ' + table).get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM progression_achievements').get().n, 1); assert.equal(f.db.prepare('SELECT count(*) n FROM progression_achievement_sources').get().n, 1);
});
