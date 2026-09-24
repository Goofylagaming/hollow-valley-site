const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-exclusive-skin-edit-"));
process.env.ECONOMY_DB_PATH = path.join(tempDir, "economy.sqlite");
process.env.SKIN_SYSTEM_ENABLED = "true";

const store = require("../automation-platform/src/services/economyStore");
const skins = require("../automation-platform/src/services/skinPresetService");

const OWNER = "76561198000000101";
const PLAYER = "76561198000000102";
const PRESET_ID = "exclusive-edit-test";

function color(r, g, b) {
  return { r, g, b, a: 1 };
}

function skin(bodyRed = 0.2) {
  return {
    body: color(bodyRed, 0.2, 0.2),
    markings: color(0.1, 0.1, 0.1),
    flank: color(0.3, 0.3, 0.3),
    underbelly: color(0.8, 0.8, 0.7),
    teeth: color(0.9, 0.9, 0.8),
    mouth: color(0.4, 0.1, 0.1),
    claws: color(0.15, 0.15, 0.15),
    detail1: color(0.5, 0.4, 0.2),
    eyes: color(0.7, 1, 0.2),
    maleDisplay: color(0.6, 0.3, 0.1),
    skinVariation: 0,
    patternIndex: 0,
    themeIndex: 0,
  };
}

test("granted exclusive skins can be personalized without changing the owner's original", () => {
  store.ensureWallet(OWNER);
  store.ensureWallet(PLAYER);

  store.db.prepare(`
    INSERT INTO economy_skin_presets
      (id, owner_steam_id, species, name, description, skin_json, is_premium, active, published, exclusive, price, share_code)
    VALUES (?, ?, 'universal', 'Original Exclusive', 'Original description', ?, 0, 1, 0, 1, 0, 'HV-EXCL-EDIT')
  `).run(PRESET_ID, OWNER, JSON.stringify(skin(0.2)));

  store.grantSkinPreset({
    steamId: PLAYER,
    presetId: PRESET_ID,
    grantedBySteamId: OWNER,
    note: "Exclusive reward",
  });

  const updated = skins.updatePreset({
    steamId: PLAYER,
    presetId: PRESET_ID,
    species: "universal",
    name: "My Exclusive Variant",
    description: "Personal colours",
    skin: skin(0.75),
  });

  assert.equal(updated.name, "My Exclusive Variant");
  assert.equal(updated.granted, true);
  assert.equal(updated.grantCustomized, true);
  assert.equal(updated.skin.body.r, 0.75);

  const ownerView = skins.getPresetForPlayer(OWNER, PRESET_ID);
  assert.equal(ownerView.name, "Original Exclusive");
  assert.equal(ownerView.skin.body.r, 0.2);

  const playerView = skins.getPresetForPlayer(PLAYER, PRESET_ID);
  assert.equal(playerView.name, "My Exclusive Variant");
  assert.equal(playerView.skin.body.r, 0.75);

  const mine = store.listOwnedSkinPresets(PLAYER);
  const listed = mine.find((preset) => preset.id === PRESET_ID);
  assert.equal(listed.name, "My Exclusive Variant");
  assert.equal(listed.grantCustomized, true);
});

test("non-owner players without an exclusive grant still cannot edit the skin", () => {
  const OTHER = "76561198000000103";
  store.ensureWallet(OTHER);

  assert.throws(() => skins.updatePreset({
    steamId: OTHER,
    presetId: PRESET_ID,
    species: "universal",
    name: "Should Not Work",
    description: "",
    skin: skin(0.9),
  }), /not editable|not found/i);
});
