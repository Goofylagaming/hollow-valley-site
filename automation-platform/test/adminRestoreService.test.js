const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildAdminRestoreJson, uploadAdminRestore } = require('../src/services/adminRestoreService');

const baseRestore = {
  version: 2,
  slot: 'admin_restore_trike',
  capturedAt: 0,
  classPath: '/Game/TheIsle/Core/Characters/Dinosaurs/Triceratops/BP_Triceratops.BP_Triceratops_C',
  growth: 0.76,
  nutrients: {
    carbValue: 12,
    proteinValue: 34,
    lipidValue: 56,
    bonesValue: 7,
    bMalnutrition: true,
  },
};

test('admin restore helper adds fullNutrients without rewriting explicit nutrient values', () => {
  const result = buildAdminRestoreJson({ restore: baseRestore, fullNutrients: true });

  assert.equal(result.state.fullNutrients, true);
  assert.equal(result.fullNutrients, true);
  assert.equal(result.explicitNutrients, true);
  assert.deepEqual(result.state.nutrients, baseRestore.nutrients);
  assert.match(result.json, /"fullNutrients": true/);
});

test('admin restore helper remains backward compatible when fullNutrients is not requested', () => {
  const result = buildAdminRestoreJson({ restore: baseRestore });

  assert.equal(Object.hasOwn(result.state, 'fullNutrients'), false);
  assert.deepEqual(result.state.nutrients, baseRestore.nutrients);
});

test('explicit fullNutrients false remains valid and preserves nutrients', () => {
  const result = buildAdminRestoreJson({
    restore: { ...baseRestore, fullNutrients: true },
    fullNutrients: false,
  });

  assert.equal(result.state.fullNutrients, false);
  assert.deepEqual(result.state.nutrients, baseRestore.nutrients);
});

test('admin restore helper accepts JSON text and validates growth', () => {
  const result = buildAdminRestoreJson({ restore: JSON.stringify(baseRestore), fullNutrients: true });
  assert.equal(result.state.growth, 0.76);

  assert.throws(
    () => buildAdminRestoreJson({ restore: { ...baseRestore, growth: 1.2 } }),
    /growth must be at most 1/
  );
});

test('DinoStorage Lua honors fullNutrients while normal snapshots do not serialize the flag', () => {
  const luaPath = path.join(__dirname, '..', '..', 'server-mods', 'DinoStorage', 'Scripts', 'main.lua');
  const lua = fs.readFileSync(luaPath, 'utf8');

  assert.match(lua, /state\.fullNutrients\s*=\s*jsonReadBool\(body, "fullNutrients"\)\s*==\s*true/);
  assert.match(lua, /local FULL_NUTRIENT_VALUE\s*=\s*9999\.0/);
  assert.match(lua, /nutrStruct\.CarbValue\s*=\s*FULL_NUTRIENT_VALUE/);
  assert.match(lua, /nutrStruct\.ProteinValue\s*=\s*FULL_NUTRIENT_VALUE/);
  assert.match(lua, /nutrStruct\.LipidValue\s*=\s*FULL_NUTRIENT_VALUE/);

  const writerStart = lua.indexOf('local function writeStateJson');
  const readerStart = lua.indexOf('local function readStateJson');
  assert.ok(writerStart >= 0 && readerStart > writerStart);
  assert.equal(lua.slice(writerStart, readerStart).includes('fullNutrients'), false);
});


test('admin restore upload fails closed unless the dedicated write gate is enabled', async () => {
  const previous = process.env.ADMIN_RESTORE_WRITE_ENABLED;
  delete process.env.ADMIN_RESTORE_WRITE_ENABLED;
  try {
    await assert.rejects(
      uploadAdminRestore({
        steamId: '76561198000000001',
        slot: 'admin_restore_test',
        restore: baseRestore,
        fullNutrients: true,
      }),
      (error) => error.code === 'ADMIN_RESTORE_WRITE_DISABLED'
    );
  } finally {
    if (previous === undefined) delete process.env.ADMIN_RESTORE_WRITE_ENABLED;
    else process.env.ADMIN_RESTORE_WRITE_ENABLED = previous;
  }
});

test('admin restore upload stages a new slot without overwriting and never auto-redeems', async () => {
  const previous = process.env.ADMIN_RESTORE_WRITE_ENABLED;
  process.env.ADMIN_RESTORE_WRITE_ENABLED = 'true';
  const calls = [];
  const client = {
    async ensureDir(directory) { calls.push(['ensureDir', directory]); },
    async list() { calls.push(['list']); return []; },
    async uploadFrom(_source, name) { calls.push(['uploadFrom', name]); },
    async rename(from, to) { calls.push(['rename', from, to]); },
    async remove(name) { calls.push(['remove', name]); },
    async cd(directory) { calls.push(['cd', directory]); },
  };
  const bridge = {
    getUe4ssRemotePath() { return '/game/TheIsle/Binaries/Win64/ue4ss'; },
    async withClient(callback) { return callback(client); },
  };

  try {
    const result = await uploadAdminRestore({
      steamId: '76561198000000001',
      slot: 'admin_restore_test',
      restore: baseRestore,
      fullNutrients: true,
    }, bridge);

    assert.equal(result.slot, 'admin_restore_test');
    assert.equal(result.fullNutrients, true);
    assert.equal(result.autoRedeem, false);
    assert.match(result.remotePath, /stored\/76561198000000001\/admin_restore_test\.json$/);
    assert.ok(calls.some(([name]) => name === 'uploadFrom'));
    assert.ok(calls.some(([name, , to]) => name === 'rename' && to === 'admin_restore_test.json'));
  } finally {
    if (previous === undefined) delete process.env.ADMIN_RESTORE_WRITE_ENABLED;
    else process.env.ADMIN_RESTORE_WRITE_ENABLED = previous;
  }
});

test('admin restore upload refuses to overwrite an existing DinoStorage slot', async () => {
  const previous = process.env.ADMIN_RESTORE_WRITE_ENABLED;
  process.env.ADMIN_RESTORE_WRITE_ENABLED = 'true';
  const client = {
    async ensureDir() {},
    async list() { return [{ name: 'admin_restore_test.json' }]; },
    async uploadFrom() { assert.fail('must not upload over an existing slot'); },
    async rename() { assert.fail('must not rename over an existing slot'); },
    async remove() {},
    async cd() {},
  };
  const bridge = {
    getUe4ssRemotePath() { return '/game/TheIsle/Binaries/Win64/ue4ss'; },
    async withClient(callback) { return callback(client); },
  };

  try {
    await assert.rejects(
      uploadAdminRestore({
        steamId: '76561198000000001',
        slot: 'admin_restore_test',
        restore: baseRestore,
      }, bridge),
      /refusing to overwrite/
    );
  } finally {
    if (previous === undefined) delete process.env.ADMIN_RESTORE_WRITE_ENABLED;
    else process.env.ADMIN_RESTORE_WRITE_ENABLED = previous;
  }
});
