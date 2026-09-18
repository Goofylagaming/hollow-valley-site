const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildAdminRestoreJson } = require('../src/services/adminRestoreService');

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
