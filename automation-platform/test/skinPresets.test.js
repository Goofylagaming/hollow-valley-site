const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function sampleSkin() {
  const color = () => ({ r: 0.1, g: 0.2, b: 0.3, a: 1 });
  return {
    body: color(),
    markings: color(),
    flank: color(),
    underbelly: color(),
    teeth: color(),
    mouth: color(),
    claws: color(),
    detail1: color(),
    eyes: color(),
    maleDisplay: color(),
    skinVariation: 1,
    patternIndex: 2,
    themeIndex: 3,
  };
}

function loadService({ enabled = true, edits = true, cost = 500 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-skins-'));
  const previous = {
    db: process.env.AUTOMATION_DB_PATH,
    system: process.env.SKIN_SYSTEM_ENABLED,
    edits: process.env.PARKED_DINO_EDIT_ENABLED,
    cost: process.env.SKIN_PRESET_CREATE_COST,
  };
  process.env.AUTOMATION_DB_PATH = path.join(dir, 'economy.sqlite');
  process.env.SKIN_SYSTEM_ENABLED = enabled ? 'true' : 'false';
  process.env.PARKED_DINO_EDIT_ENABLED = edits ? 'true' : 'false';
  process.env.SKIN_PRESET_CREATE_COST = String(cost);

  const storePath = require.resolve('../src/services/economyStore');
  const filePath = require.resolve('../src/services/parkedDinoFileService');
  const servicePath = require.resolve('../src/services/skinPresetService');
  delete require.cache[storePath];
  delete require.cache[filePath];
  delete require.cache[servicePath];

  let dino = {
    slot: 'slot_skin',
    classPath: '/Game/TheIsle/Core/Characters/Dinosaurs/Carnotaurus/BP_Carnotaurus.BP_Carnotaurus_C',
    skin: sampleSkin(),
    growth: 0.75,
    health: 900,
  };

  require.cache[filePath] = {
    id: filePath,
    filename: filePath,
    loaded: true,
    exports: {
      validateSlot(value) { return String(value); },
      async readStoredDino() { return JSON.parse(JSON.stringify(dino)); },
      async updateStoredDino(_steamId, _slot, mutator) {
        const draft = JSON.parse(JSON.stringify(dino));
        dino = await mutator(draft, dino);
        return JSON.parse(JSON.stringify(dino));
      },
    },
  };

  const store = require(storePath);
  const service = require(servicePath);

  return {
    store,
    service,
    getDino: () => dino,
    cleanup() {
      delete require.cache[storePath];
      delete require.cache[filePath];
      delete require.cache[servicePath];
      if (previous.db === undefined) delete process.env.AUTOMATION_DB_PATH; else process.env.AUTOMATION_DB_PATH = previous.db;
      if (previous.system === undefined) delete process.env.SKIN_SYSTEM_ENABLED; else process.env.SKIN_SYSTEM_ENABLED = previous.system;
      if (previous.edits === undefined) delete process.env.PARKED_DINO_EDIT_ENABLED; else process.env.PARKED_DINO_EDIT_ENABLED = previous.edits;
      if (previous.cost === undefined) delete process.env.SKIN_PRESET_CREATE_COST; else process.env.SKIN_PRESET_CREATE_COST = previous.cost;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('creating a real skin preset captures parked-dino skin and charges exactly once', async (t) => {
  const fixture = loadService();
  t.after(fixture.cleanup);
  const steamId = '76561198000000301';
  fixture.store.applyWalletTransaction({
    steamId,
    amount: 1000,
    kind: 'test_credit',
    reason: 'Skin funding',
    idempotencyKey: 'skin-fund:001',
  });

  const first = await fixture.service.createPresetFromStored({
    steamId,
    slot: 'slot_skin',
    name: 'Ash Hunter',
    idempotencyKey: 'skin-create:001',
  });
  assert.equal(first.preset.species, 'Carnotaurus');
  assert.equal(first.preset.name, 'Ash Hunter');
  assert.deepEqual(first.preset.skin, sampleSkin());
  assert.equal(first.wallet.balance, 500);

  const duplicate = await fixture.service.createPresetFromStored({
    steamId,
    slot: 'slot_skin',
    name: 'Ash Hunter',
    idempotencyKey: 'skin-create:001',
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.preset.id, first.preset.id);
  assert.equal(duplicate.wallet.balance, 500);
  assert.equal(fixture.store.getWallet(steamId).transactions.filter((tx) => tx.kind === 'skin_preset_create').length, 1);
});

test('skin preset apply changes only skin data on same-species parked dino', async (t) => {
  const fixture = loadService();
  t.after(fixture.cleanup);
  const steamId = '76561198000000302';
  fixture.store.applyWalletTransaction({
    steamId,
    amount: 500,
    kind: 'test_credit',
    reason: 'Skin funding',
    idempotencyKey: 'skin-fund:002',
  });
  const created = await fixture.service.createPresetFromStored({
    steamId,
    slot: 'slot_skin',
    name: 'Original',
    idempotencyKey: 'skin-create:002',
  });

  const beforeHealth = fixture.getDino().health;
  fixture.getDino().skin.body.r = 0.9;

  const result = await fixture.service.applyPreset({
    steamId,
    slot: 'slot_skin',
    presetId: created.preset.id,
  });

  assert.equal(result.skin.body.r, 0.1);
  assert.equal(fixture.getDino().health, beforeHealth);
  assert.equal(fixture.getDino().websiteEdits.skinPresetId, created.preset.id);
});

test('skin preset cannot be applied to a different species', async (t) => {
  const fixture = loadService();
  t.after(fixture.cleanup);
  const steamId = '76561198000000303';
  fixture.store.applyWalletTransaction({
    steamId,
    amount: 500,
    kind: 'test_credit',
    reason: 'Skin funding',
    idempotencyKey: 'skin-fund:003',
  });
  const created = await fixture.service.createPresetFromStored({
    steamId,
    slot: 'slot_skin',
    name: 'Carno Only',
    idempotencyKey: 'skin-create:003',
  });

  fixture.getDino().classPath = '/Game/TheIsle/Core/Characters/Dinosaurs/Triceratops/BP_Triceratops.BP_Triceratops_C';
  await assert.rejects(() => fixture.service.applyPreset({
    steamId,
    slot: 'slot_skin',
    presetId: created.preset.id,
  }), (error) => error.code === 'SKIN_SPECIES_MISMATCH');
});

test('other players private presets are not accessible', async (t) => {
  const fixture = loadService();
  t.after(fixture.cleanup);
  const owner = '76561198000000304';
  const other = '76561198000000305';
  fixture.store.applyWalletTransaction({
    steamId: owner,
    amount: 500,
    kind: 'test_credit',
    reason: 'Skin funding',
    idempotencyKey: 'skin-fund:004',
  });
  const created = await fixture.service.createPresetFromStored({
    steamId: owner,
    slot: 'slot_skin',
    name: 'Private',
    idempotencyKey: 'skin-create:004',
  });

  await assert.rejects(() => fixture.service.applyPreset({
    steamId: other,
    slot: 'slot_skin',
    presetId: created.preset.id,
  }), (error) => error.code === 'SKIN_PRESET_NOT_FOUND');
});

test('skin system and parked edit gates are fail-closed', async (t) => {
  const disabled = loadService({ enabled: false, edits: false });
  t.after(disabled.cleanup);
  await assert.rejects(() => disabled.service.createPresetFromStored({
    steamId: '76561198000000306',
    slot: 'slot_skin',
    name: 'Nope',
    idempotencyKey: 'skin-create:005',
  }), (error) => error.code === 'SKIN_SYSTEM_DISABLED');

  const applyDisabled = loadService({ enabled: true, edits: false });
  t.after(applyDisabled.cleanup);
  assert.equal(applyDisabled.service.applyEnabled(), false);
});

test('invalid captured skin values are rejected instead of written back', (t) => {
  const fixture = loadService();
  t.after(fixture.cleanup);
  const bad = sampleSkin();
  bad.body.r = 2;
  assert.throws(() => fixture.service.sanitizeSkin(bad), /between 0 and 1/);
});


test('Skin Studio saves free drafts with a share code when creation cost is zero', async (t) => {
  const fixture = loadService({ cost: 0 });
  t.after(fixture.cleanup);
  const steamId = '76561198000000307';

  const created = await fixture.service.createPresetFromStudio({
    steamId,
    species: 'Triceratops',
    name: 'Valley Moss',
    description: 'Green and gold valley pattern.',
    skin: sampleSkin(),
    idempotencyKey: 'skin-studio:007',
  });

  assert.equal(created.duplicate, false);
  assert.equal(created.wallet.balance, 0);
  assert.equal(created.preset.species, 'Triceratops');
  assert.match(created.preset.share_code, /^HV-[A-F0-9]{5}-[A-F0-9]{5}$/);
  assert.equal(created.preset.published, false);

  const duplicate = await fixture.service.createPresetFromStudio({
    steamId,
    species: 'Triceratops',
    name: 'Valley Moss',
    description: 'Green and gold valley pattern.',
    skin: sampleSkin(),
    idempotencyKey: 'skin-studio:007',
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.preset.id, created.preset.id);
});

test('published skin purchase permanently unlocks once and debits Valley Coin once', async (t) => {
  const fixture = loadService({ cost: 0 });
  t.after(fixture.cleanup);
  const creator = '76561198000000308';
  const buyer = '76561198000000309';

  const created = await fixture.service.createPresetFromStudio({
    steamId: creator,
    species: 'Triceratops',
    name: 'Amber Frill',
    skin: sampleSkin(),
    idempotencyKey: 'skin-studio:008',
  });
  fixture.service.publishPreset({
    presetId: created.preset.id,
    price: 250,
    description: 'Published test skin.',
  });

  fixture.store.applyWalletTransaction({
    steamId: buyer,
    amount: 500,
    kind: 'test_credit',
    reason: 'Skin shop funding',
    idempotencyKey: 'skin-fund:009',
  });

  const before = fixture.service.listStore(buyer).find((row) => row.id === created.preset.id);
  assert.equal(before.owned, false);
  assert.equal(before.price, 250);

  const purchase = fixture.service.purchasePreset({
    steamId: buyer,
    presetId: created.preset.id,
    idempotencyKey: 'skin-buy:009',
  });
  assert.equal(purchase.duplicate, false);
  assert.equal(purchase.wallet.balance, 250);
  assert.equal(purchase.preset.owned, true);

  const duplicate = fixture.service.purchasePreset({
    steamId: buyer,
    presetId: created.preset.id,
    idempotencyKey: 'skin-buy:009',
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.wallet.balance, 250);

  const owned = fixture.service.listAvailablePresets(buyer);
  assert.equal(owned.some((row) => row.id === created.preset.id), true);
  assert.equal(fixture.store.getWallet(buyer).transactions.filter((tx) => tx.kind === 'skin_purchase').length, 1);
});
