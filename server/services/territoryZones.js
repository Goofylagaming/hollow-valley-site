const zones = require("../data/territoryZones.json");
const { territoryGeometry } = require("./territoryGeometry");

function catalog() {
  return zones.territories.map((zone) => {
    const geometry = territoryGeometry({
      territoryName: zone.name,
      territoryKey: zone.key,
      centerLat: zone.centerLat,
      centerLong: zone.centerLong,
      battlefieldRadius: zone.battlefieldRadius,
      claimRadius: zone.claimRadius,
    });
    return {
      ...zone,
      geometry,
      howToEdit: zones.howToEdit,
    };
  });
}

function byKey(key) {
  const wanted = String(key || "").trim().toLowerCase();
  return catalog().find((zone) => zone.key === wanted || zone.name.toLowerCase() === wanted) || null;
}

module.exports = { catalog, byKey, howToEdit: zones.howToEdit };
