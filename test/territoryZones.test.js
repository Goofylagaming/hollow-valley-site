const test = require("node:test");
const assert = require("node:assert/strict");
const { catalog, byKey, howToEdit } = require("../server/services/territoryZones");
const { regionAnchor } = require("../server/services/territoryGeometry");

test("exactly four editable claim circles are seeded from Gateway anchors", () => {
  const zones = catalog();
  assert.deepEqual(zones.map((zone) => zone.name), ["South Plains", "West Trail", "Delta Highlands", "Swamp"]);
  assert.match(howToEdit, /server\/data\/territoryZones.json|centerLat/);
  const plains = byKey("south-plains");
  const anchor = regionAnchor("South Plains");
  assert.equal(plains.centerLat, anchor.lat);
  assert.equal(plains.centerLong, anchor.long);
  assert.equal(plains.geometry.claimRadius, 12);
  assert.ok(plains.claimRadius < plains.battlefieldRadius);
  assert.equal(byKey("swamp").centerLat, regionAnchor("Swamps").lat);
  assert.equal(byKey("west-trail").centerLat, regionAnchor("West Rail").lat);
  for (const zone of zones) {
    assert.equal(zone.geometry.source, "event-config");
    assert.ok(zone.claimRadius <= 20);
  }
});
