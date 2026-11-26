'use strict';

// Proximity policy ported from Goofylagaming/Voice bridge/proximity.cjs.
// bridge/scanner-reader.cjs is intentionally not used: this website does not
// read the Windows scanner file and does not open RCON, FTP, or CommandBridge.
// The same fail-closed timestamp and ServerOnline/RconOnline rules run against
// the automation snapshot already cached by server/services/serverStatus.js.
const DEFAULT_MAX_AGE_MS = 30000;
const DEFAULT_UNITS_PER_METER = 100;

function positionOf(p) {
  if (!p || !p.Location || typeof p.Location !== 'object') return null;
  const { X, Y, Z } = p.Location;
  if (![X, Y, Z].every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  return { x: X, y: Y, z: Z };
}

function readSnapshot(snapshot, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  if (!snapshot || typeof snapshot !== 'object' || snapshot.ServerOnline !== true ||
      snapshot.RconOnline !== true || !Array.isArray(snapshot.Players)) {
    return { valid: false, reason: 'unavailable', players: new Map() };
  }
  const parsedAt = Date.parse(snapshot.GeneratedAt);
  if (!Number.isFinite(parsedAt) || parsedAt > nowMs + 5000 || nowMs - parsedAt > maxAgeMs) {
    return { valid: false, reason: 'stale_timestamp', players: new Map() };
  }
  const players = new Map();
  const duplicates = new Set();
  for (const record of snapshot.Players) {
    const id = record?.PlayerID == null ? '' : String(record.PlayerID);
    const position = positionOf(record);
    if (!/^\d{1,32}$/.test(id) || !position) continue;
    if (players.has(id)) { players.delete(id); duplicates.add(id); continue; }
    if (!duplicates.has(id)) players.set(id, position);
  }
  return { valid: true, reason: 'ok', players, generatedAtMs: parsedAt };
}

function proximity(from, to, unitsPerMeter) {
  if (!Number.isFinite(unitsPerMeter) || unitsPerMeter <= 0) {
    throw new Error('Explicit positive unitsPerMeter calibration is required');
  }
  if (!from || !to) return { audible: false, gain: 0, distanceMeters: null };
  const distanceMeters = Math.hypot(from.x - to.x, from.y - to.y, from.z - to.z) / unitsPerMeter;
  if (!Number.isFinite(distanceMeters)) return { audible: false, gain: 0, distanceMeters: null };
  // 0-20 metres full, then a linear fade to silence at 100 metres.
  const gain = distanceMeters <= 20 ? 1 : distanceMeters >= 100 ? 0 : (100 - distanceMeters) / 80;
  return { audible: gain > 0, gain, distanceMeters };
}

function authorizedPair(snapshotState, fromId, toId, unitsPerMeter) {
  // Fail closed if snapshot is stale or the player ID wasn't verified against Steam.
  if (!snapshotState?.valid || fromId === toId) return { audible: false, gain: 0, distanceMeters: null };
  return proximity(snapshotState.players.get(String(fromId)), snapshotState.players.get(String(toId)), unitsPerMeter);
}

function voiceEnabled(env = process.env) {
  return String(env.VOICE_ENABLED || '').trim() === '1';
}

// 100 is the Voice repo's test-fixture scale, not a measured Evrima metre.
function unitsPerMeter(env = process.env) {
  const raw = env.VOICE_UNITS_PER_METER;
  if (raw == null || String(raw).trim() === '') return DEFAULT_UNITS_PER_METER;
  const value = Number(String(raw).trim());
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function sanitizeName(value) {
  const cleaned = String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80);
  return cleaned || 'Survivor';
}

function cacheClosed(state) {
  return !state || typeof state !== 'object' || state.stale === true || Boolean(state.lastError) || state.online !== true;
}

function literalFlag(state, lower, upper) {
  if (typeof state?.[lower] === 'boolean') return state[lower];
  if (typeof state?.[upper] === 'boolean') return state[upper];
  return null;
}

function sourceRecords(state) {
  if (Array.isArray(state?.characters)) return state.characters;
  if (Array.isArray(state?.players)) return state.players;
  return [];
}

function scannerPlayers(records) {
  const names = new Map();
  const duplicates = new Set();
  const players = [];
  for (const record of records) {
    const location = record?.location && typeof record.location === 'object' ? record.location : null;
    const entry = {
      PlayerID: record?.steamId,
      Location: location ? {
        X: location.x,
        Y: location.y,
        Z: location.z,
      } : undefined,
    };
    players.push(entry);
    const id = entry.PlayerID == null ? '' : String(entry.PlayerID);
    if (!/^\d{1,32}$/.test(id)) continue;
    if (names.has(id) || duplicates.has(id)) {
      names.delete(id);
      duplicates.add(id);
      continue;
    }
    names.set(id, sanitizeName(record?.name));
  }
  return { players, names };
}

// The website cache stores `online`, `stale`, `lastError`, and `lastChecked`.
// Scanner JSON stores ServerOnline, RconOnline, and GeneratedAt. Literal flags
// are honoured when the cache has them. They are never invented as true:
// a cache with no flags counts as both online only while it is explicitly
// online, not stale, and free of errors. Positions stay inside this function.
function websiteSnapshot(state) {
  const closed = cacheClosed(state);
  const serverFlag = literalFlag(state, 'serverOnline', 'ServerOnline');
  const rconFlag = literalFlag(state, 'rconOnline', 'RconOnline');
  let generatedAt = null;
  if (state && Object.prototype.hasOwnProperty.call(state, 'voiceSampledAt')) {
    generatedAt = state.voiceSampledAt;
  } else if (typeof state?.generatedAt === 'string') {
    generatedAt = state.generatedAt;
  } else if (typeof state?.lastChecked === 'string') {
    generatedAt = state.lastChecked;
  }
  const built = closed ? { players: [], names: new Map() } : scannerPlayers(sourceRecords(state));
  return {
    names: built.names,
    snapshot: {
      GeneratedAt: generatedAt,
      ServerOnline: closed ? false : (serverFlag === null ? true : serverFlag === true),
      RconOnline: closed ? false : (rconFlag === null ? true : rconFlag === true),
      Players: built.players,
    },
  };
}

function publicGains(snapshotState, fromId, scale, names) {
  const self = String(fromId);
  const gains = [];
  for (const id of snapshotState.players.keys()) {
    if (id === self) continue;
    const result = authorizedPair(snapshotState, self, id, scale);
    const gain = result.gain > 0 ? result.gain : 0;
    gains.push({
      identity: id,
      gain,
      audible: gain > 0,
      displayName: names.get(id) || 'Survivor',
    });
  }
  gains.sort((left, right) => (left.identity < right.identity ? -1 : left.identity > right.identity ? 1 : 0));
  return gains;
}

function assessVoice(state, steamId, { nowMs = Date.now(), unitsPerMeter: scale, maxAgeMs } = {}) {
  if (!Number.isFinite(scale) || scale <= 0) {
    return { ok: false, reason: 'invalid_scale', gains: [], displayName: 'Survivor' };
  }
  const built = websiteSnapshot(state);
  const snapshot = readSnapshot(built.snapshot, { nowMs, maxAgeMs });
  const displayName = built.names.get(String(steamId)) || 'Survivor';
  if (!snapshot.valid) {
    return { ok: false, reason: snapshot.reason, gains: [], displayName };
  }
  if (!snapshot.players.has(String(steamId))) {
    return { ok: false, reason: 'not_on_server', gains: [], displayName };
  }
  return {
    ok: true,
    reason: 'ok',
    gains: publicGains(snapshot, steamId, scale, built.names),
    displayName,
  };
}

module.exports = {
  readSnapshot,
  proximity,
  authorizedPair,
  assessVoice,
  voiceEnabled,
  unitsPerMeter,
  sanitizeName,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_UNITS_PER_METER,
};
