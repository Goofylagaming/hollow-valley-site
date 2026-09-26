const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';
process.env.GAME_ACTION_QUEUE_ENABLED = 'true';
process.env.GAME_ACTION_QUEUE_COOLDOWN_MS = '0';
process.env.GAME_ACTION_QUEUE_LOCK_TIMEOUT_MS = '60000';

const http = require('../src/services/commandBridgeHttpService');

function command(id, verb, steam = '76561198038977506') {
  return {
    id,
    ts: Math.floor(Date.now() / 1000),
    verb,
    steam,
    args: { args: [] },
  };
}

test('anti-crash queue dispatches only one game action at a time', () => {
  const first = command('queue-park-1', 'dino_store');
  const second = command('queue-bodydrop-1', 'bd');
  http.enqueue(first, 'DinoStorage');
  http.enqueue(second, 'BodyDrop');

  const claimed = http.claimPending(10).map(JSON.parse);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].id, first.id);

  assert.deepEqual(http.claimPending(10), []);
  const state = http.actionQueueState();
  assert.equal(state.locked, true);
  assert.equal(state.reason, 'action_in_flight');
  assert.equal(state.active.id, first.id);
});

test('CommandBridge acknowledgement does not release the game-action lock', () => {
  const outcome = http.acceptResult({
    id: 'queue-park-1',
    steam: '76561198038977506',
    verb: 'dino_store',
    ok: true,
    msg: 'accepted',
  });

  assert.equal(outcome.accepted, true);
  assert.equal(outcome.final, false);
  assert.deepEqual(http.claimPending(10), []);
  assert.equal(http.actionQueueState().active.status, 'acknowledged');
});

test('final sub-mod result releases the next queued action', () => {
  const outcome = http.acceptResult({
    id: 'queue-park-1',
    steam: '76561198038977506',
    source: 'DinoStorage',
    ok: true,
    msg: 'park complete',
  });

  assert.equal(outcome.accepted, true);
  assert.equal(outcome.final, true);

  const claimed = http.claimPending(10).map(JSON.parse);
  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].id, 'queue-bodydrop-1');
});

test('queue is fail-safe: a stale in-flight action is not re-dispatched', () => {
  const row = http.getRequest('queue-park-1');
  assert.equal(row.status, 'completed');

  // The second action is already dispatched. A subsequent poll must not send it
  // again while it owns the action lock.
  assert.deepEqual(http.claimPending(10), []);
  assert.equal(http.getRequest('queue-bodydrop-1').status, 'dispatched');
});
