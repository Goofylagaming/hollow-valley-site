const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';
delete process.env.RCON_HOST;
delete process.env.RCON_PORT;
delete process.env.RCON_PASSWORD;

const { getPublicStatus } = require('../src/services/statusService');

test('public status exposes aggregates but no player identities or positions', async () => {
  const status = await getPublicStatus();
  assert.equal(status.ok, true);
  assert.equal(typeof status.server.playerCount, 'number');
  assert.equal(Object.hasOwn(status.server, 'players'), false);
  assert.equal(Object.hasOwn(status.server, 'characters'), false);
  assert.equal(Object.hasOwn(status, 'bridge'), false);
  assert.equal(Object.hasOwn(status, 'requests'), false);
});
