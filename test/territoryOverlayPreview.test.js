const test = require("node:test");
const assert = require("node:assert/strict");

const { _test } = require("../server/services/territoryOverlayState");

test("admin boundary preview is admin-only", () => {
  assert.equal(_test.buildAdminPreviewState({ is_admin: 0 }, "South Plains"), null);
  assert.equal(_test.buildAdminPreviewState(null, "South Plains"), null);
});

test("admin boundary preview uses known territory anchors and stays read-only", () => {
  const state = _test.buildAdminPreviewState({ is_admin: 1 }, "South Plains");

  assert.equal(state.preview.active, true);
  assert.equal(state.preview.available, true);
  assert.equal(state.preview.readOnly, true);
  assert.equal(state.preview.territoryName, "South Plains");
  assert.equal(state.event, null);
  assert.equal(state.attack, null);
  assert.equal(state.viewer.mode, "admin");
  assert.equal(state.intel.exactOpponentPositionsExposed, false);
  assert.ok(state.zones.mapCenter);
  assert.ok(state.zones.battlefieldRadiusMetres > state.zones.claimRadiusMetres);
  assert.ok(state.preview.territories.includes("South Plains"));
});

test("unknown preview territory falls back to South Plains", () => {
  const state = _test.buildAdminPreviewState({ is_admin: true }, "Not A Real Territory");
  assert.equal(state.preview.territoryName, "South Plains");
});


test("admin all-territories preview returns every configured boundary pair", () => {
  const state = _test.buildAdminPreviewState({ is_admin: true }, "__all__");

  assert.equal(state.preview.active, true);
  assert.equal(state.preview.allTerritories, true);
  assert.equal(state.preview.territoryName, "All Territories");
  assert.equal(state.preview.territoryValue, "__all__");
  assert.equal(state.zones, null);
  assert.equal(state.preview.zones.length, _test.previewTerritories().length);
  assert.ok(state.preview.zones.length > 1);
  assert.ok(state.preview.zones.every((zone) =>
    zone.mapCenter &&
    zone.battlefieldRadiusMetres === 600 &&
    zone.claimRadiusMetres === 200
  ));
  assert.equal(state.intel.exactOpponentPositionsExposed, false);
});
