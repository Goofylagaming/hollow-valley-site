"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createAchievementSourceTimeStore } = require('../src/services/achievementSourceTime');
const A = '76561198000000401', B = '76561198000000402', NOW = Date.parse('2026-11-06T12:00:00Z');
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`CREATE TABLE progression_achievements(steam_id TEXT,achievement_id TEXT,metadata_json TEXT,unlocked_at TEXT,PRIMARY KEY(steam_id,achievement_id));
    CREATE TABLE economy_quest_achievements(steam_id TEXT,quest_id TEXT,period_key TEXT,achieved_at TEXT);
    CREATE TABLE event_attendance(steam_id TEXT,event_id TEXT,status TEXT,confirmed_at TEXT);
    CREATE TABLE progression_achievement_review_state(steam_id TEXT,achievement_id TEXT,status TEXT);
    CREATE TABLE progression_achievement_evidence_reviews(steam_id TEXT,achievement_id TEXT,status TEXT);`);
  let at = NOW; const store = createAchievementSourceTimeStore(db, { now: () => at });
  const award = (id, type, threshold) => db.prepare('INSERT INTO progression_achievements VALUES(?,?,?,?)').run(A, id, JSON.stringify({ type, threshold, value: threshold }), new Date(NOW).toISOString());
  const quest = (id, time, who = A) => db.prepare('INSERT INTO economy_quest_achievements VALUES(?,?,?,?)').run(who, id, 'synthetic-period', time);
  const record = id => { db.exec('BEGIN IMMEDIATE'); try { const result = store.recordNewAward(A, id); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  return { db, store, award, quest, record, clock: value => { at = value; } };
}
test('delayed quest achievements retain the original threshold source clock, not their later unlock date', t => {
  const f = fixture(t); f.award('quest-25', 'quests', 25);
  for (let n = 25; n >= 0; n--) f.quest('quest-' + n, new Date(NOW - (26 - n) * 60000).toISOString());
  f.quest('other-account', '2020-01-01 00:00:00', B);
  assert.equal(f.record('quest-25'), true);
  const result = f.store.read(A, 'quest-25'); assert.equal(result.available, true); assert.equal(result.sourceAt, NOW - 2 * 60000);
  assert.equal(result.basis, 'quest-threshold'); assert.equal(result.recordedAt, NOW);
  assert.equal(f.record('quest-25'), false); assert.equal(f.store.read(B, 'quest-25'), null);
  const before = f.db.prepare('SELECT total_changes() n').get().n; f.store.read(A, 'quest-25'); assert.equal(f.db.prepare('SELECT total_changes() n').get().n, before);
});
test('paid-event thresholds preserve staff confirmation time and ignore RSVP, unpaid and other-account records', t => {
  const f = fixture(t); f.award('event-1', 'events', 1);
  const insert = f.db.prepare('INSERT INTO event_attendance VALUES(?,?,?,?)');
  insert.run(A, 'rsvp', 'registered', '2020-01-01 00:00:00'); insert.run(B, 'other', 'paid', '2020-01-01 00:00:00'); insert.run(A, 'confirmed', 'paid', '2026-11-05 01:02:03');
  assert.equal(f.record('event-1'), true); const value = f.store.read(A, 'event-1');
  assert.equal(value.sourceAt, Date.parse('2026-11-05T01:02:03Z')); assert.equal(value.basis, 'paid-confirmation-threshold');
  f.db.exec("UPDATE event_attendance SET status='revoked' WHERE event_id='confirmed'"); assert.deepEqual(f.store.read(A, 'event-1'), { available: false });
});
test('unknown, ambiguous and impossible clocks do not acquire a fabricated achievement source date', t => {
  for (const raw of [null, '', '2026-11-05T01:02:03', '2026-02-30 00:00:00', new Date(NOW + 120001).toISOString()]) {
    const f = fixture(t); f.award('quest-1', 'quests', 1); f.quest('bad-clock', raw); assert.equal(f.record('quest-1'), false); assert.equal(f.store.read(A, 'quest-1'), null);
  }
  const f = fixture(t); f.award('quest-1', 'quests', 1); f.quest('known', '2026-11-05 00:00:00'); f.quest('unknown', null);
  assert.equal(f.record('quest-1'), false, 'an unknown completion might precede the apparent first known quest');
});
test('source mutation, earlier late imports, review flags and withdrawals withhold timing without rewriting it', t => {
  const f = fixture(t); f.award('quest-1', 'quests', 1); f.quest('one', '2026-11-05 00:00:00'); f.record('quest-1');
  const initial = f.db.prepare('SELECT * FROM progression_achievement_sources').get();
  f.db.prepare('INSERT INTO progression_achievement_review_state VALUES(?,?,?)').run(A, 'quest-1', 'withdrawn'); assert.equal(f.store.read(A, 'quest-1').available, false);
  f.db.exec('DELETE FROM progression_achievement_review_state'); f.db.prepare('INSERT INTO progression_achievement_evidence_reviews VALUES(?,?,?)').run(A, 'quest-1', 'pending'); assert.equal(f.store.read(A, 'quest-1').available, false);
  f.db.exec('DELETE FROM progression_achievement_evidence_reviews'); assert.equal(f.store.read(A, 'quest-1').available, true);
  f.quest('late-earlier', '2026-11-04 00:00:00'); assert.equal(f.store.read(A, 'quest-1').available, false); assert.equal(f.record('quest-1'), false);
  assert.deepEqual(f.db.prepare('SELECT * FROM progression_achievement_sources').get(), initial);
  f.db.exec("DELETE FROM economy_quest_achievements WHERE quest_id='late-earlier'; UPDATE progression_achievements SET metadata_json='{}'"); assert.equal(f.store.read(A, 'quest-1').available, false);
});
test('collector requires an unlock transaction and source clocks within skew are not eligible early', t => {
  const f = fixture(t); f.award('quest-1', 'quests', 1); f.quest('skew', new Date(NOW + 1000).toISOString());
  assert.throws(() => f.store.recordNewAward(A, 'quest-1'), /unlock transaction/);
  assert.equal(f.record('quest-1'), true); assert.equal(f.store.read(A, 'quest-1').available, false);
  f.clock(NOW + 1000); assert.equal(f.store.read(A, 'quest-1').available, true);
});
test('removing a permanent achievement removes its timing receipt without changing other permanent awards', t => {
  const f = fixture(t); f.award('quest-1', 'quests', 1); f.quest('original', '2026-11-05 00:00:00'); f.record('quest-1');
  f.award('event-1', 'events', 1);
  f.db.prepare("DELETE FROM progression_achievements WHERE steam_id=? AND achievement_id='quest-1'").run(A);
  assert.equal(f.store.read(A, 'quest-1'), null); assert.equal(f.db.prepare('SELECT count(*) n FROM progression_achievements').get().n, 1);
});
test('real achievement unlocks atomically retain source receipts, never backfill old awards and never issue XP or coins', t => {
  const previous = process.env.AUTOMATION_DB_PATH; process.env.AUTOMATION_DB_PATH = ':memory:';
  const economyPath = require.resolve('../src/services/economyStore'), progressionPath = require.resolve('../src/services/progressionService');
  delete require.cache[economyPath]; delete require.cache[progressionPath];
  const economy = require(economyPath), progression = require(progressionPath), times = createAchievementSourceTimeStore(economy.db);
  t.after(() => { economy.db.close(); delete require.cache[economyPath]; delete require.cache[progressionPath]; if (previous === undefined) delete process.env.AUTOMATION_DB_PATH; else process.env.AUTOMATION_DB_PATH = previous; });
  economy.ensureWallet(A);
  economy.db.prepare("INSERT INTO economy_quest_achievements(steam_id,quest_id,period_key,boost_percent,achieved_at) VALUES(?,'daily-consecutive-1h','synthetic-period',5,'2026-10-01 00:00:00')").run(A);
  economy.db.exec("CREATE TRIGGER refuse_achievement_source BEFORE INSERT ON progression_achievement_sources BEGIN SELECT RAISE(ABORT,'achievement source unavailable'); END");
  assert.throws(() => progression.unlockEligibleAchievements(A), /achievement source unavailable/);
  assert.equal(economy.db.prepare('SELECT count(*) n FROM progression_achievements').get().n, 0);
  economy.db.exec('DROP TRIGGER refuse_achievement_source'); progression.unlockEligibleAchievements(A);
  assert.equal(times.read(A, 'quest-1').sourceAt, Date.parse('2026-10-01T00:00:00Z'));
  economy.db.exec('DELETE FROM progression_achievement_sources'); progression.unlockEligibleAchievements(A);
  assert.equal(times.read(A, 'quest-1'), null, 'existing awards are not upgraded by duplicate reconciliation');
  assert.equal(economy.db.prepare('SELECT count(*) n FROM progression_xp_ledger').get().n, 0); assert.equal(economy.getWallet(A).balance, 0);
  economy.db.prepare("DELETE FROM progression_achievements WHERE steam_id=? AND achievement_id='quest-1'").run(A);
  economy.db.exec("CREATE TRIGGER refuse_post_xp_achievement_source BEFORE INSERT ON progression_achievement_sources BEGIN SELECT RAISE(ABORT,'achievement source unavailable'); END");
  const xp = { steamId: A, amount: 250, source: 'quest', referenceType: 'quest', referenceId: 'synthetic-existing-xp', idempotencyKey: 'synthetic-existing-xp', reason: 'Existing XP fixture' };
  assert.throws(() => progression.awardXp(xp), /achievement source unavailable/);
  assert.equal(economy.getWallet(A).balance, 100, 'the existing XP/level transaction was already committed before achievement reconciliation');
  assert.equal(economy.db.prepare('SELECT count(*) n FROM progression_xp_ledger').get().n, 1);
  economy.db.exec('DROP TRIGGER refuse_post_xp_achievement_source');
  assert.equal(progression.awardXp(xp).duplicate, true); progression.unlockEligibleAchievements(A);
  assert.equal(economy.getWallet(A).balance, 100); assert.equal(economy.db.prepare('SELECT count(*) n FROM progression_xp_ledger').get().n, 1);
  assert.equal(times.read(A, 'quest-1').sourceAt, Date.parse('2026-10-01T00:00:00Z'));
});
