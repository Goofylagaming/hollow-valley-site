const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';

function loadService({ snapshot, snapshotImpl, bridge } = {}) {
  const servicePath = require.resolve('../src/services/bodyDropService');
  const statusPath = require.resolve('../src/services/statusService');
  const bridgePath = require.resolve('../src/services/commandBridgeService');

  const originalStatus = require(statusPath);
  const originalBridge = require(bridgePath);

  require.cache[statusPath].exports = {
    ...originalStatus,
    getServerSnapshot: snapshotImpl || (async () => snapshot || {
      online: true,
      characters: [],
      players: [],
      maxPlayers: null,
    }),
  };
  require.cache[bridgePath].exports = bridge
    ? { ...originalBridge, ...bridge }
    : {
        ...originalBridge,
        buildCommand() {
          throw new Error('CommandBridge must not be reached for an ineligible request');
        },
        async queueCommand() {
          throw new Error('CommandBridge must not be reached for an ineligible request');
        },
      };

  delete require.cache[servicePath];
  const service = require(servicePath);

  return {
    service,
    restore() {
      require.cache[statusPath].exports = originalStatus;
      require.cache[bridgePath].exports = originalBridge;
      delete require.cache[servicePath];
    },
  };
}

test('BodyDrop eligibility matches live carnivore and growth rules', (t) => {
  const fixture = loadService();
  t.after(fixture.restore);
  const { bodyDropEligibility } = fixture.service;

  assert.equal(bodyDropEligibility({ species: 'Omniraptor', growth: 0.60 }).eligible, true);
  assert.equal(bodyDropEligibility({ species: 'BP_Omniraptor_C', growth: 0.42 }).eligible, true);

  const herbivore = bodyDropEligibility({ species: 'Triceratops', growth: 0.25 });
  assert.equal(herbivore.eligible, false);
  assert.match(herbivore.reason, /only available to carnivores/i);

  const adult = bodyDropEligibility({ species: 'Carnotaurus', growth: 0.61 });
  assert.equal(adult.eligible, false);
  assert.equal(Math.round(adult.growthPercent), 61);
  assert.match(adult.reason, /60% growth or below/i);
});

test('BodyDrop growth parser accepts 0..1 fractions and percent-style values', (t) => {
  const fixture = loadService();
  t.after(fixture.restore);
  const { growthPercent } = fixture.service;

  assert.equal(growthPercent(0.42), 42);
  assert.equal(growthPercent(42), 42);
  assert.equal(growthPercent(0), 0);
  assert.equal(growthPercent(null), null);
  assert.equal(growthPercent('bad'), null);
});

test('ineligible BodyDrop request stops before any CommandBridge publication', async (t) => {
  const fixture = loadService({
    snapshot: {
      online: true,
      players: [{ steamId: '76561198000000001', name: 'Herbivore' }],
      characters: [{
        steamId: '76561198000000001',
        species: 'Triceratops',
        growth: 0.25,
        location: { x: 1, y: 2, z: 3 },
      }],
      maxPlayers: 100,
    },
  });
  t.after(fixture.restore);

  await assert.rejects(
    fixture.service.requestBodyDrop({
      steamId: '76561198000000001',
      dropType: 'small',
    }),
    (error) => error.code === 'BODYDROP_INELIGIBLE' &&
      error.eligibility?.eligible === false &&
      /carnivores/i.test(error.message)
  );
});

