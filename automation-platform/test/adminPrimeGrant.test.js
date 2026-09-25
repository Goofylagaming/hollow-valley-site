const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';

const bridge = require('../src/services/commandBridgeService');
const storage = require('../src/services/dinoStorageService');

test('admin Prime grant publishes a dedicated DinoStorage command for the Steam ID', async (t) => {
  const originals = {
    assertPublisherReady: bridge.assertPublisherReady,
    buildCommand: bridge.buildCommand,
    queueCommand: bridge.queueCommand,
    readOutcome: bridge.readOutcome,
  };
  t.after(() => Object.assign(bridge, originals));

  const calls = [];
  bridge.assertPublisherReady = () => true;
  bridge.buildCommand = (verb, steamId, tokens) => {
    calls.push({ verb, steamId, tokens });
    return { id: 'prime-test-request', verb, steam: steamId, args: { args: tokens } };
  };
  bridge.queueCommand = async () => true;
  bridge.readOutcome = async () => ({
    state: 'confirmed',
    ok: true,
    source: 'DinoStorage',
    message: 'Prime Elder granted to Triceratops at 63% growth. Growth was not changed.',
  });

  const result = await storage.grantLivePrime({ steamId: '76561198000000999' });
  assert.deepEqual(calls, [{
    verb: 'prime_grant',
    steamId: '76561198000000999',
    tokens: [],
  }]);
  assert.equal(result.outcome.state, 'confirmed');
  assert.match(result.outcome.message, /Growth was not changed/);
});
