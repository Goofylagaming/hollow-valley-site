const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';

const store = require('../src/services/automationStore');
const { reconcileFinalBodyDropResult } = require('../src/services/bodyDropResultReconciler');

test('final successful BodyDrop result confirms a pending website request', () => {
  const id = 'bodydrop-result-success';
  store.createRequest({
    id,
    kind: 'bodydrop',
    steamId: '76561198000000881',
    status: 'acknowledged',
    commandId: id,
    details: {},
  });

  const updated = reconcileFinalBodyDropResult({
    id,
    steam: '76561198000000881',
    source: 'BodyDrop',
    ok: true,
    msg: 'Body drop spawned successfully.',
  });

  assert.equal(updated.status, 'confirmed');
  assert.equal(updated.message, 'Body drop spawned successfully.');
  assert.equal(updated.error, null);
  assert.equal(store.getRequest(id).status, 'confirmed');
});

test('final failed BodyDrop result releases pending lock as failed', () => {
  const id = 'bodydrop-result-failed';
  store.createRequest({
    id,
    kind: 'bodydrop',
    steamId: '76561198000000882',
    status: 'queued',
    commandId: id,
    details: {},
  });

  const updated = reconcileFinalBodyDropResult({
    id,
    steam: '76561198000000882',
    source: 'BodyDrop',
    ok: false,
    msg: 'No safe body drop spawn position found.',
  });

  assert.equal(updated.status, 'failed');
  assert.equal(updated.error, 'No safe body drop spawn position found.');
  assert.equal(store.getRequest(id).status, 'failed');
});

test('duplicate final BodyDrop result does not overwrite an existing terminal state', () => {
  const id = 'bodydrop-result-duplicate';
  store.createRequest({
    id,
    kind: 'bodydrop',
    steamId: '76561198000000883',
    status: 'confirmed',
    commandId: id,
    details: {},
    message: 'Already confirmed.',
  });

  const updated = reconcileFinalBodyDropResult({
    id,
    steam: '76561198000000883',
    source: 'BodyDrop',
    ok: false,
    msg: 'Late duplicate result.',
  });

  assert.equal(updated.status, 'confirmed');
  assert.equal(updated.message, 'Already confirmed.');
});
