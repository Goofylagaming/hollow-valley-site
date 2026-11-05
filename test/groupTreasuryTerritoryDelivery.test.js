const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { spawn } = require('node:child_process');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-territory-entry-'));
process.env.DB_PATH = path.join(temp, 'website.sqlite');
process.env.GROUP_TREASURY_ENABLED = '0';
const { db } = require('../server/db'), groups = require('../server/groupsStore');
// Use the real Territory schema without starting its battle runtime or timers.
const territorySource = fs.readFileSync(path.join(__dirname, '../server/routes/territoryWars.js'), 'utf8');
db.exec(territorySource.match(/db\.exec\(`([\s\S]*?)`\);/)[1]);
db.exec('ALTER TABLE territory_events ADD COLUMN live_test_mode INTEGER NOT NULL DEFAULT 0');
const { createGroupTreasuryTerritoryDelivery } = require('../server/services/groupTreasuryTerritoryDelivery');
const links = require('../server/services/groupTerritoryLinks').createGroupTerritoryLinks(db, groups);
test.after(() => { db.close(); const target = path.resolve(temp); assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep)); fs.rmSync(target, { recursive: true, force: true }); });
let n = 0;
function fixture() {
  n++;
  const A = String(76561198000009000n + BigInt(n * 10)), B = String(BigInt(A) + 1n);
  for (const actor of [A, B]) db.prepare('INSERT INTO users(steam_id,username) VALUES(?,?)').run(actor, 'Synthetic actor');
  const userId = db.prepare('SELECT id FROM users WHERE steam_id=?').get(A).id;
  const groupId = groups.createGroup(A, 'Entry Pack ' + n).current.id;
  groups.invite(A, B); groups.actOnInvite(B, groups.getState(B).incoming[0].id, 'accept');
  const territoryGroupId = Number(db.prepare('INSERT INTO territory_groups(name,leader_user_id) VALUES(?,?)').run('Territory ' + n, userId).lastInsertRowid);
  db.prepare("INSERT INTO territory_group_members(group_id,user_id,role) VALUES(?,?,'leader')").run(territoryGroupId, userId);
  links.set(A, { expectedGroupId: groupId, expectedRevision: 0, territoryGroupId });
  const eventId = Number(db.prepare("INSERT INTO territory_events(name,status) VALUES(?,'scheduled')").run('Synthetic Event ' + n).lastInsertRowid);
  const requestId = 'entry_request_' + n;
  let enabled = true, remote = { requestId, groupId, state: 'reserved', item: { id: 'entry-' + n, revision: 1, title: 'Synthetic entry', description: 'No live price', cost: 80, purpose: 'territory_entry', target: { eventId } } };
  let readOverride = null;
  const accounting = { read: async input => readOverride ? readOverride(input) : structuredClone(remote) };
  const service = createGroupTreasuryTerritoryDelivery(db, groups, accounting, { enabled: () => enabled });
  const body = { expectedGroupId: groupId, requestId };
  return { A, B, userId, groupId, territoryGroupId, eventId, requestId, service, accounting, body,
    enable: value => enabled = value, remote: value => remote = { ...remote, ...value },
    hold: fn => readOverride = fn,
    prepare: () => service.prepare(A, body), deliver: () => service.deliver(A, body),
    registrations: () => db.prepare('SELECT * FROM territory_event_registrations WHERE event_id=?').all(eventId) };
}
const code = value => error => error.code === value;
test('entry binds website and Territory identities, requires dispatch, persists actual registration once', async () => {
  const f = fixture(); const draft = await f.prepare(); assert.equal(draft.outcome, 'pending'); assert.equal(draft.evidence, null);
  assert.equal(draft.territoryGroupId, f.territoryGroupId); assert.equal(f.registrations().length, 0);
  await assert.rejects(f.deliver, code('ENTRY_RESERVATION_MISMATCH'));
  f.remote({ state: 'fulfilling' }); const delivered = await f.deliver(); assert.equal(delivered.outcome, 'delivered');
  assert.equal(delivered.evidence.cost, 80); assert.equal(delivered.evidence.targetKey, String(f.eventId));
  assert.equal(f.registrations()[0].group_id, f.territoryGroupId); assert.equal(f.registrations()[0].registered_by_user_id, f.userId);
  f.enable(false); assert.deepEqual(await f.deliver(), delivered); assert.deepEqual(f.service.cancel(f.A, f.body), delivered);
  const restarted = createGroupTreasuryTerritoryDelivery(db, groups, {});
  assert.deepEqual(await restarted.deliver(f.A, f.body), delivered);
  assert.equal(f.registrations().length, 1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM territory_event_log WHERE event_id=?').get(f.eventId).n, 1);
});
test('only current website owner and current linked Territory leader may deliver', async () => {
  const f = fixture(); await assert.rejects(() => f.service.prepare(f.B, f.body), code('GROUP_OWNER_REQUIRED'));
  await f.prepare(); f.remote({ state: 'fulfilling' });
  db.prepare("UPDATE territory_group_members SET role='member' WHERE group_id=?").run(f.territoryGroupId);
  await assert.rejects(f.deliver, code('ENTRY_LEADER_REQUIRED')); assert.equal(f.registrations().length, 0);
  groups.exitGroup(f.A);
  assert.throws(() => f.service.read(f.A, f.body), code('ENTRY_UNAVAILABLE'));
  assert.equal(f.service.cancel(f.B, f.body).outcome, 'not_delivered');
});
test('changed link cannot redirect a pending request to another Territory group', async () => {
  const f = fixture(); await f.prepare(); f.remote({ state: 'fulfilling' });
  links.set(f.A, { expectedGroupId: f.groupId, expectedRevision: 1, territoryGroupId: null });
  links.set(f.A, { expectedGroupId: f.groupId, expectedRevision: 2, territoryGroupId: f.territoryGroupId });
  await assert.rejects(f.deliver, code('ENTRY_LINK_CHANGED')); assert.equal(f.registrations().length, 0);
});
test('ended and controlled-test events are checked before preparation and delivery', async () => {
  const f = fixture(); db.prepare('UPDATE territory_events SET live_test_mode=1 WHERE id=?').run(f.eventId);
  await assert.rejects(f.prepare, code('ENTRY_TEST_RESTRICTED'));
  db.prepare('INSERT INTO territory_live_test_groups(event_id,group_id) VALUES(?,?)').run(f.eventId, f.territoryGroupId);
  await f.prepare(); f.remote({ state: 'fulfilling' }); db.prepare("UPDATE territory_events SET status='ended' WHERE id=?").run(f.eventId);
  await assert.rejects(f.deliver, code('ENTRY_EVENT_UNAVAILABLE')); assert.equal(f.registrations().length, 0);
  assert.equal(f.service.cancel(f.A, f.body).outcome, 'not_delivered');
});
test('existing free registration records non-delivery rather than another paid benefit', async () => {
  const f = fixture(); await f.prepare(); f.remote({ state: 'fulfilling' });
  db.prepare("INSERT INTO territory_event_registrations(event_id,group_id,registered_by_user_id) VALUES(?,?,?)").run(f.eventId, f.territoryGroupId, f.userId);
  const result = await f.deliver(); assert.equal(result.outcome, 'not_delivered'); assert.equal(result.reason, 'ALREADY_REGISTERED'); assert.equal(f.registrations().length, 1);
});
test('failed delivery audit rolls back registration and log, retaining a pending outcome', async () => {
  const f = fixture(); await f.prepare(); f.remote({ state: 'fulfilling' });
  db.exec(`CREATE TRIGGER fail_entry_audit BEFORE INSERT ON hv_treasury_territory_delivery_audit WHEN NEW.request_id='${f.requestId}' AND NEW.outcome='delivered' BEGIN SELECT RAISE(ABORT,'audit failed'); END`);
  await assert.rejects(f.deliver, /audit failed/); assert.equal(f.registrations().length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM territory_event_log WHERE event_id=?').get(f.eventId).n, 0);
  assert.equal(f.service.read(f.A, f.body).outcome, 'pending');
  db.exec('DROP TRIGGER fail_entry_audit'); assert.equal((await f.deliver()).outcome, 'delivered');
});
test('cancellation overtakes a pending accounting reply and permanently blocks late registration', async () => {
  const f = fixture(); await f.prepare(); f.remote({ state: 'fulfilling' });
  let release; f.hold(() => new Promise(resolve => release = resolve)); const pending = f.deliver();
  const cancelled = f.service.cancel(f.A, f.body); assert.equal(cancelled.outcome, 'not_delivered');
  release({ requestId: f.requestId, groupId: f.groupId, state: 'fulfilling', item: { id: 'entry-' + n, revision: 1, title: 'Synthetic entry', description: 'No live price', cost: 80, purpose: 'territory_entry', target: { eventId: f.eventId } } });
  assert.deepEqual(await pending, cancelled); assert.equal(f.registrations().length, 0);
});
test('accounting mismatches, unavailable adapters and paused rollout cannot create entries', async () => {
  const f = fixture(); f.remote({ groupId: f.groupId + 1 }); await assert.rejects(f.prepare, code('ENTRY_RESERVATION_MISMATCH'));
  f.remote({ groupId: f.groupId }); let release; f.hold(() => new Promise(resolve => release = resolve)); const preparing = f.prepare();
  f.enable(false); release({ requestId: f.requestId, groupId: f.groupId, state: 'reserved', item: { id: 'entry-' + n, revision: 1, title: 'Synthetic entry', description: 'No live price', cost: 80, purpose: 'territory_entry', target: { eventId: f.eventId } } });
  await assert.rejects(preparing, code('ENTRY_DELIVERY_DISABLED')); assert.equal(f.registrations().length, 0);
  const absent = createGroupTreasuryTerritoryDelivery(db, groups, {}, { enabled: () => true });
  await assert.rejects(() => absent.prepare(f.A, f.body), code('ENTRY_ACCOUNTING_UNAVAILABLE'));
});
test('pending entry prevents closure and remains financial activity after local cancellation', async () => {
  const f = fixture(); await f.prepare();
  const lifecycle = require('../server/services/groupTreasuryLifecycle').createGroupTreasuryLifecycle(db);
  assert.throws(() => groups.disband(f.A), code('TREASURY_REQUESTS_PENDING'));
  assert.equal(lifecycle.inspect(f.groupId).pending, true);
  f.service.cancel(f.A, f.body);
  assert.equal(lifecycle.inspect(f.groupId).pending, false); assert.equal(lifecycle.needsRemote(f.groupId), true);
  assert.throws(() => groups.disband(f.A), code('TREASURY_CLOSURE_REQUIRED'));
});
test('membership loss during accounting read prevents creating a delivery record', async () => {
  const f = fixture(); let release; f.hold(() => new Promise(resolve => release = resolve)); const pending = f.prepare();
  groups.exitGroup(f.A);
  release({ requestId: f.requestId, groupId: f.groupId, state: 'reserved', item: { id: 'entry-' + n, revision: 1, title: 'Synthetic entry', description: 'No live price', cost: 80, purpose: 'territory_entry', target: { eventId: f.eventId } } });
  await assert.rejects(pending, code('ENTRY_UNAVAILABLE'));
  assert.equal(db.prepare('SELECT 1 FROM hv_treasury_territory_delivery WHERE request_id=?').get(f.requestId), undefined);
});
test('independent delivery and cancellation processes settle one immutable outcome', async () => {
  const f = fixture(); await f.prepare(); const saved = db.prepare('SELECT item_json FROM hv_treasury_territory_delivery WHERE request_id=?').get(f.requestId);
  const source = `const {DatabaseSync}=require('node:sqlite');
    const db=new DatabaseSync(process.env.ENTRY_TEST_DATABASE);db.exec('PRAGMA busy_timeout=5000');
    const groups={getState:actor=>({current:db.prepare("SELECT g.id,g.owner_steam_id AS ownerSteamId FROM hv_groups g JOIN hv_group_members m ON m.group_id=g.id WHERE m.steam_id=? AND g.status='active'").get(actor)})};
    const service=require(process.env.ENTRY_TEST_MODULE).createGroupTreasuryTerritoryDelivery(db,groups,{read:async()=>JSON.parse(process.env.ENTRY_TEST_RESERVATION)},{enabled:()=>true});
    (async()=>{try{const result=await service[process.env.ENTRY_TEST_ACTION](process.env.ENTRY_TEST_ACTOR,JSON.parse(process.env.ENTRY_TEST_BODY));process.stdout.write(JSON.stringify(result));}catch(error){process.stderr.write(error.stack);process.exitCode=1;}finally{db.close();}})();`;
  const run = action => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', source], { windowsHide: true, env: { ...process.env,
      ENTRY_TEST_DATABASE: process.env.DB_PATH, ENTRY_TEST_MODULE: require.resolve('../server/services/groupTreasuryTerritoryDelivery'),
      ENTRY_TEST_ACTION: action, ENTRY_TEST_ACTOR: f.A, ENTRY_TEST_BODY: JSON.stringify(f.body),
      ENTRY_TEST_RESERVATION: JSON.stringify({ requestId: f.requestId, groupId: f.groupId, state: 'fulfilling', item: JSON.parse(saved.item_json) }) } });
    let output = '', stderr = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject); child.on('close', status => status ? reject(new Error(stderr)) : resolve(JSON.parse(output)));
  });
  const results = await Promise.all([run('deliver'), run('cancel')]);
  assert.deepEqual(results[0], results[1]);
  assert.equal(f.registrations().length, results[0].outcome === 'delivered' ? 1 : 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM hv_treasury_territory_delivery_audit WHERE request_id=? AND outcome<>'pending'").get(f.requestId).n, 1);
});
