const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

process.env.AUTOMATION_DB_PATH = path.join(os.tmpdir(), `hollow-valley-herbybot-endpoint-${randomUUID()}.sqlite`);
process.env.HERBYBOT_AUTOMATION_TOKEN = 'herbybot-endpoint-secret';
delete process.env.RCON_HOST;
delete process.env.RCON_PORT;
delete process.env.RCON_PASSWORD;

const { app } = require('../src/index');
const outbox = require('../src/services/herbyBotOutboxService');

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('HerbyBot bridge API is fail-closed and exposes only protected aggregate status', async (t) => {
  const server = await listen();
  t.after(() => close(server));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/herbybot`;

  const denied = await fetch(`${base}/status`);
  assert.equal(denied.status, 401);

  const allowed = await fetch(`${base}/status`, {
    headers: { Authorization: 'Bearer herbybot-endpoint-secret' },
  });
  assert.equal(allowed.status, 200);
  const body = await allowed.json();
  assert.equal(body.bridge.configured, true);
  assert.equal(body.server.online, false);
  assert.equal(Object.hasOwn(body.server, 'players'), false);
  assert.equal(Object.hasOwn(body, 'steamId'), false);
});

test('HerbyBot can claim and acknowledge a queued event through the bridge API', async (t) => {
  const server = await listen();
  t.after(() => close(server));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/herbybot`;
  const queued = outbox.queueAnnouncement('Bridge API test', { nonce: 'announcement:endpoint:001' });

  const claimedResponse = await fetch(`${base}/outbox/claim`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer herbybot-endpoint-secret',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ limit: 5, leaseSeconds: 60 }),
  });
  assert.equal(claimedResponse.status, 200);
  const claimed = await claimedResponse.json();
  const event = claimed.events.find((item) => item.id === queued.id);
  assert.ok(event);
  assert.equal(event.status, 'claimed');

  const ack = await fetch(`${base}/outbox/${encodeURIComponent(event.id)}/ack`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer herbybot-endpoint-secret',
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(ack.status, 200);
  const ackBody = await ack.json();
  assert.equal(ackBody.event.status, 'delivered');
});


test('HerbyBot staff overview requires bridge authentication', async (t) => {
  const server = await listen();
  t.after(() => close(server));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/herbybot`;

  const denied = await fetch(`${base}/staff-overview`);
  assert.equal(denied.status, 401);

  const allowed = await fetch(`${base}/staff-overview`, {
    headers: { Authorization: 'Bearer herbybot-endpoint-secret' },
  });
  assert.equal(allowed.status, 200);
  const body = await allowed.json();
  assert.ok(Array.isArray(body.server.players));
  assert.ok(body.requests);
  assert.ok(body.outbox);
});


test('HerbyBot slash announcement endpoint is idempotent by interaction nonce', async (t) => {
  const server = await listen();
  t.after(() => close(server));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/herbybot`;
  const body = JSON.stringify({ message: 'Announcement retry test', nonce: 'slash:123456789012345680' });

  const send = () => fetch(`${base}/commands/announcement`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer herbybot-endpoint-secret',
      'Content-Type': 'application/json',
    },
    body,
  });

  const first = await send();
  const second = await send();
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  const firstBody = await first.json();
  const secondBody = await second.json();
  assert.equal(firstBody.event.id, secondBody.event.id);
});

test('HerbyBot slash schedule endpoint is idempotent by interaction nonce', async (t) => {
  const server = await listen();
  t.after(() => close(server));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/herbybot`;
  const runAt = new Date(Date.now() + 5 * 60_000).toISOString();
  const body = JSON.stringify({
    message: 'Scheduled retry test',
    runAt,
    recurrence: 'none',
    nonce: '123456789012345681',
  });

  const send = () => fetch(`${base}/commands/schedule`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer herbybot-endpoint-secret',
      'Content-Type': 'application/json',
    },
    body,
  });

  const first = await send();
  const second = await send();
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  const firstBody = await first.json();
  const secondBody = await second.json();
  assert.equal(firstBody.job.id, secondBody.job.id);
  assert.equal(firstBody.job.id, 'herbybot:123456789012345681');
});

test('HerbyBot slash write endpoints reject invalid interaction nonces', async (t) => {
  const server = await listen();
  t.after(() => close(server));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/herbybot`;

  const announcement = await fetch(`${base}/commands/announcement`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer herbybot-endpoint-secret',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: 'Nope', nonce: 'bad' }),
  });
  assert.equal(announcement.status, 400);

  const schedule = await fetch(`${base}/commands/schedule`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer herbybot-endpoint-secret',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: 'Nope',
      runAt: new Date(Date.now() + 60_000).toISOString(),
      recurrence: 'none',
      nonce: 'bad',
    }),
  });
  assert.equal(schedule.status, 400);
});
