const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const luaPath = path.join(__dirname, "..", "client-mods", "SkinInspector", "Scripts", "main.lua");
const readmePath = path.join(__dirname, "..", "client-mods", "SkinInspector", "README.md");

test("SkinInspector v001 is local-player, read-only, and captures current customizer fields", () => {
  const lua = fs.readFileSync(luaPath, "utf8");
  const readme = fs.readFileSync(readmePath, "utf8");

  assert.match(lua, /RegisterKeyBind\(Key\.F8, \{ ModifierKey\.CONTROL, ModifierKey\.ALT \}/);
  assert.match(lua, /UEHelpers:GetPlayerController\(\)/);
  assert.match(lua, /ExecuteInGameThread\(function\(\)/);
  assert.match(lua, /pawn\.CustomizerData/);

  for (const field of [
    "BodyColor",
    "MarkingsColor",
    "FlankColor",
    "UnderbellyColor",
    "Detail1Color",
    "EyesColor",
    "TeethColor",
    "MouthColor",
    "ClawsColor",
    "MaleDisplayColor",
  ]) {
    assert.match(lua, new RegExp(field));
  }

  assert.match(lua, /PatternIndex/);
  assert.match(lua, /ThemeIndex/);
  assert.match(lua, /SkinVariation/);
  assert.match(lua, /GetNumMaterials\(\)/);
  assert.match(lua, /GetMaterial\(index\)/);
  assert.match(lua, /GetMaterialSlotNames\(\)/);
  assert.match(lua, /GetSkeletalMeshAsset\(\)/);
  assert.match(lua, /Mods\/SkinInspector\/Saved/);

  assert.equal(/FindAllOf\s*\(/.test(lua), false);
  assert.equal(/ForceNetUpdate\s*\(/.test(lua), false);
  assert.equal(/SetPropertyValue\s*\(/.test(lua), false);
  assert.equal(/\.SkinCode\b|\["SkinCode"\]|\['SkinCode'\]/.test(lua), false);
  assert.equal(/CustomizerData\s*=/.test(lua), false);

  assert.match(readme, /read-only/i);
  assert.match(readme, /Ctrl \+ Alt \+ F8/);
  assert.match(readme, /latest\.json/);
  assert.match(readme, /raw UV\/vertex-buffer extraction in Lua v001/i);
});

test("SkinInspector capture files use a versioned schema", () => {
  const lua = fs.readFileSync(luaPath, "utf8");
  assert.match(lua, /hollow-valley-skin-inspector\/v1/);
  assert.match(lua, /inspectorVersion = MOD_VERSION/);
  assert.match(lua, /capturedAtUnix = os\.time\(\)/);
  assert.match(lua, /limitations = \{/);
});
