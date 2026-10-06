const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AUTOMATION_SERVICE_URL = "https://automation.example.test";
process.env.HOLLOW_VALLEY_API_TOKEN = "test-token";
process.env.AUTOMATION_SERVICE_TIMEOUT_MS = "5000";

test("Skin Studio website client targets automation skin endpoints", async (t) => {
  const calls = [];
  const previousFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ ok: true, preset: { id: "preset-12345678" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => { global.fetch = previousFetch; });

  const clientPath = require.resolve("../server/services/automationWebsiteClient");
  delete require.cache[clientPath];
  const client = require(clientPath);

  const skin = {
    body: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
    markings: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
    flank: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
    underbelly: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
    teeth: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
    mouth: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
    claws: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
    detail1: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
    eyes: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
    maleDisplay: { r: 0.1, g: 0.2, b: 0.3, a: 1 },
    skinVariation: 0,
    patternIndex: 0,
    themeIndex: 0,
  };

  await client.saveStudioSkin({
    steamId: "76561198000000401",
    species: "Triceratops",
    name: "Valley Moss",
    description: "Test skin",
    skin,
    idempotencyKey: "skin-save:test-001",
  });
  await client.buySkin({
    steamId: "76561198000000401",
    presetId: "preset-12345678",
    idempotencyKey: "skin-buy:test-001",
  });
  await client.wearSkin({
    steamId: "76561198000000401",
    presetId: "preset-12345678",
  });
  await client.getSkinWearState("76561198000000401");
  await client.retrySkinWear("76561198000000401");
  await client.resetSkinWear("76561198000000401");

  assert.equal(calls[0].url, "https://automation.example.test/api/website/skins/studio");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(JSON.parse(calls[0].options.body).species, "Triceratops");

  assert.equal(calls[1].url, "https://automation.example.test/api/website/skins/preset-12345678/buy");
  assert.equal(calls[2].url, "https://automation.example.test/api/website/skins/preset-12345678/wear");
  assert.equal(calls[2].options.headers.Authorization, "Bearer test-token");
  assert.equal(calls[3].url, "https://automation.example.test/api/website/skins/wear-state/76561198000000401");
  assert.equal(calls[4].url, "https://automation.example.test/api/website/skins/wear-retry");
  assert.equal(calls[4].options.method, "POST");
  assert.equal(calls[5].url, "https://automation.example.test/api/website/skins/wear-reset");
  assert.equal(calls[5].options.method, "POST");
});


test("Skin Studio v012 restores life-scoped skins without using transient pawn skin data", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const lua = fs.readFileSync(path.join(__dirname, "..", "server-mods", "SkinStudio", "Scripts", "main.lua"), "utf8");
  const browser = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "skins.js"), "utf8");

  assert.match(lua, /SkinStudio v012/);
  assert.match(lua, /life-scoped reconnect persistence/);
  assert.match(lua, /rememberProfile\(steam, args, config, growth\)/);
  assert.match(lua, /loadProfiles\(\)/);
  assert.match(lua, /safeCall\("reapplyProfiles", reapplyProfiles\)/);
  assert.match(lua, /pendingLiveRefresh\[steam\]/);
  assert.match(lua, /local REAPPLY_INTERVAL_MS = 4000/);
  assert.match(lua, /PATTERN_MAX_BY_SPECIES/);
  assert.match(lua, /Skipped unverified PatternIndex/);
  assert.match(lua, /BABY_GROWTH_RESET_FLOOR = 0\.15/);
  assert.match(lua, /reconnect profile saved/);
  assert.equal(lua.includes("SaveDataToFile"), false);
  assert.match(lua, /state\.pawnAddress/);
  assert.match(lua, /state\.controllerAddress/);
  assert.match(lua, /Cancelled live skin refresh after dinosaur life changed/);
  assert.equal(lua.includes("mirrorCustomizerToTemporary"), false);
  assert.equal(lua.includes("pawn.TemporarySkinData"), false);
  assert.equal(lua.includes("bUseSkinPalette = true"), false);
  assert.match(lua, /temporary=false/);
  assert.match(lua, /local function parseColor/);
  assert.match(lua, /local function parseTokens/);
  assert.match(lua, /local function pawnClassName/);
  assert.match(lua, /local function speciesMatches/);
  assert.match(lua, /local function nearlyEqual/);
  assert.match(lua, /local function applyColor/);

  assert.match(browser, /data-species=/);
  assert.match(browser, /storedDinos\.find/);
  assert.match(browser, /presetSpecies\.toLowerCase\(\) !== dinoSpecies\.toLowerCase\(\)/);
  assert.match(browser, /Variation \$\{Number\(preset\.skin\?\.skinVariation\)/);
  assert.match(browser, /function syncColorCodeLabels\(\)/);
  assert.match(browser, /syncColorCodeLabels\(\);/);
  assert.match(browser, /syncPatternPresetButtons\(\);/);
});

