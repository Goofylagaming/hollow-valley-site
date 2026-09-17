const test = require('node:test');
const assert = require('node:assert/strict');

const rcon = require('../src/services/rconControlService');

test('RCON control actions are allowlisted and validated', () => {
  assert.deepEqual(rcon.buildAction('announce', { message: 'Server message' }), {
    action: 'announce',
    code: 0x10,
    params: 'Server message',
  });
  assert.deepEqual(rcon.buildAction('save'), { action: 'save', code: 0x50, params: '' });
  assert.deepEqual(rcon.buildAction('aiDensity', { value: 0.5 }), { action: 'aiDensity', code: 0x92, params: '0.5' });
  assert.throws(() => rcon.buildAction('unknown'), /Unsupported/);
  assert.throws(() => rcon.buildAction('aiDensity', { value: 1.1 }), /between 0 and 1/);
  assert.throws(() => rcon.buildAction('announce', { message: 'x'.repeat(241) }), /240/);
});

test('corpse wipe requires explicit confirmation text', () => {
  assert.throws(() => rcon.buildAction('wipeCorpses', {}), /WIPE CORPSES/);
  assert.deepEqual(rcon.buildAction('wipeCorpses', { confirm: 'WIPE CORPSES' }), {
    action: 'wipeCorpses',
    code: 0x13,
    params: '',
  });
});

test('direct message requires a valid Steam ID', () => {
  assert.throws(() => rcon.buildAction('directMessage', { steamId: 'bad', message: 'Hi' }), /17-digit Steam ID/);
  assert.deepEqual(rcon.buildAction('directMessage', { steamId: '76561198012345678', message: 'Hi' }), {
    action: 'directMessage',
    code: 0x11,
    params: '76561198012345678,Hi',
  });
});

test('RCON writes fail closed unless explicitly enabled', async () => {
  const previous = process.env.RCON_WRITE_ENABLED;
  process.env.RCON_WRITE_ENABLED = 'false';
  await assert.rejects(() => rcon.execute('save'), /disabled/);
  if (previous === undefined) delete process.env.RCON_WRITE_ENABLED;
  else process.env.RCON_WRITE_ENABLED = previous;
});
