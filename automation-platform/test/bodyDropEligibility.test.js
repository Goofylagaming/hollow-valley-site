const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';

function loadService({ snapshot } = {}) {
  const servicePath = require.resolve('../src/services/bodyDropService');
  const statusPath = require.resolve('../src/services/statusService');
  const bridgePath = require.resolve('../src/services/commandBridgeService');

  const originalStatus = require(statusPath);
  const originalBridge = require(bridgePath);

  require.cache[statusPath].exports = {
    ...originalStatus,
    getServerSnapshot: async () => snapshot || {
      online: true,
      characters: [],
      players: [],
      maxPlayers: null,
    },
  };
  require.cache[bridgePath].exports = {
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
  assert.deepEqual(state.restrictions, { carnivoreOnly: true, maxGrowthPercent: 60 });
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
