// Static Gateway map layers (salt licks, sanctuaries, migration and patrol
// zones, named locations, water, wallows, caves).
//
// The community dataset is parsed directly from Vulnona's official Gateway
// cartography definitions (data_1.txt and data_2.txt). Vulnona encodes zones
// with multi-polygon sequences (M commands) and individual ellipse nodes
// (R=radius/rot commands), which produce the exact 60 patrol zone areas,
// 12 migration corridors, and 8 sanctuaries matching the in-game map.
const express = require("express");
const fs = require("fs");
const path = require("path");
const { BOUNDS, GRID } = require("../evrimaMap");

const router = express.Router();

const VULNONA_MAP_BASE_URL =
  process.env.VULNONA_MAP_BASE_URL ||
  "https://vulnona.com/game/map/map";

// Prefer the latest verified Gateway cartography first. Fall back through the
// previous 0.21.7 builds so a community-map folder rename never takes the Live
// Map down. Explicit DATA URLs still win when an operator pins a source.
const VULNONA_GATEWAY_VERSIONS = [
  process.env.VULNONA_GATEWAY_VERSION,
  "Gateway_v0.21.772",
  "Gateway_v0.21.738",
  "Gateway_v0.21.7",
].map((value) => String(value || "").trim()).filter(Boolean);

const PINNED_DATA_URLS = process.env.VULNONA_DATA1_URL && process.env.VULNONA_DATA2_URL
  ? {
      data1: process.env.VULNONA_DATA1_URL,
      data2: process.env.VULNONA_DATA2_URL,
      version: process.env.VULNONA_GATEWAY_VERSION || "operator-pinned",
    }
  : null;

const LOCAL_DATA1_PATH = path.join(__dirname, "../data/vulnona_data_1.txt");
const LOCAL_DATA2_PATH = path.join(__dirname, "../data/vulnona_data_2.txt");

const CACHE_MS = 6 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

const WIDTH_UNITS = BOUNDS.maxY - BOUNDS.minY;   // 1,112,000
const HEIGHT_UNITS = BOUNDS.maxX - BOUNDS.minX;  // 1,116,000

let cache = null;
let cachedAt = 0;
let inflight = null;

function projectLatLong(lat, long) {
  const left = (long * 1000 - BOUNDS.minY) / WIDTH_UNITS;
  const top = (lat * 1000 - BOUNDS.minX) / HEIGHT_UNITS;
  const clamp = (n) => Math.min(1, Math.max(0, n));
  return { left: clamp(left), top: clamp(top) };
}

function parseVulnonaFile(text) {
  const lines = text.split(/\r?\n/);
  const sections = {};
  let currentDir = "";
  let currentItem = null;
  let currentCoords = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const parts = trimmed.split("\t");

    if (parts[0] === "dir") {
      currentDir = parts[1] || "";
    } else if (parts[0] === "dirEnd") {
      if (currentItem && currentDir) {
        (sections[currentDir] = sections[currentDir] || []).push({ item: currentItem, coords: currentCoords });
      }
      currentItem = null;
      currentCoords = [];
      currentDir = "";
    } else if (!trimmed.startsWith("-") && !/^\d/.test(trimmed) && parts.length >= 2) {
      if (currentItem && currentDir) {
        (sections[currentDir] = sections[currentDir] || []).push({ item: currentItem, coords: currentCoords });
      }
      currentItem = parts;
      currentCoords = [];
    } else {
      currentCoords.push(trimmed);
    }
  }

  if (currentItem && currentDir) {
    (sections[currentDir] = sections[currentDir] || []).push({ item: currentItem, coords: currentCoords });
  }

  return sections;
}

function parsePoints(items) {
  const pts = [];
  for (const { item, coords } of items || []) {
    const rawName = item[2] || item[1] || "Location";
    const cleanName = rawName.split(":")[0].replace(/<s>.*?<\/s>/gi, "").replace(/<br\s*\/?>/gi, " ").trim();
    for (const c of coords) {
      const parts = c.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2 && !isNaN(parseFloat(parts[0])) && !isNaN(parseFloat(parts[1]))) {
        const lat = parseFloat(parts[0]);
        const long = parseFloat(parts[1]);
        const pos = projectLatLong(lat, long);
        pts.push({ name: cleanName, left: pos.left, top: pos.top });
        break;
      }
    }
  }
  return pts;
}

