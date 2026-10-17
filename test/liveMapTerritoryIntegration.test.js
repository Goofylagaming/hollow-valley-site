const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REGIONS } = require("../server/evrimaMap");
const {
  REMOVED_TERRITORY_AREAS,
  isRemovedTerritory,
  activeTerritoryNames,
} = require("../server/services/territoryAreas");

const read = (pathInRepo) => fs.readFileSync(path.join(__dirname, "..", pathInRepo), "utf8");

test("seven retired Territory Wars areas are filtered from preview regions but not from the regular map", () => {
  assert.equal(REMOVED_TERRITORY_AREAS.length, 7);
  const selected = activeTerritoryNames(REGIONS);
  assert.ok(selected.includes("South Plains"));
  assert.equal(selected.length, REGIONS.length - 7);
  for (const name of REMOVED_TERRITORY_AREAS) {
    assert.equal(isRemovedTerritory(name), true);
  }
  assert.ok(isRemovedTerritory("NW ridge"));
  assert.ok(REGIONS.some(([name]) => name === "Spiky Isle"));
  assert.ok(REGIONS.some(([name]) => name === "Rail Beach"));
  assert.ok(selected.every((name) => !isRemovedTerritory(name)));
});

test("the preview map layers and main player tracking render alongside the territory layer", () => {
  const html = read("public/livemap.html");
  for (const id of ["tracker-markers", "tracker-trails", "tracker-shapes",
    "territory-war-shapes", "territory-war-overlay-slot", "layer-territoryWars",
    "territory-admin-preview", "tracker-roads", "tracker-grid",
    "tracker-heatmap", "tracker-target-pins", "tracker-wildlife"]) {
    assert.ok(html.includes('id="' + id + '"'), "missing map element " + id);
  }
  for (const script of ["livemap.js", "livemap-trail.js", "territory-map-overlay.js",
    "livemap-navigation.js", "livemap-pins.js", "livemap-heatmap.js",
    "livemap-precision.js", "livemap-prime-summary.js"]) {
    assert.ok(html.includes("assets/" + script + "?v="), "missing map script " + script);
  }
  assert.match(read("public/assets/territory-map-overlay.js"), /\/api\/live-map\/territory-overlay\/overlay-state/);
  assert.doesNotMatch(read("public/assets/territory-map-overlay.js"), /new URL\("\/api\/territory-wars\/overlay-state"/);
});

test("map boundary preview cannot elevate ordinary player or non-allowlisted site admin", () => {
  const middleware = read("server/routes/territoryOverlay.js");
  assert.match(middleware, /isTerritoryAdmin\(req\.user\)/);
  assert.match(middleware, /preview: preview && safeUser\.is_admin === 1/);
  const state = read("server/services/territoryOverlayState.js");
  assert.match(state, /activeTerritoryNames\(REGIONS\)/);
  assert.match(state, /isRemovedTerritory\(latest\.territory_name\)/);
  const index = read("server/index.js");
  assert.match(index, /app\.use\("\/api\/live-map\/territory-overlay", require\("\.\/routes\/territoryOverlay"\)\)/);
  assert.match(index, /if \(TERRITORY_WARS_ADMIN_TEST_ENABLED\)/);
});

test("the seven removals do not delete stored battles, regions, or other production systems", () => {
  const territory = read("server/routes/territoryWars.js");
  assert.match(territory, /retired from the live map/);
  assert.doesNotMatch(territory, /DELETE FROM territory_events WHERE territory/);
  for (const route of ["/api/wallet", "/api/groups", "/api/marketplace"]) {
    assert.ok(read("server/index.js").includes(route), "existing route lost " + route);
  }
});
