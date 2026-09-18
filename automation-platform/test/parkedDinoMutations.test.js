const test = require('node:test');
const assert = require('node:assert/strict');

const filePath = require.resolve('../src/services/parkedDinoFileService');
const servicePath = require.resolve('../src/services/parkedDinoMutationService');

function loadService({ enabled = false } = {}) {
  const previous = process.env.PARKED_DINO_EDIT_ENABLED;
  process.env.PARKED_DINO_EDIT_ENABLED = enabled ? 'true' : 'false';
  let state = {
    slot: 'slot_a',
    mutations: {
      Slot1: 'Cellular Regeneration',
      Slot2: 'Wader',
      Slot3: '',
      Slot4: '',
      ParentSlot1: 'Inherited Example',
      ElderSlot1A: 'Elder Example',
    },
  };
  let writes = 0;

  delete require.cache[filePath];
  delete require.cache[servicePath];
  require.cache[filePath] = {
    id: filePath,
    filename: filePath,
    loaded: true,
    exports: {
      validateSteamId(value) {
        const id = String(value || '');
        if (!/^\d{17}$/.test(id)) throw new Error('Invalid Steam ID');
        return id;
      },
      validateSlot(value) {
        const slot = String(value || '');
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(slot)) throw new Error('Invalid DinoStorage slot');
        return slot;
      },
      async readStoredDino() { return JSON.parse(JSON.stringify(state)); },
      async updateStoredDino(_steamId, _slot, mutator) {
        writes += 1;
        const draft = JSON.parse(JSON.stringify(state));
        state = await mutator(draft, state);
        return JSON.parse(JSON.stringify(state));
      },
    },
  };

  const service = require(servicePath);
  return {
    service,
    getState: () => state,
    getWrites: () => writes,
    cleanup() {
      delete require.cache[filePath];
      delete require.cache[servicePath];
      if (previous === undefined) delete process.env.PARKED_DINO_EDIT_ENABLED;
      else process.env.PARKED_DINO_EDIT_ENABLED = previous;
    },
  };
}

test('mutation editor exposes four active slots and curated catalog', async (t) => {
  const fixture = loadService();
  t.after(fixture.cleanup);
  const result = await fixture.service.getMutationEditor('76561198000000201', 'slot_a');

  assert.deepEqual(Object.keys(result.mutations), ['Slot1', 'Slot2', 'Slot3', 'Slot4']);
  assert.equal(result.mutations.Slot1, 'Cellular Regeneration');
  assert.ok(result.catalog.includes('Reniculate Kidneys'));
  assert.ok(result.catalog.includes('Accelerated Prey Drive'));
  assert.equal(result.writeEnabled, false);
});

test('mutation edits are fail-closed while parked-dino writes are disabled', async (t) => {
  const fixture = loadService({ enabled: false });
  t.after(fixture.cleanup);

  await assert.rejects(() => fixture.service.updateMutations({
    steamId: '76561198000000201',
    slot: 'slot_a',
    mutations: { Slot1: 'Wader' },
  }), (error) => error.code === 'PARKED_DINO_EDIT_DISABLED');
  assert.equal(fixture.getWrites(), 0);
});

test('mutation editor changes only active slots and preserves inherited/elder data', async (t) => {
  const fixture = loadService({ enabled: true });
  t.after(fixture.cleanup);

  const result = await fixture.service.updateMutations({
    steamId: '76561198000000201',
    slot: 'slot_a',
    mutations: {
      Slot1: 'Hemomania',
      Slot2: 'Sustained Hydration',
      Slot3: 'Osteosclerosis',
      Slot4: '',
    },
  });

  assert.equal(fixture.getWrites(), 1);
  assert.deepEqual(result.mutations, {
    Slot1: 'Hemomania',
    Slot2: 'Sustained Hydration',
    Slot3: 'Osteosclerosis',
    Slot4: '',
  });
  const raw = fixture.getState();
  assert.equal(raw.mutations.ParentSlot1, 'Inherited Example');
  assert.equal(raw.mutations.ElderSlot1A, 'Elder Example');
  assert.ok(raw.websiteEdits.mutationsEditedAt);
});

test('duplicate or unknown mutations are rejected before file write', async (t) => {
  const fixture = loadService({ enabled: true });
  t.after(fixture.cleanup);

  await assert.rejects(() => fixture.service.updateMutations({
    steamId: '76561198000000201',
    slot: 'slot_a',
    mutations: { Slot1: 'Wader', Slot2: 'Wader' },
  }), (error) => error.code === 'DUPLICATE_MUTATION');

  await assert.rejects(() => fixture.service.updateMutations({
    steamId: '76561198000000201',
    slot: 'slot_a',
    mutations: { Slot1: 'Made Up Mutation' },
  }), (error) => error.code === 'MUTATION_NOT_ALLOWED');

  assert.equal(fixture.getWrites(), 0);
});

test('mutation names normalize case-insensitively to canonical names', (t) => {
  const fixture = loadService({ enabled: true });
  t.after(fixture.cleanup);
  assert.equal(fixture.service.normalizeMutation('cellular regeneration'), 'Cellular Regeneration');
  assert.equal(fixture.service.normalizeMutation('NONE'), '');
});
