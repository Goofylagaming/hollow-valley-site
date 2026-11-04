const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Batch = require("../public/assets/skin-studio-batch-map.js");

const fixture = () => {
  const lookup = new Uint8Array(256 * 256);
  lookup.fill(1, 10, 25);
  lookup.fill(4, 500, 535);
  lookup.fill(3, 800, 825);
  return lookup;
};

test("batch mask RLE encode/decode matches every pixel", () => {
  const mask = Batch.encode(fixture());
  assert.equal(mask.size, 256);
  assert.deepEqual(Batch.decode(mask), fixture());
});

test("batch mapping is compact and retains masked manual edits and deliberate erasures", () => {
  const prior = fixture();
  const owners = new Uint8Array(prior.length);
  owners.fill(1, 10, 25);
  owners.fill(1, 500, 535);
  owners.fill(1, 800, 825);
  owners[510] = 2;
  owners[801] = 2;
  owners[2011] = 2; // user deliberately erased this pixel
  prior[510] = 4;
  prior[801] = 3;
  const saved = Batch.serialize(prior, owners, false, { modelFingerprint: "abc123" });
  assert.equal(saved.calibration.version, 2);
  assert.ok(JSON.stringify(saved).length < 1000);
  assert.equal(saved.calibration.modelFingerprint, "abc123");
  const proposal = new Uint8Array(65536).fill(1);
  const result = Batch.merge(JSON.stringify(saved), proposal);
  const next = Batch.decode(result.payload);
  assert.equal(next[510], 4);
  assert.equal(next[801], 3);
  assert.equal(next[2011], 0);
  assert.equal(next[2008], 1);
  assert.equal(result.preserved, 3);
  assert.deepEqual(Batch.ownersFromDraft(next, result.payload.calibration).slice(2009, 2013),
    new Uint8Array([1, 1, 2, 1]));
});

test("v015 can safely migrate v014 owner strings and retain manual patches", () => {
  const previous = Batch.encode(fixture());
  const owner = new Uint8Array(65536).fill(0);
  owner.fill(1, 10, 25);
  owner.fill(1, 500, 535);
  owner.fill(1, 800, 825);
  owner[513] = 2;
  previous.calibration = { version: 1, owners: Array.from(owner, String).join(""), flipV: true };
  const next = Batch.merge(JSON.stringify(previous), new Uint8Array(65536).fill(1), { flipV: false });
  assert.equal(Batch.decode(next.payload)[513], 4);
  assert.equal(next.payload.calibration.flipV, true);
  assert.equal(next.payload.calibration.manualRuns[0], 513);
});

test("existing imported masks without ownership remain protected by default", () => {
  const old = Batch.encode(fixture());
  const proposal = new Uint8Array(65536).fill(2);
  const result = Batch.merge(JSON.stringify(old), proposal);
  assert.equal(Batch.decode(result.payload)[12], 1);
  assert.equal(Batch.decode(result.payload)[510], 4);
  const deliberateRebuild = Batch.merge(JSON.stringify(old), proposal, { rebuildAll: true });
  assert.equal(Batch.decode(deliberateRebuild.payload)[12], 2);
});

test("bad, overlapping and out-of-range masks fail closed", () => {
  assert.throws(() => Batch.decode({ size: 256, zones: { body: [30, 20], underbelly: [40, 5] } }), /Overlapping/);
  assert.throws(() => Batch.decode({ size: 256, zones: { body: [65535, 2] } }), /malformed/);
  assert.throws(() => Batch.decode({ size: 256, zones: { body: [20] } }), /Invalid calibration/);
  assert.throws(() => Batch.decode({ size: 256, zones: { imaginary: [20, 4] } }), /Unknown/);
  assert.throws(() => Batch.merge(null, new Uint8Array(100)), /65536/);
  const bad = fixture(); bad[12] = 255;
  assert.throws(() => Batch.encode(bad), /invalid colour-zone/);
});

test("live UI batch stays admin-only, browser-local and does not touch wear or player APIs", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "public", "skins.html"), "utf8");
  const viewer = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "skin-studio-3d.js"), "utf8");
  assert.match(html, /<section class="skin-calibration-panel" id="skin-calibration-panel" hidden>/);
  assert.match(html, /id="skin-auto-on-upload" type="checkbox" checked/);
  assert.match(html, /id="skin-calibration-batch" type="button"/);
  assert.match(html, /id="skin-calibration-batch-download"/);
  assert.ok(html.indexOf("skin-studio-auto-map.js?v=2") <
    html.indexOf("skin-studio-batch-map.js?v=1"));
  assert.ok(html.indexOf("skin-studio-batch-map.js?v=1") <
    html.indexOf("skin-studio-3d.js?v=24"));
  assert.match(viewer, /async function batchMapAllLocalModels\(\)/);
  assert.match(viewer, /await gltfLoader.loadAsync\(def.loader.url\)/);
  assert.match(viewer, /buildModelUvCoverage\(gltf.scene\)/);
  assert.match(viewer, /HVSkinBatchMap.merge/);
  assert.match(viewer, /localStorage.setItem\(key, JSON.stringify\(result.payload\)\)/);
  assert.match(viewer, /if \(calibrationAutoOnUploadEl\?\.checked\) await batchMapAllLocalModels\(\)/);
  assert.match(viewer, /verified: false/);
});
