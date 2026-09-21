const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-map-activity-'));
process.env.AUTOMATION_DB_PATH = path.join(dir, 'automation.sqlite');
process.env.HOLLOW_VALLEY_API_TOKEN = 'map-activity-secret';
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

test('map activity endpoint is token-protected, aggregate-only and works without live RCON', async (t) => {
  const now = Date.now();
  const start = new Date(now - 90 * 60 * 1000).toISOString();
  const end = new Date(now - 30 * 60 * 1000).toISOString();
  const sampleAt = new Date(now - 20 * 60 * 1000).toISOString();

  presence.reconcilePresence([
    { steamId: '76561198000000201', name: 'PrivatePlayer', species: 'Triceratops' },
  ], start);
  presence.reconcilePresence([], end);
  presence.recordPresenceSample([
    { steamId: '76561198000000201', name: 'PrivatePlayer', species: 'Triceratops' },
  ], sampleAt);

  const server = await listen();
  t.after(async () => {
    await close(server);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const url = `http://127.0.0.1:${server.address().port}/api/website/map/activity?hours=24`;

  const denied = await fetch(url);
  assert.equal(denied.status, 401);

  const allowed = await fetch(url, {
    headers: { Authorization: 'Bearer map-activity-secret' },
  });
  assert.equal(allowed.status, 200);
  const body = await allowed.json();

  assert.equal(body.trackingEnabled, true);
  assert.equal(body.sampleCount, 1);
  assert.equal(body.uniquePlayers, 1);
  assert.equal(body.peakConcurrent >= 1, true);
  assert.equal(body.lastVerifiedAt, sampleAt);
  assert.equal(body.topSpecies[0].species, 'Triceratops');

  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('76561198000000201'), false);
  assert.equal(serialized.includes('PrivatePlayer'), false);
  assert.equal(Object.hasOwn(body, 'topPlayers'), false);
});
