const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';
process.env.COMMAND_BRIDGE_ENABLED = 'true';
process.env.COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK = 'automation-platform-is-sole-publisher';
process.env.COMMAND_BRIDGE_TRANSPORT = 'http_pull';
process.env.BINARYLANE_COMMAND_TOKEN = 'binarylane-command-test-secret-1234567890';

const { app } = require('../src/index');
const commandBridge = require('../src/services/commandBridgeService');

function listen() {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('BinaryLane HTTP CommandBridge is private, one-shot and reconciles terminal results', async (t) => {
  const server = await listen();
  t.after(() => close(server));

  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const token = process.env.BINARYLANE_COMMAND_TOKEN;
  const steamId = '76561198000000091';

  const command = commandBridge.buildCommand('bd', steamId, ['spawn', 'Dryosaurus']);
  await commandBridge.queueCommand(command);

  const denied = await fetch(`${base}/api/command-bridge/poll`);
  assert.equal(denied.status, 401);

  const poll = await fetch(`${base}/api/command-bridge/poll`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(poll.status, 200);
  const body = await poll.text();
  assert.equal(body.trim(), JSON.stringify(command));

  const secondPoll = await fetch(`${base}/api/command-bridge/poll`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(secondPoll.status, 200);
  assert.equal(await secondPoll.text(), '');

  const wrongSteam = await fetch(`${base}/api/command-bridge/result`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: command.id,
      steam: '76561198000000092',
      source: 'BodyDrop',
      ok: true,
      msg: 'spawned',
    }),
  });
  assert.equal(wrongSteam.status, 400);

  const accepted = await fetch(`${base}/api/command-bridge/result`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: command.id,
      steam: steamId,
      source: 'BodyDrop',
      ok: true,
      msg: 'spawned',
    }),
  });
  assert.equal(accepted.status, 200);
  assert.equal((await accepted.json()).final, true);

  const outcome = await commandBridge.readOutcome(command);
  assert.equal(outcome.state, 'confirmed');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.source, 'BodyDrop');

  const duplicate = await fetch(`${base}/api/command-bridge/result`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: command.id,
      steam: steamId,
      source: 'BodyDrop',
      ok: true,
      msg: 'spawned',
    }),
  });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
});
