const { REGIONS, toLatLong } = require('../evrimaMap');

// Territory geometry uses the same Lat/Long shorthand as the live map
// (raw Unreal world units / 1000). One Lat/Long unit is 10 metres.
// These defaults are intentionally preview/tuning values, not claimed map borders.
const DEFAULT_BATTLEFIELD_RADIUS = 60; // ~600m
const DEFAULT_CLAIM_RADIUS = 20; // ~200m

function normalize(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function regionAnchor(nameOrKey) {
  const wanted = normalize(nameOrKey);
  if (!wanted) return null;
  const match = REGIONS.find(([name]) => normalize(name) === wanted);
  if (!match) return null;
  return { name: match[0], lat: Number(match[1]), long: Number(match[2]) };
}

function territoryGeometry({
  territoryName,
  territoryKey,
  centerLat,
  centerLong,
  battlefieldRadius = DEFAULT_BATTLEFIELD_RADIUS,
  claimRadius = DEFAULT_CLAIM_RADIUS,
} = {}) {
  const anchor = regionAnchor(territoryName) || regionAnchor(territoryKey);
  const lat = finiteNumber(centerLat) ?? anchor?.lat ?? null;
  const long = finiteNumber(centerLong) ?? anchor?.long ?? null;
  if (!Number.isFinite(lat) || !Number.isFinite(long)) return null;

  const battlefield = Math.max(1, finiteNumber(battlefieldRadius) ?? DEFAULT_BATTLEFIELD_RADIUS);
  const claim = Math.max(1, Math.min(
    battlefield,
    finiteNumber(claimRadius) ?? DEFAULT_CLAIM_RADIUS
  ));

  return {
    territoryName: String(territoryName || anchor?.name || territoryKey || 'Territory'),
    center: { lat, long },
    battlefieldRadius: battlefield,
    claimRadius: claim,
    units: 'lat-long',
    metresPerUnit: 10,
    source: Number.isFinite(finiteNumber(centerLat)) && Number.isFinite(finiteNumber(centerLong))
      ? 'event-config'
      : 'region-anchor',
  };
}

function distanceFromCenter(coords, geometry) {
  if (!coords || !geometry?.center) return null;
  const lat = finiteNumber(coords.lat);
  const long = finiteNumber(coords.long);
  if (!Number.isFinite(lat) || !Number.isFinite(long)) return null;
  const dLat = lat - geometry.center.lat;
  const dLong = long - geometry.center.long;
  return Math.sqrt((dLat * dLat) + (dLong * dLong));
}

function classifyLatLong(coords, geometry) {
  const distance = distanceFromCenter(coords, geometry);
  if (!Number.isFinite(distance)) {
    return { valid: false, distance: null, inBattlefield: false, inClaim: false };
  }
  return {
    valid: true,
    distance,
    distanceMetres: Math.round(distance * 10),
    inBattlefield: distance <= geometry.battlefieldRadius,
    inClaim: distance <= geometry.claimRadius,
  };
}

function classifyWorldPosition(x, y, geometry) {
  return classifyLatLong(toLatLong(Number(x), Number(y)), geometry);
}

module.exports = {
  DEFAULT_BATTLEFIELD_RADIUS,
  DEFAULT_CLAIM_RADIUS,
  regionAnchor,
  territoryGeometry,
  distanceFromCenter,
  classifyLatLong,
  classifyWorldPosition,
};