test('BodyDrop state exposes live-compatible restrictions and eligibility', async (t) => {
  const fixture = loadService({
    snapshot: {
      online: true,
      players: [{ steamId: '76561198000000002', name: 'Young Carno' }],
      characters: [{
        steamId: '76561198000000002',
        species: 'Carnotaurus',
        growth: 0.4,
        location: { x: 1, y: 2, z: 3 },
      }],
      maxPlayers: 100,
    },
  });
  t.after(fixture.restore);

  const state = await fixture.service.getBodyDropState('76561198000000002');
  assert.equal(state.serverOnline, true);
  assert.equal(state.eligibility.eligible, true);
  assert.equal(state.eligibility.growthPercent, 40);
  assert.equal(state.restrictions.carnivoreOnly, true);
  assert.equal(state.restrictions.maxGrowthPercent, 60);
  assert.equal(state.restrictions.dietValidated, true);
  assert.equal(state.restrictions.corpseGrowthScalePercent, 75);
  assert.equal(state.corpseGrowthPercent, 30);
  assert.equal(state.requester.species, 'Carnotaurus');
  assert.equal(state.dietEligibility.eligible, true);
  assert.ok(state.options.some((option) =>
    option.id === 'protein-herrerasaurus' &&
    option.nutrient === 'protein' &&
    option.species === 'Herrerasaurus' &&
    option.growthPercent === 30
  ));
});



test('BodyDrop corpse size is 75% of requester growth clamped to 15-40%', (t) => {
  const fixture = loadService();
  t.after(fixture.restore);
  const { scaleCorpseGrowth } = fixture.service;

  assert.equal(scaleCorpseGrowth(0.10), 0.15);
  assert.equal(scaleCorpseGrowth(0.20), 0.15);
  assert.equal(scaleCorpseGrowth(0.40), 0.30);
  assert.equal(scaleCorpseGrowth(0.55), 0.40);
  assert.equal(scaleCorpseGrowth(60), 0.40);
});

test('BodyDrop rejects a carcass that is not on the live dinosaur diet', async (t) => {
  const steamId = '76561198000000444';
  const fixture = loadService({
    snapshot: {
      online: true,
      players: [{ steamId, name: 'Young Carno' }],
      characters: [{
        steamId,
        species: 'Carnotaurus',
        growth: 0.40,
        hunger: 0.20,
        location: { x: 10, y: 20, z: 30 },
      }],
      maxPlayers: 100,
    },
  });
  t.after(fixture.restore);

  await assert.rejects(
    fixture.service.requestBodyDrop({
      steamId,
      dropType: 'carbohydrate-triceratops',
    }),
    (error) =>
      error.code === 'BODYDROP_DIET_MISMATCH' &&
      /current Carnotaurus diet/i.test(error.message) &&
      Array.isArray(error.allowedDropTypes) &&
      error.allowedDropTypes.includes('protein-herrerasaurus')
  );
});

test('BodyDrop publishes the selected diet prey with scaled growth', async (t) => {
  const steamId = '76561198000000445';
  let built = null;
  const fixture = loadService({
    snapshot: {
      online: true,
      players: [{ steamId, name: 'Young Carno' }],
      characters: [{
        steamId,
        species: 'Carnotaurus',
        growth: 0.40,
        hunger: 0.20,
        location: { x: 10, y: 20, z: 30 },
      }],
      maxPlayers: 100,
    },
    bridge: {
      buildCommand(verb, steam, args) {
        built = { verb, steam, args };
        return { id: 'bodydrop-diet-test-0001', ts: 1, verb, steam, args };
      },
      async queueCommand() {},
    },
  });
  t.after(fixture.restore);

  await fixture.service.requestBodyDrop({
    steamId,
    dropType: 'protein-herrerasaurus',
  });

  assert.equal(built.verb, 'bd');
  assert.equal(built.steam, steamId);
  assert.equal(built.args[0], 'spawn');
  assert.equal(built.args[1], 'Herrerasaurus');
  assert.equal(Number(built.args[5]), 0.30);
});

test('legacy small BodyDrop remains accepted for admin/global compatibility', async (t) => {
  const steamId = '76561198000000446';
  let built = null;
  const fixture = loadService({
    snapshot: {
      online: true,
      players: [{ steamId, name: 'Legacy Carno' }],
      characters: [{
        steamId,
        species: 'Carnotaurus',
        growth: 0.40,
        hunger: 0.20,
        location: { x: 10, y: 20, z: 30 },
      }],
      maxPlayers: 100,
    },
    bridge: {
      buildCommand(verb, steam, args) {
        built = { verb, steam, args };
        return { id: 'bodydrop-legacy-test-0001', ts: 1, verb, steam, args };
      },
      async queueCommand() {},
    },
  });
  t.after(fixture.restore);

  await fixture.service.requestBodyDrop({ steamId, dropType: 'small' });

  assert.equal(built.args[1], 'Compsognathus');
  assert.equal(Number(built.args[5]), 1);
});

