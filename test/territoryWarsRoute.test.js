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

test('permanent Group invites join the invited Steam account to the correct Group', async (t) => {
  const leader = insertUser();
  const invited = insertUser();
  const leaderServer = await listen(appFor(leader));
  const invitedServer = await listen(appFor(invited));
  t.after(() => Promise.all([
    new Promise((resolve) => leaderServer.close(resolve)),
    new Promise((resolve) => invitedServer.close(resolve)),
  ]));

  let response = await request(leaderServer, '/api/territory-wars/group', {
    method: 'POST',
    body: JSON.stringify({ name: `Invite Pack ${sequence}`, tag: `IP${sequence}` }),
  });
  assert.equal(response.status, 200);
  const group = (await response.json()).group;

  response = await request(leaderServer, '/api/territory-wars/group/invite', {
    method: 'POST',
    body: JSON.stringify({ steamId: invited.steam_id }),
  });
  assert.equal(response.status, 200);
  const inviteId = Number((await response.json()).inviteId);
  assert.ok(inviteId > 0);

  response = await request(invitedServer, '/api/territory-wars/me');
  assert.equal(response.status, 200);
  let invitedState = await response.json();
  assert.equal(invitedState.group, null);
  assert.equal(invitedState.invites.length, 1);
  assert.equal(Number(invitedState.invites[0].id), inviteId);

  response = await request(invitedServer, '/api/territory-wars/group/invite/accept', {
    method: 'POST',
    body: JSON.stringify({ inviteId }),
  });
  assert.equal(response.status, 200);
  const accepted = await response.json();
  assert.equal(Number(accepted.group.id), Number(group.id));
  assert.equal(accepted.group.role, 'member');

  response = await request(invitedServer, '/api/territory-wars/me');
  invitedState = await response.json();
  assert.equal(Number(invitedState.group.id), Number(group.id));
  assert.equal(invitedState.invites.length, 0);
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

test('live lineup substitutions wait ten minutes before the new fighter becomes active', async (t) => {
  const leader = insertUser();
  const original = insertUser();
  const substitute = insertUser();
  const admin = insertUser({ admin: true });

  const leaderServer = await listen(appFor(leader));
  const adminServer = await listen(appFor(admin));
  t.after(() => Promise.all([
    new Promise((resolve) => leaderServer.close(resolve)),
    new Promise((resolve) => adminServer.close(resolve)),
  ]));

  let response = await request(leaderServer, '/api/territory-wars/group', {
    method: 'POST',
    body: JSON.stringify({ name: `Sub Pack ${sequence}`, tag: `SUB${sequence}` }),
  });
  assert.equal(response.status, 200);
  const groupId = Number((await response.json()).group.id);

  const addMember = db.prepare(`
    INSERT INTO territory_group_members (group_id, user_id, role)
    VALUES (?, ?, 'member')
  `);
  addMember.run(groupId, original.id);
  addMember.run(groupId, substitute.id);

  response = await request(adminServer, '/api/territory-wars/admin/event', {
    method: 'POST',
    body: JSON.stringify({
      name: `Substitution Test ${sequence}`,
      territoryName: 'South Plains',
      territoryKey: 'south-plains',
      ownerName: 'Admin',
    }),
  });
  assert.equal(response.status, 200);
  const eventId = Number((await response.json()).event.id);

  response = await request(leaderServer, '/api/territory-wars/event-register', {
    method: 'POST',
    body: JSON.stringify({ eventId }),
  });
  assert.equal(response.status, 200);

  response = await request(leaderServer, '/api/territory-wars/lineup', {
    method: 'POST',
    body: JSON.stringify({ eventId, memberUserIds: [leader.id, original.id] }),
  });
  assert.equal(response.status, 200);
  const initialLineup = (await response.json()).lineup;
  const leaderInitial = initialLineup.find((entry) => Number(entry.user_id) === leader.id);
  assert.ok(leaderInitial);

  response = await request(adminServer, '/api/territory-wars/admin/status', {
    method: 'POST',
    body: JSON.stringify({ id: eventId, status: 'live' }),
  });
  assert.equal(response.status, 200);

  const changedAt = Date.now();
  response = await request(leaderServer, '/api/territory-wars/lineup', {
    method: 'POST',
    body: JSON.stringify({ eventId, memberUserIds: [leader.id, substitute.id] }),
  });
  assert.equal(response.status, 200);
  const changed = await response.json();
  assert.equal(changed.liveSubstitutionDelayMinutes, 10);
  assert.equal(changed.lineup.length, 2);

  const leaderAfter = changed.lineup.find((entry) => Number(entry.user_id) === leader.id);
  const substituteAfter = changed.lineup.find((entry) => Number(entry.user_id) === substitute.id);
  assert.ok(leaderAfter);
  assert.ok(substituteAfter);
  assert.equal(leaderAfter.active_from, leaderInitial.active_from, 'existing fighter should stay active without a new delay');

  const substitutionDelay = new Date(substituteAfter.active_from).getTime() - changedAt;
  assert.ok(substitutionDelay >= (10 * 60 * 1000) - 2000, `substitution delay was only ${substitutionDelay}ms`);
  assert.ok(substitutionDelay <= (10 * 60 * 1000) + 5000, `substitution delay was ${substitutionDelay}ms`);

  response = await request(leaderServer, '/api/territory-wars/attack-declare', {
    method: 'POST',
    body: JSON.stringify({ eventId }),
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /at least 2 active lineup fighters/i);
});


test('controlled live-test mode restricts Territory participation to approved Groups', async (t) => {
  const approvedLeader = insertUser();
  const blockedLeader = insertUser();
  const admin = insertUser({ admin: true });

  const approvedServer = await listen(appFor(approvedLeader));
  const blockedServer = await listen(appFor(blockedLeader));
  const adminServer = await listen(appFor(admin));
  t.after(() => Promise.all([
    new Promise((resolve) => approvedServer.close(resolve)),
    new Promise((resolve) => blockedServer.close(resolve)),
    new Promise((resolve) => adminServer.close(resolve)),
  ]));

  let response = await request(approvedServer, '/api/territory-wars/group', {
    method: 'POST',
    body: JSON.stringify({
      name: `Approved Live Test ${sequence}`,
      tag: `AL${sequence}`,
    }),
  });
  assert.equal(response.status, 200);
  const approvedGroupId = Number((await response.json()).group.id);

  response = await request(blockedServer, '/api/territory-wars/group', {
    method: 'POST',
    body: JSON.stringify({
      name: `Blocked Live Test ${sequence}`,
      tag: `BL${sequence}`,
    }),
  });
  assert.equal(response.status, 200);
  const blockedGroupId = Number((await response.json()).group.id);
  assert.notEqual(blockedGroupId, approvedGroupId);

  response = await request(adminServer, '/api/territory-wars/admin/event', {
    method: 'POST',
    body: JSON.stringify({
      name: `Controlled Live Test ${sequence}`,
      territoryName: 'South Plains',
      territoryKey: 'south-plains',
      ownerName: 'Admin',
    }),
  });
  assert.equal(response.status, 200);
  const eventId = Number((await response.json()).event.id);

  response = await request(adminServer, '/api/territory-wars/admin/live-test', {
    method: 'POST',
    body: JSON.stringify({ id: eventId, enabled: true }),
  });
  assert.equal(response.status, 200);
  assert.equal(Number((await response.json()).event.live_test_mode), 1);

  response = await request(adminServer, '/api/territory-wars/admin/live-test-group', {
    method: 'POST',
    body: JSON.stringify({
      id: eventId,
      groupId: approvedGroupId,
      allowed: true,
    }),
  });
  assert.equal(response.status, 200);
  const allowed = await response.json();
  assert.equal(allowed.liveTestGroups.length, 1);
  assert.equal(Number(allowed.liveTestGroups[0].id), approvedGroupId);

  response = await request(adminServer, '/api/territory-wars/admin/status', {
    method: 'POST',
    body: JSON.stringify({ id: eventId, status: 'live' }),
  });
  assert.equal(response.status, 200);

  response = await request(approvedServer, '/api/territory-wars/event-register', {
    method: 'POST',
    body: JSON.stringify({ eventId }),
  });
  assert.equal(response.status, 200);

  response = await request(blockedServer, '/api/territory-wars/event-register', {
    method: 'POST',
    body: JSON.stringify({ eventId }),
  });
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /controlled live testing/i);

  response = await request(blockedServer, '/api/territory-wars/me');
  assert.equal(response.status, 200);
  const blockedState = await response.json();
  assert.equal(Number(blockedState.event.live_test_mode), 1);
  assert.equal(blockedState.liveTestAllowed, false);
});
