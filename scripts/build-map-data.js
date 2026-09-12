// Build-time converter for the Gateway map's geographic data.
//
// Fetches the community-maintained coordinate dataset for Evrima's Gateway map
// and converts it into a compact JSON file the site renders itself as SVG.
//
// Only *coordinate data* is used - names and positions of roads, lakes, caves
// and landmarks. The upstream raster map tiles are artwork derived from the
// game and are deliberately neither copied nor hotlinked; we draw our own
// schematic from the data instead. Data source is credited in the UI.
//
// Run: node scripts/build-map-data.js
const fs = require("node:fs");
const path = require("node:path");

const MAP_ID = "Gateway_v0.21.7";
const BASE = `https://vulnona.com/game/map/map/${MAP_ID}`;
const OUT = path.join(__dirname, "..", "public", "assets", "map-data.json");

// Coordinates in the dataset are "Lat,Long" = world units / 1000.
const BOUNDS = { minX: -607, maxX: 509, minY: -505, maxY: 607 };

// Spawn types that sit in water, excluded when inferring where land is.
const AQUATIC = new Set(["Fish", "Crab", "Turtle", "Frog", "Clam", "Shark"]);

function stripTags(value) {
  return value
    .replace(/<s>.*?<\/s>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

/**
 * The dataset is a flat, tab-delimited stream of records. A header line names
 * the record ("text water Cascades"), and the lines that follow are its
 * "lat,long,label,flags" points until the next header or "#---" separator.
 */
function parseRecords(text) {
  const records = [];
  let current = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith("#")) {
      if (line.startsWith("#---")) current = null;
      continue;
    }

    if (/^[a-z]+\t/.test(line)) {
      const [kind, group, name, flags] = line.split("\t");
      current = { kind, group, name: name || "", flags: flags || "", points: [] };
      records.push(current);
      continue;
    }

    if (!current) continue;
    const parts = line.split(",");
    const lat = Number(parts[0]);
    const long = Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(long)) continue;
    // Columns after lat/long are a label plus free-form flags ("M", "exit",
    // "up", time ranges...), so keep them all for callers to inspect.
    current.points.push({
      lat,
      long,
      label: stripTags(parts[2] || ""),
      flags: parts.slice(2).map((p) => p.trim().toLowerCase()),
    });
  }

  return records;
}

// --- Landmass inference -----------------------------------------------------
//
// No coastline geometry exists in the dataset (upstream it's only raster art),
// so the island outline is inferred from where land features actually are:
// mark a coarse grid cell as land if any road, land-based spawn or landmark
// falls in it, smooth the result, then trace the boundary. The result is
// approximate by construction and is presented as a schematic, not as
// survey-accurate cartography.
const GRID = 150;

function cellSize() {
  return {
    x: (BOUNDS.maxX - BOUNDS.minX) / GRID,
    y: (BOUNDS.maxY - BOUNDS.minY) / GRID,
  };
}

function buildLandGrid(landPoints) {
  const cell = cellSize();
  const grid = Array.from({ length: GRID }, () => new Uint8Array(GRID));

  for (const p of landPoints) {
    const row = Math.floor((p.lat - BOUNDS.minX) / cell.x);
    const col = Math.floor((p.long - BOUNDS.minY) / cell.y);
    if (row < 0 || row >= GRID || col < 0 || col >= GRID) continue;
    grid[row][col] = 1;
  }
  return grid;
}

function dilate(grid, radius) {
  const out = Array.from({ length: GRID }, () => new Uint8Array(GRID));
  for (let r = 0; r < GRID; r += 1) {
    for (let c = 0; c < GRID; c += 1) {
      if (!grid[r][c]) continue;
      for (let dr = -radius; dr <= radius; dr += 1) {
        for (let dc = -radius; dc <= radius; dc += 1) {
          if (dr * dr + dc * dc > radius * radius) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr >= 0 && nr < GRID && nc >= 0 && nc < GRID) out[nr][nc] = 1;
        }
      }
    }
  }
  return out;
}

