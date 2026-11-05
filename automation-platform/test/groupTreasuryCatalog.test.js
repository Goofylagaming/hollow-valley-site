const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');
const { main } = require('../../scripts/review-group-treasury-catalog.cjs');
const { digest } = require('../src/services/groupTreasuryCatalog');
const { createGroupTreasurySpending } = require('../src/services/groupTreasurySpending');
const A = '76561198000000001', B = '76561198000000002';
const cli = path.resolve(__dirname, '../../scripts/review-group-treasury-catalog.cjs');
function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-catalog-'));
  const database = path.join(temp, 'economy.sqlite'), file = path.join(temp, 'item.json');
  const db = new DatabaseSync(database);
  db.exec('CREATE TABLE economy_wallets(steam_id TEXT PRIMARY KEY,balance INTEGER); CREATE TABLE economy_wallet_ledger(id TEXT PRIMARY KEY);');
  const service = createGroupTreasurySpending({ db });
  const item = { id: 'fern', revision: 1, title: 'Fern frame', description: 'Synthetic test price only', cost: 80, purpose: 'group_cosmetic', target: { kind: 'profile_frame', value: 'fern' } };
  fs.writeFileSync(file, JSON.stringify(item));
  t.after(() => { db.close(); const target = path.resolve(temp); assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(target, { recursive: true, force: true }); });
  const stage = () => main(['stage', '--database', database, '--file', file, '--reviewer', A, '--digest', digest(item)]);
  const inspect = (version = 1) => main(['inspect', '--database', database, '--id', 'fern', '--revision', String(version)]);
  const args = (command, value = item, active = 'none') => [command, '--database', database, '--id', value.id, '--revision', String(value.revision), '--reviewer', B, '--digest', digest(value), '--active-revision', String(active)];
  return { temp, database, file, db, service, item, stage, inspect, args };
}
test('review is read-only, canonical and does not need a database or rollout flags', t => {
  const { file, item, db } = fixture(t);
  db.exec('DROP TABLE economy_group_treasury_catalog');
  const output = main(['review', '--file', file]);
  assert.deepEqual(output.item, item); assert.equal(output.digest, digest(item)); assert.equal(output.enabled, false);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='economy_group_treasury_catalog'").get(), undefined);
  for (const args of [['review', '--file', file, '--write', 'yes'], ['review', '--file', file, '--file', file], ['enable']]) assert.throws(() => main(args));
});
test('stage requires exact reviewed content and existing economy DB; no coins or flags change', t => {
  const { temp, file, db, item, stage, inspect } = fixture(t);
  const before = db.prepare('SELECT COUNT(*) n FROM economy_group_treasury_ledger').get().n;
  const first = stage(); assert.equal(first.enabled, false); assert.equal(first.audit.length, 1); assert.deepEqual(stage(), first);
  assert.deepEqual(inspect(), first);
  fs.writeFileSync(file, JSON.stringify({ ...item, cost: 81 })); assert.throws(stage, /changed after review/);
  const missing = path.join(temp, 'missing.sqlite');
  assert.throws(() => main(['stage', '--database', missing, '--file', file, '--reviewer', A, '--digest', digest({ ...item, cost: 81 })]));
  assert.equal(fs.existsSync(missing), false);
  const wrong = path.join(temp, 'website.sqlite'), other = new DatabaseSync(wrong); other.close();
  assert.throws(() => main(['stage', '--database', wrong, '--file', file, '--reviewer', A, '--digest', digest({ ...item, cost: 81 })]), /not an initialized/);
  const check = new DatabaseSync(wrong); assert.equal(check.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'economy_%'").get().n, 0); check.close();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM economy_group_treasury_ledger').get().n, before);
});
test('activation uses reviewed digest and active-revision comparison, retains audit, does not enable rollout', t => {
  const { item, service, db, stage, inspect, args } = fixture(t); stage();
  assert.throws(() => main(args('enable').map(value => value === digest(item) ? '0'.repeat(64) : value)), /changed/);
  const first = main(args('enable')); assert.equal(first.enabled, true); assert.deepEqual(first.audit.map(row => row.action), ['register', 'enable']);
  assert.throws(() => main(args('enable')), /changed/); // old review said none active
  assert.equal(main(args('enable', item, 1)).audit.length, 2); // matching replay
  const next = { ...item, revision: 2, cost: 90 }; service.register(next, A);
  assert.throws(() => main(args('enable', next)), /changed/);
  const second = main(args('enable', next, 1)); assert.equal(second.activeRevision, 2); assert.equal(inspect().enabled, false);
  assert.deepEqual(inspect().audit.map(row => row.action), ['register', 'enable', 'disable']);
  assert.equal(main(args('disable', next, 2)).enabled, false);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM economy_group_treasury_spends').get().n, 0);
  assert.equal(service.list().length, 0);
});
test('catalog revision and review reject unsupported fields and external activation', t => {
  const { database, file, item, service, stage, args, db } = fixture(t); stage();
  fs.writeFileSync(file, JSON.stringify({ ...item, damage: 20 })); assert.throws(() => main(['review', '--file', file]), /Unsupported/);
  fs.writeFileSync(file, JSON.stringify({ ...item, cost: 99 }));
  assert.throws(() => main(['stage', '--database', database, '--file', file, '--reviewer', A, '--digest', digest({ ...item, cost: 99 })]), /revision cannot change/);
  const external = { ...item, id: 'entry', purpose: 'territory_entry', target: { eventId: 5 } }; service.register(external, A);
  assert.throws(() => main(args('enable', external)), /delivery adapter/);
  assert.equal(db.prepare("SELECT enabled FROM economy_group_treasury_catalog WHERE item_id='entry'").get().enabled, 0);
});
test('catalog audit failure rolls activation and replacement back together', t => {
  const { service, db, item, stage, args, inspect } = fixture(t); stage(); main(args('enable'));
  const next = { ...item, revision: 2 }; service.register(next, A);
  db.exec("CREATE TRIGGER audit_failure BEFORE INSERT ON economy_group_treasury_catalog_audit WHEN NEW.action='enable' AND NEW.revision=2 BEGIN SELECT RAISE(ABORT,'audit failed'); END");
  assert.throws(() => main(args('enable', next, 1)), /audit failed/);
  assert.equal(inspect().enabled, true); assert.equal(inspect(2).enabled, false);
  assert.deepEqual(inspect().audit.map(row => row.action), ['register', 'enable']);
});
test('fresh CLI processes inspect and activate the persisted reviewed revision', t => {
  const { database, stage, item, args } = fixture(t); stage();
  const run = values => spawnSync(process.execPath, [cli, ...values], { encoding: 'utf8', windowsHide: true });
  const inspect = run(['inspect', '--database', database, '--id', item.id, '--revision', '1']);
  assert.equal(inspect.status, 0, inspect.stderr); assert.equal(JSON.parse(inspect.stdout).digest, digest(item));
  const activate = run(args('enable')); assert.equal(activate.status, 0, activate.stderr); assert.equal(JSON.parse(activate.stdout).enabled, true);
  const stale = run(args('disable')); assert.equal(stale.status, 1); assert.match(stale.stderr, /changed/);
});
test('competing operator processes cannot replace the same reviewed active revision twice', async t => {
  const { service, item, stage, args, db } = fixture(t); stage(); main(args('enable'));
  const second = { ...item, revision: 2 }, third = { ...item, revision: 3 }; service.register(second, A); service.register(third, A);
  const run = values => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...values], { windowsHide: true }); let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk); child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr }));
  });
  const outputs = await Promise.all([run(args('enable', second, 1)), run(args('enable', third, 1))]);
  assert.equal(outputs.filter(value => value.status === 0).length, 1);
  assert.match(outputs.find(value => value.status !== 0).stderr, /changed/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM economy_group_treasury_catalog WHERE enabled=1").get().n, 1);
});
test('reviewed Territory activation requires its own flag and proof key; group event registration remains unavailable', t => {
  const { service, item, args } = fixture(t);
  const entry={...item,id:'entry-reviewed',purpose:'territory_entry',target:{eventId:5}};
  service.register(entry,A);
  const oldFlag=process.env.GROUP_TREASURY_TERRITORY_ENABLED,oldKey=process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET;
  try {
    process.env.GROUP_TREASURY_TERRITORY_ENABLED='1';delete process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET;
    assert.throws(()=>main(args('enable',entry)),/delivery adapter/);
    process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET='synthetic-catalog-entry-key-000000000';
    assert.equal(main(args('enable',entry)).enabled,true);
    const event={...entry,id:'event-entry',purpose:'event_registration',target:{eventId:'reviewed-event'}};service.register(event,A);
    assert.throws(()=>main(args('enable',event)),/delivery adapter/);
  } finally {
    if(oldFlag===undefined)delete process.env.GROUP_TREASURY_TERRITORY_ENABLED;else process.env.GROUP_TREASURY_TERRITORY_ENABLED=oldFlag;
    if(oldKey===undefined)delete process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET;else process.env.GROUP_TREASURY_TERRITORY_PROOF_SECRET=oldKey;
  }
});
