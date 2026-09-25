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

  assert.equal(calls[0].url, "https://automation.example.test/api/website/skins/studio");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(JSON.parse(calls[0].options.body).species, "Triceratops");

  assert.equal(calls[1].url, "https://automation.example.test/api/website/skins/preset-12345678/buy");
  assert.equal(calls[2].url, "https://automation.example.test/api/website/skins/preset-12345678/wear");
  assert.equal(calls[2].options.headers.Authorization, "Bearer test-token");
});


test("Skin Studio v010 never seeds a future pawn through persistence or TemporarySkinData", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const lua = fs.readFileSync(path.join(__dirname, "..", "server-mods", "SkinStudio", "Scripts", "main.lua"), "utf8");
  const browser = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "skins.js"), "utf8");

  assert.match(lua, /SkinStudio v010/);
  assert.match(lua, /CURRENT pawn only/);
  assert.match(lua, /never auto-restores an old applied skin onto a future pawn/);
  assert.match(lua, /TemporarySkinData and bUseSkinPalette are intentionally never modified/);
  assert.match(lua, /Cleared legacy auto-restore profiles/);
  assert.equal(lua.includes("loadProfiles()\n\nif LoopInGameThreadWithDelay"), false);
  assert.equal(lua.includes('safeCall("reapplyProfiles", reapplyProfiles)'), false);
  assert.match(lua, /state\.pawnAddress/);
  assert.match(lua, /state\.controllerAddress/);
  assert.match(lua, /Cancelled live skin refresh after dinosaur life changed/);
  assert.equal(lua.includes("mirrorCustomizerToTemporary"), false);
  assert.equal(lua.includes("pawn.TemporarySkinData"), false);
  assert.equal(lua.includes("bUseSkinPalette = true"), false);
  assert.match(lua, /temporary=false/);

  assert.match(browser, /data-species=/);
  assert.match(browser, /storedDinos\.find/);
  assert.match(browser, /presetSpecies\.toLowerCase\(\) !== dinoSpecies\.toLowerCase\(\)/);
  assert.match(browser, /Variation \$\{Number\(preset\.skin\?\.skinVariation\)/);
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
