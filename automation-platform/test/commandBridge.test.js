const test = require('node:test');
const assert = require('node:assert/strict');
const bridge = require('../src/services/commandBridgeService');

const steamId = '76561198000000000';

function line(value) {
  return `${JSON.stringify(value)}\n`;
}

test('buildCommand validates Steam IDs and token content', () => {
  const command = bridge.buildCommand('bd', steamId, ['spawn', 'Dryosaurus']);
  assert.equal(command.verb, 'bd');
  assert.equal(command.steam, steamId);
  assert.deepEqual(command.args.args, ['spawn', 'Dryosaurus']);
  assert.throws(() => bridge.buildCommand('bd', 'bad'), /Steam ID/);
  assert.throws(() => bridge.buildCommand('bd', steamId, ['"escape"']), /tokens/);
  assert.throws(() => bridge.buildCommand('unknown', steamId), /Unsupported/);
});

test('bridge acknowledgement remains unconfirmed until the sub-mod reports', () => {
  const command = bridge.buildCommand('bd', steamId);
  const outcome = bridge.findOutcome(line({
    id: command.id,
    steam: steamId,
    verb: 'bd',
    ok: true,
    msg: 'routed',
  }), command);
  assert.equal(outcome.state, 'acknowledged');
  assert.equal(outcome.ok, false);
  assert.equal(outcome.acknowledged, true);
});

test('BodyDrop source result is the only positive completion for BodyDrop', () => {
  const command = bridge.buildCommand('bd', steamId);
  const text = [
    line({ id: command.id, steam: steamId, verb: 'bd', ok: true, msg: 'routed' }),
    line({ id: command.id, steam: steamId, source: 'BodyDrop', ok: true, msg: 'spawned' }),
  ].join('');
  const outcome = bridge.findOutcome(text, command);
  assert.equal(outcome.state, 'confirmed');
  assert.equal(outcome.ok, true);
  assert.equal(outcome.source, 'BodyDrop');
});

test('negative bridge result fails immediately and malformed results are rejected', () => {
  const command = bridge.buildCommand('dino_store', steamId, ['default']);
  const failed = bridge.findOutcome(line({
    id: command.id,
    steam: steamId,
    verb: 'dino_store',
    ok: false,
    msg: 'queue rejected',
  }), command);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.ok, false);

  assert.throws(() => bridge.findOutcome('{not-json}\n', command), /malformed NDJSON/);
});

test('partial trailing NDJSON line is ignored until complete', () => {
  const command = bridge.buildCommand('bd', steamId);
  const completeAck = line({ id: command.id, steam: steamId, verb: 'bd', ok: true, msg: 'routed' });
  const text = `${completeAck}{"id":"${command.id}"`;
  const outcome = bridge.findOutcome(text, command);
  assert.equal(outcome.state, 'acknowledged');
});
