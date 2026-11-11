'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createMilestoneStore, telemetry } = require('../src/services/playerMilestoneStore');
const alice = '76561198000000101', bob = '76561198000000102';
const dependencies = {
  membership: location => location == null ? { point: null } : ({ point: {}, sanctuaries: location.s || [], patrolZones: location.p || [], migrations: location.m || [] }),
  normalizeSpecies: s => String(s || '').toLowerCase(), growthFraction: n => n > 1 ? n / 100 : n,
};
function fixture() {
  const db = new DatabaseSync(':memory:');
  const store = createMilestoneStore(db, dependencies);
  let at = Date.now() - 1000000;
  const player = { steamId: alice, species: 'Rex', health: 100, growth: 1, location: {} };
  const sample = (patch = {}, seconds = 30) => { at += seconds * 1000; store.record({ ...player, ...patch }, at); return at; };
  const events = () => db.prepare('SELECT * FROM player_milestone_events ORDER BY id').all();
  return { db, store, sample, events, player, now: () => at };
}
test('stable transitions count entries, unique footprints and persist through restart; replay is inert', () => {
  const f = fixture();
  f.sample();
  const location = { s: ['Sanctuary'], p: ['Patrol A'], m: ['Migration A'] };
  f.sample({ location });
  assert.equal(f.events().length, 0);
  f.sample({ location });
  assert.equal(f.events().length, 3);
  const before = f.store.read(alice);
  f.store.record({ ...f.player, location }, f.now());
  f.store.record({ ...f.player, species: 'Stego' }, f.now() - 1000);
  assert.deepEqual(f.store.read(alice), before);
  const restarted = createMilestoneStore(f.db, dependencies);
  assert.deepEqual(restarted.read(alice), before);
  f.sample(); f.sample();
  f.sample({ location }); f.sample({ location });
  assert.equal(f.store.read(alice).entries.patrol, 2);
  assert.deepEqual(f.store.read(alice).visits.patrol, ['Patrol A']);
  assert.ok(f.events().some(e => e.message.includes('Sanctuary left')));
  f.db.close();
});
test('baseline, jitter, missing telemetry and long disconnects do not generate fake transitions', () => {
  const f = fixture(), location = { p: ['A'], s: ['S'] };
  f.sample({ location });
  assert.equal(f.events().length, 0);
  f.sample(); f.sample({ location });
  assert.equal(f.events().length, 0);
  f.sample({ location: null, growth: null });
  assert.equal(f.store.read(alice).growth, 1);
  f.sample({ location });
  assert.equal(f.events().length, 0);
  f.sample({ location }, 1000);
  assert.equal(f.store.read(alice).entries.patrol, 1);
  assert.equal(f.events().length, 0);
  f.db.close();
});
test('death, explicit identity, species and growth reset lives; offline omission does not', () => {
  for (const reset of [{ dinosaurId: 'new-dinosaur' }, { species: 'Stego' }, { growth: 0.05 }]) {
    const f = fixture();
    f.sample({ dinosaurId: 'old-dinosaur', location: { p: ['A'] } });
    const first = f.store.read(alice).lifeId;
    f.sample({ ...reset });
    assert.notEqual(f.store.read(alice).lifeId, first);
    assert.equal(f.store.read(alice).entries.patrol, 0);
    f.db.close();
  }
  const f = fixture(); f.sample({ location: { p: ['A'] } });
  const first = f.store.read(alice).lifeId;
  f.sample({ health: 0 });
  assert.equal(f.store.read(alice).ended, true);
  f.sample({ health: null, species: null });
  assert.equal(f.store.read(alice).lifeId, first);
  f.sample();
  assert.notEqual(f.store.read(alice).lifeId, first);
  assert.equal(f.store.read(alice).entries.patrol, 0);
  f.db.close();
});
test('combat death is applied once even when received late', () => {
  const f = fixture();
  f.db.exec('CREATE TABLE combat_events (victim_steam_id TEXT, occurred_at TEXT)');
  f.sample({ location: { p: ['A'] } });
  const first = f.store.read(alice).lifeId;
  const deathAt = f.now() + 10000;
  f.sample();
  f.db.prepare('INSERT INTO combat_events VALUES (?,?)').run(alice, new Date(deathAt).toISOString());
  f.sample();
  const second = f.store.read(alice).lifeId;
  assert.notEqual(second, first);
  f.sample(); assert.equal(f.store.read(alice).lifeId, second);
  f.db.close();
});
test('preferences are strict, persistent and private; disabled alerts still count visits', () => {
  const f = fixture();
  f.store.setPreferences(alice, { patrol: false });
  assert.throws(() => f.store.setPreferences(alice, { patrol: 'false' }));
  assert.throws(() => f.store.setPreferences(alice, { steamId: bob }));
  f.sample(); f.sample({ location: { p: ['A'] } }); f.sample({ location: { p: ['A'] } });
  assert.equal(f.events().length, 0);
  assert.equal(f.store.read(alice).entries.patrol, 1);
  assert.equal(f.store.feed(bob, 0).stats, null);
  assert.equal(f.store.preferences(bob).patrol, true);
  assert.equal(createMilestoneStore(f.db, dependencies).preferences(alice).patrol, false);
  assert.throws(() => f.store.feed(alice, '-1'));
  assert.throws(() => f.store.feed(alice, 'foo'));
  f.db.close();
});
test('notifications are throttled without dropping legitimate counters; game claims are at-most-once', () => {
  const f = fixture();
  f.store.setPreferences(alice, { inGame: true });
  f.sample();
  f.sample({ location: { p: ['A'] } }, 4); f.sample({ location: { p: ['A'] } }, 4);
  f.sample({}, 4); f.sample({}, 4);
  f.sample({ location: { p: ['A'] } }, 4); f.sample({ location: { p: ['A'] } }, 4);
  assert.equal(f.store.read(alice).entries.patrol, 2);
  assert.equal(f.events().length, 1);
  const messages = f.store.claimGameMessages(f.now());
  assert.equal(messages.length, 1); assert.equal(messages[0].steamId, alice);
  assert.equal(f.store.claimGameMessages(f.now()).length, 0);
  f.db.close();
});
test('transaction rollback preserves last accepted state and counters', () => {
  const f = fixture(); f.sample();
  const before = f.store.read(alice);
  f.db.exec("CREATE TRIGGER fail_update BEFORE UPDATE ON player_milestone_state BEGIN SELECT RAISE(ABORT, 'disk failure'); END");
  assert.throws(() => f.sample({ location: { p: ['A'] } }), /disk failure/);
  assert.deepEqual(f.store.read(alice), before);
  f.db.close();
});
test('telemetry never derives identity or death from unrelated stats', () => {
  assert.deepEqual(telemetry({ isPrime: true, hunger: 100, dinosaurId: 'bad id', isDead: 'true' }),
    { dinosaurId: null, isDead: null });
  assert.deepEqual(telemetry({ dinosaurId: 'saved-life:123', isDead: false }),
    { dinosaurId: 'saved-life:123', isDead: false });
});
test('file-backed restart and additive migration preserve preexisting production-shaped records', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-milestone-persist-'));
  const file = path.join(dir, 'automation.sqlite');
  let db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode=WAL; CREATE TABLE existing_wallets(id TEXT,coins INTEGER); INSERT INTO existing_wallets VALUES('survivor',12345)");
    const { backupBeforeMilestones } = require('../src/services/playerMilestoneBackup');
    backupBeforeMilestones(db, file);
    const store = createMilestoneStore(db, dependencies);
    const at = Date.now();
    store.record({ steamId: alice, species: 'Rex', health: 100, growth: 1, location: { p: ['A'] } }, at);
    store.setPreferences(alice, { sanctuary: false });
    const lifeId = store.read(alice).lifeId;
    db.close(); db = new DatabaseSync(file);
    const reopened = createMilestoneStore(db, dependencies);
    assert.equal(reopened.read(alice).lifeId, lifeId);
    assert.equal(reopened.read(alice).entries.patrol, 1);
    assert.equal(reopened.preferences(alice).sanctuary, false);
    assert.equal(db.prepare('SELECT coins FROM existing_wallets').get().coins, 12345);
    const backup = new DatabaseSync(path.join(dir, 'backups/before-player-milestones-v1.sqlite'), { readOnly: true });
    try {
      assert.equal(backup.prepare('PRAGMA quick_check').get().quick_check, 'ok');
      assert.equal(backup.prepare('SELECT coins FROM existing_wallets').get().coins, 12345);
      assert.equal(backup.prepare("SELECT 1 FROM sqlite_master WHERE name='player_milestone_state'").get(), undefined);
    } finally { backup.close(); }
  } finally { db.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
