const zones = require("../data/territoryZones.json");
const { territoryGeometry } = require("./territoryGeometry");

function decorate(zone) {
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
    active: zone.active !== false,
    geometry,
    howToEdit: zones.howToEdit,
  };
}

function catalog() {
  return zones.territories.filter((zone) => zone.active !== false).map(decorate);
}

function archived() {
  return zones.territories.filter((zone) => zone.active === false).map(decorate);
}

function byKey(key) {
  const wanted = String(key || "").trim().toLowerCase();
  return catalog().find((zone) => zone.key === wanted || zone.name.toLowerCase() === wanted) || null;
}

module.exports = { catalog, archived, byKey, howToEdit: zones.howToEdit };
