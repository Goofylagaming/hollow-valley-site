const test = require('node:test');
const assert = require('node:assert/strict');

const bridgePath = require.resolve('../src/services/commandBridgeService');
const presetsPath = require.resolve('../src/services/skinPresetService');
const wearPath = require.resolve('../src/services/skinWearService');

function color(seed) {
  return { r: seed, g: 0.2, b: 0.3, a: 1 };
}

function samplePreset() {
  return {
    id: 'preset-live-001',
    species: 'Triceratops',
    skin: {
      body: color(0.1),
      markings: color(0.11),
      flank: color(0.12),
      underbelly: color(0.13),
      teeth: color(0.14),
      mouth: color(0.15),
      claws: color(0.16),
      detail1: color(0.17),
      eyes: color(0.18),
      maleDisplay: color(0.19),
      skinVariation: 4,
      patternIndex: 2,
      themeIndex: 3,
    },
  };
}

function loadFixture({ outcome = { state: 'confirmed', message: 'Skin applied.', source: 'SkinStudio' }, enabled = true, preset = samplePreset() } = {}) {
  const calls = { queued: [], read: [] };

  require.cache[bridgePath] = {
    id: bridgePath,
    filename: bridgePath,
    loaded: true,
    exports: {
      buildCommand(verb, steamId, args) {
        return { id: 'skin-command-001', verb, steamId, args };
      },
      async queueCommand(command) {
        calls.queued.push(command);
      },
      async readOutcome(command) {
        calls.read.push(command.id);
        return outcome;
      },
    },
  };

  require.cache[presetsPath] = {
    id: presetsPath,
    filename: presetsPath,
    loaded: true,
    exports: {
      COLOR_KEYS: ['body','markings','flank','underbelly','teeth','mouth','claws','detail1','eyes','maleDisplay'],
      liveWearEnabled() { return enabled; },
      getPresetForPlayer() { return preset; },
      sanitizeSkin(value) { return value; },
      validateSpecies(value) { return value; },
    },
  };

  delete require.cache[wearPath];
  const service = require(wearPath);

  return {
    service,
    calls,
    cleanup() {
      delete require.cache[wearPath];
      delete require.cache[bridgePath];
      delete require.cache[presetsPath];
    },
  };
}

test('live skin wear sends species plus native variation, pattern and theme tokens', async (t) => {
  const fixture = loadFixture();
  t.after(fixture.cleanup);

  const result = await fixture.service.wearPreset({
    steamId: '76561198000000601',
    presetId: 'preset-live-001',
  });

  assert.equal(result.confirmed, true);
  assert.equal(fixture.calls.queued.length, 1);
  const command = fixture.calls.queued[0];
  assert.equal(command.verb, 'skin_apply');
  assert.equal(command.args.includes('species=Triceratops'), true);
  assert.equal(command.args.includes('variation=4'), true);
  assert.equal(command.args.includes('pattern=2'), true);
  assert.equal(command.args.includes('theme=3'), true);
  assert.equal(command.args.some((token) => token.startsWith('body=')), true);
});


test('universal live skin sends wildcard species and preserves species-native indices', async (t) => {
  const preset = samplePreset();
  preset.species = 'Universal';
  const fixture = loadFixture({ preset });
  t.after(fixture.cleanup);

  const result = await fixture.service.wearPreset({
    steamId: '76561198000000604',
    presetId: 'preset-live-001',
  });

  assert.equal(result.confirmed, true);
  const command = fixture.calls.queued[0];
  assert.equal(command.args.includes('species=Universal'), true);
  assert.equal(command.args.includes('preserveIndices=1'), true);
});

test('live skin wear fails closed when the feature gate is disabled', async (t) => {
  const fixture = loadFixture({ enabled: false });
  t.after(fixture.cleanup);

  await assert.rejects(
    fixture.service.wearPreset({
      steamId: '76561198000000602',
      presetId: 'preset-live-001',
    }),
    (error) => error.code === 'SKIN_LIVE_WEAR_DISABLED'
  );
  assert.equal(fixture.calls.queued.length, 0);
});

test('live skin wear surfaces game-side rejection without claiming success', async (t) => {
  const fixture = loadFixture({
    outcome: { state: 'failed', message: 'This skin is for Triceratops, not your current dinosaur.' },
  });
  t.after(fixture.cleanup);

  await assert.rejects(
    fixture.service.wearPreset({
      steamId: '76561198000000603',
      presetId: 'preset-live-001',
    }),
    (error) => error.code === 'SKIN_WEAR_FAILED' && error.requestId === 'skin-command-001'
  );
});