function erode(grid, radius) {
  const out = Array.from({ length: GRID }, () => new Uint8Array(GRID));
  for (let r = 0; r < GRID; r += 1) {
    for (let c = 0; c < GRID; c += 1) {
      let keep = 1;
      for (let dr = -radius; dr <= radius && keep; dr += 1) {
        for (let dc = -radius; dc <= radius && keep; dc += 1) {
          if (dr * dr + dc * dc > radius * radius) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= GRID || nc < 0 || nc >= GRID || !grid[nr][nc]) keep = 0;
        }
      }
      out[r][c] = keep;
    }
  }
  return out;
}

// Keeps connected blobs above a minimum size, so offshore islands survive but
// isolated specks from stray spawn points don't.
function significantComponents(grid, minCells) {
  const seen = Array.from({ length: GRID }, () => new Uint8Array(GRID));
  const blobs = [];

  for (let r = 0; r < GRID; r += 1) {
    for (let c = 0; c < GRID; c += 1) {
      if (!grid[r][c] || seen[r][c]) continue;
      const stack = [[r, c]];
      const blob = [];
      seen[r][c] = 1;
      while (stack.length) {
        const [cr, cc] = stack.pop();
        blob.push([cr, cc]);
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nr = cr + dr;
          const nc = cc + dc;
          if (nr < 0 || nr >= GRID || nc < 0 || nc >= GRID) continue;
          if (!grid[nr][nc] || seen[nr][nc]) continue;
          seen[nr][nc] = 1;
          stack.push([nr, nc]);
        }
      }
      if (blob.length >= minCells) blobs.push(blob);
    }
  }

  return blobs.map((blob) => {
    const out = Array.from({ length: GRID }, () => new Uint8Array(GRID));
    for (const [r, c] of blob) out[r][c] = 1;
    return out;
  });
}

// Traces the outline by collecting the cell edges that border water and
// stitching them head-to-tail into a closed loop.
function traceOutline(grid) {
  const key = (x, y) => `${x}:${y}`;
  const edges = new Map();

  const addEdge = (a, b) => {
    const k = key(a[0], a[1]);
    if (!edges.has(k)) edges.set(k, []);
    edges.get(k).push(b);
  };

  for (let r = 0; r < GRID; r += 1) {
    for (let c = 0; c < GRID; c += 1) {
      if (!grid[r][c]) continue;
      const up = r > 0 ? grid[r - 1][c] : 0;
      const down = r < GRID - 1 ? grid[r + 1][c] : 0;
      const left = c > 0 ? grid[r][c - 1] : 0;
      const right = c < GRID - 1 ? grid[r][c + 1] : 0;
      if (!up) addEdge([c, r], [c + 1, r]);
      if (!right) addEdge([c + 1, r], [c + 1, r + 1]);
      if (!down) addEdge([c + 1, r + 1], [c, r + 1]);
      if (!left) addEdge([c, r + 1], [c, r]);
    }
  }

  if (!edges.size) return [];

  const startKey = edges.keys().next().value;
  const start = startKey.split(":").map(Number);
  let [cx, cy] = start;
  const loop = [[cx, cy]];

  for (let guard = 0; guard < 100000; guard += 1) {
    const k = key(cx, cy);
    const next = edges.get(k);
    if (!next || !next.length) break;
    const [nx, ny] = next.pop();
    if (!next.length) edges.delete(k);
    loop.push([nx, ny]);
    cx = nx;
    cy = ny;
    if (cx === start[0] && cy === start[1]) break;
  }

  const cell = cellSize();
  return loop.map(([gx, gy]) => ({
    long: Number((BOUNDS.minY + gx * cell.y).toFixed(1)),
    lat: Number((BOUNDS.minX + gy * cell.x).toFixed(1)),
  }));
}

// Chaikin corner-cutting: replaces the stair-stepped grid boundary with a
// smooth closed curve. Each pass doubles the vertex count, so simplify after.
function smoothClosed(points, passes) {
  let result = points;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = [];
    for (let i = 0; i < result.length; i += 1) {
      const a = result[i];
      const b = result[(i + 1) % result.length];
      next.push({
        lat: a.lat * 0.75 + b.lat * 0.25,
        long: a.long * 0.75 + b.long * 0.25,
      });
      next.push({
        lat: a.lat * 0.25 + b.lat * 0.75,
        long: a.long * 0.25 + b.long * 0.75,
      });
    }
    result = next;
  }
  return result.map((p) => ({
    lat: Number(p.lat.toFixed(1)),
    long: Number(p.long.toFixed(1)),
  }));
}

