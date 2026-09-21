const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-map-activity-'));
process.env.AUTOMATION_DB_PATH = path.join(dir, 'automation.sqlite');
process.env.HOLLOW_VALLEY_API_TOKEN = 'map-activity-test-secret';
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

test('map activity is aggregate-only and available without a live server snapshot', async (t) => {
  const sampledAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  presence.recordPresenceSample([
    { steamId: '76561198000000201', name: 'HiddenPlayer', species: 'Triceratops' },
  ], sampledAt);

  const server = await listen();
  t.after(async () => {
    await close(server);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const url = `http://127.0.0.1:${server.address().port}/api/website/map/activity?hours=24`;

  const denied = await fetch(url);
  assert.equal(denied.status, 401);

  const allowed = await fetch(url, {
    headers: { Authorization: 'Bearer map-activity-test-secret' },
  });
  assert.equal(allowed.status, 200);

  const body = await allowed.json();
  assert.equal(body.trackingEnabled, true);
  assert.equal(body.sampleCount, 1);
  assert.equal(body.lastVerifiedAt, sampledAt);
  assert.equal(body.peakConcurrent, 1);
  assert.equal(body.topSpecies[0].species, 'Triceratops');

  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes('76561198000000201'), false);
  assert.equal(serialized.includes('HiddenPlayer'), false);
  assert.equal(Object.hasOwn(body, 'topPlayers'), false);
});
