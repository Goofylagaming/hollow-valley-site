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

test('RCON writes fail closed unless the specific action is enabled', async () => {
  const keys = [
    'RCON_WRITE_ENABLED',
    'RCON_ANNOUNCEMENT_WRITE_ENABLED',
    'RCON_CORPSE_WIPE_WRITE_ENABLED',
    'RCON_SAVE_WRITE_ENABLED',
    'RCON_AI_DENSITY_WRITE_ENABLED',
  ];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));

  process.env.RCON_WRITE_ENABLED = 'false';
  process.env.RCON_ANNOUNCEMENT_WRITE_ENABLED = 'true';
  process.env.RCON_CORPSE_WIPE_WRITE_ENABLED = 'true';
  process.env.RCON_SAVE_WRITE_ENABLED = 'false';
  process.env.RCON_AI_DENSITY_WRITE_ENABLED = 'false';

  assert.equal(rcon.writeEnabled('announce'), true);
  assert.equal(rcon.writeEnabled('wipeCorpses'), true);
  assert.equal(rcon.writeEnabled('save'), false);
  assert.equal(rcon.writeEnabled('aiDensity'), false);
  assert.deepEqual(rcon.getActionGates(), {
    announce: true,
    directMessage: false,
    wipeCorpses: true,
    save: false,
    aiDensity: false,
  });

  await assert.rejects(() => rcon.execute('save'), /RCON_SAVE_WRITE_ENABLED/);

  for (const key of keys) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
});

test('RCON_DISABLED overrides every direct RCON write gate', async () => {
  const previousDisabled = process.env.RCON_DISABLED;
  const previousGlobal = process.env.RCON_WRITE_ENABLED;
  const previousAnnouncement = process.env.RCON_ANNOUNCEMENT_WRITE_ENABLED;
  process.env.RCON_DISABLED = 'true';
  process.env.RCON_WRITE_ENABLED = 'true';
  process.env.RCON_ANNOUNCEMENT_WRITE_ENABLED = 'true';

  assert.equal(rcon.rconDisabled(), true);
  assert.equal(rcon.writeEnabled('announce'), false);
  assert.equal(rcon.getState().configured, false);
  assert.equal(rcon.getState().rconDisabled, true);
  await assert.rejects(() => rcon.execute('announce', { message: 'test' }), /writes are disabled/);

  if (previousDisabled === undefined) delete process.env.RCON_DISABLED;
  else process.env.RCON_DISABLED = previousDisabled;
  if (previousGlobal === undefined) delete process.env.RCON_WRITE_ENABLED;
  else process.env.RCON_WRITE_ENABLED = previousGlobal;
  if (previousAnnouncement === undefined) delete process.env.RCON_ANNOUNCEMENT_WRITE_ENABLED;
  else process.env.RCON_ANNOUNCEMENT_WRITE_ENABLED = previousAnnouncement;
});

test('legacy RCON_WRITE_ENABLED remains a fallback when no per-action gate is set', () => {
  const previousGlobal = process.env.RCON_WRITE_ENABLED;
  const previousAnnouncement = process.env.RCON_ANNOUNCEMENT_WRITE_ENABLED;
  process.env.RCON_WRITE_ENABLED = 'true';
  delete process.env.RCON_ANNOUNCEMENT_WRITE_ENABLED;
  assert.equal(rcon.writeEnabled('announce'), true);

  process.env.RCON_ANNOUNCEMENT_WRITE_ENABLED = 'false';
  assert.equal(rcon.writeEnabled('announce'), false);

  if (previousGlobal === undefined) delete process.env.RCON_WRITE_ENABLED;
  else process.env.RCON_WRITE_ENABLED = previousGlobal;
  if (previousAnnouncement === undefined) delete process.env.RCON_ANNOUNCEMENT_WRITE_ENABLED;
  else process.env.RCON_ANNOUNCEMENT_WRITE_ENABLED = previousAnnouncement;
});