test("Skin Studio 3D preview uses species-specific models and refuses fake universal previews", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "skins.html"), "utf8");
  const registry = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "skin-studio-model-registry.js"), "utf8");
  const renderer = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "skin-studio-3d.js"), "utf8");

  assert.match(html, /skin-studio-model-registry\.js/);
  assert.match(html, /id="skin-model-name"/);
  assert.match(registry, /tyrannosaurus:[\s\S]*capability: "zones"[\s\S]*patternMax: 2/);
  assert.match(registry, /const calibratedModel =/);
  assert.match(registry, /maskUrl/);
  assert.match(registry, /switch its registry entry from shapeModel/);
  assert.match(registry, /triceratops:[\s\S]*capability: "shape"/);
  assert.match(registry, /deinosuchus:[\s\S]*capability: "pending"/);
  assert.match(registry, /allosaurus: shapeModel/);
  assert.match(registry, /carnotaurus: shapeModel/);
  assert.match(registry, /ceratosaurus: shapeModel/);
  assert.match(registry, /dilophosaurus: shapeModel/);
  assert.match(registry, /gallimimus: shapeModel/);
  assert.match(registry, /kentrosaurus: shapeModel/);
  assert.match(registry, /pachycephalosaurus: shapeModel/);
  assert.match(registry, /pteranodon: shapeModel/);
  assert.match(registry, /stegosaurus: shapeModel/);
  assert.match(registry, /beipiaosaurus: pendingModel/);
  assert.match(renderer, /resolveModelDefinition/);
  assert.match(renderer, /loadModelForSpecies/);
  assert.match(renderer, /Universal skin/);
  assert.match(renderer, /colour-zone calibration pending/);
  assert.match(renderer, /currentModelDef\.capability === "zones"/);
  assert.match(renderer, /skin-model-auto-rotate/);
  assert.match(renderer, /skin-model-clean-view/);
  assert.match(renderer, /skin-model-ultra/);
  assert.match(renderer, /skin-model-spin/);
  assert.match(renderer, /function engineChannelsFromHex\(value\)/);
  assert.match(renderer, /THREE\.LinearSRGBColorSpace/);
  assert.match(renderer, /engineColorFromHex\(currentPalette\.body\)/);
  assert.match(renderer, /EVRIMA linear colour/);
  assert.equal(renderer.includes("new THREE.Color(currentPalette.body)"), false);
  assert.match(renderer, /lookupZoneFromUv/);
  assert.match(renderer, /selectPaintZoneAt/);
  assert.match(renderer, /function startCalibration\(\)/);
  assert.match(renderer, /function paintCalibrationUv\(uv\)/);
  assert.match(renderer, /function exportCalibrationMask\(\)/);
  assert.match(renderer, /async function loadMaskData\(def\)/);
  assert.match(renderer, /def\.maskUrl/);
  assert.match(renderer, /await response\.json\(\)/);
  assert.match(renderer, /JSON\.stringify\(maskPayloadFromLookup\(\), null, 2\)/);
  assert.match(renderer, /function loadCalibrationDraft\(\)/);
  assert.match(renderer, /hv-skin-calibration:/);
  assert.match(renderer, /draft auto-saved/);
  assert.match(html, /CLICK ZONE TO PAINT/);
  assert.match(html, /id="skin-calibration-panel"/);
  assert.match(html, /id="skin-calibration-zone"/);
  assert.match(html, /id="skin-calibration-copy"/);
});

test("Skin Studio keeps FNF-compatible core zone order and simple pattern controls", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const browser = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "skins.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "skins.html"), "utf8");

  const ordered = [
    '["maleDisplay", "Male display"',
    '["markings", "Markings"',
    '["body", "Body"',
    '["flank", "Flank"',
    '["underbelly", "Underbelly"',
    '["detail1", "Detail"',
    '["eyes", "Eyes"',
  ].map((needle) => browser.indexOf(needle));

  assert.equal(ordered.every((index) => index >= 0), true);
  assert.deepEqual([...ordered].sort((a, b) => a - b), ordered);
  assert.match(browser, /Fangs & Ferns-compatible order/);
  assert.match(browser, /Extended EVRIMA channels/);
  assert.match(browser, /previewSex/);
  assert.match(browser, /function selectedSpeciesProfile\(\)/);
  assert.match(browser, /Number\.isInteger\(profile\?\.patternMax\)/);
  assert.match(browser, /Wear Live will preserve its current in-game pattern/);
  assert.match(html, /skin-studio-3d\.js\?v=11/);
  assert.match(html, /id="skin-pattern-presets"/);
  assert.match(html, /id="skin-pattern-safety"/);
  assert.match(html, /id="skin-sex-preview"/);
  assert.match(html, /<details class="skin-advanced-settings">/);
  assert.match(html, /Advanced EVRIMA values/);
  assert.match(html, /Wear Live skips unsafe PatternIndex values/);
});

test("Skin Shop published cards hide raw colour swatches but editing views keep them", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const browser = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "skins.js"), "utf8");

  assert.equal(browser.includes('const swatchMarkup = mode === "store"'), true);
  assert.equal(browser.includes('? ""\n    : \`<div class="skin-swatch-row">\${swatches(preset.skin)}</div>\`;'), true);
  assert.equal(browser.includes("\${swatchMarkup}"), true);
  assert.equal(
    browser.includes('<p>\${escapeHtml(description)}</p>\n        <div class="skin-swatch-row">\${swatches(preset.skin)}</div>'),
    false
  );
});
