// Static Gateway map layers (salt licks, sanctuaries, migration and patrol
// zones, named locations). The community dataset is Vulnona's Gateway v0.21
// POI export converted to Unreal centimetres, which is exactly the coordinate
// space our own RCON positions use - so everything is projected here with the
// same project() the live player markers go through.
//
// The upstream file is ~650KB of data we mostly don't need, so it's fetched
// server-side, normalised down to projected percentages and cached. The browser
// only ever sees the small result, and never has to make a cross-origin call.
const express = require("express");
const { project, BOUNDS } = require("../evrimaMap");

const router = express.Router();

const SOURCE_URL =
  process.env.MAP_DATA_URL ||
  "https://raw.githubusercontent.com/aguirretim/isle-overlay/main/web/pois.json";

const CACHE_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;

const WIDTH_UNITS = BOUNDS.maxY - BOUNDS.minY;
const HEIGHT_UNITS = BOUNDS.maxX - BOUNDS.minX;

// Vulnona stores radii in "simple code" units, i.e. world centimetres / 1000.
const RADIUS_SCALE = 1000;

let cache = null;
let cachedAt = 0;
let inflight = null;

function toPoint(entry) {
  const position = project(Number(entry.x), Number(entry.y));
  if (!position) return null;
  return { name: String(entry.name || "Unnamed"), left: position.left, top: position.top };
}

function toPoints(list) {
  return (Array.isArray(list) ? list : []).map(toPoint).filter(Boolean);
}

function projectPolyline(polyline) {
  return (Array.isArray(polyline) ? polyline : [])
    .map(([x, y]) => project(Number(x), Number(y)))
    .filter(Boolean)
    .map((p) => [p.left, p.top]);
}

/**
 * Zones come in three upstream flavours and all three need to render as filled
 * areas rather than outlines:
 *
 *   kind "circle" - centre plus rx/ry radii and a rotation, i.e. an ellipse.
 *   kind "line"   - already a closed 5-point rectangle ring.
 *   kind "path"   - a polygon ring, except when it has exactly two points, in
 *                   which case Vulnona is describing the opposite corners of a
 *                   rectangle rather than a line segment.
 *
 * The first version of this route only handled polylines, so every
 * circle-shaped zone (6 of the 10 migration zones and 4 patrol zones) silently
 * rendered as nothing at all.
 */
function toZone(entry) {
  const anchor = toPoint(entry);
  if (!anchor) return null;

  const radii = entry.radii || {};
  let rx = Number(radii.rx);
  let ry = Number(radii.ry);
  let rot = Number.isFinite(Number(radii.rot)) ? Number(radii.rot) : 0;

  if (!Number.isFinite(rx) && Number.isFinite(Number(entry.radius))) {
    rx = Number(entry.radius);
    ry = Number(entry.radius);
  }

  if (Number.isFinite(rx) && Number.isFinite(ry)) {
    return {
      ...anchor,
      shape: "ellipse",
      rx: (rx * RADIUS_SCALE) / WIDTH_UNITS,
      ry: (ry * RADIUS_SCALE) / HEIGHT_UNITS,
      rotation: rot,
    };
  }

  const points = projectPolyline(entry.polyline);

  if (points.length === 2) {
    const [[l1, t1], [l2, t2]] = points;
    return {
      ...anchor,
      shape: "polygon",
      points: [
        [l1, t1],
        [l2, t1],
        [l2, t2],
        [l1, t2],
      ],
    };
  }

  if (points.length >= 3) {
    return { ...anchor, shape: "polygon", points };
  }

  return null;
}

function toZones(list) {
  return (Array.isArray(list) ? list : []).map(toZone).filter(Boolean);
}

// Caves stay as open outlines - they trace passages, not areas to shade in.
function toPaths(list) {
  return (Array.isArray(list) ? list : [])
    .map((entry) => {
      const anchor = toPoint(entry);
      if (!anchor) return null;
      const points = projectPolyline(entry.polyline);
      if (points.length < 2) return null;
      return { ...anchor, points };
    })
    .filter(Boolean);
}

function normalise(raw) {
  const meta = raw && raw._meta ? raw._meta : {};
  return {
    mapVersion: meta.map_version || "Gateway",
    fetchedAt: meta.fetched_utc || null,
    layers: {
      areas: toPoints(raw.areas),
      landmarks: toPoints(raw.landmarks),
      saltLicks: toPoints(raw.salt_licks),
      water: toPoints(raw.drinking_water_river_pond),
      wallows: toPoints(raw.wallows),
      caves: toPaths(raw.caves),
      migrations: toZones(raw.migrations),
      patrolZones: toZones(raw.patrol_zones),
      sanctuaries: toZones(raw.sanctuaries),
    },
  };
}

async function fetchMapData() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(SOURCE_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`Map data request failed: ${response.status}`);
    return normalise(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

async function getMapData() {
  if (cache && Date.now() - cachedAt < CACHE_MS) return cache;
  if (!inflight) {
    inflight = fetchMapData()
      .then((data) => {
        cache = data;
        cachedAt = Date.now();
        return data;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

router.get("/", async (_req, res) => {
  try {
    res.json(await getMapData());
  } catch (err) {
    console.error("[mapdata] failed to load Gateway map layers:", err.message);
    // A stale copy is far more useful than an error - the data barely changes.
    if (cache) return res.json(cache);
    res.status(502).json({ error: "Gateway map data is unavailable right now." });
  }
});

module.exports = router;
