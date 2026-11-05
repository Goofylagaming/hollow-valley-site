"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { describe, createSeasonTrackStore } = require('../src/services/seasonTrackStore');
const A = '76561198000000401', B = '76561198000000402';
const START = Date.parse('2027-01-01T00:00:00Z'), END = START + 56 * 86400000, SETTLE = END + 86400000;
const iso = ms => new Date(ms).toISOString();
function definition(id = 'synthetic-season') {
  return { id, title: 'Synthetic free season', startsAt: iso(START), endsAt: iso(END), settlesAt: iso(SETTLE), retainUntil: iso(SETTLE + 90 * 86400000), free: true,
    sources: [{ source: 'playtime', policy: 'interval-end' }, { source: 'quest', policy: 'achievement-time' }, { source: 'event', policy: 'confirmation-time' }],
    tiers: [{ xp: 10, title: 'First steps' }, { xp: 100, title: 'Explorer' }] };
}
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec(`CREATE TABLE progression_xp_ledger(id TEXT PRIMARY KEY,steam_id TEXT,amount INTEGER,source TEXT,reference_type TEXT,created_at TEXT);
    CREATE TABLE progression_xp_source_times(ledger_id TEXT PRIMARY KEY,source_at INTEGER,basis TEXT);
    CREATE TABLE wallet_fixture(steam_id TEXT PRIMARY KEY,balance INTEGER); INSERT INTO wallet_fixture VALUES('${A}',1234);`);
  let at = START - 10000, paused = false;
  const store = createSeasonTrackStore(db, { now: () => at, writable: () => { if (paused) throw new Error('Read only'); } });
  const def = definition(), digest = describe(def).digest;
  const stage = () => store.stage(def, { reviewer: A, digest });
  const publish = () => { stage(); return store.changeState(def.id, { action: 'publish', digest, expectedRevision: 1, reviewer: A }); };
  function grant(id, { who = A, amount = 10, source = 'quest', time = at, receivedAt = at, basis, reference, known = true } = {}) {
    const contract = { quest: ['quest', 'quest-achievement'], event: ['event', 'event-confirmation'], playtime: ['playtime_interval', 'playtime-observation'] }[source] || ['bad', 'bad'];
    db.prepare('INSERT INTO progression_xp_ledger VALUES(?,?,?,?,?,?)').run(id, who, amount, source, reference || contract[0], typeof receivedAt === 'number' ? iso(receivedAt) : receivedAt);
    if (known) db.prepare('INSERT INTO progression_xp_source_times VALUES(?,?,?)').run(id, time, basis || contract[1]);
  }
  return { db, store, def, digest, stage, publish, grant, clock: value => { at = value; }, pause: () => { paused = true; } };
}
test('season review canonicalizes exact free rules and rejects unknown sources, payments and ambiguous windows', () => {
  const def = definition(), expected = describe(def);
  assert.deepEqual(describe({ ...def, sources: [...def.sources].reverse() }), expected);
  for (const patch of [ { free: false }, { price: 1 }, { startsAt: '2027-01-01T00:00:00' }, { endsAt: iso(START) },
    { settlesAt: iso(END - 1) }, { settlesAt: iso(END + 31 * 86400000) }, { sources: [] },
    { sources: [{ source: 'achievement', policy: 'unlock-time' }] }, { sources: [{ source: '__proto__', policy: 'bad' }] },
    { sources: [{ source: 'event', policy: 'actual-attendance' }] }, { sources: [def.sources[0], def.sources[0]] },
    { tiers: [{ xp: 10, title: 'A', coins: 10 }] }, { tiers: [{ xp: 10, title: 'A' }, { xp: 10, title: 'B' }] } ]) {
    assert.throws(() => describe({ ...def, ...patch }));
  }
});
test('staging and publishing bind exact rules, current revision and atomic audit; seasons cannot overlap or reopen', t => {
  const f = fixture(t), { store, db, def, digest } = f;
  assert.throws(() => store.stage(def, { reviewer: A, digest: 'wrong' }), /changed/);
  db.exec("CREATE TRIGGER fail_season_audit BEFORE INSERT ON progression_season_audit BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.throws(f.stage, /audit unavailable/); assert.equal(db.prepare('SELECT count(*) n FROM progression_seasons').get().n, 0);
  db.exec('DROP TRIGGER fail_season_audit'); f.stage(); assert.equal(f.stage().duplicate, true);
  assert.throws(() => store.stage({ ...def, title: 'Changed title' }, { reviewer: A, digest: describe({ ...def, title: 'Changed title' }).digest }), /immutable/);
  assert.throws(() => store.changeState(def.id, { reviewer: A, digest, action: 'publish', expectedRevision: 2 }), /changed/);
  store.changeState(def.id, { reviewer: A, digest, action: 'publish', expectedRevision: 1 });
  const other = definition('overlapping-season'), otherDigest = describe(other).digest;
  store.stage(other, { reviewer: A, digest: otherDigest });
  assert.throws(() => store.changeState(other.id, { reviewer: A, digest: otherDigest, action: 'publish', expectedRevision: 1 }), /overlap/);
  assert.throws(() => store.changeState(def.id, { reviewer: A, digest, action: 'close', expectedRevision: 2 }), /window/);
  f.clock(SETTLE); store.changeState(def.id, { reviewer: A, digest, action: 'close', expectedRevision: 2 });
  assert.throws(() => store.changeState(def.id, { reviewer: A, digest, action: 'publish', expectedRevision: 3 }), /future staged/);
});
test('only post-enrollment in-window source evidence counts; ledger writes cannot move old XP into a season', t => {
  const f = fixture(t); f.publish();
  assert.throws(() => f.store.enroll(f.def.id, A), /not open/);
  f.clock(START + 1000); f.store.enroll(f.def.id, A); f.clock(START + 2000);
  assert.equal(f.store.enroll(f.def.id, A).enrolledAt, START + 1000);
  f.grant('old-quest', { time: START - 1 }); f.grant('pre-consent', { time: START + 500 });
  f.grant('start', { time: START + 1000 }); f.grant('unknown', { known: false });
  f.grant('wrong-kind', { basis: 'event-confirmation' }); f.grant('wrong-ref', { reference: 'manual' });
  f.grant('other-account', { who: B }); f.grant('manual', { source: 'admin' });
  f.grant('end-exclusive', { time: END });
  assert.deepEqual(f.store.reconcile(f.def.id, A), { accepted: 1, scanned: 8, more: false });
  const progress = f.store.progress(f.def.id, A); assert.equal(progress.xp, 10); assert.equal(progress.tier, 1);
  assert.equal(progress.nextTier.title, 'Explorer'); assert.equal(progress.pending, false);
  assert.equal(f.store.progress(f.def.id, B).enrolled, false);
  assert.equal(f.db.prepare('SELECT balance FROM wallet_fixture').get().balance, 1234);
  assert.equal(f.db.prepare('SELECT count(*) n FROM progression_xp_ledger').get().n, 9);
  assert.equal(f.store.reconcile(f.def.id, A).accepted, 0);
});
test('reviewed interval-end and confirmation-time policy is explicit; future skew never advances current progress', t => {
  const f = fixture(t); f.publish(); f.clock(START); f.store.enroll(f.def.id, A);
  f.grant('interval-crosses-start', { source: 'playtime', time: START });
  f.grant('staff-confirmation', { source: 'event', time: START + 1000 });
  f.store.reconcile(f.def.id, A); assert.equal(f.store.progress(f.def.id, A).xp, 10);
  f.clock(START + 1000); assert.equal(f.store.progress(f.def.id, A).xp, 20);
});
test('delayed source grants settle by receipt time; offline reconciliation works after closure without accepting late receipts', t => {
  const f = fixture(t); f.publish(); f.clock(START); f.store.enroll(f.def.id, A);
  f.clock(END + 1000); f.grant('delayed-valid', { time: END - 1 });
  f.clock(SETTLE); f.grant('too-late', { time: END - 1 });
  f.grant('ambiguous-receipt', { time: END - 1, receivedAt: '2027-01-02T01:02:03' });
  f.store.changeState(f.def.id, { reviewer: A, digest: f.digest, action: 'close', expectedRevision: 2 });
  assert.throws(() => f.store.enroll(f.def.id, B), /not open/);
  assert.equal(f.store.reconcile(f.def.id, A).accepted, 1);
  const progress = f.store.progress(f.def.id, A); assert.equal(progress.xp, 10); assert.equal(progress.collectionClosed, true);
});
test('bounded batches report unfinished work and audit failure rolls back both evidence and cursor', t => {
  const f = fixture(t); f.publish(); f.clock(START); f.store.enroll(f.def.id, A);
  for (let i = 0; i < 5; i++) f.grant('batch-' + i);
  f.db.exec("CREATE TRIGGER fail_season_evidence BEFORE INSERT ON progression_season_evidence BEGIN SELECT RAISE(ABORT,'evidence unavailable'); END");
  assert.throws(() => f.store.reconcile(f.def.id, A, { limit: 2 }), /evidence unavailable/);
  assert.equal(f.store.progress(f.def.id, A).xp, 0); assert.equal(f.store.enroll(f.def.id, A).cursor, 0);
  f.db.exec('DROP TRIGGER fail_season_evidence');
  assert.deepEqual(f.store.reconcile(f.def.id, A, { limit: 2 }), { accepted: 2, scanned: 2, more: true });
  assert.equal(f.store.progress(f.def.id, A).pending, true);
  assert.equal(f.store.reconcile(f.def.id, A, { limit: 2 }).accepted, 2);
  assert.equal(f.store.reconcile(f.def.id, A, { limit: 2 }).accepted, 1);
  assert.equal(f.store.progress(f.def.id, A).xp, 50); assert.equal(f.store.progress(f.def.id, A).pending, false);
});
test('changed or removed source evidence stops counting; private deletion survives damaged catalog and rejoin never backfills', t => {
  const f = fixture(t); f.publish(); f.clock(START); f.store.enroll(f.def.id, A); f.grant('one'); f.grant('two');
  f.store.reconcile(f.def.id, A); assert.equal(f.store.progress(f.def.id, A).xp, 20);
  f.db.prepare("UPDATE progression_xp_ledger SET amount=100 WHERE id='one'").run();
  f.db.prepare("DELETE FROM progression_xp_source_times WHERE ledger_id='two'").run();
  const broken = f.store.progress(f.def.id, A); assert.equal(broken.xp, 0); assert.equal(broken.evidenceUnavailable, true);
  f.clock(START + 1000); f.store.erase(f.def.id, A); f.store.enroll(f.def.id, A);
  f.store.reconcile(f.def.id, A); assert.equal(f.store.progress(f.def.id, A).xp, 0);
  f.db.exec("DELETE FROM progression_season_audit");
  assert.throws(() => f.store.progress(f.def.id, A), /unavailable/);
  assert.deepEqual(f.store.erase(f.def.id, A), { erased: true });
  assert.equal(f.db.prepare('SELECT count(*) n FROM progression_season_evidence').get().n, 0);
});
test('private progress reads perform no writes, writable guard blocks mutations, and stage-only rules cannot collect XP', t => {
  const f = fixture(t); f.stage(); f.clock(START);
  assert.throws(() => f.store.enroll(f.def.id, A), /not open/);
  const before = f.db.prepare('SELECT total_changes() n').get().n;
  assert.equal(f.store.progress(f.def.id, A).xp, 0);
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n, before);
  f.pause(); assert.throws(() => f.store.erase(f.def.id, A), /Read only/);
  assert.throws(() => f.store.stage(definition('new-season'), { reviewer: A, digest: describe(definition('new-season')).digest }), /Read only/);
});
test('consent binds a ledger position so preexisting grants and same-clock re-enrollment cannot backfill points', t => {
  const f = fixture(t); f.publish(); f.clock(START); f.grant('preexisting-future-clock', { time: START + 1000 });
  f.store.enroll(f.def.id, A); f.grant('after-consent'); f.store.reconcile(f.def.id, A);
  assert.equal(f.store.progress(f.def.id, A).xp, 10);
  f.store.erase(f.def.id, A); f.store.enroll(f.def.id, A);
  f.clock(START + 1000); assert.equal(f.store.reconcile(f.def.id, A).accepted, 0);
  assert.equal(f.store.progress(f.def.id, A).xp, 0);
});
test('a selected source subset, malformed amounts and impossible receipt/source clocks never manufacture seasonal points', t => {
  const f = fixture(t), def = { ...f.def, sources: [{ source: 'quest', policy: 'achievement-time' }] }, digest = describe(def).digest;
  f.store.stage(def, { reviewer: A, digest }); f.store.changeState(def.id, { reviewer: A, digest, action: 'publish', expectedRevision: 1 });
  f.clock(START); f.store.enroll(def.id, A);
  f.grant('disabled-event', { source: 'event' }); f.grant('disabled-playtime', { source: 'playtime' });
  f.grant('zero', { amount: 0 }); f.grant('negative', { amount: -1 }); f.grant('fractional', { amount: 0.5 });
  f.grant('huge', { amount: 1000000001 }); f.grant('implausible-source-clock', { time: START + 120001 });
  f.grant('valid', { amount: 100 });
  f.clock(START + 120001);
  assert.equal(f.store.reconcile(def.id, A).accepted, 1);
  const progress = f.store.progress(def.id, A); assert.equal(progress.xp, 100); assert.equal(progress.tier, 2); assert.equal(progress.nextTier, null);
});
test('a stable source position survives SQLite rowid reuse after a removed permanent grant', t => {
  const f = fixture(t); f.publish(); f.clock(START); f.store.enroll(f.def.id, A);
  f.grant('removed'); const oldRowid = f.db.prepare("SELECT rowid FROM progression_xp_ledger WHERE id='removed'").get().rowid;
  f.store.reconcile(f.def.id, A); f.db.exec("DELETE FROM progression_xp_ledger WHERE id='removed'");
  f.grant('replacement'); assert.equal(f.db.prepare("SELECT rowid FROM progression_xp_ledger WHERE id='replacement'").get().rowid, oldRowid);
  assert.equal(f.store.progress(f.def.id, A).pending, true);
  assert.equal(f.store.reconcile(f.def.id, A).accepted, 1);
  assert.equal(f.store.progress(f.def.id, A).xp, 10);
});
test('initialized source indexing shares the real permanent grant transaction and preserves the existing level reward', t => {
  const previous = process.env.AUTOMATION_DB_PATH;
  process.env.AUTOMATION_DB_PATH = ':memory:';
  const storePath = require.resolve('../src/services/economyStore'), progressionPath = require.resolve('../src/services/progressionService');
  delete require.cache[storePath]; delete require.cache[progressionPath];
  const economy = require(storePath), progression = require(progressionPath);
  t.after(() => {
    economy.db.close(); delete require.cache[storePath]; delete require.cache[progressionPath];
    if (previous === undefined) delete process.env.AUTOMATION_DB_PATH; else process.env.AUTOMATION_DB_PATH = previous;
  });
  createSeasonTrackStore(economy.db); economy.ensureWallet(A);
  const request = { steamId: A, amount: 250, source: 'quest', referenceType: 'quest', referenceId: 'synthetic-season-index',
    idempotencyKey: 'synthetic-season-index', reason: 'Existing quest XP fixture' };
  economy.db.exec("CREATE TRIGGER refuse_source_position BEFORE INSERT ON progression_season_source_positions BEGIN SELECT RAISE(ABORT,'position unavailable'); END");
  assert.throws(() => progression.awardXp(request), /position unavailable/);
  assert.equal(economy.db.prepare('SELECT count(*) n FROM progression_xp_ledger').get().n, 0);
  assert.equal(economy.getWallet(A).balance, 0);
  economy.db.exec('DROP TRIGGER refuse_source_position');
  const result = progression.awardXp(request); assert.equal(result.xpAwarded, 250); assert.equal(result.vcAwarded, 100);
  progression.awardXp(request); assert.equal(economy.getWallet(A).balance, 100);
  assert.equal(economy.db.prepare('SELECT count(*) n FROM progression_season_source_positions').get().n, 1);
  assert.equal(economy.db.prepare('SELECT count(*) n FROM progression_season_enrollments').get().n, 0);
});
test('reviewed participation retries preserve current choice and cannot resurrect a deleted enrollment', t => {
  const f = fixture(t); f.publish(); f.clock(START);
  const join = { selected: true, expectedRevision: 0, requestKey: 'synthetic-join-request', seasonDigest: f.digest };
  assert.equal(f.store.changeParticipation(f.def.id, A, join).current.revision, 1);
  f.grant('new-grant'); f.store.reconcile(f.def.id, A, { expectedRevision: 1, seasonDigest: f.digest });
  const leave = { selected: false, expectedRevision: 1, requestKey: 'synthetic-leave-request', seasonDigest: f.digest };
  f.store.changeParticipation(f.def.id, A, leave);
  const replay = f.store.changeParticipation(f.def.id, A, join);
  assert.equal(replay.duplicate, true); assert.equal(replay.saved.participating, true); assert.equal(replay.current.participating, false);
  assert.equal(f.store.status(f.def.id, A).revision, 2); assert.equal(f.store.progress(f.def.id, A).xp, 0);
  assert.throws(() => f.store.changeParticipation(f.def.id, A, { ...join, selected: false }), { status: 409 });
  assert.throws(() => f.store.changeParticipation(f.def.id, A, { ...join, requestKey: 'synthetic-stale-request' }), { status: 409 });
  assert.throws(() => f.store.reconcile(f.def.id, A, { expectedRevision: 1, seasonDigest: f.digest }), { status: 409 });
});
test('a failed participation receipt rolls back enrollment and deletion; deletion survives damaged review evidence', t => {
  const f = fixture(t); f.publish(); f.clock(START);
  const join = { selected: true, expectedRevision: 0, requestKey: 'synthetic-join-receipt', seasonDigest: f.digest };
  f.db.exec("CREATE TRIGGER refuse_choice_receipt BEFORE INSERT ON progression_season_requests BEGIN SELECT RAISE(ABORT,'receipt unavailable'); END");
  assert.throws(() => f.store.changeParticipation(f.def.id, A, join), /receipt unavailable/);
  assert.equal(f.store.status(f.def.id, A).revision, 0); assert.equal(f.store.status(f.def.id, A).participating, false);
  f.db.exec('DROP TRIGGER refuse_choice_receipt'); f.store.changeParticipation(f.def.id, A, join);
  f.grant('retained'); f.store.reconcile(f.def.id, A);
  const leave = { selected: false, expectedRevision: 1, requestKey: 'synthetic-leave-receipt', seasonDigest: f.digest };
  f.db.exec("CREATE TRIGGER refuse_delete_receipt BEFORE INSERT ON progression_season_requests BEGIN SELECT RAISE(ABORT,'receipt unavailable'); END");
  assert.throws(() => f.store.changeParticipation(f.def.id, A, leave), /receipt unavailable/);
  assert.equal(f.store.status(f.def.id, A).progress.xp, 10); assert.equal(f.store.status(f.def.id, A).revision, 1);
  f.db.exec('DROP TRIGGER refuse_delete_receipt; DELETE FROM progression_season_audit');
  assert.equal(f.store.changeParticipation(f.def.id, A, leave).current.participating, false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM progression_season_evidence').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM progression_season_requests').get().n, 2);
});
test('player catalog pages omit staged plans and private evidence; guessed staged identities remain unavailable', t => {
  const f = fixture(t); f.stage();
  assert.equal(f.store.catalog().items.length, 0); assert.throws(() => f.store.status(f.def.id, A), { status: 404 });
  for (let i = 0; i < 26; i++) {
    const start = START + i * 57 * 86400000;
    const def = { ...definition('page-' + i), startsAt: iso(start), endsAt: iso(start + 56 * 86400000), settlesAt: iso(start + 57 * 86400000), retainUntil: iso(start + 147 * 86400000) }, digest = describe(def).digest;
    f.store.stage(def, { reviewer: A, digest }); f.store.changeState(def.id, { reviewer: A, digest, action: 'publish', expectedRevision: 1 });
  }
  const first = f.store.catalog(), last = f.store.catalog({ before: first.next });
  assert.equal(first.items.length, 25); assert.equal(last.items.length, 1); assert.equal(last.next, null);
  assert.equal(JSON.stringify(first).includes(A), false); assert.throws(() => f.store.catalog({ before: [] }));
});
test('reviewed expiry hides private progress immediately, then bounded cleanup erases choices and cannot revive old requests', t => {
  const f = fixture(t); f.publish(); f.clock(START);
  const join = { selected: true, expectedRevision: 0, requestKey: 'synthetic-expiry-join', seasonDigest: f.digest };
  f.store.changeParticipation(f.def.id, A, join); f.grant('expiry-xp'); f.store.reconcile(f.def.id, A);
  const expiry = Date.parse(f.def.retainUntil); f.clock(expiry - 1);
  assert.equal(f.store.progress(f.def.id, A).xp, 10); assert.equal(f.store.maintain().removed, 0);
  f.clock(expiry); const before = f.db.prepare('SELECT total_changes() n').get().n;
  const status = f.store.status(f.def.id, A); assert.equal(status.progress.xp, 0); assert.equal(status.progress.retentionExpired, true); assert.equal(status.participating, false);
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n, before);
  assert.throws(() => f.store.changeParticipation(f.def.id, A, join), { status: 410 });
  assert.throws(() => f.store.reconcile(f.def.id, A), { status: 410 });
  let removed = 0;
  for (let n = 0; n < 6; n++) { const result = f.store.maintain({ limit: 1 }); assert.ok(result.removed <= 1); removed += result.removed; }
  assert.equal(removed, 5);
  for (const table of ['collection_queue','evidence','enrollments','choices','requests']) assert.equal(f.db.prepare('SELECT count(*) n FROM progression_season_' + table).get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM progression_xp_ledger').get().n, 1); assert.equal(f.db.prepare('SELECT balance FROM wallet_fixture').get().balance, 1234);
  assert.equal(f.store.read(f.def.id).definition.title, f.def.title);
  assert.throws(() => f.store.changeParticipation(f.def.id, A, join), { status: 410 });
});
test('retention cleanup rolls back on deletion failure and does not trust a changed expiry index', t => {
  const f = fixture(t); f.publish(); f.clock(START); f.store.enroll(f.def.id, A); f.grant('retained-expiry'); f.store.reconcile(f.def.id, A);
  f.clock(Date.parse(f.def.retainUntil));
  f.db.exec("CREATE TRIGGER refuse_expiry_delete BEFORE DELETE ON progression_season_enrollments BEGIN SELECT RAISE(ABORT,'cleanup unavailable'); END");
  assert.throws(() => f.store.maintain(), /cleanup unavailable/);
  assert.equal(f.db.prepare('SELECT count(*) n FROM progression_season_evidence').get().n, 1);
  assert.equal(f.db.prepare('SELECT cleaned_at FROM progression_season_retention').get().cleaned_at, null);
  f.db.exec('DROP TRIGGER refuse_expiry_delete');
  f.db.prepare('UPDATE progression_season_retention SET retain_until=?').run(START);
  const result = f.store.maintain(); assert.equal(result.unavailable, 1); assert.equal(result.removed, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM progression_season_enrollments').get().n, 1);
});
test('old definitions keep their exact digest and readable history without an invented expiry; new reviews require one', t => {
  const f = fixture(t); const old = { ...f.def }; delete old.retainUntil;
  const reviewed = describe(old); assert.equal(Object.hasOwn(reviewed.definition, 'retainUntil'), false);
  assert.throws(() => f.store.stage(old, { reviewer: A, digest: reviewed.digest }), /retention date/);
  f.publish();
  f.db.prepare('UPDATE progression_seasons SET definition_json=?,digest=?').run(JSON.stringify(reviewed.definition), reviewed.digest);
  f.db.prepare('UPDATE progression_season_audit SET digest=?').run(reviewed.digest); f.db.exec('DELETE FROM progression_season_retention');
  f.clock(START); f.store.enroll(f.def.id, A); f.clock(SETTLE + 367 * 86400000);
  assert.equal(f.store.read(f.def.id).digest, reviewed.digest); assert.equal(f.store.maintain().removed, 0);
  assert.equal(f.store.status(f.def.id, A).participating, true);
  for (const retainUntil of [null, iso(SETTLE), iso(SETTLE - 1), iso(SETTLE + 367 * 86400000), '2027-04-01T00:00:00']) assert.throws(() => describe({ ...f.def, retainUntil }));
});
test('orphan position maintenance scans bounded pages and preserves active grant indexes', t => {
  const f = fixture(t);
  for (let n = 0; n < 5; n++) f.grant('position-' + n);
  f.db.exec("DELETE FROM progression_xp_ledger WHERE id='position-4'");
  assert.equal(f.store.maintain({ limit: 2 }).removed, 0); assert.equal(f.store.maintain({ limit: 2 }).removed, 0);
  assert.equal(f.store.maintain({ limit: 2 }).removed, 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM progression_season_source_positions').get().n, 4);
  assert.equal(f.db.prepare('SELECT count(*) n FROM progression_xp_ledger').get().n, 4);
});
test('own-account deletion after expiry removes replay metadata without inserting another retained request', t => {
  const f = fixture(t); f.publish(); f.clock(START);
  f.store.changeParticipation(f.def.id, A, { selected: true, expectedRevision: 0, requestKey: 'synthetic-expired-delete-join', seasonDigest: f.digest });
  f.clock(Date.parse(f.def.retainUntil));
  const request = { selected: false, expectedRevision: 0, requestKey: 'synthetic-expired-delete-request', seasonDigest: f.digest };
  assert.equal(f.store.changeParticipation(f.def.id, A, request).expired, true);
  assert.equal(f.store.changeParticipation(f.def.id, A, request).current.participating, false);
  for (const table of ['enrollments','requests','choices']) assert.equal(f.db.prepare('SELECT count(*) n FROM progression_season_' + table).get().n, 0);
  f.pause(); assert.throws(() => f.store.maintain(), /Read only/);
});
