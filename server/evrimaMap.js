// Coordinate handling for The Isle: Evrima's "Gateway" map.
//
// RCON reports positions as raw Unreal world units (centimetres). Bounds below
// are the community-standard Gateway v0.21.7 values (vulnona.com's map config,
// independently mirrored by other open-source map tools). They are derived by
// the community rather than published by the developers, so treat them as
// accurate to within a few thousand units at the very edges.
//
// Orientation is counter-intuitive and worth stating explicitly:
//   -X = NORTH, +X = SOUTH   (vertical axis / "Lat")
//   -Y = WEST,  +Y = EAST    (horizontal axis / "Long")
// So world Y drives the horizontal screen axis and world X drives the vertical
// one, and neither needs negating - the minimums are already the top/left edges.
const BOUNDS = { minX: -607000, maxX: 509000, minY: -505000, maxY: 607000 };

/**
 * Projects raw RCON world coordinates to fractions of the map image.
 * Returns { left, top } in the range 0..1 (clamped), or null if unavailable.
 */
function project(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const clamp = (n) => Math.min(1, Math.max(0, n));
  return {
    left: clamp((y - BOUNDS.minY) / (BOUNDS.maxY - BOUNDS.minY)),
    top: clamp((x - BOUNDS.minX) / (BOUNDS.maxX - BOUNDS.minX)),
  };
}

/**
 * Converts raw world units to the "Lat/Long" shorthand players and admins use
 * in-game and in Discord, which is simply the raw value divided by 1000.
 */
function toLatLong(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { lat: Math.round(x / 1000), long: Math.round(y / 1000) };
}

// Named region anchors, used to label roughly where a player is. Values are in
// Lat/Long (i.e. world units / 1000). Nearest-anchor matching is approximate by
// design - it answers "whereabouts am I?", not "which polygon am I inside".
const REGIONS = [
  ["NE. Cape", -460, 433],
  ["North Plains", -345, 353],
  ["Northern Beach", -379, 114],
  ["Northern Jungle", -321, 166],
  ["East Coast", -131, 564],
  ["Eastern Jungle", -157, 398],
  ["Port", -308, 548],
  ["Highland", -127, -80],
  ["Central Jungle", -49, 71],
  ["NW. Ridge", -248, -153],
  ["Water Access", -214, 87],
  ["Forks Plains", -119, 246],
  ["Spiky Isle", -379, -295],
  ["Delta", 33, 177],
  ["West Rail", -4, -238],
  ["Rail Beach", 6, -388],
  ["West Bay", 101, -394],
  ["Sandbank Bay", 74, 399],
  ["Delta Bay", 175, 298],
  ["Shallows", 270, 225],
  ["Swamps", 273, 74],
  ["Lagoon", 334, -87],
  ["Southern Strait", 238, -211],
  ["South Plains", 250, -302],
  ["The Pit", 329, -394],
  ["Southern Beach", 397, 130],
];

function nearestRegion(x, y) {
  const coords = toLatLong(x, y);
  if (!coords) return null;
  let best = null;
  let bestDistance = Infinity;
  for (const [name, lat, long] of REGIONS) {
    const distance = (coords.lat - lat) ** 2 + (coords.long - long) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = name;
    }
  }
  return best;
}

// The in-game grid reference (e.g. "K15") - the shorthand players actually use
// to call out positions. The grid isn't published anywhere, so these constants
// were fitted by least-squares against 14 known "Site <cell>" landmarks whose
// coordinates are documented; the fit reproduces the correct cell for all of
// them. Rows are letters A-T running north to south, columns are numbers 1-20
// running west to east.
const GRID_ROW_ORIGIN = -572.25;
const GRID_ROW_SIZE = 57.3;
const GRID_COL_ORIGIN = -555.1;
const GRID_COL_SIZE = 56.06;
const GRID_CELLS = 20;

function gridCell(x, y) {
  const coords = toLatLong(x, y);
  if (!coords) return null;
  const clampIndex = (n) => Math.min(GRID_CELLS - 1, Math.max(0, n));
  const row = clampIndex(Math.floor((coords.lat - GRID_ROW_ORIGIN) / GRID_ROW_SIZE));
  const col = clampIndex(Math.floor((coords.long - GRID_COL_ORIGIN) / GRID_COL_SIZE));
  return `${String.fromCharCode(65 + row)}${col + 1}`;
}

module.exports = { BOUNDS, REGIONS, project, toLatLong, nearestRegion, gridCell };
