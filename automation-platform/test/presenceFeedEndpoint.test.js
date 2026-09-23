const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';
process.env.PRESENCE_FEED_TOKEN = 'presence-feed-test-secret-1234567890';
process.env.PLAYER_PRESENCE_ENABLED = 'false';
process.env.WALLET_PLAYTIME_REWARDS_ENABLED = 'false';
process.env.SUPPORTER_COIN_BONUSES_ENABLED = 'false';

const { app } = require('../src/index');
const playerPresence = require('../src/services/playerPresenceService');

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function post(base, body, token = process.env.PRESENCE_FEED_TOKEN) {
  return fetch(`${base}/api/presence-feed/snapshot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('BinaryLane presence feed is private, validated, deduplicated and reconciles sessions', async (t) => {
  const server = await listen();
  t.after(() => close(server));

  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const steamId = '76561198000000091';
  const startMs = Date.now() - 120000;

  assert.equal(playerPresence.pollingEnabled(), false);
  assert.equal(playerPresence.enabled(), true);

  const first = {
    sampleId: 'binarylane-test-0001',
    sampledAt: new Date(startMs).toISOString(),
    players: [{
      PlayerID: steamId,
      Name: 'Goofy',
      Class: 'Tyrannosaurus',
      Growth: 0.33,
      Health: 1,
    }],
  };

  const denied = await post(base, first, '');
  assert.equal(denied.status, 401);

  const invalid = await post(base, {
    ...first,
    sampleId: 'binarylane-test-invalid',
    players: [{ PlayerID: '123', Name: 'Bad', Class: 'Tyrannosaurus' }],
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, 'PRESENCE_SAMPLE_INVALID');

  const accepted = await post(base, first);
  assert.equal(accepted.status, 201);
  const acceptedBody = await accepted.json();
  assert.equal(acceptedBody.ok, true);
  assert.equal(acceptedBody.duplicate, false);
  assert.equal(acceptedBody.stale, false);
  assert.equal(acceptedBody.opened, 1);
  assert.equal(acceptedBody.online, 1);
  assert.equal(acceptedBody.rewards.skipped, true);

  const duplicate = await post(base, first);
  assert.equal(duplicate.status, 200);
  const duplicateBody = await duplicate.json();
  assert.equal(duplicateBody.duplicate, true);

  const conflict = await post(base, {
    ...first,
    players: [{ PlayerID: steamId, Name: 'Goofy', Class: 'Triceratops' }],
  });
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, 'PRESENCE_SAMPLE_CONFLICT');

  const leave = await post(base, {
    sampleId: 'binarylane-test-0002',
    sampledAt: new Date(startMs + 60000).toISOString(),
    players: [],
  });
  assert.equal(leave.status, 201);
  const leaveBody = await leave.json();
  assert.equal(leaveBody.closed, 1);
  assert.equal(leaveBody.online, 0);

  const sessions = playerPresence.listSessions({ steamId, limit: 10 });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].steam_id, steamId);
  assert.ok(sessions[0].ended_at);
});
