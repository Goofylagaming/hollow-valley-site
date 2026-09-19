const test = require('node:test');
const assert = require('node:assert/strict');
const { Writable } = require('node:stream');

const bridgePath = require.resolve('../src/adapters/fileBridge');
const servicePath = require.resolve('../src/services/parkedDinoFileService');

function loadFixture() {
  delete require.cache[bridgePath];
  delete require.cache[servicePath];

  const target = '/ue4ss/Mods/DinoStorage/Saved/stored/76561198000000501/slot_a.json';
  const files = new Map([[target, Buffer.from(JSON.stringify({
    slot: 'slot_a',
    classPath: '/Game/Test/BP_Test.BP_Test_C',
    growth: 0.5,
    mutations: { Slot1: 'Wader' },
  }) + '\n')]]);

  const renameCalls = [];
  let finalRenameFailed = false;
  let firstRollbackFailed = false;

  function missing(message = 'not found') {
    const error = new Error(message);
    error.code = 550;
    return error;
  }

  const client = {
    async size(remotePath) {
      const value = files.get(remotePath);
      if (!value) throw missing();
      return value.length;
    },
    async downloadTo(sink, remotePath) {
      const value = files.get(remotePath);
      if (!value) throw missing();
      sink.write(value);
      sink.end();
    },
    async ensureDir() {},
    async cd() {},
    async uploadFrom(stream, remotePath) {
      const chunks = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      files.set(remotePath, Buffer.concat(chunks));
    },
    async rename(from, to) {
      renameCalls.push({ from, to });

      const isTempToTarget = from.includes('.edit-') && to === target;
      if (isTempToTarget && !finalRenameFailed) {
        finalRenameFailed = true;
        throw new Error('simulated final rename failure');
      }

      const isBackupToTarget = from.includes('.backup-') && to === target;
      if (isBackupToTarget && !firstRollbackFailed) {
        firstRollbackFailed = true;
        throw new Error('simulated first rollback failure');
      }

      if (!files.has(from)) throw missing();
      files.set(to, files.get(from));
      files.delete(from);
    },
    async remove(remotePath) {
      files.delete(remotePath);
    },
  };

  function bufferWritable() {
    const chunks = [];
    const sink = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    });
    sink.toBuffer = () => Buffer.concat(chunks);
    return sink;
  }

  require.cache[bridgePath] = {
    id: bridgePath,
    filename: bridgePath,
    loaded: true,
    exports: {
      getUe4ssRemotePath: () => '/ue4ss',
      normalizeRemotePath: (value) => String(value).replace(/\\/g, '/'),
      isMissingFtpError: (error) => error?.code === 550,
      bufferWritable,
      withClient: async (fn) => fn(client),
    },
  };

  const service = require(servicePath);
  return {
    service,
    target,
    files,
    renameCalls,
    cleanup() {
      delete require.cache[bridgePath];
      delete require.cache[servicePath];
    },
  };
}

test('parked dino editor restores original backup after first rollback rename fails', async (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);

  const original = Buffer.from(fixture.files.get(fixture.target));

  await assert.rejects(() => fixture.service.updateStoredDino(
    '76561198000000501',
    'slot_a',
    (state) => {
      state.growth = 0.9;
      return state;
    }
  ), (error) => error.code === 'DINO_EDIT_ROLLBACK_FAILED');

  assert.equal(fixture.files.has(fixture.target), true);
  assert.deepEqual(fixture.files.get(fixture.target), original);

  const leftovers = [...fixture.files.keys()].filter((key) =>
    key.includes('.backup-') || key.includes('.edit-')
  );
  assert.deepEqual(leftovers, []);

  const rollbackAttempts = fixture.renameCalls.filter((call) =>
    call.from.includes('.backup-') && call.to === fixture.target
  );
  assert.equal(rollbackAttempts.length, 2);
});
