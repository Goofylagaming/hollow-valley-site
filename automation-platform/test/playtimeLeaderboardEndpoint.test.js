const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-playtime-leaderboard-'));
process.env.AUTOMATION_DB_PATH = path.join(dir, 'automation.sqlite');
process.env.HOLLOW_VALLEY_API_TOKEN = 'leaderboard-website-secret';
process.env.PLAYER_PRESENCE_ENABLED = 'true';

const { app } = require('../src/index');
const presence = require('../src/services/playerPresenceService');

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('website playtime leaderboard is token-protected and strips Steam IDs', async (t) => {
  const now = Date.now();
  const firstStart = new Date(now - 90 * 60 * 1000).toISOString();
  const firstEnd = new Date(now - 30 * 60 * 1000).toISOString();
  const secondStart = new Date(now - 45 * 60 * 1000).toISOString();
  const secondEnd = new Date(now - 15 * 60 * 1000).toISOString();

  presence.reconcilePresence([
    { steamId: '76561198000000101', name: 'LongPlayer', species: 'Triceratops' },
  ], firstStart);
  presence.reconcilePresence([], firstEnd);

  presence.reconcilePresence([
    { steamId: '76561198000000102', name: 'ShortPlayer', species: 'Carnotaurus' },
  ], secondStart);
  presence.reconcilePresence([], secondEnd);

  const server = await listen();
  t.after(async () => {
    await close(server);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${server.address().port}/api/website/leaderboards/playtime?hours=744`;

  const denied = await fetch(base);
  assert.equal(denied.status, 401);

  const allowed = await fetch(base, {
    headers: { Authorization: 'Bearer leaderboard-website-secret' },
  });
  assert.equal(allowed.status, 200);
  const body = await allowed.json();

  assert.equal(body.windowHours, 744);
  assert.equal(body.trackingEnabled, true);
  assert.equal(body.players.length, 2);
  assert.equal(body.players[0].username, 'LongPlayer');
  assert.ok(body.players[0].playtime_minutes >= body.players[1].playtime_minutes);
  assert.equal(Object.hasOwn(body.players[0], 'steamId'), false);
  assert.equal(Object.hasOwn(body.players[0], 'steam_id'), false);
});

