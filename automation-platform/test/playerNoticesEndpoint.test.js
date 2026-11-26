'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-notices-http-'));
process.env.AUTOMATION_DB_PATH = path.join(dir, 'automation.sqlite');
process.env.PRESENCE_FEED_TOKEN = 'presence-feed-test-secret-1234567890';
process.env.HOLLOW_VALLEY_API_TOKEN = 'notices-website-test-secret';
process.env.PLAYER_PRESENCE_ENABLED = 'false';
process.env.WALLET_PLAYTIME_REWARDS_ENABLED = 'false';
process.env.SUPPORTER_COIN_BONUSES_ENABLED = 'false';
process.env.PRIME_TRACKER_ENABLED = 'false';
process.env.PRIME_CHAT_NOTIFY_ENABLED = 'true';
process.env.PLAYER_MILESTONES_EVENTAI_NOTIFY = 'true';

const { app } = require('../src/index');
const notices = require('../src/services/playerNoticeService');
const { UNAVAILABLE } = notices;

const alice = '76561198000000101';

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

function post(base, body, headers = {}) {
  return fetch(`${base}/api/presence-feed/notices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

test('presence notice collection requires the presence token', async (t) => {
  const server = await listen();
  t.after(() => close(server));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = `http://127.0.0.1:${server.address().port}`;
  notices.reset();

  const missing = await post(base, {});
  assert.equal(missing.status, 401);

  const wrong = await post(base, {}, { Authorization: 'Bearer not-the-token' });
  assert.equal(wrong.status, 401);

  const header = await post(base, { primeRequests: [] }, { 'X-Presence-Feed-Token': process.env.PRESENCE_FEED_TOKEN });
  assert.equal(header.status, 200);
  assert.deepEqual(await header.json(), { notices: [] });

  const prime = await post(base, {
    primeRequests: [{ id: 'chat-prime-76561198000000101-1', steam: alice, ts: 1732600000 }],
  }, { Authorization: `Bearer ${process.env.PRESENCE_FEED_TOKEN}` });
  assert.equal(prime.status, 200);
  const primeBody = await prime.json();
  assert.equal(primeBody.notices.length, 1);
  assert.equal(primeBody.notices[0].steam, alice);
  assert.equal(primeBody.notices[0].text, UNAVAILABLE);
  assert.match(prime.headers.get('cache-control'), /no-store/);

  const replay = await post(base, {
    primeRequests: [{ id: 'chat-prime-76561198000000101-1', steam: alice, ts: 1732600000 }],
  }, { Authorization: `Bearer ${process.env.PRESENCE_FEED_TOKEN}` });
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { notices: [] });

  const invalid = await post(base, { primeRequests: { steam: alice } }, {
    Authorization: `Bearer ${process.env.PRESENCE_FEED_TOKEN}`,
  });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).code, 'NOTICES_INVALID');
});
