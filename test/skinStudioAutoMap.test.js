const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Auto = require("../public/assets/skin-studio-auto-map.js");

function face(y, normal = "down", u = 0.08, v = 0.08, materialName = "MI_Deinosuchus_Body") {
  const positions = normal === "down"
    ? [0, y, 0, 1, y, 0, 0, y, 1]
    : normal === "up"
      ? [0, y, 0, 0, y, 1, 1, y, 0]
      : [0, y, 0, 0, y + 1, 0, 0, y, 1];
  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array([u, v, u + 0.36, v, u, v + 0.36]),
    materialName,
  };
}

test("Deinosuchus underside is detected from geometry without any hand-painted mask", () => {
  const result = Auto.generate({ meshes: [face(0.1, "down")], size: 32 });
  assert.equal(result.verified, false);
  assert.ok(result.counts.underbelly > 20);
  assert.equal(result.counts.eyes, 0);
  assert.equal(result.faces, 1);
});

test("side-facing surfaces map to flank and top-facing parts can suggest markings", () => {
  const flank = Auto.generate({ meshes: [face(0.1, "side")], size: 32 });
  assert.ok(flank.counts.flank > 20);
  const dorsal = Auto.generate({ meshes: [face(0.1, "down"), face(1, "up", 0.55, 0.55)], size: 32 });
  assert.ok(dorsal.counts.markings > 0);
  assert.ok(dorsal.counts.underbelly > 0);
});

test("PSK-derived eye material UVs are not painted over the body atlas", () => {
  const body = face(0.1, "down");
  const overlappingEyes = face(0.1, "up", 0.08, 0.08, "MI_Deinosuchus_Eye");
  const bodyOnly = Auto.generate({ meshes: [body], size: 32 });
  const withEyes = Auto.generate({ meshes: [body, overlappingEyes], size: 32 });
  assert.deepEqual(withEyes.lookup, bodyOnly.lookup);
  assert.equal(withEyes.counts.eyes, 0);
  assert.equal(Auto.materialZone("MI_Tyrannosaurus_Eye"), 6);
});

test("UV orientation flip mirrors the output mask without changing area or region counts", () => {
  const input = { meshes: [face(0.1, "down")], size: 32 };
  const normal = Auto.generate(input);
  const flipped = Auto.generate({ ...input, flipV: true });
  assert.deepEqual(normal.counts, flipped.counts);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      assert.equal(normal.lookup[y * 32 + x], flipped.lookup[(31 - y) * 32 + x]);
    }
  }
});

test("geometry votes and material groups are deterministic regardless of mesh order", () => {
  const one = face(0.1, "down");
  const two = face(0.1, "side", 0.18, 0.15);
  const a = Auto.generate({ meshes: [one, two], size: 32 });
  const b = Auto.generate({ meshes: [two, one], size: 32 });
  assert.deepEqual(a.lookup, b.lookup);
  assert.ok(a.ambiguousPixels > 0);
});

test("invalid and excessive input fails closed", () => {
  assert.throws(() => Auto.generate({ meshes: [], size: 256 }), /valid 3D dinosaur/);
  assert.throws(() => Auto.generate({ meshes: [face(0.1)], size: 512 }), /atlas size/);
  assert.throws(() => Auto.generate({ meshes: [{ positions: [0, 0, 0], uvs: [] }], size: 32 }), /matching mesh/);
  const invalid = face(0.1);
  invalid.uvs[0] = NaN;
  const result = Auto.generate({ meshes: [invalid], size: 32 });
  assert.equal(result.coveredPixels, 0);
  assert.ok(result.rejected > 0);
});

test("live Skin Studio loads automapper before its viewer and keeps suggestions admin-only", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "skins.html"), "utf8");
  const viewer = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "skin-studio-3d.js"), "utf8");
  assert.match(html, /<section class="skin-calibration-panel" id="skin-calibration-panel" hidden>/);
  assert.match(html, /id="skin-calibration-auto" type="button" disabled/);
  assert.match(html, /not<\/em> verified EVRIMA patterns/);
  assert.ok(html.indexOf("/assets/skin-studio-auto-map.js?v=1") < html.indexOf("/assets/skin-studio-3d.js?v=21"));
  assert.match(viewer, /function collectAutoMapMeshes\(root\)/);
  assert.match(viewer, /if \(!material\.map\) material\.map = MASK_WHITE_MAP/);
  assert.match(viewer, /name: source\.name \|\| ""/);
  assert.match(viewer, /async function autoMapCalibration\(\)/);
  assert.match(viewer, /const rootInverse = new THREE.Matrix4/);
  assert.match(viewer, /if \(zoneLookup\[pixel\] \|\| !maskPixelCovered/);
  assert.match(viewer, /pushCalibrationHistory\(\)/);
  assert.match(viewer, /rebuildMaskAtlasesFromLookup\(\)/);
  assert.match(viewer, /calibrationAutoEl\?\.addEventListener\("click", autoMapCalibration\)/);
  assert.match(viewer, /if \(\/\(\^\|\[\^a-z\]\)eyes\?\(\[\^a-z\]\|\$\)\/i\.test/);
});
