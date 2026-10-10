const test = require('node:test');
const assert = require('node:assert/strict');

const storagePath = require.resolve('../src/services/dinoStorageService');
const servicePath = require.resolve('../src/services/parkedDinoMutationService');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadService({ enabled = false, editReceipt = null } = {}) {
  const previous = process.env.PARKED_DINO_EDIT_ENABLED;
  process.env.PARKED_DINO_EDIT_ENABLED = enabled ? 'true' : 'false';
  let state = {
    slot: 'slot_a',
    classPath: '/Game/TheIsle/Core/Characters/Dinosaurs/Tyrannosaurus/BP_Tyrannosaurus.BP_Tyrannosaurus_C',
    species: 'Tyrannosaurus',
    isFemale: true,
    mutations: {
      Slot1: 'Cellular Regeneration',
      Slot2: 'Wader',
      Slot3: '',
      Slot4: '',
      ParentSlot1: 'Inherited Example',
      ElderSlot1A: 'Elder Example',
    },
  };
  const editCalls = [];

  delete require.cache[storagePath];
  delete require.cache[servicePath];
  require.cache[storagePath] = {
    id: storagePath,
    filename: storagePath,
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
      async getStoredDino() { return clone(state); },
      async editStoredDino(command) {
        editCalls.push(clone(command));
        return editReceipt || { ok: true };
      },
      async getParkedMutationEditStatus(params) {
        return { ...params, requestId: params.requestId, status: 'confirmed', confirmed: true };
      },
    },
  };

  const service = require(servicePath);
  return {
    service,
    getState: () => state,
    getWrites: () => editCalls.length,
    getEditCalls: () => clone(editCalls),
    cleanup() {
      delete require.cache[storagePath];
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
  assert.deepEqual(fixture.getEditCalls()[0], {
    steamId: '76561198000000201',
    slot: 'slot_a',
    mode: 'mutations',
    trackMutation: true,
    values: {
      Slot1: 'Hemomania',
      Slot2: 'Sustained Hydration',
      Slot3: 'Osteosclerosis',
      Slot4: '',
    },
  });
  const raw = fixture.getState();
  assert.equal(raw.mutations.ParentSlot1, 'Inherited Example');
  assert.equal(raw.mutations.ElderSlot1A, 'Elder Example');
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


test('current mutation rules exclude removed mutation and include reproductive options', async (t) => {
  const fixture = loadService();
  t.after(fixture.cleanup);
  const result = await fixture.service.getMutationEditor('76561198000000201', 'slot_a');

  assert.equal(result.catalog.includes('Traumatic Thrombosis'), false);
  assert.equal(result.catalog.includes('Sequential Hermaphroditism'), true);
  assert.equal(result.catalog.includes('Parthenogenesis'), true);
  assert.equal(result.slotCatalog.Slot1.includes('Parthenogenesis'), false);
  assert.equal(result.slotCatalog.Slot2.includes('Parthenogenesis'), true);
  assert.equal(result.slotCatalog.Slot3.includes('Enhanced Digestion'), true);
  assert.equal(result.slotCatalog.Slot4.includes('Enhanced Digestion'), false);
});

test('slot-restricted mutation is rejected before file write', async (t) => {
  const fixture = loadService({ enabled: true });
  t.after(fixture.cleanup);

  await assert.rejects(() => fixture.service.updateMutations({
    steamId: '76561198000000201',
    slot: 'slot_a',
    mutations: { Slot1: 'Cannibalistic' },
  }), (error) => error.code === 'MUTATION_SLOT_NOT_ALLOWED');

  assert.equal(fixture.getWrites(), 0);
});

test('female-only mutation is rejected on a male parked dino', async (t) => {
  const fixture = loadService({ enabled: true });
  t.after(fixture.cleanup);
  fixture.getState().isFemale = false;

  await assert.rejects(() => fixture.service.updateMutations({
    steamId: '76561198000000201',
    slot: 'slot_a',
    mutations: { Slot2: 'Parthenogenesis' },
  }), (error) => error.code === 'MUTATION_SLOT_NOT_ALLOWED');

  assert.equal(fixture.getWrites(), 0);
});


test('mutation editor JSON keys match DinoStorage serializer contract', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const lua = fs.readFileSync(
    path.join(__dirname, '..', '..', 'server-mods', 'DinoStorage', 'Scripts', 'main.lua'),
    'utf8'
  );

  assert.match(lua, /"Slot1": "%s", "Slot2": "%s", "Slot3": "%s", "Slot4": "%s"/);
  assert.match(lua, /jsonReadString\(mutBlock,"Slot1"\)/);
  assert.match(lua, /MutationSlot1 = jsonReadString\(mutBlock,"Slot1"\)/);
});

test('T-Rex only sees carnivore and universal mutations', async (t) => {
  const fixture = loadService({ enabled: true });
  t.after(fixture.cleanup);
  const result = await fixture.service.getMutationEditor('76561198000000201', 'slot_a');

  assert.equal(result.species, 'Tyrannosaurus');
  assert.equal(result.diet, 'carnivore');
  assert.ok(result.slotCatalog.Slot2.includes('Cannibalistic'));
  assert.ok(result.slotCatalog.Slot2.includes('Hypermetabolic Inanition'));
  assert.ok(result.slotCatalog.Slot2.includes('Cellular Regeneration'));
  assert.equal(result.slotCatalog.Slot2.includes('Tactile Endurance'), false);
  assert.equal(result.slotCatalog.Slot1.includes('Barometric Sensitivity'), false);
  assert.equal(result.catalog.includes('Photosynthetic Regeneration'), false);
});

test('T-Rex cannot write herbivore-only Tactile Endurance', async (t) => {
  const fixture = loadService({ enabled: true });
  t.after(fixture.cleanup);
  await assert.rejects(() => fixture.service.updateMutations({
    steamId: '76561198000000201',
    slot: 'slot_a',
    mutations: { Slot2: 'Tactile Endurance' },
  }), (error) => error.code === 'MUTATION_SLOT_NOT_ALLOWED' &&
    /not available for Tyrannosaurus/.test(error.message));
  assert.equal(fixture.getWrites(), 0);
});

test('Triceratops only sees herbivore and universal mutations, not carnivore mutations', async (t) => {
  const fixture = loadService({ enabled: true });
  t.after(fixture.cleanup);
  fixture.getState().species = 'Triceratops';
  fixture.getState().classPath = '/Game/Dinosaurs/Triceratops/BP_Triceratops.BP_Triceratops_C';

  const result = await fixture.service.getMutationEditor('76561198000000201', 'slot_a');
  assert.equal(result.diet, 'herbivore');
  assert.ok(result.slotCatalog.Slot2.includes('Tactile Endurance'));
  assert.ok(result.slotCatalog.Slot2.includes('Cellular Regeneration'));
  assert.equal(result.slotCatalog.Slot2.includes('Cannibalistic'), false);
  assert.equal(result.catalog.includes('Accelerated Prey Drive'), false);
  await assert.rejects(() => fixture.service.updateMutations({
    steamId: '76561198000000201',
    slot: 'slot_a',
    mutations: { Slot1: 'Accelerated Prey Drive' },
  }), (error) => error.code === 'MUTATION_SLOT_NOT_ALLOWED');
  assert.equal(fixture.getWrites(), 0);
});

test('carnivore and herbivore mutations still work for their own diet', async (t) => {
  const carnivore = loadService({ enabled: true });
  t.after(carnivore.cleanup);
  await carnivore.service.updateMutations({
    steamId: '76561198000000201',
    slot: 'slot_a',
    mutations: { Slot1: 'Accelerated Prey Drive', Slot2: 'Cannibalistic' },
  });
  assert.equal(carnivore.getWrites(), 1);

  const herbivore = loadService({ enabled: true });
  t.after(herbivore.cleanup);
  herbivore.getState().species = 'Triceratops';
  herbivore.getState().classPath = '/Game/Dinosaurs/Triceratops/BP_Triceratops.BP_Triceratops_C';
  await herbivore.service.updateMutations({
    steamId: '76561198000000201',
    slot: 'slot_a',
    mutations: { Slot1: 'Barometric Sensitivity', Slot2: 'Tactile Endurance' },
  });
  assert.equal(herbivore.getWrites(), 1);
});

test('plant-eating omnivores can use plant pool but cannot equip carnivore-only mutations', async (t) => {
  const fixture = loadService({ enabled: true });
  t.after(fixture.cleanup);
  fixture.getState().species = 'Beipiaosaurus';
  fixture.getState().classPath = '/Game/Dinosaurs/Beipiaosaurus/BP_Beipiaosaurus.BP_Beipiaosaurus_C';

  const result = await fixture.service.getMutationEditor('76561198000000201', 'slot_a');
  assert.equal(result.diet, 'omnivore');
  assert.ok(result.slotCatalog.Slot2.includes('Tactile Endurance'));
  assert.equal(result.catalog.includes('Hemomania'), false);
  await assert.rejects(() => fixture.service.updateMutations({
    steamId: '76561198000000201',
    slot: 'slot_a',
    mutations: { Slot1: 'Hemomania' },
  }), (error) => error.code === 'MUTATION_SLOT_NOT_ALLOWED');
  assert.equal(fixture.getWrites(), 0);
});

test('innate cannibals do not see or receive Cannibalistic mutation', async (t) => {
  const fixture = loadService({ enabled: true });
  t.after(fixture.cleanup);
  fixture.getState().species = 'Deinosuchus';
  fixture.getState().classPath = '/Game/Dinosaurs/Deinosuchus/BP_Deinosuchus.BP_Deinosuchus_C';

  const result = await fixture.service.getMutationEditor('76561198000000201', 'slot_a');
  assert.equal(result.slotCatalog.Slot2.includes('Cannibalistic'), false);
  await assert.rejects(() => fixture.service.updateMutations({
    steamId: '76561198000000201',
    slot: 'slot_a',
    mutations: { Slot2: 'Cannibalistic' },
  }), (error) => error.code === 'MUTATION_SLOT_NOT_ALLOWED');
  assert.equal(fixture.getWrites(), 0);
});

test('unrecognised dinosaur species cannot edit mutations even by sending a crafted write', async (t) => {
  const fixture = loadService({ enabled: true });
  t.after(fixture.cleanup);
  fixture.getState().species = 'Unknown';
  fixture.getState().classPath = '/Game/Dinosaurs/Unreleased/BP_Unreleased.BP_Unreleased_C';

  const state = await fixture.service.getMutationEditor('76561198000000201', 'slot_a');
  assert.equal(state.writeEnabled, false);
  assert.deepEqual(state.catalog, []);
  await assert.rejects(() => fixture.service.updateMutations({
    steamId: '76561198000000201',
    slot: 'slot_a',
    mutations: { Slot1: 'Cellular Regeneration' },
  }), (error) => error.code === 'MUTATION_SPECIES_UNKNOWN');
  assert.equal(fixture.getWrites(), 0);
});

test('mutation constraints do not alter inherited or elder fields', async (t) => {
  const fixture = loadService({ enabled: true });
  t.after(fixture.cleanup);
  fixture.getState().species = 'Triceratops';
  await fixture.service.updateMutations({
    steamId: '76561198000000201',
    slot: 'slot_a',
    mutations: { Slot1: 'Cellular Regeneration', Slot2: 'Tactile Endurance' },
  });
  const values = fixture.getEditCalls()[0].values;
  assert.equal(Object.keys(values).length, 4);
  assert.equal(fixture.getState().mutations.ParentSlot1, 'Inherited Example');
  assert.equal(fixture.getState().mutations.ElderSlot1A, 'Elder Example');
});

test('queued mutation edits return an unconfirmed receipt instead of throwing timeout', async (t) => {
  const fixture = loadService({
    enabled: true,
    editReceipt: {
      command: { id: 'b8d90bba-88b0-462c-87e6-a5d0ffec8121' },
      outcome: { state: 'pending' },
    },
  });
  t.after(fixture.cleanup);

  const result = await fixture.service.updateMutations({
    steamId: '76561198000000201',
    slot: 'slot_a',
    mutations: { Slot1: 'Accelerated Prey Drive', Slot2: 'Cannibalistic' },
  });
  assert.equal(fixture.getWrites(), 1);
  assert.equal(fixture.getEditCalls()[0].trackMutation, true);
  assert.equal(result.confirmed, false);
  assert.equal(result.pending, true);
  assert.equal(result.requestId, 'b8d90bba-88b0-462c-87e6-a5d0ffec8121');
  assert.match(result.message, /waiting for confirmation/i);
});

test('mutation edit status lookup uses the original request ID and slot', async (t) => {
  const fixture = loadService({ enabled: true });
  t.after(fixture.cleanup);
  const status = await fixture.service.getMutationEditStatus({
    steamId: '76561198000000201',
    slot: 'slot_a',
    requestId: 'e91e7904-6bdc-4b72-90de-a46360c10f98',
  });
  assert.equal(status.confirmed, true);
  assert.equal(status.requestId, 'e91e7904-6bdc-4b72-90de-a46360c10f98');
  assert.equal(fixture.getWrites(), 0);
});