function parsePaths(items) {
  const paths = [];
  for (const { item, coords } of items || []) {
    const rawName = item[2] || item[1] || "Path";
    const cleanName = rawName.split(":")[0].replace(/<s>.*?<\/s>/gi, "").replace(/<br\s*\/?>/gi, " ").trim();
    const points = [];
    for (const c of coords) {
      const parts = c.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2 && !isNaN(parseFloat(parts[0])) && !isNaN(parseFloat(parts[1]))) {
        const lat = parseFloat(parts[0]);
        const long = parseFloat(parts[1]);
        const pos = projectLatLong(lat, long);
        points.push([pos.left, pos.top]);
      }
    }
    if (points.length >= 2) {
      paths.push({ name: cleanName, points });
    }
  }
  return paths;
}

function parseRoads(items) {
  const roads = [];
  for (const { item, coords } of items || []) {
    const rawName = item[2] || item[1] || "Road";
    const cleanName = rawName.split(":")[0].replace(/<s>.*?<\/s>/gi, "").replace(/<br\s*\/?>/gi, " ").trim();
    const trail = /(?:^|\s)trail(?:\s|$)/i.test(String(item[3] || ""));
    let points = [];

    const flush = () => {
      if (points.length >= 2) roads.push({ name: cleanName, trail, points });
      points = [];
    };

    for (const coord of coords) {
      const parts = coord.split(",").map((s) => s.trim());
      const lat = parseFloat(parts[0]);
      const long = parseFloat(parts[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(long)) continue;

      // Vulnona uses M to begin a new path segment. Respecting it avoids
      // drawing artificial straight connectors between forks or split roads.
      if (parts.slice(2).some((part) => part.toUpperCase() === "M") && points.length) {
        flush();
      }

      const pos = projectLatLong(lat, long);
      points.push([pos.left, pos.top]);
    }
    flush();
  }
  return roads;
}

function parseZones(items) {
  const shapes = [];
  for (const { item, coords } of items || []) {
    const kind = item[0];
    const rawName = item[2] || item[1] || "Zone";
    const cleanName = rawName.split(":")[0].replace(/<s>.*?<\/s>/gi, "").replace(/<br\s*\/?>/gi, " ").trim();

    if (kind === "circle") {
      for (const c of coords) {
        const nums = c.split(/[,/]/).map((s) => s.trim()).filter(Boolean);
        if (nums.length >= 2) {
          const lat = parseFloat(nums[0]);
          const long = parseFloat(nums[1]);
          const rx = parseFloat(nums[2]) || 15;
          const ry = parseFloat(nums[3]) || rx;
          const rot = parseFloat(nums[4]) || 0;
          const pos = projectLatLong(lat, long);
          shapes.push({
            name: cleanName,
            shape: "ellipse",
            left: pos.left,
            top: pos.top,
            rx: (rx * 1000) / WIDTH_UNITS,
            ry: (ry * 1000) / HEIGHT_UNITS,
            rotation: rot,
          });
        }
      }
      continue;
    }

    let currentPoly = [];
    for (const c of coords) {
      const rMatch = c.match(/R=([\d\.]+)(?:\/([\d\.]+))?(?:\/(-?[\d\.]+))?/);
      if (rMatch) {
        if (currentPoly.length >= 3) {
          shapes.push({ name: cleanName, shape: "polygon", points: currentPoly });
        }
        currentPoly = [];

        const parts = c.split(",").map((s) => s.trim()).filter(Boolean);
        const lat = parseFloat(parts[0]);
        const long = parseFloat(parts[1]);
        const rx = parseFloat(rMatch[1]) || 15;
        const ry = parseFloat(rMatch[2]) || rx;
        const rot = parseFloat(rMatch[3]) || 0;
        const pos = projectLatLong(lat, long);
        shapes.push({
          name: cleanName,
          shape: "ellipse",
          left: pos.left,
          top: pos.top,
          rx: (rx * 1000) / WIDTH_UNITS,
          ry: (ry * 1000) / HEIGHT_UNITS,
          rotation: rot,
        });
      } else {
        const parts = c.split(",").map((s) => s.trim()).filter(Boolean);
        if (parts.length >= 2 && !isNaN(parseFloat(parts[0])) && !isNaN(parseFloat(parts[1]))) {
          if (parts.includes("M") && currentPoly.length >= 3) {
            shapes.push({ name: cleanName, shape: "polygon", points: currentPoly });
            currentPoly = [];
          }
          const lat = parseFloat(parts[0]);
          const long = parseFloat(parts[1]);
          const pos = projectLatLong(lat, long);
          currentPoly.push([pos.left, pos.top]);
        }
      }
    }

    if (currentPoly.length >= 3) {
      shapes.push({ name: cleanName, shape: "polygon", points: currentPoly });
    }
  }
  return shapes;
}

function buildPayload(sec1, sec2, sourceVersion = "Gateway_v0.21.7") {
  return {
    mapVersion: sourceVersion,
    source: "Vulnona community cartography",
    fetchedAt: new Date().toISOString(),
    bounds: BOUNDS,
    grid: GRID,
    layers: {
      areas: parsePoints(sec1["Area"]),
      landmarks: [...parsePoints(sec1["Landmarks"]), ...parsePoints(sec1["Site (Human Base)"])],
      saltLicks: parsePoints(sec2["SaltRock"]),
      water: parsePoints(sec1["Water"]),
      wallows: parsePoints(sec1["Mud"]),
      caves: parsePaths(sec1["Cave"]),
      roads: parseRoads(sec2["_Road_"]),
      migrations: parseZones(sec1["Migration"]),
      patrolZones: parseZones(sec1["PatrolZone"]),
      sanctuaries: parseZones(sec1["Sanctuary"]),
    },
  };
}

function validateGatewayData(txt1, txt2) {
  const requiredSections = ["dir\tMigration", "dir\tPatrolZone", "dir\tSanctuary"];
  if (!requiredSections.every((needle) => String(txt1 || "").includes(needle))) {
    throw new Error("Vulnona Gateway layer data is missing required zone sections");
  }
  if (!String(txt2 || "").includes("dir\t_Road_")) {
    throw new Error("Vulnona Gateway resource data is missing the roads/trails section");
  }
}

async function fetchPair({ data1, data2, version }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const [res1, res2] = await Promise.all([
      fetch(data1, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        signal: controller.signal,
      }),
      fetch(data2, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        signal: controller.signal,
      }),
    ]);
    if (!res1.ok || !res2.ok) {
      throw new Error(`Vulnona ${version} fetch failed: data1=${res1.status}, data2=${res2.status}`);
    }
    const [txt1, txt2] = await Promise.all([res1.text(), res2.text()]);
    validateGatewayData(txt1, txt2);
    return { txt1, txt2, version };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFromNetwork() {
  const candidates = PINNED_DATA_URLS
    ? [PINNED_DATA_URLS]
    : VULNONA_GATEWAY_VERSIONS.map((version) => ({
        version,
        data1: `${VULNONA_MAP_BASE_URL}/${version}/data_1.txt`,
        data2: `${VULNONA_MAP_BASE_URL}/${version}/data_2.txt`,
      }));

  let lastError = null;
  for (const candidate of candidates) {
    try {
      const { txt1, txt2, version } = await fetchPair(candidate);

      // Save the newest successfully validated pair as the local fallback.
      try {
        fs.writeFileSync(LOCAL_DATA1_PATH, txt1, "utf8");
        fs.writeFileSync(LOCAL_DATA2_PATH, txt2, "utf8");
        fs.writeFileSync(
          path.join(__dirname, "../data/vulnona_data_meta.json"),
          JSON.stringify({ version, savedAt: new Date().toISOString() }, null, 2),
          "utf8"
        );
      } catch (_) {}

      return buildPayload(parseVulnonaFile(txt1), parseVulnonaFile(txt2), version);
    } catch (error) {
      lastError = error;
      console.warn(`[mapdata] ${candidate.version} unavailable:`, error.message);
    }
  }

  throw lastError || new Error("No Vulnona Gateway data source was available");
}

