'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const automation = require('../server/services/automationWebsiteClient');
test('website milestone routes enforce login, bind Steam identity and validate preference writes', async t => {
  const calls = [];
  automation.getPlayerMilestones = async (...args) => { calls.push(args); return { events: [] }; };
  automation.setPlayerMilestonePreferences = async (...args) => { calls.push(args); return { preferences: args[1] }; };
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { if (req.headers['x-test-user']) req.user = { steam_id: req.headers['x-test-user'] }; next(); });
  app.use('/api/player-milestones', require('../server/routes/playerMilestones'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/player-milestones`;
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { 'x-test-user': 'invalid' } })).status, 403);
  const headers = { 'x-test-user': '76561198000000101', 'Content-Type': 'application/json' };
  const read = await fetch(url + '?steamId=76561198000000102&after=8', { headers });
  assert.equal(read.status, 200); assert.equal(read.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(calls[0], ['76561198000000101', '8']);
  assert.equal((await fetch(url + '/preferences', { method: 'POST', headers, body: JSON.stringify({ patrol: false }) })).status, 200);
  assert.deepEqual(calls[1], ['76561198000000101', { patrol: false }]);
  for (const body of [{ patrol: 'false' }, { steamId: '76561198000000102' }, []]) {
    assert.equal((await fetch(url + '/preferences', { method: 'POST', headers, body: JSON.stringify(body) })).status, 400);
  }
  assert.equal(calls.length, 2);
});
