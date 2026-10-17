// Only Territory Wars uses this exclusion list. Keep Gateway's general
// REGIONS untouched so player positioning and ordinary map labels still work.
const REMOVED_TERRITORY_AREAS = Object.freeze([
  "Spiky Isle",
  "NW. Ridge",
  "Northern Beach",
  "Sandbank Bay",
  "Delta Bay",
  "Shallows",
  "Rail Beach",
]);

function normalizeTerritory(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

const removed = new Set(REMOVED_TERRITORY_AREAS.map(normalizeTerritory));

function isRemovedTerritory(value) {
  return removed.has(normalizeTerritory(value));
}

function activeTerritoryNames(regions) {
  return (Array.isArray(regions) ? regions : []).map((row) =>
    Array.isArray(row) ? row[0] : row
  ).filter((value) => value && !isRemovedTerritory(value)).map(String);
}

module.exports = { REMOVED_TERRITORY_AREAS, normalizeTerritory, isRemovedTerritory, activeTerritoryNames };