// Drops vertices that barely deviate from the line between their neighbours.
function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = out[out.length - 1];
    const p = points[i];
    const next = points[i + 1];
    const dx = next.long - prev.long;
    const dy = next.lat - prev.lat;
    const len = Math.hypot(dx, dy) || 1;
    const dist = Math.abs((p.long - prev.long) * dy - (p.lat - prev.lat) * dx) / len;
    if (dist > tolerance) out.push(p);
  }
  out.push(points[points.length - 1]);
  return out;
}

function thinPath(points, minStep) {
  const out = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.lat - last.lat, p.long - last.long) >= minStep) {
      out.push({ lat: p.lat, long: p.long });
    }
  }
  if (out.length === 1 && points.length > 1) {
    const last = points[points.length - 1];
    out.push({ lat: last.lat, long: last.long });
  }
  return out;
}

async function main() {
  console.log("Fetching map dataset...");
  const [d1, d2] = await Promise.all([
    fetchText(`${BASE}/data_1.txt`),
    fetchText(`${BASE}/data_2.txt`),
  ]);

  const records = [...parseRecords(d1), ...parseRecords(d2)];
  console.log(`Parsed ${records.length} records.`);

  const labelsFor = (group) =>
    records
      .filter((r) => r.kind === "text" && r.group === group)
      .flatMap((r) =>
        r.points.map((p) => ({
          name: p.label || stripTags(r.name),
          lat: p.lat,
          long: p.long,
          size: /large/.test(r.flags) ? "lg" : /small/.test(r.flags) ? "sm" : "md",
        }))
      )
      .filter((entry) => entry.name);

  const areas = labelsFor("area");
  const water = labelsFor("water");
  const land = labelsFor("land");

  const roads = records
    .filter((r) => r.kind === "path" && r.group === "road" && r.points.length > 1)
    .map((r) => ({
      name: stripTags(r.name),
      trail: /trail/.test(r.flags),
      points: thinPath(r.points, 2.5),
    }))
    .filter((r) => r.points.length > 1);

  const caves = records
    .filter((r) => r.kind === "path" && r.group === "cave")
    .flatMap((r) =>
      r.points
        .filter((p) => p.flags.includes("exit"))
        .map((p) => ({ name: stripTags(r.name), lat: p.lat, long: p.long }))
    );

  // Land-based features drive the coastline inference.
  const landPoints = [];
  for (const r of roads) landPoints.push(...r.points);
  for (const entry of [...land, ...areas]) landPoints.push(entry);
  for (const r of records) {
    if (r.kind !== "food" || AQUATIC.has(r.group)) continue;
    landPoints.push(...r.points);
  }
  console.log(`Inferring landmass from ${landPoints.length} land features...`);

  let grid = buildLandGrid(landPoints);
  grid = dilate(grid, 4);
  grid = erode(grid, 2);

  const islands = significantComponents(grid, 40)
    .map((blob) => simplify(smoothClosed(traceOutline(blob), 3), 0.6))
    .filter((ring) => ring.length > 8)
    .sort((a, b) => b.length - a.length);

  console.log(`Landmasses: ${islands.length} (${islands.map((i) => i.length).join(", ")} vertices).`);

  const payload = {
    map: MAP_ID,
    bounds: BOUNDS,
    attribution: "Map feature data from the vulnona.com community Isle map project",
    generated: new Date().toISOString().slice(0, 10),
    islands,
    roads,
    areas,
    water,
    land,
    caves,
  };

  fs.writeFileSync(OUT, JSON.stringify(payload));
  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(
    `Wrote ${OUT} (${kb} KB): ${roads.length} roads, ${water.length} water, ` +
      `${land.length} landmarks, ${areas.length} areas, ${caves.length} cave exits.`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
