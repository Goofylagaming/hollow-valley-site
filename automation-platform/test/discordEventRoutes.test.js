const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');

test('HerbyBot event sync is token-protected and website reads the same cached snapshot', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-discord-event-routes-'));
  const previous = {
    AUTOMATION_DB_PATH: process.env.AUTOMATION_DB_PATH,
    HERBYBOT_AUTOMATION_TOKEN: process.env.HERBYBOT_AUTOMATION_TOKEN,
    HOLLOW_VALLEY_API_TOKEN: process.env.HOLLOW_VALLEY_API_TOKEN,
  };
  process.env.AUTOMATION_DB_PATH = path.join(dir, 'automation.sqlite');
  process.env.HERBYBOT_AUTOMATION_TOKEN = 'herbybot-events-test-token';
  process.env.HOLLOW_VALLEY_API_TOKEN = 'website-events-test-token';

  const modulePaths = [
    '../src/services/automationStore',
    '../src/services/discordEventService',
    '../src/routes/herbyBotRoutes',
    '../src/routes/websiteRoutes',
  ].map(require.resolve);
  for (const modulePath of modulePaths) delete require.cache[modulePath];

  const herbyRoutes = require('../src/routes/herbyBotRoutes');
  const websiteRoutes = require('../src/routes/websiteRoutes');
  const app = express();
  app.use(express.json());
  app.use('/api/herbybot', herbyRoutes);
  app.use('/api/website', websiteRoutes);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  t.after(() => new Promise((resolve) => server.close(() => {
    for (const modulePath of modulePaths) delete require.cache[modulePath];
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
    resolve();
  })));

  const base = 'http://127.0.0.1:' + server.address().port;
  const snapshot = {
    guildId: '1540359454627725387',
    syncedAt: '2026-09-21T09:40:00.000Z',
    events: [{
      id: '1540359454627725398',
      title: 'Migration Night',
      description: 'Cross Gateway together.',
      startTime: '2026-09-22T09:00:00.000Z',
      location: 'Gateway',
      attendees: 24,
    }],
  };

  let response = await fetch(base + '/api/herbybot/events/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  });
  assert.equal(response.status, 401);

  response = await fetch(base + '/api/herbybot/events/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer herbybot-events-test-token',
    },
    body: JSON.stringify(snapshot),
  });
  assert.equal(response.status, 200);
  const synced = await response.json();
  assert.equal(synced.eventCount, 1);

  response = await fetch(base + '/api/website/events', {
    headers: { Authorization: 'Bearer website-events-test-token' },
  });
  assert.equal(response.status, 200);
  const read = await response.json();
  assert.equal(read.configured, true);
  assert.equal(read.events.length, 1);
  assert.equal(read.events[0].title, 'Migration Night');
  assert.equal(read.events[0].attendees, 24);
  assert.equal(read.events[0].url, 'https://discord.com/events/1540359454627725387/1540359454627725398');
});
