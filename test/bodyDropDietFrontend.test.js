const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("BodyDrop page renders live species-specific diet options", () => {
  const html = read("public/bodydrop.html");
  const js = read("public/assets/bodydrop.js");
  const route = read("server/routes/bodydrop.js");

  assert.match(html, /Choose from your diet\./);
  assert.match(js, /dietEligibility/);
  assert.match(js, /PROTEIN/);
  assert.match(js, /CARBOHYDRATE/);
  assert.match(js, /LIPID/);
  assert.match(js, /data-prey=/);
  assert.match(js, /corpseGrowthPercent/);
  assert.match(js, /75% of your current growth/);

  assert.match(route, /dietEligibility:/);
  assert.match(route, /options: Array\.isArray\(result\.options\)/);
  assert.doesNotMatch(route, /options: getDropTypes\(\),/);
});
