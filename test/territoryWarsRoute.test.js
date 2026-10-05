const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.DB_PATH = ':memory:';

const { db } = require('../server/db');
const router = require('../server/routes/territoryWars');

function appFor(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user || null;
    next();
  });
  app.use('/api/territory-wars', router);
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function baseUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(server, path, options = {}) {
  return fetch(`${baseUrl(server)}${path}`, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
}

let sequence = 0;
function insertUser({ steam = true, admin = false } = {}) {
  sequence += 1;
  const steamId = steam ? `76561198${String(100000000 + sequence).slice(-9)}` : null;
  const result = db.prepare(`
    INSERT INTO users (steam_id, username, is_admin)
    VALUES (?, ?, ?)
  `).run(steamId, `TerritoryTester${sequence}`, admin ? 1 : 0);
  return {
    id: Number(result.lastInsertRowid),
    steam_id: steamId,
    username: `TerritoryTester${sequence}`,
    is_admin: admin ? 1 : 0,
  };
}

test('Territory Wars admin state is protected server-side', async (t) => {
  for (const user of [null, insertUser({ admin: false })]) {
    const server = await listen(appFor(user));
    t.after(() => new Promise((resolve) => server.close(resolve)));
    const response = await request(server, '/api/territory-wars/admin/state');
    assert.equal(response.status, user ? 403 : 401);
  }
});

test('creating a permanent Territory Wars Group requires a linked Steam account', async (t) => {
  const user = insertUser({ steam: false });
  const server = await listen(appFor(user));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await request(server, '/api/territory-wars/group', {
    method: 'POST',
    body: JSON.stringify({ name: 'No Steam Group', tag: 'NOSTM' }),
  });

  assert.equal(response.status, 403);
  const body = await response.json();
  assert.match(body.error, /Steam/i);
});

test('Territory Wars enforces six-fighter lineups and five-minute attack warning', async (t) => {
  const leader = insertUser();
  const members = Array.from({ length: 6 }, () => insertUser());
  const admin = insertUser({ admin: true });

  const leaderServer = await listen(appFor(leader));
  const adminServer = await listen(appFor(admin));
  t.after(() => Promise.all([
    new Promise((resolve) => leaderServer.close(resolve)),
    new Promise((resolve) => adminServer.close(resolve)),
  ]));

  let response = await request(leaderServer, '/api/territory-wars/group', {
    method: 'POST',
    body: JSON.stringify({ name: 'Test War Pack', tag: 'TWP' }),
  });
  assert.equal(response.status, 200);
  const groupBody = await response.json();
  const groupId = Number(groupBody.group.id);

  const addMember = db.prepare(`
    INSERT INTO territory_group_members (group_id, user_id, role)
    VALUES (?, ?, 'member')
  `);
  for (const member of members) addMember.run(groupId, member.id);

  response = await request(adminServer, '/api/territory-wars/admin/event', {
    method: 'POST',
    body: JSON.stringify({
      name: 'South Plains Test War',
      territoryName: 'South Plains',
      territoryKey: 'south-plains',
      ownerName: 'Admin',
    }),
  });
  assert.equal(response.status, 200);
  const eventBody = await response.json();
  const eventId = Number(eventBody.event.id);

  response = await request(leaderServer, '/api/territory-wars/event-register', {
    method: 'POST',
    body: JSON.stringify({ eventId }),
  });
  assert.equal(response.status, 200);

  const sevenFighters = [leader.id, ...members.map((member) => member.id)];
  response = await request(leaderServer, '/api/territory-wars/lineup', {
    method: 'POST',
    body: JSON.stringify({ eventId, memberUserIds: sevenFighters }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /capped at 6/i);

  response = await request(leaderServer, '/api/territory-wars/lineup', {
    method: 'POST',
    body: JSON.stringify({ eventId, memberUserIds: [leader.id] }),
  });
  assert.equal(response.status, 200);

  response = await request(adminServer, '/api/territory-wars/admin/status', {
    method: 'POST',
    body: JSON.stringify({ id: eventId, status: 'live' }),
  });
  assert.equal(response.status, 200);

  response = await request(leaderServer, '/api/territory-wars/attack-declare', {
    method: 'POST',
    body: JSON.stringify({ eventId }),
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /at least 2 active lineup fighters/i);

  response = await request(adminServer, '/api/territory-wars/admin/status', {
    method: 'POST',
    body: JSON.stringify({ id: eventId, status: 'paused' }),
  });
  assert.equal(response.status, 200);

  response = await request(leaderServer, '/api/territory-wars/lineup', {
    method: 'POST',
    body: JSON.stringify({ eventId, memberUserIds: [leader.id, members[0].id] }),
  });
  assert.equal(response.status, 200);

  response = await request(adminServer, '/api/territory-wars/admin/status', {
    method: 'POST',
    body: JSON.stringify({ id: eventId, status: 'live' }),
  });
  assert.equal(response.status, 200);

  const beforeDeclare = Date.now();
  response = await request(leaderServer, '/api/territory-wars/attack-declare', {
    method: 'POST',
    body: JSON.stringify({ eventId }),
  });
  assert.equal(response.status, 200);
  const attackBody = await response.json();
  assert.equal(attackBody.attack.status, 'warning');
  assert.equal(Number(attackBody.attack.attacker_group_id), groupId);

  const startsAt = new Date(attackBody.attack.starts_at).getTime();
  const warningMs = startsAt - beforeDeclare;
  assert.ok(warningMs >= (5 * 60 * 1000) - 2000, `warning was only ${warningMs}ms`);
  assert.ok(warningMs <= (5 * 60 * 1000) + 5000, `warning was ${warningMs}ms`);
});
