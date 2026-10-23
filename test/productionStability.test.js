'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
process.env.DB_PATH = path.join(os.tmpdir(), `hv-stability-${randomUUID()}.sqlite`);
const { createResilientRead } = require('../server/services/resilientRead');
const { verifyReadiness } = require('../scripts/verify-readiness.cjs');

test('read retry is bounded, circuit opens, one recovery probe closes it', async () => {
  let time = 0, calls = 0;
  const read = createResilientRead({ threshold: 1, cooldownMs: 100, now: () => time, sleep: async () => {} });
  const failed = async () => { calls++; throw Object.assign(new Error('down'), { status: 502 }); };
  await assert.rejects(read(failed));
  assert.equal(calls, 2);
  await assert.rejects(read(failed), { status: 503 });
  assert.equal(calls, 2);
  time = 101;
  let finish;
  const pending = read(() => new Promise(resolve => { finish = resolve; }));
  await assert.rejects(read(failed), { status: 503 });
  finish('recovered');
  assert.equal(await pending, 'recovered');
  assert.equal(await read(async () => 'ready'), 'ready');
});

test('auth errors and expired deadlines are not retried', async () => {
  for (const status of [400, 401, 403, 409, 429]) {
    let calls = 0;
    await assert.rejects(createResilientRead()(() => { calls++; throw Object.assign(new Error('no'), { status }); }));
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(createResilientRead()(() => { calls++; throw new Error('timeout'); }, AbortSignal.abort()));
  assert.equal(calls, 1);
});

test('website command submission is never automatically replayed', async () => {
  process.env.AUTOMATION_SERVICE_URL = 'https://automation.invalid';
  process.env.HOLLOW_VALLEY_API_TOKEN = 'test-only';
  const original = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; return new Response('{}', { status: 502 }); };
  try {
    await assert.rejects(require('../server/services/automationWebsiteClient').requestDinoAction('store', {
      steamId: '76561198000000001', slot: 'slot1',
    }));
    assert.equal(calls, 1);
  } finally { global.fetch = original; }
});

for (const location of ['../server/services/readiness', '../automation-platform/src/services/readiness']) {
  test(`${location}: local DB failure and drain reject readiness but liveness stays up`, async () => {
    const app = express();
    let broken = false;
    const health = require(location).installReadiness(app, () => { if (broken) throw new Error('private DB path'); }, 'test');
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      assert.equal((await fetch(base + '/readyz')).status, 200);
      broken = true;
      const failure = await fetch(base + '/readyz');
      assert.equal(failure.status, 503);
      assert.doesNotMatch(await failure.text(), /private DB/);
      assert.equal((await fetch(base + '/healthz')).status, 200);
      broken = false; health.drain();
      assert.equal((await fetch(base + '/readyz')).status, 503);
    } finally { await new Promise(resolve => server.close(resolve)); }
  });
}

test('snapshots persist across module reload, isolate users, and expire', () => {
  let snapshots = require('../server/services/readSnapshots');
  snapshots.save('progression:alice', { profile: { xp: 42 } });
  delete require.cache[require.resolve('../server/services/readSnapshots')];
  snapshots = require('../server/services/readSnapshots');
  assert.equal(snapshots.load('progression:alice', 60000).value.profile.xp, 42);
  assert.equal(snapshots.load('progression:bob', 60000), null);
  assert.equal(snapshots.load('progression:alice', -1), null);
});

test('deployment gate rejects old commits and resets consecutive successes after failure', async () => {
  let calls = 0;
  const values = ['old', 'new', 'bad', 'new', 'new', 'new'];
  await verifyReadiness('https://site.invalid', 'new', {
    attempts: 6, sleep: async () => {}, fetchImpl: async () => {
      calls++; return Response.json({ ok: true, revision: values.shift() });
    },
  });
  assert.equal(calls, 6);
  await assert.rejects(verifyReadiness('https://site.invalid', 'new', {
    attempts: 3, sleep: async () => {}, fetchImpl: async () => Response.json({ ok: true, revision: 'old' }),
  }));
});

test('stale server positions are retained for display but cannot drive territory state', async () => {
  const automation = require('../server/services/automationWebsiteClient');
  const previous = automation.getServerSnapshot;
  const service = require('../server/services/serverStatus');
  try {
    automation.getServerSnapshot = async () => ({ online:true, players:[{name:'Test'}], characters:[{x:1}], checkedAt:new Date().toISOString() });
    await service.poll();
    assert.equal(service.getState().players.length, 1);
    automation.getServerSnapshot = async () => { throw new Error('offline'); };
    await service.poll();
    assert.equal(service.getDisplayState().players.length, 1);
    assert.equal(service.getDisplayState().stale, true);
    assert.equal(service.getState().players.length, 0);
    assert.equal(service.getState().characters.length, 0);
  } finally { automation.getServerSnapshot = previous; }
});

test('progression fallback is authenticated, user-scoped and not used for authorization errors', async () => {
  const automation = require('../server/services/automationWebsiteClient');
  const previous = automation.getProgression;
  let user = {steam_id:'76561198000000001'};
  let status = 200;
  automation.getProgression = async () => {
    if (status !== 200) throw Object.assign(new Error('unavailable'), {status});
    return {profile:{xp:123}};
  };
  const app = express();
  app.use((req, _res, next) => {req.user = user; next();});
  app.use(require('../server/routes/progression'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  try {
    assert.equal((await fetch(url)).status, 200);
    status = 503;
    const saved = await (await fetch(url)).json();
    assert.equal(saved.profile.xp, 123);
    assert.equal(saved.stale, true);
    status = 403;
    assert.equal((await fetch(url)).status, 403);
    status = 503; user = {steam_id:'76561198000000002'};
    assert.equal((await fetch(url)).status, 503);
    user = null;
    assert.equal((await fetch(url)).status, 401);
  } finally { automation.getProgression = previous; await new Promise(resolve => server.close(resolve)); }
});

test('migration preflight inventories without changing the database', () => {
  const { inventory } = require('../scripts/storage-preflight.cjs');
  const before = require('../server/db').db.prepare('SELECT COUNT(*) AS count FROM read_snapshots').get().count;
  const result = inventory(process.env.DB_PATH);
  assert.equal(result.integrity, 'ok');
  assert.equal(result.tables.find(table => table.name === 'read_snapshots').rows, before);
  assert.equal(require('../server/db').db.prepare('SELECT COUNT(*) AS count FROM read_snapshots').get().count, before);
});
