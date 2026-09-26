const test = require('node:test');
const assert = require('node:assert/strict');

const fileBridgePath = require.resolve('../src/adapters/fileBridge');
const commandBridgePath = require.resolve('../src/services/commandBridgeService');
const dinoStoragePath = require.resolve('../src/services/dinoStorageService');
const servicePath = require.resolve('../src/services/parkedDinoFileService');

function loadFixture({ outcomeFor } = {}) {
  for (const path of [fileBridgePath, commandBridgePath, dinoStoragePath, servicePath]) {
    delete require.cache[path];
  }

  const queued = [];
  const storedReads = [];
  let ftpCalls = 0;

  require.cache[fileBridgePath] = {
    id: fileBridgePath,
    filename: fileBridgePath,
    loaded: true,
    exports: {
      getUe4ssRemotePath() { throw new Error('FTP path must not be used in http_pull mode'); },
      isMissingFtpError: () => false,
      withClient: async () => {
        ftpCalls += 1;
        throw new Error('FTP must not be used in http_pull mode');
      },
    },
  };

  require.cache[commandBridgePath] = {
    id: commandBridgePath,
    filename: commandBridgePath,
    loaded: true,
    exports: {
      getTransport: () => 'http_pull',
      buildCommand(verb, steam, tokens) {
        return { id: `cmd-${queued.length + 1}`, verb, steam, args: { args: tokens } };
      },
      async queueCommand(command) {
        queued.push(command);
        return command;
      },
      async readOutcome(command) {
        if (typeof outcomeFor === 'function') return outcomeFor(command);
        const operation = command.args.args[1];
        return {
          state: 'confirmed',
          ok: true,
          message: operation === 'escrow-exists' ? 'true' : 'ok',
        };
      },
    },
  };

  require.cache[dinoStoragePath] = {
    id: dinoStoragePath,
    filename: dinoStoragePath,
    loaded: true,
    exports: {
      async getStoredDino(steamId, slot) {
        storedReads.push({ steamId, slot });
        return {
          slot,
          classPath: '/Game/TheIsle/Core/Characters/Dinosaurs/Tenontosaurus/BP_Tenontosaurus.BP_Tenontosaurus_C',
          growth: 0.75,
          isPrime: true,
        };
      },
    },
  };

  const service = require(servicePath);
  return {
    service,
    queued,
    storedReads,
    get ftpCalls() { return ftpCalls; },
    cleanup() {
      for (const path of [fileBridgePath, commandBridgePath, dinoStoragePath, servicePath]) {
        delete require.cache[path];
      }
    },
  };
}

const seller = '76561198000000001';
const buyer = '76561198000000002';
const listingId = '11111111-2222-3333-4444-555555555555';

test('HTTP-pull marketplace reads seller DinoStorage through CommandBridge-backed DinoStorage service', async (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);

  const state = await fixture.service.readStoredDino(seller, 'teno_slot');
  assert.equal(state.growth, 0.75);
  assert.deepEqual(fixture.storedReads, [{ steamId: seller, slot: 'teno_slot' }]);
  assert.equal(fixture.ftpCalls, 0);
});

test('HTTP-pull marketplace escrows, transfers and restores without FTP', async (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);

  await fixture.service.moveStoredToEscrow({ listingId, steamId: seller, slot: 'teno_slot' });
  await fixture.service.transferEscrowToStored({ listingId, buyerSteamId: buyer, buyerSlot: 'market_target' });
  await fixture.service.restoreEscrowToSeller({ listingId, sellerSteamId: seller, sellerSlot: 'teno_slot' });

  assert.equal(fixture.ftpCalls, 0);
  assert.deepEqual(fixture.queued.map((command) => ({
    verb: command.verb,
    steam: command.steam,
    tokens: command.args.args,
  })), [
    { verb: 'bd', steam: seller, tokens: ['marketplace', 'escrow', listingId, 'teno_slot'] },
    { verb: 'bd', steam: buyer, tokens: ['marketplace', 'transfer', listingId, 'market_target'] },
    { verb: 'bd', steam: seller, tokens: ['marketplace', 'restore', listingId, 'teno_slot'] },
  ]);
});

test('HTTP-pull marketplace probes escrow presence through the game server', async (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);

  assert.equal(await fixture.service.escrowExists(listingId), true);
  assert.equal(fixture.ftpCalls, 0);
  assert.equal(fixture.queued[0].verb, 'bd');
  assert.equal(fixture.queued[0].steam, '00000000000000000');
  assert.deepEqual(fixture.queued[0].args.args, ['marketplace', 'escrow-exists', listingId]);
});

test('game-server occupied buyer slot maps to DINO_TARGET_EXISTS for safe refund handling', async (t) => {
  const fixture = loadFixture({
    outcomeFor(command) {
      return {
        state: 'failed',
        ok: false,
        message: command.args.args[1] === 'transfer' ? 'buyer target slot occupied' : 'failed',
      };
    },
  });
  t.after(fixture.cleanup);

  await assert.rejects(
    () => fixture.service.transferEscrowToStored({
      listingId,
      buyerSteamId: buyer,
      buyerSlot: 'market_target',
    }),
    (error) => error.code === 'DINO_TARGET_EXISTS'
  );
  assert.equal(fixture.ftpCalls, 0);
});
