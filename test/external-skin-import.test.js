const test = require("node:test");
const assert = require("node:assert/strict");

const { parseExternalSkinCode, mergeWithSkin } = require("../public/assets/external-skin-import.js");

test("parses current Fangs & Ferns seven-zone share codes", () => {
  const parsed = parseExternalSkinCode(
    "FNF-TYRA-AB09E · C42021-2A3A4F-B09E7E-9A5A2C-E6DAB8-FFB347-FF6A1F"
  );
  assert.equal(parsed.source, "fangs-ferns");
  assert.deepEqual(Object.keys(parsed.skinPatch), [
    "maleDisplay", "markings", "body", "flank", "underbelly", "detail1", "eyes",
  ]);
  assert.equal(Math.round(parsed.skinPatch.maleDisplay.r * 255), 0xC4);
  assert.equal(Math.round(parsed.skinPatch.body.g * 255), 0x9E);
  assert.equal(Math.round(parsed.skinPatch.eyes.b * 255), 0x1F);
});

test("parses Dino Den-style JSON customizer values", () => {
  const parsed = parseExternalSkinCode(JSON.stringify({
    bIsFemale: false,
    SkinVariation: 2,
    PatternIndex: 3,
    MaleDisplayColor: { R: 0.5, G: 0.25, B: 0.1, A: 1 },
    MarkingsColor: { R: 0.2, G: 0.3, B: 0.4, A: 1 },
    BodyColor: { R: 12, G: 24, B: 36, A: 255 },
    FlankColor: { R: 0.4, G: 0.5, B: 0.6, A: 1 },
    UnderbellyColor: { R: 0.7, G: 0.8, B: 0.9, A: 1 },
    Detail1Color: { R: 1, G: 1, B: 1, A: 1 },
    EyesColor: { R: 0.9, G: 0.8, B: 0.2, A: 1 },
  }));
  assert.equal(parsed.source, "dino-den-json");
  assert.equal(parsed.indices.patternIndex, 3);
  assert.equal(parsed.indices.skinVariation, 2);
  assert.equal(Math.round(parsed.skinPatch.body.r * 255), 12);
});

test("external imports preserve unsupported current editor fields", () => {
  const base = {
    teeth: { r: 1, g: 1, b: 1, a: 1 },
    mouth: { r: 0.2, g: 0.1, b: 0.1, a: 1 },
    claws: { r: 0.1, g: 0.1, b: 0.1, a: 1 },
    patternIndex: 7,
    themeIndex: 4,
    skinVariation: 1,
  };
  const parsed = parseExternalSkinCode(
    "FNF-TYRA-AB09E · C42021-2A3A4F-B09E7E-9A5A2C-E6DAB8-FFB347-FF6A1F"
  );
  const merged = mergeWithSkin(base, parsed);
  assert.deepEqual(merged.teeth, base.teeth);
  assert.deepEqual(merged.mouth, base.mouth);
  assert.deepEqual(merged.claws, base.claws);
  assert.equal(merged.patternIndex, 7);
  assert.equal(merged.themeIndex, 4);
  assert.equal(merged.skinVariation, 1);
});

test("rejects unknown formats", () => {
  assert.throws(() => parseExternalSkinCode("not-a-supported-skin-code"), /Unsupported skin code/);
});
