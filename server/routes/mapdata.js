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
const { BOUNDS } = require("../evrimaMap");

const router = express.Router();

const VULNONA_DATA1_URL =
  process.env.VULNONA_DATA1_URL ||
  "https://vulnona.com/game/map/map/Gateway_v0.21.7/data_1.txt";

const VULNONA_DATA2_URL =
  process.env.VULNONA_DATA2_URL ||
  "https://vulnona.com/game/map/map/Gateway_v0.21.7/data_2.txt";

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

function buildPayload(sec1, sec2) {
  return {
    mapVersion: "Gateway_v0.21.7",
    fetchedAt: new Date().toISOString(),
    layers: {
      areas: parsePoints(sec1["Area"]),
      landmarks: [...parsePoints(sec1["Landmarks"]), ...parsePoints(sec1["Site (Human Base)"])],
      saltLicks: parsePoints(sec2["SaltRock"]),
      water: parsePoints(sec1["Water"]),
      wallows: parsePoints(sec1["Mud"]),
      caves: parsePaths(sec1["Cave"]),
      migrations: parseZones(sec1["Migration"]),
      patrolZones: parseZones(sec1["PatrolZone"]),
      sanctuaries: parseZones(sec1["Sanctuary"]),
    },
  };
}

async function fetchFromNetwork() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const [res1, res2] = await Promise.all([
      fetch(VULNONA_DATA1_URL, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        signal: controller.signal,
      }),
      fetch(VULNONA_DATA2_URL, {
        headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        signal: controller.signal,
      }),
    ]);
    if (!res1.ok || !res2.ok) {
      throw new Error(`Vulnona fetch failed: data1=${res1.status}, data2=${res2.status}`);
    }
    const [txt1, txt2] = await Promise.all([res1.text(), res2.text()]);

    // Save fallback copies locally if possible
    try {
      fs.writeFileSync(LOCAL_DATA1_PATH, txt1, "utf8");
      fs.writeFileSync(LOCAL_DATA2_PATH, txt2, "utf8");
    } catch (_) {}

    return buildPayload(parseVulnonaFile(txt1), parseVulnonaFile(txt2));
  } finally {
    clearTimeout(timer);
  }
}

function loadLocalFallback() {
  if (fs.existsSync(LOCAL_DATA1_PATH) && fs.existsSync(LOCAL_DATA2_PATH)) {
    const txt1 = fs.readFileSync(LOCAL_DATA1_PATH, "utf8");
    const txt2 = fs.readFileSync(LOCAL_DATA2_PATH, "utf8");
    return buildPayload(parseVulnonaFile(txt1), parseVulnonaFile(txt2));
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