test('Austroraptor exposes only spawnable on-diet carcasses', async (t) => {
  const steamId = '76561198000000447';
  const fixture = loadService({
    snapshot: {
      online: true,
      players: [{ steamId, name: 'Austro' }],
      characters: [{
        steamId,
        species: 'Austroraptor',
        growth: 0.40,
        hunger: 0.20,
        location: { x: 10, y: 20, z: 30 },
      }],
      maxPlayers: 100,
    },
  });
  t.after(fixture.restore);

  const state = await fixture.service.getBodyDropState(steamId);
  assert.equal(state.eligibility.eligible, true);
  assert.equal(state.dietEligibility.eligible, true);
  assert.equal(state.dietEligibility.configured, true);
  assert.equal(state.corpseGrowthPercent, 30);
  assert.deepEqual(
    state.options.map((option) => [option.nutrient, option.species]),
    [
      ['protein', 'Deinosuchus'],
      ['protein', 'Hypsilophodon'],
      ['lipid', 'Beipiaosaurus'],
    ]
  );
  assert.equal(state.options.some((option) => option.nutrient === 'carbohydrate'), false);
});

test('failed or cancelled BodyDrop requests do not consume cooldown', (t) => {
  const fixture = loadService();
  t.after(fixture.restore);
  const { cooldownForRequest } = fixture.service;
  const now = Date.parse('2026-09-18T00:10:00.000Z');

  for (const status of ['failed', 'cancelled']) {
    const result = cooldownForRequest({
      id: 'request-test',
      status,
      created_at: '2026-09-18 00:09:30',
    }, now);
    assert.equal(result.active, false);
    assert.equal(result.remainingSeconds, 0);
  }
});

test('confirmed BodyDrop still consumes the configured cooldown window', (t) => {
  const fixture = loadService();
  t.after(fixture.restore);
  const { cooldownForRequest } = fixture.service;
  const previous = process.env.BODYDROP_COOLDOWN_SECONDS;
  process.env.BODYDROP_COOLDOWN_SECONDS = '900';

  try {
    const result = cooldownForRequest({
      id: 'request-test',
      status: 'confirmed',
      created_at: '2026-09-18 00:09:30',
    }, Date.parse('2026-09-18T00:10:00.000Z'));

    assert.equal(result.active, true);
    assert.equal(result.reason, 'cooldown');
    assert.equal(result.remainingSeconds, 870);
  } finally {
    if (previous === undefined) delete process.env.BODYDROP_COOLDOWN_SECONDS;
    else process.env.BODYDROP_COOLDOWN_SECONDS = previous;
  }
});


test('simultaneous BodyDrop requests for one player publish only once', async (t) => {
  const steamId = '76561198000000999';
  let snapshotCalls = 0;
  let releaseSnapshot;
  const gate = new Promise((resolve) => { releaseSnapshot = resolve; });
  let commandCounter = 0;
  let queueCalls = 0;

  const snapshot = {
    online: true,
    players: [{ steamId, name: 'Young Carno' }],
    characters: [{
      steamId,
      species: 'Carnotaurus',
      growth: 0.4,
      location: { x: 10, y: 20, z: 30 },
    }],
    maxPlayers: 100,
  };

  const fixture = loadService({
    snapshotImpl: async () => {
      snapshotCalls += 1;
      if (snapshotCalls === 2) releaseSnapshot();
      await gate;
      return snapshot;
    },
    bridge: {
      buildCommand(verb, steam, args) {
        commandCounter += 1;
        return {
          id: `bodydrop-race-${commandCounter}`,
          ts: new Date().toISOString(),
          source: 'BodyDrop',
          verb,
          steam,
          args,
        };
      },
      async queueCommand() {
        queueCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
      },
    },
  });
  t.after(fixture.restore);

  const results = await Promise.allSettled([
    fixture.service.requestBodyDrop({ steamId, dropType: 'small' }),
    fixture.service.requestBodyDrop({ steamId, dropType: 'small' }),
  ]);

  assert.equal(queueCalls, 1);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'BODYDROP_COOLDOWN');
  assert.equal(rejected.reason.cooldown.reason, 'pending');
});


