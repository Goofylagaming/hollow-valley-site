const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
process.env.AUTOMATION_DB_PATH = path.join(os.tmpdir(), 'tw-discord-feed-' + randomUUID() + '.sqlite');
process.env.HERBYBOT_AUTOMATION_TOKEN = 'herbybot-test-token';
process.env.HOLLOW_VALLEY_API_TOKEN = 'test-website-secret';

const express = require('express');
const router = require('../src/routes/websiteTerritoryFeedRoutes');
const outbox = require('../src/services/herbyBotOutboxService');
const store = require('../src/services/automationStore');

test('five-minute warning pings only the linked defenders and uses dedicated outbox', async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/website/territory-wars', router);
  const server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const url = 'http://127.0.0.1:' + server.address().port + '/api/website/territory-wars/feed';
    const body = {
      eventId: 19, logId: 101, kind: 'attack',
      territoryName: 'South Plains',
      message: 'Hollow Group declared an attack. Five-minute warning started.',
      ownerName: '@everyone Admin',
      challengerName: 'Hollow Group',
      fiveMinuteWarning: true,
      attackStartsAt: '2026-11-01T10:00:00.000Z',
      defenderDiscordIds: ['123456789012345678', '123456789012345678', 'junk', '987654321098765432'],
    };
    const request = (token, payload=body) => fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: JSON.stringify(payload),
    });
    assert.equal((await request('bad-token')).status, 401);
    const response = await request('test-website-secret');
    assert.equal(response.status, 202);
    const first = await response.json();
    assert.equal(first.nonce, 'territory:19:log:101');
    const second = await request('test-website-secret');
    assert.equal((await second.json()).id, first.id);
    assert.equal(store.getOutboxSummary().total, 1);
    const events = outbox.claimMessages({ limit: 5 });
    assert.equal(events.length, 1);
    assert.equal(events[0].destination, 'territory-war');
    assert.match(events[0].message, /5-MINUTE TERRITORY ATTACK WARNING/);
    assert.match(events[0].message, /<@123456789012345678>/);
    assert.match(events[0].message, /<@987654321098765432>/);
    assert.doesNotMatch(events[0].message, /@everyone/);
    assert.equal((await request('test-website-secret', { ...body, eventId: -1 })).status, 400);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('non-warning Territory log cannot ping defenders', () => {
  const { messageFor } = router._test;
  const result = messageFor({
    kind: 'capture', territoryName: 'South Plains', message: 'Captured!',
    fiveMinuteWarning: true, defenderDiscordIds: ['123456789012345678'],
  });
  assert.doesNotMatch(result, /<@/);
});
