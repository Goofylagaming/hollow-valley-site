const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';
const service = require('../src/services/dinoStorageService');
const bridge = require('../src/services/commandBridgeService');
const http = require('../src/services/commandBridgeHttpService');
const files = require('../src/adapters/fileBridge');
const steam = '76561198000000000';

function setup(t, transport = 'http_pull') {
  const settings = {
    COMMAND_BRIDGE_TRANSPORT: transport,
    COMMAND_BRIDGE_ENABLED: 'true',
    COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK: bridge.PUBLISHER_ACK,
    BINARYLANE_COMMAND_TOKEN: 'test-only',
  };
  for (const [key, value] of Object.entries(settings)) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
  t.mock.method(files, 'withClient', async () => assert.fail('HTTP list must not access FTP'));
  t.mock.method(files, 'getUe4ssRemotePath', () => assert.fail('HTTP list must not resolve FTP paths'));
}

test('HTTP list queues one read command and waits past routing ACK for matching stored states', async (t) => {
  setup(t);
  const states = [
    { slot: 'older', capturedAt: 10, classPath: '/Game/BP_Triceratops.BP_Triceratops_C',
      growth: 0.76, health: 800, isFemale: true, mutations: { Slot1: 'Truculency' } },
    { slot: 'newer', capturedAt: 20 },
  ];
  const originalRead = bridge.readOutcome;
  let reads = 0;
  t.mock.method(bridge, 'readOutcome', async (command) => {
    reads += 1;
    if (reads === 1) {
      const claimed = http.claimPending().map(JSON.parse);
      assert.equal(claimed.length, 1);
      assert.deepEqual(claimed[0], command);
      assert.equal(command.verb, 'dino_list');
      assert.equal(command.steam, steam);
      assert.deepEqual(command.args.args, []);
      assert.equal(http.acceptResult({ id: command.id, steam, source: 'BodyDrop', ok: true, msg: '[]' }).ignoredSource, 'BodyDrop');
      assert.equal(http.acceptResult({ id: command.id, steam: '76561198000000001', source: 'DinoStorage', ok: true, msg: '[]' }).accepted, false);
      http.acceptResult({ id: command.id, steam, verb: command.verb, ok: true, msg: 'routed' });
    } else {
      http.acceptResult({ id: command.id, steam, source: 'DinoStorage', ok: true, msg: JSON.stringify(states) });
    }
    return originalRead(command);
  });
  const dinos = await service.listStoredDinos(` ${steam} `);
  assert.equal(reads, 2);
  assert.deepEqual(dinos.map((dino) => dino.slot), ['newer', 'older']);
  assert.deepEqual(dinos[1], { ...states[0], species: 'Triceratops', gender: 'Female', mutationList: ['Truculency'] });
});

for (const [message, expected] of [
  ['[]', []],
  ['not json', /invalid JSON/],
  ['{}', /non-array/],
  ['[null]', /invalid stored slot/],
  ['[{"slot":"../bad"}]', /invalid stored slot/],
  ['[{}]', /invalid stored slot/],
]) {
  test(`HTTP list validates payload ${message}`, async (t) => {
    setup(t);
    t.mock.method(bridge, 'queueCommand', async () => {});
    t.mock.method(bridge, 'readOutcome', async () => ({ state: 'confirmed', message }));
    if (Array.isArray(expected)) assert.deepEqual(await service.listStoredDinos(steam), expected);
    else await assert.rejects(service.listStoredDinos(steam), expected);
  });
}

test('HTTP list propagates terminal failures without falling back to FTP', async (t) => {
  setup(t);
  t.mock.method(bridge, 'queueCommand', async () => {});
  t.mock.method(bridge, 'readOutcome', async () => ({ state: 'failed', message: 'mod unavailable' }));
  await assert.rejects(service.listStoredDinos(steam), /mod unavailable/);
});

for (const outcome of [null, { state: 'acknowledged', message: 'routed' }]) {
  test(`HTTP list times out for ${outcome ? 'ACK only' : 'no result'} without replay`, async (t) => {
    setup(t);
    const queue = t.mock.method(bridge, 'queueCommand', async () => {});
    let now = 0;
    t.mock.method(Date, 'now', () => now);
    t.mock.method(bridge, 'readOutcome', async () => { now += 6000; return outcome; });
    await assert.rejects(service.listStoredDinos(steam), /timed out/);
    assert.equal(queue.mock.callCount(), 1);
  });
}

test('HTTP list validates identity and preserves publisher/configuration gates', async (t) => {
  setup(t);
  await assert.rejects(service.listStoredDinos('bad'), /Steam ID/);
  process.env.COMMAND_BRIDGE_ENABLED = 'false';
  await assert.rejects(service.listStoredDinos(steam), /COMMAND_BRIDGE_ENABLED/);
  process.env.COMMAND_BRIDGE_ENABLED = 'true';
  delete process.env.COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK;
  await assert.rejects(service.listStoredDinos(steam), /publishing is locked/);
  process.env.COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK = bridge.PUBLISHER_ACK;
  delete process.env.BINARYLANE_COMMAND_TOKEN;
  await assert.rejects(service.listStoredDinos(steam), /BINARYLANE_COMMAND_TOKEN/);
});

for (const transport of ['file', undefined]) {
  test(`FTP list remains available with ${transport || 'default'} transport`, async (t) => {
    setup(t, 'file');
    if (transport === undefined) delete process.env.COMMAND_BRIDGE_TRANSPORT;
    t.mock.method(bridge, 'queueCommand', async () => assert.fail('FTP list must not publish commands'));
    t.mock.method(files, 'getUe4ssRemotePath', () => '/UE4SS');
    t.mock.method(files, 'withClient', async (callback) => callback({
      cd: async (directory) => assert.equal(directory, `/UE4SS/Mods/DinoStorage/Saved/stored/${steam}`),
      list: async () => [{ isFile: true, name: 'saved.json', size: 80 }],
      downloadTo: async (sink) => sink.write(JSON.stringify({ slot: 'saved', growth: 0.76 })),
    }));
    const dinos = await service.listStoredDinos(steam);
    assert.equal(dinos.length, 1);
    assert.equal(dinos[0].slot, 'saved');
    assert.equal(dinos[0].growth, 0.76);
  });
}
