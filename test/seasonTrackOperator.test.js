"use strict";
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { main } = require('../scripts/review-season-track.cjs');
const REVIEWER = '76561198000000401';
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-season-operator-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const database = path.join(directory, 'synthetic.sqlite'), file = path.join(directory, 'season.json');
  const db = new DatabaseSync(database);
  db.exec(`CREATE TABLE economy_wallets(steam_id TEXT PRIMARY KEY,balance INTEGER);
    CREATE TABLE progression_xp_ledger(id TEXT PRIMARY KEY,steam_id TEXT,amount INTEGER,source TEXT,reference_type TEXT,created_at TEXT);
    CREATE TABLE progression_xp_source_times(ledger_id TEXT PRIMARY KEY,source_at INTEGER,basis TEXT);
    INSERT INTO economy_wallets VALUES('${REVIEWER}',123);`); db.close();
  const start = Date.now() + 7 * 86400000;
  const definition = { id: 'synthetic-operator-season', title: 'Synthetic operator fixture', free: true,
    startsAt: new Date(start).toISOString(), endsAt: new Date(start + 56 * 86400000).toISOString(), settlesAt: new Date(start + 57 * 86400000).toISOString(), retainUntil: new Date(start + 147 * 86400000).toISOString(),
    sources: [{ source: 'quest', policy: 'achievement-time' }], tiers: [{ xp: 100, title: 'Synthetic milestone' }] };
  fs.writeFileSync(file, JSON.stringify(definition));
  return { directory, database, file, definition };
}
test('operator review opens no database; default stage and inspect leave the exact database bytes unchanged', t => {
  const f = fixture(t), before = fs.readFileSync(f.database);
  const review = main(['review', '--file', f.file]); assert.equal(review.databaseOpened, false);
  const stageArgs = ['stage', '--file', f.file, '--database', f.database, '--digest', review.digest, '--reviewer', REVIEWER];
  assert.equal(main(stageArgs).wouldStage, true);
  assert.equal(main(['inspect', '--database', f.database, '--id', f.definition.id]).schemaReady, false);
  assert.deepEqual(fs.readFileSync(f.database), before);
  main([...stageArgs, '--write']);
  const staged = fs.readFileSync(f.database);
  const inspection = main(['inspect', '--database', f.database, '--id', f.definition.id]);
  assert.equal(inspection.season.state, 'staged'); assert.equal(inspection.audit.length, 1);
  const publish = ['publish', '--database', f.database, '--id', f.definition.id, '--digest', review.digest, '--revision', '1', '--reviewer', REVIEWER];
  assert.equal(main(publish).nextState, 'published'); assert.deepEqual(fs.readFileSync(f.database), staged);
  assert.equal(main([...publish, '--write']).season.state, 'published');
  assert.throws(() => main([...publish, '--write']), /changed/);
  const db = new DatabaseSync(f.database, { readOnly: true });
  try {
    assert.equal(db.prepare('SELECT balance FROM economy_wallets').get().balance, 123);
    assert.equal(db.prepare('SELECT count(*) n FROM progression_xp_ledger').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM progression_season_enrollments').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM progression_season_audit').get().n, 2);
  } finally { db.close(); }
});
test('operator tool rejects changed artifacts, stale reviews, unknown options and non-progression files without creating databases', t => {
  const f = fixture(t), review = main(['review', '--file', f.file]);
  const stage = ['stage', '--file', f.file, '--database', f.database, '--digest', review.digest, '--reviewer', REVIEWER];
  fs.writeFileSync(f.file, JSON.stringify({ ...f.definition, title: 'Altered after review' }));
  assert.throws(() => main([...stage, '--write']), /changed after review/);
  assert.throws(() => main(['review', '--file', f.file, '--write']), /allowed/);
  assert.throws(() => main(['review', '--file', f.file, '--database', f.database]), /Unknown/);
  assert.throws(() => main(['review', '--file', f.file, '--file', f.file]), /duplicate/);
  const absent = path.join(f.directory, 'missing.sqlite');
  assert.throws(() => main(['inspect', '--database', absent, '--id', f.definition.id])); assert.equal(fs.existsSync(absent), false);
  const wrong = path.join(f.directory, 'other.sqlite'), db = new DatabaseSync(wrong); db.close();
  assert.throws(() => main(['inspect', '--database', wrong, '--id', f.definition.id]), /initialized/);
  assert.throws(() => main(['publish', '--database', f.database, '--id', f.definition.id, '--reviewer', REVIEWER, '--digest', review.digest, '--revision', '1.5']), /whole revision/);
});
