const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';
process.env.COMMAND_BRIDGE_TRANSPORT = 'http_pull';
process.env.COMMAND_BRIDGE_ENABLED = 'true';
process.env.COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK = 'automation-platform-is-sole-publisher';
process.env.BINARYLANE_COMMAND_TOKEN = 'test-only-command-token';

const { app } = require('../src/index');
const bridge = require('../src/services/commandBridgeService');
const http = require('../src/services/commandBridgeHttpService');
const store = require('../src/services/automationStore');

const steam = '76561198000000000';

test('terminal DinoStorage HTTP result immediately reconciles the matching automation request', async (t) => {
  const slot = 'dino-test-slot';
  const command = bridge.buildCommand('dino_store', steam, [slot]);

  store.createRequest({
    id: command.id,
    kind: 'dinostorage',
    steamId: steam,
    status: 'queued',
    commandId: command.id,
    details: { action: 'store', slot, command },
    message: 'awaiting routing/result',
  });

  await bridge.queueCommand(command);
  const claimed = http.claimPending(10).map(JSON.parse);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].id, command.id);

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/api/command-bridge/result`, {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-only-command-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      id: command.id,
      steam,
      source: 'DinoStorage',
      args: [steam, slot],
      ok: true,
      msg: "**Tyrannosaurus** parked in slot 'dino-test-slot' (62% growth). Returning to spawn shortly.",
    }),
  });

  assert.equal(response.status, 200);
  const outcome = await response.json();
  assert.equal(outcome.accepted, true);
  assert.equal(outcome.final, true);

  const request = store.getRequest(command.id);
  assert.equal(request.status, 'accepted');
  assert.equal(request.error, null);
  assert.match(request.message, /62% growth/);
  assert.match(request.message, /deferred in-game kill is not independently confirmed/);
  assert.equal(http.getRequest(command.id).status, 'completed');
});