function loadLocalFallback() {
  if (fs.existsSync(LOCAL_DATA1_PATH) && fs.existsSync(LOCAL_DATA2_PATH)) {
    const txt1 = fs.readFileSync(LOCAL_DATA1_PATH, "utf8");
    const txt2 = fs.readFileSync(LOCAL_DATA2_PATH, "utf8");
    let version = "Gateway_v0.21.7-local-fallback";
    try {
      const meta = JSON.parse(
        fs.readFileSync(path.join(__dirname, "../data/vulnona_data_meta.json"), "utf8")
      );
      if (meta?.version) version = `${meta.version}-local-fallback`;
    } catch (_) {}
    return buildPayload(parseVulnonaFile(txt1), parseVulnonaFile(txt2), version);
  }
  return null;
}

async function getMapData() {
  if (cache && Date.now() - cachedAt < CACHE_MS) return cache;
  if (!inflight) {
    inflight = fetchFromNetwork()
      .catch((err) => {
        console.warn("[mapdata] Vulnona network fetch failed, using local fallback:", err.message);
        const fallback = loadLocalFallback();
        if (fallback) return fallback;
        throw err;
      })
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
    if (cache) return res.json(cache);
    const fallback = loadLocalFallback();
    if (fallback) return res.json(fallback);
    res.status(502).json({ error: "Gateway map data is unavailable right now." });
  }
});

module.exports = router;
