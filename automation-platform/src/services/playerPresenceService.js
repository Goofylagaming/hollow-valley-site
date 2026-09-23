const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { getServerSnapshot } = require('./statusService');
const playtimeRewards = require('./playtimeRewardsService');
const supporterBonuses = require('./supporterBonusService');
const rconControl = require('./rconControlService');
const externalServerSnapshot = require('./externalServerSnapshotService');

const dbPath = process.env.AUTOMATION_DB_PATH || path.join(__dirname, '..', '..', 'data', 'automation.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA busy_timeout = 5000;');
db.exec('PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS player_presence_sessions (
    id TEXT PRIMARY KEY,
    steam_id TEXT NOT NULL,
    player_name TEXT,
    species TEXT,
    started_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    ended_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_presence_open
    ON player_presence_sessions(ended_at, last_seen_at DESC);
  CREATE INDEX IF NOT EXISTS idx_presence_steam
    ON player_presence_sessions(steam_id, started_at DESC);

  CREATE TABLE IF NOT EXISTS player_presence_samples (
    sampled_at TEXT PRIMARY KEY,
    player_count INTEGER NOT NULL,
    species_counts_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX IF NOT EXISTS idx_presence_samples_time
    ON player_presence_samples(sampled_at DESC);

  CREATE TABLE IF NOT EXISTS player_presence_external_samples (
    sample_id TEXT PRIMARY KEY,
    sampled_at TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    ingested_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_presence_external_samples_time
    ON player_presence_external_samples(sampled_at DESC);
`);

let running = false;
let joinMessagesPrimed = false;

function pollingEnabled() {
  return String(process.env.PLAYER_PRESENCE_ENABLED || '').toLowerCase() === 'true';
}

function externalFeedConfigured() {
  return Boolean(String(process.env.PRESENCE_FEED_TOKEN || '').trim());
}

function enabled() {
  return pollingEnabled() || externalFeedConfigured();
}

function intervalMs() {
  const value = Number(process.env.PLAYER_PRESENCE_INTERVAL_MS || 300000);
  return Math.max(300000, Math.min(600000, Number.isFinite(value) ? value : 300000));
}

function joinMessagesEnabled() {
  return String(process.env.JOIN_MESSAGE_ENABLED || '').toLowerCase() === 'true' &&
    rconControl.writeEnabled('announce');
}

function buildJoinMessage(player = {}) {
  const safeName = String(player.name || 'survivor')
    .replace(/[\x00\r\n]/g, '')
    .trim()
    .slice(0, 48) || 'survivor';
  const template = String(
    process.env.JOIN_MESSAGE_TEMPLATE ||
    'Welcome to Hollow Valley, {player}! Join us at discord.gg/herbydeathsquadgames'
  ).replace(/[\x00\r\n]/g, ' ').trim();

  const message = template.replaceAll('{player}', safeName).replace(/\s+/g, ' ').trim();
  return message.slice(0, 240);
}

function findNewPlayers(onlinePlayers = []) {
  const open = db.prepare(`
    SELECT steam_id
    FROM player_presence_sessions
    WHERE ended_at IS NULL
  `).all();
  const openSteamIds = new Set(open.map((row) => String(row.steam_id)));
  return onlinePlayers.filter((player) => !openSteamIds.has(String(player.steamId)));
}

async function sendJoinMessages(players = []) {
  if (!joinMessagesEnabled()) {
    return { skipped: true, reason: 'disabled', attempted: 0, sent: 0, confirmed: 0, failed: 0 };
  }
  if (!players.length) {
    return { skipped: true, reason: 'no-new-players', attempted: 0, sent: 0, confirmed: 0, failed: 0 };
  }

  const summary = { skipped: false, attempted: 0, sent: 0, confirmed: 0, failed: 0 };
  for (const player of players) {
    summary.attempted += 1;
    try {
      const result = await rconControl.execute('announce', { message: buildJoinMessage(player) });
      if (result.sent) summary.sent += 1;
      if (result.confirmed) summary.confirmed += 1;
      if (!result.sent) summary.failed += 1;
    } catch (error) {
      summary.failed += 1;
      console.warn('[join-message]', error.message);
    }
  }
  return summary;
}

function normalizeOnline(snapshot) {
  const characters = new Map((snapshot.characters || []).map((item) => [String(item.steamId), item]));
  return (snapshot.players || []).map((player) => {
    const steamId = String(player.steamId || '');
    const character = characters.get(steamId);
    return {
      steamId,
      name: player.name || character?.name || 'Unknown',
      species: character?.species || null,
    };
  }).filter((player) => /^\d{17}$/.test(player.steamId));
}

function speciesCounts(onlinePlayers = []) {
  const counts = {};
  for (const player of onlinePlayers) {
    const species = String(player.species || 'Unknown').trim() || 'Unknown';
    counts[species] = (counts[species] || 0) + 1;
  }
  return counts;
}

function recordPresenceSample(onlinePlayers, nowIso = new Date().toISOString()) {
  const counts = speciesCounts(onlinePlayers);
  db.prepare(`
    INSERT INTO player_presence_samples (sampled_at, player_count, species_counts_json)
    VALUES (?, ?, ?)
    ON CONFLICT(sampled_at) DO UPDATE SET
      player_count = excluded.player_count,
      species_counts_json = excluded.species_counts_json
  `).run(nowIso, onlinePlayers.length, JSON.stringify(counts));
  return { sampledAt: nowIso, playerCount: onlinePlayers.length, speciesCounts: counts };
}

function listPresenceSamples({ hours = 24, nowMs = Date.now(), limit = 5000 } = {}) {
  const safeHours = Math.max(1, Math.min(24 * 31, Number(hours) || 24));
  const safeLimit = Math.max(1, Math.min(60000, Number(limit) || 5000));
  const startIso = new Date(nowMs - safeHours * 60 * 60 * 1000).toISOString();
  return db.prepare(`
    SELECT sampled_at, player_count, species_counts_json
    FROM player_presence_samples
    WHERE sampled_at >= ?
    ORDER BY sampled_at ASC
    LIMIT ?
  `).all(startIso, safeLimit).map((row) => {
    let counts = {};
    try { counts = JSON.parse(row.species_counts_json || '{}'); } catch {}
    return {
      sampledAt: row.sampled_at,
      playerCount: Number(row.player_count) || 0,
      speciesCounts: counts,
    };
  });
}

function prunePresenceSamples({ retentionHours = 24 * 31, nowIso = new Date().toISOString() } = {}) {
  const hours = Math.max(24, Math.min(24 * 365, Number(retentionHours) || 24 * 31));
  return db.prepare(`
    DELETE FROM player_presence_samples
    WHERE datetime(sampled_at) < datetime(?, ?)
  `).run(nowIso, `-${hours} hours`).changes;
}

function reconcilePresence(onlinePlayers, nowIso = new Date().toISOString()) {
  const onlineBySteam = new Map(onlinePlayers.map((player) => [player.steamId, player]));
  const open = db.prepare(`
    SELECT * FROM player_presence_sessions
    WHERE ended_at IS NULL
    ORDER BY started_at ASC
  `).all();
  const openBySteam = new Map(open.map((row) => [row.steam_id, row]));
  let opened = 0;
  let updated = 0;
  let closed = 0;

  const insert = db.prepare(`
    INSERT INTO player_presence_sessions
      (id, steam_id, player_name, species, started_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const touch = db.prepare(`
    UPDATE player_presence_sessions
    SET player_name = ?, species = ?, last_seen_at = ?, updated_at = datetime('now')
    WHERE id = ?
  `);
  const close = db.prepare(`
    UPDATE player_presence_sessions
    SET ended_at = ?, updated_at = datetime('now')
    WHERE id = ? AND ended_at IS NULL
  `);

  for (const player of onlinePlayers) {
    const existing = openBySteam.get(player.steamId);
    if (existing) {
      touch.run(player.name, player.species, nowIso, existing.id);
      updated += 1;
    } else {
      insert.run(randomUUID(), player.steamId, player.name, player.species, nowIso, nowIso);
      opened += 1;
    }
  }

  for (const row of open) {
    if (onlineBySteam.has(row.steam_id)) continue;
    closed += close.run(nowIso, row.id).changes;
  }

  return { opened, updated, closed, online: onlinePlayers.length };
}

function presenceFeedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeLocation(value) {
  if (!value) return null;

  if (typeof value === 'object' && !Array.isArray(value)) {
    const x = finiteOrNull(value.x ?? value.X);
    const y = finiteOrNull(value.y ?? value.Y);
    const z = finiteOrNull(value.z ?? value.Z);
    return x === null || y === null || z === null ? null : { x, y, z };
  }

  const match = /X=(-?[\d.]+)[;,\s]+Y=(-?[\d.]+)[;,\s]+Z=(-?[\d.]+)/i.exec(String(value));
  if (!match) return null;
  return { x: Number(match[1]), y: Number(match[2]), z: Number(match[3]) };
}

function normalizeMutations(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter((item) => item && item.toLowerCase() !== 'none')
    .slice(0, 16);
}

function normalizeExternalPlayers(input) {
  if (!Array.isArray(input) || input.length > 500) {
    throw presenceFeedError('PRESENCE_SAMPLE_INVALID', 'players must be an array with at most 500 entries');
  }

  const seen = new Set();
  return input.map((player, index) => {
    if (!player || typeof player !== 'object' || Array.isArray(player)) {
      throw presenceFeedError('PRESENCE_SAMPLE_INVALID', `players[${index}] must be an object`);
    }

    const steamId = String(player.steamId || player.PlayerID || '').trim();
    if (!/^\d{17}$/.test(steamId)) {
      throw presenceFeedError('PRESENCE_SAMPLE_INVALID', `players[${index}] has an invalid SteamID64`);
    }
    if (seen.has(steamId)) {
      throw presenceFeedError('PRESENCE_SAMPLE_INVALID', `Duplicate SteamID64 in players: ${steamId}`);
    }
    seen.add(steamId);

    const name = String(player.name ?? player.Name ?? 'Unknown')
      .replace(/[\x00\r\n]/g, '')
      .trim();
    if (name.length > 80) {
      throw presenceFeedError('PRESENCE_SAMPLE_INVALID', `players[${index}] name is too long`);
    }

    const rawSpecies = player.species ?? player.Class ?? null;
    const species = rawSpecies === null || rawSpecies === undefined || String(rawSpecies).trim() === ''
      ? null
      : String(rawSpecies).replace(/[\x00\r\n]/g, '').trim();
    if (species && species.length > 120) {
      throw presenceFeedError('PRESENCE_SAMPLE_INVALID', `players[${index}] species is too long`);
    }

    const rawGender = player.gender ?? player.Gender ?? null;
    const gender = rawGender === null || rawGender === undefined || String(rawGender).trim() === ''
      ? null
      : String(rawGender).replace(/[\x00\r\n]/g, '').trim().slice(0, 32);

    return {
      steamId,
      name: name || 'Unknown',
      gender,
      species,
      growth: finiteOrNull(player.growth ?? player.Growth),
      health: finiteOrNull(player.health ?? player.Health),
      stamina: finiteOrNull(player.stamina ?? player.Stamina),
      hunger: finiteOrNull(player.hunger ?? player.Hunger),
      thirst: finiteOrNull(player.thirst ?? player.Thirst),
      isPrime: player.isPrime === true || player.PrimeElder === true || String(player.PrimeElder || '').toLowerCase() === 'true',
      mutations: normalizeMutations(player.mutations ?? player.Mutations),
      location: normalizeLocation(player.location ?? player.Location),
    };
  });
}

function externalSampleHash(sampledAt, players) {
  const stablePlayers = [...players]
    .sort((left, right) => left.steamId.localeCompare(right.steamId));
  return createHash('sha256')
    .update(JSON.stringify({ sampledAt, players: stablePlayers }))
    .digest('hex');
}

async function ingestExternalPresenceSnapshot(input = {}) {
  if (running) return { skipped: true, reason: 'sample-already-running' };

  const sampleId = String(input.sampleId || '').trim();
  if (!/^[A-Za-z0-9_.:@+-]{8,180}$/.test(sampleId)) {
    throw presenceFeedError('PRESENCE_SAMPLE_INVALID', 'sampleId must be 8-180 safe characters');
  }

  const sampledAtMs = Date.parse(String(input.sampledAt || ''));
  if (!Number.isFinite(sampledAtMs)) {
    throw presenceFeedError('PRESENCE_SAMPLE_INVALID', 'sampledAt must be a valid ISO-8601 timestamp');
  }
  if (sampledAtMs > Date.now() + 120000) {
    throw presenceFeedError('PRESENCE_SAMPLE_INVALID', 'sampledAt cannot be more than 2 minutes in the future');
  }

  const sampledAt = new Date(sampledAtMs).toISOString();
  const players = normalizeExternalPlayers(input.players);
  const payloadHash = externalSampleHash(sampledAt, players);

  const existing = db.prepare(`
    SELECT sample_id, sampled_at, payload_hash
    FROM player_presence_external_samples
    WHERE sample_id = ?
  `).get(sampleId);

  if (existing) {
    if (existing.payload_hash !== payloadHash) {
      throw presenceFeedError(
        'PRESENCE_SAMPLE_CONFLICT',
        'sampleId has already been used for a different presence payload'
      );
    }
    return {
      skipped: false,
      duplicate: true,
      stale: false,
      sampleId,
      sampledAt: existing.sampled_at,
    };
  }

  const latest = db.prepare(`
    SELECT sample_id, sampled_at
    FROM player_presence_external_samples
    ORDER BY sampled_at DESC
    LIMIT 1
  `).get();
  if (latest && sampledAtMs <= Date.parse(latest.sampled_at)) {
    return {
      skipped: false,
      duplicate: false,
      stale: true,
      reason: 'out-of-order',
      sampleId,
      sampledAt,
      latestAcceptedSampleId: latest.sample_id,
      latestAcceptedAt: latest.sampled_at,
    };
  }

  running = true;
  try {
    const newPlayers = findNewPlayers(players);
    const reconciliation = reconcilePresence(players, sampledAt);
    const sample = recordPresenceSample(players, sampledAt);
    prunePresenceSamples({
      retentionHours: Number(process.env.PLAYER_PRESENCE_RETENTION_HOURS || 24 * 31),
      nowIso: sampledAt,
    });

    let supporterMemberships;
    try {
      supporterMemberships = await supporterBonuses.refreshMemberships(
        players.map((player) => player.steamId)
      );
    } catch (error) {
      console.warn('[supporter-bonuses]', error.message);
      supporterMemberships = {
        skipped: true,
        reason: 'refresh-error',
        error: error.message,
        requested: players.length,
        entitled: 0,
      };
    }

    let rewards;
    try {
      rewards = playtimeRewards.rewardOnlinePlayers(players, { nowMs: sampledAtMs });
    } catch (error) {
      console.warn('[playtime-rewards]', error.message);
      rewards = { skipped: true, reason: 'reward-error', error: error.message };
    }

    db.prepare(`
      INSERT INTO player_presence_external_samples
        (sample_id, sampled_at, payload_hash)
      VALUES (?, ?, ?)
    `).run(sampleId, sampledAt, payloadHash);

    externalServerSnapshot.saveSnapshot({
      sampleId,
      sampledAt,
      players,
      maxPlayers: input.maxPlayers,
    });

    return {
      skipped: false,
      duplicate: false,
      stale: false,
      sampleId,
      sampledAt,
      newPlayers: newPlayers.length,
      ...reconciliation,
      sample,
      supporterMemberships,
      rewards,
    };
  } finally {
    running = false;
  }
}

async function samplePresence({ force = false } = {}) {
  if (running) return { skipped: true, reason: 'sample-already-running' };
  if (!pollingEnabled()) return { skipped: true, reason: 'disabled' };
  running = true;
  try {
    const snapshot = await getServerSnapshot({ force });
    if (!snapshot.configured) return { skipped: true, reason: 'rcon-not-configured' };
    if (!snapshot.online) {
      return {
        skipped: true,
        reason: 'rcon-unavailable',
        error: snapshot.error || null,
      };
    }
    const players = normalizeOnline(snapshot);
    const nowIso = new Date().toISOString();
    const newPlayers = findNewPlayers(players);
    const reconciliation = reconcilePresence(players, nowIso);
    const sample = recordPresenceSample(players, nowIso);
    prunePresenceSamples({ retentionHours: Number(process.env.PLAYER_PRESENCE_RETENTION_HOURS || 24 * 31) });

    let supporterMemberships;
    try {
      supporterMemberships = await supporterBonuses.refreshMemberships(
        players.map((player) => player.steamId)
      );
    } catch (error) {
      console.warn('[supporter-bonuses]', error.message);
      supporterMemberships = {
        skipped: true,
        reason: 'refresh-error',
        error: error.message,
        requested: players.length,
        entitled: 0,
      };
    }

    let rewards;
    try {
      rewards = playtimeRewards.rewardOnlinePlayers(players, { nowMs: Date.parse(nowIso) });
    } catch (error) {
      console.warn('[playtime-rewards]', error.message);
      rewards = { skipped: true, reason: 'reward-error', error: error.message };
    }

    let joinMessages;
    if (!joinMessagesPrimed) {
      // Never greet everyone merely because the automation service restarted.
      // The first successful presence snapshot establishes the baseline.
      joinMessagesPrimed = true;
      joinMessages = {
        skipped: true,
        reason: 'priming',
        attempted: 0,
        sent: 0,
        confirmed: 0,
        failed: 0,
        suppressed: newPlayers.length,
      };
    } else {
      joinMessages = await sendJoinMessages(newPlayers);
    }

    return { skipped: false, ...reconciliation, sample, supporterMemberships, rewards, joinMessages };
  } finally {
    running = false;
  }
}

function listSessions({ steamId = null, activeOnly = false, limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const clauses = [];
  const params = [];
  if (steamId) {
    const id = String(steamId);
    if (!/^\d{17}$/.test(id)) throw new Error('Invalid Steam ID');
    clauses.push('steam_id = ?');
    params.push(id);
  }
  if (activeOnly) clauses.push('ended_at IS NULL');
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db.prepare(`
    SELECT id, steam_id, player_name, species, started_at, last_seen_at, ended_at
    FROM player_presence_sessions
    ${where}
    ORDER BY COALESCE(ended_at, last_seen_at) DESC
    LIMIT ?
  `).all(...params, safeLimit);
}

function getPresenceSummary() {
  const active = db.prepare('SELECT COUNT(*) AS count FROM player_presence_sessions WHERE ended_at IS NULL').get().count;
  const sessions24h = db.prepare(`
    SELECT COUNT(*) AS count FROM player_presence_sessions
    WHERE datetime(started_at) >= datetime('now', '-24 hours')
  `).get().count;
  const unique24h = db.prepare(`
    SELECT COUNT(DISTINCT steam_id) AS count FROM player_presence_sessions
    WHERE datetime(started_at) >= datetime('now', '-24 hours') OR datetime(last_seen_at) >= datetime('now', '-24 hours')
  `).get().count;
  return {
    enabled: enabled(),
    active,
    sessions24h,
    uniquePlayers24h: unique24h,
    joinMessagesEnabled: joinMessagesEnabled(),
  };
}

function buildActivityTrend(samples, { startMs, endMs, maxBuckets = 48 } = {}) {
  const safeStart = Number(startMs);
  const safeEnd = Number(endMs);
  if (!samples.length || !Number.isFinite(safeStart) || !Number.isFinite(safeEnd) || safeEnd <= safeStart) return [];
  const bucketCount = Math.max(1, Math.min(maxBuckets, samples.length));
  const bucketMs = Math.max(60_000, Math.ceil((safeEnd - safeStart) / bucketCount));
  const buckets = new Map();

  for (const sample of samples) {
    const at = Date.parse(sample.sampledAt);
    if (!Number.isFinite(at)) continue;
    const index = Math.max(0, Math.floor((at - safeStart) / bucketMs));
    const key = Math.min(bucketCount - 1, index);
    const current = buckets.get(key) || { sum: 0, count: 0, peak: 0 };
    current.sum += sample.playerCount;
    current.count += 1;
    current.peak = Math.max(current.peak, sample.playerCount);
    buckets.set(key, current);
  }

  return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([index, value]) => ({
    startedAt: new Date(safeStart + index * bucketMs).toISOString(),
    averagePlayers: Math.round((value.sum / value.count) * 10) / 10,
    peakPlayers: value.peak,
    samples: value.count,
  }));
}

function getPresenceAnalytics({ hours = 24, nowMs = Date.now() } = {}) {
  const safeHours = Math.max(1, Math.min(24 * 31, Number(hours) || 24));
  const windowStartMs = nowMs - safeHours * 60 * 60 * 1000;
  const windowStartIso = new Date(windowStartMs).toISOString();
  const nowIso = new Date(nowMs).toISOString();
  const rows = db.prepare(`
    SELECT steam_id, player_name, species, started_at, last_seen_at, ended_at
    FROM player_presence_sessions
    WHERE started_at <= ? AND COALESCE(ended_at, last_seen_at) >= ?
    ORDER BY started_at ASC
  `).all(nowIso, windowStartIso);

  const unique = new Set();
  const perPlayer = new Map();
  const events = [];
  let trackedMs = 0;

  for (const row of rows) {
    const rawStart = Date.parse(row.started_at);
    const rawEnd = Date.parse(row.ended_at || row.last_seen_at);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) continue;
    const start = Math.max(windowStartMs, rawStart);
    const end = Math.min(nowMs, rawEnd);
    if (end < start) continue;

    unique.add(row.steam_id);
    const durationMs = Math.max(0, end - start);
    trackedMs += durationMs;
    const current = perPlayer.get(row.steam_id) || {
      steamId: row.steam_id,
      name: row.player_name || 'Unknown',
      trackedMs: 0,
      sessions: 0,
    };
    current.name = row.player_name || current.name;
    current.trackedMs += durationMs;
    current.sessions += 1;
    perPlayer.set(row.steam_id, current);

    events.push([start, 1]);
    events.push([end, -1]);
  }

  events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let concurrent = 0;
  let peakConcurrent = 0;
  for (const [, delta] of events) {
    concurrent += delta;
    peakConcurrent = Math.max(peakConcurrent, concurrent);
  }

  const topPlayers = [...perPlayer.values()]
    .sort((a, b) => b.trackedMs - a.trackedMs || a.name.localeCompare(b.name))
    .slice(0, 20)
    .map((player) => ({
      steamId: player.steamId,
      name: player.name,
      sessions: player.sessions,
      trackedMinutes: Math.round(player.trackedMs / 60000),
    }));

  const completedDurations = rows
    .filter((row) => row.ended_at)
    .map((row) => Math.max(0, Math.min(nowMs, Date.parse(row.ended_at)) - Math.max(windowStartMs, Date.parse(row.started_at))))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const averageSessionMinutes = completedDurations.length
    ? Math.round(completedDurations.reduce((sum, value) => sum + value, 0) / completedDurations.length / 60000)
    : 0;
  const medianSessionMinutes = completedDurations.length
    ? Math.round(completedDurations[Math.floor((completedDurations.length - 1) / 2)] / 60000)
    : 0;
  const longestSessionMinutes = completedDurations.length
    ? Math.round(completedDurations[completedDurations.length - 1] / 60000)
    : 0;
  const returningPlayers = [...perPlayer.values()].filter((player) => player.sessions >= 2).length;

  const samples = listPresenceSamples({ hours: safeHours, nowMs });
  const samplePeak = samples.reduce((peak, sample) => Math.max(peak, sample.playerCount), 0);
  const averageOnline = samples.length
    ? Math.round((samples.reduce((sum, sample) => sum + sample.playerCount, 0) / samples.length) * 10) / 10
    : 0;
  const speciesTotals = new Map();
  for (const sample of samples) {
    for (const [species, count] of Object.entries(sample.speciesCounts || {})) {
      speciesTotals.set(species, (speciesTotals.get(species) || 0) + Number(count || 0));
    }
  }
  const topSpecies = [...speciesTotals.entries()]
    .map(([species, samplePlayerCount]) => ({ species, samplePlayerCount }))
    .sort((a, b) => b.samplePlayerCount - a.samplePlayerCount || a.species.localeCompare(b.species))
    .slice(0, 10);
  const activityTrend = buildActivityTrend(samples, {
    startMs: windowStartMs,
    endMs: nowMs,
    maxBuckets: 48,
  });

  return {
    enabled: enabled(),
    hours: safeHours,
    uniquePlayers: unique.size,
    sessions: rows.length,
    trackedMinutes: Math.round(trackedMs / 60000),
    peakConcurrent: Math.max(peakConcurrent, samplePeak),
    averageOnline,
    averageSessionMinutes,
    medianSessionMinutes,
    longestSessionMinutes,
    returningPlayers,
    topSpecies,
    activityTrend,
    sampleCount: samples.length,
    topPlayers,
    windowStart: windowStartIso,
    windowEnd: nowIso,
  };
}

function startPlayerPresence() {
  if (!pollingEnabled()) return null;
  samplePresence({ force: false }).catch((error) => console.warn('[player-presence]', error.message));
  const timer = setInterval(() => {
    samplePresence({ force: false }).catch((error) => console.warn('[player-presence]', error.message));
  }, intervalMs());
  timer.unref?.();
  return timer;
}

module.exports = {
  enabled,
  pollingEnabled,
  externalFeedConfigured,
  intervalMs,
  joinMessagesEnabled,
  buildJoinMessage,
  findNewPlayers,
  sendJoinMessages,
  normalizeOnline,
  speciesCounts,
  recordPresenceSample,
  listPresenceSamples,
  prunePresenceSamples,
  buildActivityTrend,
  reconcilePresence,
  ingestExternalPresenceSnapshot,
  samplePresence,
  listSessions,
  getPresenceSummary,
  getPresenceAnalytics,
  startPlayerPresence,
};
