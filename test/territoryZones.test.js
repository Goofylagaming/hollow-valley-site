const test = require("node:test");
const assert = require("node:assert/strict");
const { catalog, archived, byKey, howToEdit } = require("../server/services/territoryZones");
const { regionAnchor } = require("../server/services/territoryGeometry");

test("South Plains is the only active zone and the other three stay archived", () => {
  const zones = catalog();
  assert.deepEqual(zones.map((zone) => zone.key), ["south-plains"]);
  assert.equal(zones[0].name, "South Plains");
  assert.equal(zones[0].active, true);
  assert.match(howToEdit, /server\/data\/territoryZones.json|centerLat/);
  const plains = byKey("south-plains");
  const anchor = regionAnchor("South Plains");
  assert.equal(plains.centerLat, anchor.lat);
  assert.equal(plains.centerLong, anchor.long);
  assert.equal(plains.geometry.claimRadius, 12);
  assert.ok(plains.claimRadius < plains.battlefieldRadius);
  assert.equal(plains.geometry.source, "event-config");
  assert.equal(byKey("South Plains")?.key, "south-plains");

  const stored = archived();
  assert.deepEqual(stored.map((zone) => zone.key), ["west-trail", "delta-highlands", "swamp"]);
  assert.equal(stored.find((zone) => zone.key === "swamp").centerLat, regionAnchor("Swamps").lat);
  assert.equal(stored.find((zone) => zone.key === "west-trail").centerLat, regionAnchor("West Rail").lat);
  for (const zone of stored) {
    assert.equal(zone.active, false);
    assert.match(zone.note, /archived for a later season/i);
    assert.equal(byKey(zone.key), null);
    assert.equal(byKey(zone.name), null);
    assert.equal(catalog().some((active) => active.key === zone.key), false);
  }
});
