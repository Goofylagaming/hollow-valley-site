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
const fileBridge = require('../src/adapters/fileBridge');

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

test('HTTP-pull reconciliation recovers a missed DinoStorage result from results.ndjson without replaying', async (t) => {
  const slot = 'dino-local-result-fallback';
  const command = bridge.buildCommand('dino_retrieve', steam, [slot]);

  store.createRequest({
    id: command.id,
    kind: 'dinostorage',
    steamId: steam,
    status: 'queued',
    commandId: command.id,
    details: { action: 'redeem', slot, command },
    message: 'awaiting routing/result',
  });

  await bridge.queueCommand(command);
  assert.equal(http.getRequest(command.id).status, 'pending');

  const originalReadResultsText = fileBridge.readResultsText;
  t.after(() => {
    fileBridge.readResultsText = originalReadResultsText;
  });
  fileBridge.readResultsText = async () => `${JSON.stringify({
    id: command.id,
    ts: Math.floor(Date.now() / 1000),
    source: 'DinoStorage',
    steam,
    args: [steam, slot],
    ok: true,
    msg: `Retrieving **Omniraptor** from slot '${slot}'. Spawn the same species now!`,
  })}\n`;

  const outcome = await bridge.readOutcome(command);
  assert.equal(outcome.state, 'confirmed');
  assert.equal(outcome.source, 'DinoStorage');
  assert.match(outcome.message, /Omniraptor/);

  // The recovered file result is persisted into the HTTP bridge as terminal,
  // so its anti-crash queue lock is released without replaying the command.
  assert.equal(http.getRequest(command.id).status, 'completed');

  const dinoStorage = require('../src/services/dinoStorageService');
  const request = await dinoStorage.reconcileDinoStorageRequest(command.id);
  assert.equal(request.status, 'accepted');
  assert.match(request.message, /deferred in-game restore is not independently confirmed/);
});

test('parked mutation save returns a receipt and late confirmation resolves without replaying', async (t) => {
  const dinoStorage = require('../src/services/dinoStorageService');
  const previousFallback = process.env.COMMAND_BRIDGE_HTTP_RESULT_FTP_FALLBACK;
  process.env.COMMAND_BRIDGE_HTTP_RESULT_FTP_FALLBACK = 'false';
  t.after(() => {
    if (previousFallback === undefined) delete process.env.COMMAND_BRIDGE_HTTP_RESULT_FTP_FALLBACK;
    else process.env.COMMAND_BRIDGE_HTTP_RESULT_FTP_FALLBACK = previousFallback;
  });
  const slot = 'mutation-test-slot';
  const write = await dinoStorage.editStoredDino({
    steamId: steam,
    slot,
    mode: 'mutations',
    trackMutation: true,
    values: {
      Slot1: 'Accelerated Prey Drive',
      Slot2: 'Cannibalistic',
      Slot3: 'Cellular Regeneration',
      Slot4: 'Sustained Hydration',
    },
  });
  const id = write.command.id;

  assert.equal(write.outcome.state, 'pending');
  assert.equal(http.getRequest(id).status, 'pending');
  assert.equal(store.getRequest(id).kind, 'parked_mutation_edit');

  const pending = await dinoStorage.getParkedMutationEditStatus({
    steamId: steam, slot, requestId: id,
  });
  assert.equal(pending.status, 'pending');
  assert.equal(pending.confirmed, false);

  assert.deepEqual(http.acceptResult({
    id, steam, source: 'DinoStorage', ok: true, msg: 'parked mutations updated',
  }), { accepted: true, final: true });

  const confirmed = await dinoStorage.getParkedMutationEditStatus({
    steamId: steam, slot, requestId: id,
  });
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.status, 'confirmed');
  assert.match(confirmed.message, /parked mutations updated/);
  assert.equal(store.getRequest(id).status, 'accepted');

  await assert.rejects(() => dinoStorage.getParkedMutationEditStatus({
    steamId: '76561198000000001', slot, requestId: id,
  }), (error) => error.code === 'MUTATION_EDIT_NOT_FOUND');
  await assert.rejects(() => dinoStorage.getParkedMutationEditStatus({
    steamId: steam, slot: 'another-slot', requestId: id,
  }), (error) => error.code === 'MUTATION_EDIT_NOT_FOUND');

  // Polling the same receipt never enqueues another dino_edit.
  assert.equal(http.getSummary().total >= 1, true);
  const same = await dinoStorage.getParkedMutationEditStatus({
    steamId: steam, slot, requestId: id,
  });
  assert.equal(same.confirmed, true);
});

test('parked mutation receipt preserves real game-side failures', async (t) => {
  const dinoStorage = require('../src/services/dinoStorageService');
  const previousFallback = process.env.COMMAND_BRIDGE_HTTP_RESULT_FTP_FALLBACK;
  process.env.COMMAND_BRIDGE_HTTP_RESULT_FTP_FALLBACK = 'false';
  t.after(() => {
    if (previousFallback === undefined) delete process.env.COMMAND_BRIDGE_HTTP_RESULT_FTP_FALLBACK;
    else process.env.COMMAND_BRIDGE_HTTP_RESULT_FTP_FALLBACK = previousFallback;
  });
  const slot = 'mutation-failure-slot';
  const write = await dinoStorage.editStoredDino({
    steamId: steam, slot, mode: 'mutations', trackMutation: true,
    values: { Slot1: 'Cellular Regeneration', Slot2: '', Slot3: '', Slot4: '' },
  });
  http.acceptResult({
    id: write.command.id, steam, source: 'DinoStorage', ok: false, msg: 'could not write parked dino slot',
  });
  const receipt = await dinoStorage.getParkedMutationEditStatus({
    steamId: steam, slot, requestId: write.command.id,
  });
  assert.equal(receipt.status, 'failed');
  assert.equal(receipt.confirmed, false);
  assert.match(receipt.error, /could not write/);
});
