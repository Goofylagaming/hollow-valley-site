const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.env.AUTOMATION_DB_PATH || path.join(__dirname, '..', '..', 'data', 'automation.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS prime_tracker_lives (
    id TEXT PRIMARY KEY,
    steam_id TEXT NOT NULL,
    species TEXT,
    started_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_growth REAL,
    is_prime INTEGER NOT NULL DEFAULT 0,
    prime_started_at TEXT,
    prime_preexisting INTEGER NOT NULL DEFAULT 0,
    prime_seconds INTEGER NOT NULL DEFAULT 0,
    last_location_json TEXT,
    ended_at TEXT,
    end_reason TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_prime_tracker_lives_steam
    ON prime_tracker_lives(steam_id, started_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_prime_tracker_open_life
    ON prime_tracker_lives(steam_id)
    WHERE ended_at IS NULL;

  CREATE TABLE IF NOT EXISTS prime_tracker_zone_visits (
    life_id TEXT NOT NULL,
    zone_kind TEXT NOT NULL,
    zone_name TEXT NOT NULL,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    sample_count INTEGER NOT NULL DEFAULT 1,
    seconds_inside INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (life_id, zone_kind, zone_name),
    FOREIGN KEY (life_id) REFERENCES prime_tracker_lives(id)
  );
  CREATE INDEX IF NOT EXISTS idx_prime_tracker_zone_life
    ON prime_tracker_zone_visits(life_id, zone_kind, first_seen_at);
`);

try {
  db.exec('ALTER TABLE prime_tracker_lives ADD COLUMN prime_preexisting INTEGER NOT NULL DEFAULT 0;');
} catch (error) {
  if (!/duplicate column name/i.test(String(error?.message || ''))) throw error;
}

// Any dino first observed as Prime before this field existed is treated as an
// inherited/pre-existing Prime. We preserve the state but do not invent an
// original achievement timestamp.
db.exec(`\n  UPDATE prime_tracker_lives\n  SET prime_preexisting = 1, prime_started_at = NULL\n  WHERE is_prime = 1\n    AND prime_preexisting = 0\n    AND prime_started_at = started_at;\n`);

const BOUNDS = { minX: -607000, maxX: 509000, minY: -505000, maxY: 607000 };
const WIDTH_UNITS = BOUNDS.maxY - BOUNDS.minY;
const HEIGHT_UNITS = BOUNDS.maxX - BOUNDS.minX;
const MAP_VERSION = 'Gateway_v0.21.7';
const VULNONA_DATA1_PATH = path.join(__dirname, '..', '..', '..', 'server', 'data', 'vulnona_data_1.txt');

let cachedLayers = null;

function enabled(env = process.env) {
  return /^(1|true|yes)$/i.test(String(env.PRIME_TRACKER_ENABLED || '').trim());
}

function maxSampleGapMs(env = process.env) {
  const seconds = Number(env.PRIME_TRACKER_MAX_SAMPLE_GAP_SECONDS || 900);
  return Math.max(60, Math.min(3600, Number.isFinite(seconds) ? seconds : 900)) * 1000;
}

function normalizeSpecies(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^bp_/, '')
    .replace(/_c$/, '')
    .replace(/[^a-z0-9]/g, '');
}

function displaySpecies(value) {
  const raw = String(value || '').trim();
  return raw || 'Unknown';
}

function growthFraction(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const fraction = number > 1.5 ? number / 100 : number;
  return Math.max(0, Math.min(1, fraction));
}

function safeIso(value) {
  const time = new Date(value);
  return Number.isFinite(time.getTime()) ? time.toISOString() : new Date().toISOString();
}

function projectLatLong(lat, long) {
  const left = (long * 1000 - BOUNDS.minY) / WIDTH_UNITS;
  const top = (lat * 1000 - BOUNDS.minX) / HEIGHT_UNITS;
  return { left, top };
}

function projectLocation(location) {
  if (!location || typeof location !== 'object') return null;
  // Keep this identical to server/evrimaMap#fromRconLocation + project:
  // Evrima/RCON location X/Y arrive transposed relative to Gateway Lat/Long.
  const worldX = Number(location.y);
  const worldY = Number(location.x);
  if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return null;
  return {
    left: (worldY - BOUNDS.minY) / WIDTH_UNITS,
    top: (worldX - BOUNDS.minX) / HEIGHT_UNITS,
    lat: worldX / 1000,
    long: worldY / 1000,
    raw: {
      x: Number(location.x),
      y: Number(location.y),
      z: Number.isFinite(Number(location.z)) ? Number(location.z) : null,
    },
  };
}

function parseVulnonaFile(text) {
  const sections = {};
  let currentDir = '';
  let currentItem = null;
  let currentCoords = [];

  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = trimmed.split('\t');

    if (parts[0] === 'dir') {
      currentDir = parts[1] || '';
      continue;
    }
    if (parts[0] === 'dirEnd') {
      if (currentItem && currentDir) {
        (sections[currentDir] = sections[currentDir] || []).push({ item: currentItem, coords: currentCoords });
      }
      currentItem = null;
      currentCoords = [];
      currentDir = '';
      continue;
    }

    if (!trimmed.startsWith('-') && !/^\d/.test(trimmed) && parts.length >= 2) {
      if (currentItem && currentDir) {
        (sections[currentDir] = sections[currentDir] || []).push({ item: currentItem, coords: currentCoords });
      }
      currentItem = parts;
      currentCoords = [];
      continue;
    }

    currentCoords.push(trimmed);
  }

  if (currentItem && currentDir) {
    (sections[currentDir] = sections[currentDir] || []).push({ item: currentItem, coords: currentCoords });
  }
  return sections;
}

function cleanZoneName(item) {
  const rawName = item?.[2] || item?.[1] || 'Zone';
  return rawName
    .split(':')[0]
    .replace(/<s>.*?<\/s>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .trim() || 'Zone';
}

function parseZones(items) {
  const shapes = [];
  for (const { item, coords } of items || []) {
    const kind = item[0];
    const name = cleanZoneName(item);

    if (kind === 'circle') {
      for (const coord of coords) {
        const nums = coord.split(/[,/]/).map((value) => value.trim()).filter(Boolean);
        if (nums.length < 2) continue;
        const lat = Number.parseFloat(nums[0]);
        const long = Number.parseFloat(nums[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(long)) continue;
        const rx = Number.parseFloat(nums[2]) || 15;
        const ry = Number.parseFloat(nums[3]) || rx;
        const rotation = Number.parseFloat(nums[4]) || 0;
        const pos = projectLatLong(lat, long);
        shapes.push({
          name,
          shape: 'ellipse',
          left: pos.left,
          top: pos.top,
          rx: (rx * 1000) / WIDTH_UNITS,
          ry: (ry * 1000) / HEIGHT_UNITS,
          rotation,
        });
      }
      continue;
    }

    let currentPoly = [];
    for (const coord of coords) {
      const rMatch = coord.match(/R=([\d.]+)(?:\/([\d.]+))?(?:\/(-?[\d.]+))?/);
      if (rMatch) {
        if (currentPoly.length >= 3) shapes.push({ name, shape: 'polygon', points: currentPoly });
        currentPoly = [];

        const parts = coord.split(',').map((value) => value.trim()).filter(Boolean);
        const lat = Number.parseFloat(parts[0]);
        const long = Number.parseFloat(parts[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(long)) continue;
        const rx = Number.parseFloat(rMatch[1]) || 15;
        const ry = Number.parseFloat(rMatch[2]) || rx;
        const rotation = Number.parseFloat(rMatch[3]) || 0;
        const pos = projectLatLong(lat, long);
        shapes.push({
          name,
          shape: 'ellipse',
          left: pos.left,
          top: pos.top,
          rx: (rx * 1000) / WIDTH_UNITS,
          ry: (ry * 1000) / HEIGHT_UNITS,
          rotation,
        });
        continue;
      }

      const parts = coord.split(',').map((value) => value.trim()).filter(Boolean);
      if (parts.length < 2) continue;
      const lat = Number.parseFloat(parts[0]);
      const long = Number.parseFloat(parts[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(long)) continue;
      if (parts.includes('M') && currentPoly.length >= 3) {
        shapes.push({ name, shape: 'polygon', points: currentPoly });
        currentPoly = [];
      }
      const pos = projectLatLong(lat, long);
      currentPoly.push([pos.left, pos.top]);
    }
    if (currentPoly.length >= 3) shapes.push({ name, shape: 'polygon', points: currentPoly });
  }
  return shapes;
}

function loadZoneLayers() {
  if (cachedLayers) return cachedLayers;
  try {
    const text = fs.readFileSync(VULNONA_DATA1_PATH, 'utf8');
    const sections = parseVulnonaFile(text);
    cachedLayers = {
      migrations: parseZones(sections.Migration),
      patrolZones: parseZones(sections.PatrolZone),
      sanctuaries: parseZones(sections.Sanctuary),
    };
  } catch (error) {
    console.warn('[prime-tracker] Gateway zone data unavailable:', error.message);
    cachedLayers = { migrations: [], patrolZones: [], sanctuaries: [] };
  }
  return cachedLayers;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  const x = point.left;
  const y = point.top;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / ((yj - yi) || Number.EPSILON) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInEllipse(point, zone) {
  if (!zone.rx || !zone.ry) return false;
  const radians = -(Number(zone.rotation) || 0) * Math.PI / 180;
  const dx = point.left - zone.left;
  const dy = point.top - zone.top;
  const x = dx * Math.cos(radians) - dy * Math.sin(radians);
  const y = dx * Math.sin(radians) + dy * Math.cos(radians);
  return ((x * x) / (zone.rx * zone.rx)) + ((y * y) / (zone.ry * zone.ry)) <= 1;
}

function pointInZone(point, zone) {
  if (!point || !zone) return false;
  if (zone.shape === 'ellipse') return pointInEllipse(point, zone);
  if (zone.shape === 'polygon') return pointInPolygon(point, zone.points || []);
  return false;
}

function zoneMembership(location) {
  const point = projectLocation(location);
  if (!point) return {
    point: null,
    migrations: [],
    patrolZones: [],
    sanctuaries: [],
  };

  const layers = loadZoneLayers();
  const result = { point, migrations: [], patrolZones: [], sanctuaries: [] };
  for (const key of ['migrations', 'patrolZones', 'sanctuaries']) {
    const names = new Set();
    for (const zone of layers[key] || []) {
      if (pointInZone(point, zone)) names.add(zone.name);
    }
    result[key] = [...names].sort();
  }
  return result;
}

function activeLife(steamId) {
  return db.prepare(`
    SELECT *
    FROM prime_tracker_lives
    WHERE steam_id = ? AND ended_at IS NULL
    ORDER BY started_at DESC
    LIMIT 1
  `).get(String(steamId)) || null;
}

function closeLife(life, endedAt, reason) {
  if (!life) return;
  db.prepare(`
    UPDATE prime_tracker_lives
    SET ended_at = ?, end_reason = ?, updated_at = datetime('now')
    WHERE id = ? AND ended_at IS NULL
  `).run(endedAt, String(reason || 'new-life'), life.id);
}

function createLife(player, sampledAt) {
  const id = randomUUID();
  const growth = growthFraction(player.growth);
  const prime = player.isPrime === true;
  const projected = projectLocation(player.location);
  db.prepare(`
    INSERT INTO prime_tracker_lives
      (id, steam_id, species, started_at, last_seen_at, last_growth, is_prime, prime_started_at, prime_preexisting, prime_seconds, last_location_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    id,
    String(player.steamId),
    displaySpecies(player.species),
    sampledAt,
    sampledAt,
    growth,
    prime ? 1 : 0,
    null,
    prime ? 1 : 0,
    projected ? JSON.stringify(projected) : null
  );
  return activeLife(player.steamId);
}

function needsNewLife(life, player) {
  if (!life) return true;
  const priorSpecies = normalizeSpecies(life.species);
  const nextSpecies = normalizeSpecies(player.species);
  if (priorSpecies && nextSpecies && priorSpecies !== nextSpecies) return true;

  const priorGrowth = growthFraction(life.last_growth);
  const nextGrowth = growthFraction(player.growth);
  if (priorGrowth !== null && nextGrowth !== null && priorGrowth >= 0.35 && nextGrowth <= 0.12) {
    return true;
  }
  return false;
}

function upsertZoneVisit(life, kind, name, sampledAt, deltaSeconds) {
  const existing = db.prepare(`
    SELECT *
    FROM prime_tracker_zone_visits
    WHERE life_id = ? AND zone_kind = ? AND zone_name = ?
  `).get(life.id, kind, name);

  let addSeconds = 0;
  if (existing && deltaSeconds > 0) {
    const lastVisitMs = Date.parse(existing.last_seen_at);
    const priorLifeMs = Date.parse(life.last_seen_at);
    if (Number.isFinite(lastVisitMs) && Number.isFinite(priorLifeMs) && lastVisitMs === priorLifeMs) {
      addSeconds = deltaSeconds;
    }
  }

  db.prepare(`
    INSERT INTO prime_tracker_zone_visits
      (life_id, zone_kind, zone_name, first_seen_at, last_seen_at, sample_count, seconds_inside)
    VALUES (?, ?, ?, ?, ?, 1, ?)
    ON CONFLICT(life_id, zone_kind, zone_name) DO UPDATE SET
      last_seen_at = excluded.last_seen_at,
      sample_count = prime_tracker_zone_visits.sample_count + 1,
      seconds_inside = prime_tracker_zone_visits.seconds_inside + excluded.seconds_inside
  `).run(life.id, kind, name, sampledAt, sampledAt, addSeconds);
}

function updateLife(player, sampledAt, env = process.env) {
  const steamId = String(player.steamId || '').trim();
  if (!/^\d{17}$/.test(steamId)) return null;

  let life = activeLife(steamId);
  if (needsNewLife(life, player)) {
    if (life) closeLife(life, sampledAt, 'species-or-growth-reset');
    life = createLife(player, sampledAt);
  }

  const sampledMs = Date.parse(sampledAt);
  const previousMs = Date.parse(life.last_seen_at);
  const gapMs = Number.isFinite(sampledMs) && Number.isFinite(previousMs)
    ? Math.max(0, sampledMs - previousMs)
    : 0;
  const continuous = gapMs > 0 && gapMs <= maxSampleGapMs(env);
  const deltaSeconds = continuous ? Math.floor(gapMs / 1000) : 0;

  const primeNow = player.isPrime === true;
  const primePreviously = life.is_prime === 1;
  const addPrimeSeconds = continuous && primeNow && primePreviously ? deltaSeconds : 0;
  const primeStartedAt = life.prime_started_at || (primeNow && !primePreviously ? sampledAt : null);
  const growth = growthFraction(player.growth);
  const projected = projectLocation(player.location);
  const membership = zoneMembership(player.location);

  for (const name of membership.migrations) upsertZoneVisit(life, 'migration', name, sampledAt, deltaSeconds);
  for (const name of membership.patrolZones) upsertZoneVisit(life, 'patrol', name, sampledAt, deltaSeconds);
  for (const name of membership.sanctuaries) upsertZoneVisit(life, 'sanctuary', name, sampledAt, deltaSeconds);

  db.prepare(`
    UPDATE prime_tracker_lives
    SET species = ?,
        last_seen_at = ?,
        last_growth = ?,
        is_prime = ?,
        prime_started_at = ?,
        prime_seconds = prime_seconds + ?,
        last_location_json = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    displaySpecies(player.species),
    sampledAt,
    growth,
    primeNow ? 1 : 0,
    primeStartedAt,
    addPrimeSeconds,
    projected ? JSON.stringify(projected) : life.last_location_json,
    life.id
  );

  return getLife(life.id);
}

function recordSnapshot(players = [], sampledAt = new Date().toISOString(), options = {}) {
  const env = options.env || process.env;
  if (!enabled(env)) return { skipped: true, reason: 'disabled', tracked: 0 };
  const timestamp = safeIso(sampledAt);
  let tracked = 0;
  for (const player of players) {
    try {
      if (updateLife(player, timestamp, env)) tracked += 1;
    } catch (error) {
      console.warn('[prime-tracker]', player?.steamId || 'unknown', error.message);
    }
  }
  return { skipped: false, tracked, sampledAt: timestamp };
}

function getLife(id) {
  return db.prepare('SELECT * FROM prime_tracker_lives WHERE id = ?').get(String(id)) || null;
}

function parseLocationJson(value) {
  try { return JSON.parse(value || 'null'); } catch { return null; }
}

function mapLife(row) {
  if (!row) return null;
  return {
    id: row.id,
    steamId: row.steam_id,
    species: row.species || 'Unknown',
    startedAt: row.started_at,
    lastSeenAt: row.last_seen_at,
    growth: row.last_growth === null ? null : Number(row.last_growth),
    isPrime: row.is_prime === 1,
    primeStartedAt: row.prime_started_at,
    primePreexisting: row.prime_preexisting === 1,
    primeSeconds: Number(row.prime_seconds) || 0,
    lastLocation: parseLocationJson(row.last_location_json),
    endedAt: row.ended_at,
    endReason: row.end_reason,
  };
}

function visitsForLife(lifeId) {
  return db.prepare(`
    SELECT zone_kind, zone_name, first_seen_at, last_seen_at, sample_count, seconds_inside
    FROM prime_tracker_zone_visits
    WHERE life_id = ?
    ORDER BY zone_kind ASC, first_seen_at ASC, zone_name ASC
  `).all(String(lifeId)).map((row) => ({
    kind: row.zone_kind,
    name: row.zone_name,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    sampleCount: Number(row.sample_count) || 0,
    secondsInside: Number(row.seconds_inside) || 0,
    activityState: row.zone_kind === 'sanctuary' ? 'not-applicable' : 'unknown',
  }));
}

function trackerState(steamId, env = process.env) {
  const id = String(steamId || '').trim();
  if (!/^\d{17}$/.test(id)) throw new Error('Invalid Steam ID');

  const active = activeLife(id);
  const historyRows = db.prepare(`
    SELECT *
    FROM prime_tracker_lives
    WHERE steam_id = ?
    ORDER BY started_at DESC
    LIMIT 20
  `).all(id);

  const activeVisits = active ? visitsForLife(active.id) : [];
  const currentLocation = active ? parseLocationJson(active.last_location_json) : null;
  const currentZones = active && currentLocation
    ? zoneMembership({
        // Reverse the stored projected raw coordinates back to the original
        // location object expected by zoneMembership.
        x: currentLocation.raw?.x,
        y: currentLocation.raw?.y,
        z: currentLocation.raw?.z,
      })
    : { migrations: [], patrolZones: [], sanctuaries: [] };

  const byKind = (kind) => activeVisits.filter((visit) => visit.kind === kind);
  const layers = loadZoneLayers();
  const distinctZoneNames = (items) => new Set((items || []).map((item) => item.name)).size;

  return {
    enabled: enabled(env),
    mapVersion: MAP_VERSION,
    activeStateDetection: false,
    activeStateNote: 'Zone footprints are verified from the Live Map dataset; whether a migration/patrol zone is currently active in-game is not exposed by the present feed.',
    activeLife: mapLife(active),
    currentZones: {
      migrations: currentZones.migrations || [],
      patrolZones: currentZones.patrolZones || [],
      sanctuaries: currentZones.sanctuaries || [],
    },
    progress: active ? {
      migrationZonesVisited: byKind('migration').length,
      patrolZonesVisited: byKind('patrol').length,
      sanctuariesVisited: byKind('sanctuary').length,
      knownMigrationZones: distinctZoneNames(layers.migrations),
      knownPatrolZones: distinctZoneNames(layers.patrolZones),
      knownSanctuaries: distinctZoneNames(layers.sanctuaries),
      primeSeconds: Number(active.prime_seconds) || 0,
      isPrime: active.is_prime === 1,
      primeStartedAt: active.prime_started_at,
      primePreexisting: active.prime_preexisting === 1,
    } : null,
    zoneVisits: activeVisits,
    history: historyRows.map(mapLife),
  };
}

module.exports = {
  enabled,
  maxSampleGapMs,
  normalizeSpecies,
  growthFraction,
  projectLocation,
  loadZoneLayers,
  pointInZone,
  zoneMembership,
  recordSnapshot,
  trackerState,
  _test: {
    db,
    parseVulnonaFile,
    parseZones,
    activeLife,
    needsNewLife,
    visitsForLife,
  },
};
