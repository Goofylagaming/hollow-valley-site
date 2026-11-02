const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');

process.env.DB_PATH = ':memory:';
const automation = require('../server/services/automationWebsiteClient');
const router = require('../server/routes/adminOperations');

function serve(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/admin-operations', router);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function url(server) {
  return `http://127.0.0.1:${server.address().port}/api/admin-operations/feature-announcement`;
}
function payload() {
  return {
    kind: 'growth', multiplier: 3, channels: ['announcement', 'progress'],
    requestId: '51cb5cc5-5d07-4f74-8426-8c7a9926e09a',
    verified: true, confirm: 'ANNOUNCE VERIFIED',
  };
}

test('only admin users may publish feature announcements', async (t) => {
  for (const user of [null, { id: 1, is_admin: 0 }]) {
    const server = await serve(user);
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const response = await fetch(url(server), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    });
    assert.equal(response.status, user ? 403 : 401);
  }
});

test('website only forwards confirmed feature announcements and server-owned actor identity', async (t) => {
  const original = automation.queueAdminFeatureAnnouncement;
  const calls = [];
  automation.queueAdminFeatureAnnouncement = async (input) => {
    calls.push(input);
    return { ok: true, announcement: { receipts: [{ destination: 'announcement', state: 'pending' }], deliveryConfirmed: false } };
  };
  t.after(() => { automation.queueAdminFeatureAnnouncement = original; });
  const server = await serve({
    id: 1, is_admin: 1,
    steam_id: '76561198038977506', username: 'Admin',
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  async function post(input) {
    return fetch(url(server), { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input) });
  }
  assert.equal((await post({ ...payload(), verified: false })).status, 400);
  assert.equal((await post({ ...payload(), channels: ['alert'] })).status, 400);
  assert.equal((await post({ ...payload(), multiplier: 50 })).status, 400);
  assert.equal((await post({ ...payload(), requestId: 'oops' })).status, 400);
  assert.deepEqual(calls, []);
  const response = await post({ ...payload(), actorSteamId: '00000000000000000' });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).announcement.deliveryConfirmed, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].actorSteamId, '76561198038977506');
  assert.deepEqual(calls[0].channels, ['announcement', 'progress']);
});

test('Admin Hub feature UI describes verification, Discord and private in-game limitation', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/adminoperations.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../public/assets/adminoperations.js'), 'utf8');
  assert.match(html, /id="ops-feature-verified"/);
  assert.match(html, /Server progress &amp; updates/);
  assert.match(html, /In-game \(not connected\)/);
  assert.match(js, /\/api\/admin-operations\/feature-announcement/);
  assert.match(js, /crypto\.randomUUID\(\)/);
  assert.match(js, /ANNOUNCE VERIFIED/);
});

test('Admin Hub validates growth-only ping modes and never accepts custom mass mentions', async (t) => {
  const old = automation.queueAdminFeatureAnnouncement;
  const sent = [];
  automation.queueAdminFeatureAnnouncement = async (data) => {
    sent.push(data);
    return { ok: true, announcement: { queued: true, receipts: [{ destination: 'announcement' }] } };
  };
  t.after(() => { automation.queueAdminFeatureAnnouncement = old; });
  const server = await serve({ id: 1, is_admin: 1, steam_id: '76561198038977506' });
  t.after(() => new Promise(resolve => server.close(resolve)));
  async function post(data) {
    return fetch(url(server), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify(data),
    });
  }
  assert.equal((await post({ ...payload(), pingMode: '@everyone' })).status, 400);
  assert.equal((await post({ ...payload(), pingMode: 'everyone', channels: ['progress'] })).status, 400);
  assert.equal((await post({ ...payload(), kind: 'custom', message: 'Event is live', pingMode: 'community' })).status, 400);
  assert.equal((await post({ ...payload(), verified: false, pingMode: 'everyone' })).status, 400);
  assert.equal(sent.length, 0);

  for (const mode of ['community', 'everyone', 'none']) {
    const response = await post({ ...payload(), pingMode: mode });
    assert.equal(response.status, 202);
    assert.equal(sent.at(-1).pingMode, mode);
    assert.equal(sent.at(-1).actorSteamId, '76561198038977506');
    assert.deepEqual(sent.at(-1).channels, ['announcement', 'progress']);
  }
});

test('Admin UI shows explicit growth ping options with no ping as default', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/adminoperations.html'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '../public/assets/adminoperations.js'), 'utf8');
  assert.match(html, /id="ops-feature-growth-ping"/);
  assert.match(html, /value="none" selected/);
  assert.match(html, /value="community"/);
  assert.match(html, /value="everyone"/);
  assert.match(js, /pingAllowed/);
  assert.match(js, /Confirm this change is already active/);
});