test('global emergency BodyDrop requires carnivore <=60% growth and <=30% food', (t) => {
  const fixture = loadService();
  t.after(fixture.restore);
  const { globalBodyDropEligibility, foodPercent } = fixture.service;

  const eligible = globalBodyDropEligibility({
    steamId: '76561198000001001',
    species: 'Tyrannosaurus',
    growth: 0.55,
    hunger: 0.30,
    location: { x: 1, y: 2, z: 3 },
  });
  assert.equal(eligible.eligible, true);
  assert.equal(Math.round(eligible.growthPercent), 55);
  assert.equal(eligible.foodPercent, 30);
  assert.equal(foodPercent(0.25), 25);
  assert.equal(foodPercent(25), 25);

  const fed = globalBodyDropEligibility({
    steamId: '76561198000001002',
    species: 'Carnotaurus',
    growth: 0.40,
    hunger: 31,
    location: { x: 1, y: 2, z: 3 },
  });
  assert.equal(fed.eligible, false);
  assert.match(fed.reason, /30% food or below/i);

  const herbivore = globalBodyDropEligibility({
    steamId: '76561198000001003',
    species: 'Triceratops',
    growth: 0.20,
    hunger: 10,
    location: { x: 1, y: 2, z: 3 },
  });
  assert.equal(herbivore.eligible, false);
});

test('global emergency BodyDrop is default-off, one-shot and only queues eligible players', async (t) => {
  const previousStagger = process.env.GLOBAL_BODYDROP_STAGGER_MS;
  process.env.GLOBAL_BODYDROP_STAGGER_MS = '0';
  t.after(() => {
    if (previousStagger === undefined) delete process.env.GLOBAL_BODYDROP_STAGGER_MS;
    else process.env.GLOBAL_BODYDROP_STAGGER_MS = previousStagger;
  });

  let commandCounter = 0;
  let queueCalls = 0;
  const snapshot = {
    online: true,
    players: [],
    maxPlayers: 100,
    characters: [
      {
        steamId: '76561198000002001',
        species: 'Tyrannosaurus',
        growth: 0.55,
        hunger: 0.25,
        location: { x: 10, y: 20, z: 30 },
      },
      {
        steamId: '76561198000002002',
        species: 'Carnotaurus',
        growth: 0.40,
        hunger: 0.80,
        location: { x: 40, y: 50, z: 60 },
      },
    ],
  };

  const fixture = loadService({
    snapshot,
    bridge: {
      buildCommand(verb, steam, args) {
        commandCounter += 1;
        return { id: `global-bodydrop-${commandCounter}`, ts: 1, verb, steam, args };
      },
      async queueCommand() {
        queueCalls += 1;
      },
    },
  });
  t.after(fixture.restore);

  const service = fixture.service;
  assert.equal(service.getGlobalBodyDropState().enabled, false);
  await assert.rejects(
    service.activateGlobalBodyDrop(),
    (error) => error.code === 'GLOBAL_BODYDROP_DISABLED'
  );

  const armed = service.setGlobalBodyDropEnabled(true);
  assert.equal(armed.enabled, true);

  const activated = await service.activateGlobalBodyDrop();
  assert.equal(activated.enabled, false);
  assert.equal(activated.lastRun.scheduledCount, 1);
  assert.equal(activated.lastRun.eligibleCount, 1);

  await new Promise((resolve) => setTimeout(resolve, 25));
  const finished = service.getGlobalBodyDropState();
  assert.equal(queueCalls, 1);
  assert.equal(finished.enabled, false);
  assert.equal(finished.lastRun.queuedCount, 1);
  assert.equal(finished.lastRun.status, 'completed');
});
