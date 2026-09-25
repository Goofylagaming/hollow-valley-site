const { randomUUID } = require('node:crypto');
const store = require('./economyStore');

const PLAYTIME_XP_PER_5_MINUTES = 10;
const LEVEL_REWARD_VC = 100;
const MAX_LEVEL = 999;

const QUEST_XP = Object.freeze({
  'daily-consecutive-1h': 250,
  'daily-total-3h': 400,
  'daily-total-6h': 600,
  'weekly-total-12h': 750,
  'weekly-total-24h': 1200,
});

const RANKS = Object.freeze([
  { level: 1, name: 'Hypsilophodon' },
  { level: 5, name: 'Dryosaurus' },
  { level: 10, name: 'Beipiaosaurus' },
  { level: 15, name: 'Troodon' },
  { level: 20, name: 'Gallimimus' },
  { level: 25, name: 'Pachycephalosaurus' },
  { level: 30, name: 'Dilophosaurus' },
  { level: 35, name: 'Omniraptor' },
  { level: 40, name: 'Ceratosaurus' },
  { level: 45, name: 'Maiasaura' },
  { level: 50, name: 'Stegosaurus' },
  { level: 60, name: 'Deinosuchus' },
  { level: 70, name: 'Carnotaurus' },
  { level: 80, name: 'Triceratops' },
  { level: 90, name: 'Tyrannosaurus' },
  { level: 100, name: 'Hollow Valley Apex' },
]);

const ACHIEVEMENTS = Object.freeze([
  { id: 'first-level', title: 'Moving Up', description: 'Reach level 2.', type: 'level', threshold: 2 },
  { id: 'level-10', title: 'Valley Regular', description: 'Reach level 10.', type: 'level', threshold: 10 },
  { id: 'level-25', title: 'Valley Tracker', description: 'Reach level 25.', type: 'level', threshold: 25 },
  { id: 'level-50', title: 'Valley Veteran', description: 'Reach level 50.', type: 'level', threshold: 50 },
  { id: 'level-100', title: 'Hollow Valley Apex', description: 'Reach level 100.', type: 'level', threshold: 100 },
  { id: 'playtime-1h', title: 'First Hour', description: 'Log 1 verified hour in Hollow Valley.', type: 'playtime_minutes', threshold: 60 },
  { id: 'playtime-25h', title: 'Settling In', description: 'Log 25 verified hours in Hollow Valley.', type: 'playtime_minutes', threshold: 1500 },
  { id: 'playtime-100h', title: 'Valley Veteran', description: 'Log 100 verified hours in Hollow Valley.', type: 'playtime_minutes', threshold: 6000 },
  { id: 'playtime-250h', title: 'Ancient One', description: 'Log 250 verified hours in Hollow Valley.', type: 'playtime_minutes', threshold: 15000 },
  { id: 'playtime-500h', title: 'Living Fossil', description: 'Log 500 verified hours in Hollow Valley.', type: 'playtime_minutes', threshold: 30000 },
  { id: 'quest-1', title: 'Quest Started', description: 'Complete your first quest.', type: 'quests', threshold: 1 },
  { id: 'quest-25', title: 'Dedicated', description: 'Complete 25 quests.', type: 'quests', threshold: 25 },
  { id: 'quest-100', title: 'Quest Master', description: 'Complete 100 quests.', type: 'quests', threshold: 100 },
  { id: 'event-1', title: 'Event Goer', description: 'Attend your first confirmed event.', type: 'events', threshold: 1 },
  { id: 'event-10', title: 'Party Animal', description: 'Attend 10 confirmed events.', type: 'events', threshold: 10 },
  { id: 'event-25', title: 'Valley Socialite', description: 'Attend 25 confirmed events.', type: 'events', threshold: 25 },
]);

store.db.exec(`
  CREATE TABLE IF NOT EXISTS progression_players (
    steam_id TEXT PRIMARY KEY,
    xp INTEGER NOT NULL DEFAULT 0 CHECK(xp >= 0),
    level INTEGER NOT NULL DEFAULT 1 CHECK(level >= 1),
    playtime_last_seen_ms INTEGER,
    playtime_accrued_ms INTEGER NOT NULL DEFAULT 0 CHECK(playtime_accrued_ms >= 0),
    playtime_intervals INTEGER NOT NULL DEFAULT 0 CHECK(playtime_intervals >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS progression_xp_ledger (
    id TEXT PRIMARY KEY,
    steam_id TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK(amount > 0),
    source TEXT NOT NULL,
    reason TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    reference_type TEXT,
    reference_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_progression_xp_steam_created
    ON progression_xp_ledger(steam_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS progression_achievements (
    steam_id TEXT NOT NULL,
    achievement_id TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (steam_id, achievement_id)
  );
  CREATE INDEX IF NOT EXISTS idx_progression_achievements_steam
    ON progression_achievements(steam_id, unlocked_at DESC);

  CREATE TABLE IF NOT EXISTS progression_discord_links (
    discord_id TEXT PRIMARY KEY,
    steam_id TEXT NOT NULL UNIQUE,
    linked_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function parseJson(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

function validateDiscordId(value) {
  const id = String(value || '').trim();
  if (!/^\d{15,22}$/.test(id)) throw new Error('Invalid Discord ID');
  return id;
}

function xpToReachLevel(level) {
  const target = Math.max(1, Math.min(MAX_LEVEL, Math.floor(Number(level) || 1)));
  const steps = target - 1;
  return steps * 250 + 25 * steps * (steps - 1);
}

function levelFromXp(xp) {
  const total = Math.max(0, Math.floor(Number(xp) || 0));
  let low = 1;
  let high = MAX_LEVEL;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (xpToReachLevel(mid) <= total) low = mid;
    else high = mid - 1;
  }
  return low;
}

function rankForLevel(level) {
  const current = Math.max(1, Number(level) || 1);
  let rank = RANKS[0];
  for (const candidate of RANKS) {
    if (candidate.level > current) break;
    rank = candidate;
  }
  return { ...rank };
}

function nextRankForLevel(level) {
  const current = Math.max(1, Number(level) || 1);
  const next = RANKS.find((candidate) => candidate.level > current);
  return next ? { ...next } : null;
}

function ensurePlayer(steamId) {
  const steam = store.validateSteamId(steamId);
  store.ensureWallet(steam);
  store.db.prepare(`
    INSERT INTO progression_players (steam_id, xp, level)
    VALUES (?, 0, 1)
    ON CONFLICT(steam_id) DO NOTHING
  `).run(steam);
  return store.db.prepare('SELECT * FROM progression_players WHERE steam_id = ?').get(steam);
}

function latestPlayerName(steamId) {
  const exists = store.db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'player_presence_sessions'"
  ).get();
  if (!exists) return null;
  return store.db.prepare(`
    SELECT player_name
    FROM player_presence_sessions
    WHERE steam_id = ? AND player_name IS NOT NULL AND trim(player_name) <> ''
    ORDER BY last_seen_at DESC
    LIMIT 1
  `).get(String(steamId))?.player_name || null;
}

function readAchievements(steamId) {
  return store.db.prepare(`
    SELECT achievement_id, metadata_json, unlocked_at
    FROM progression_achievements
    WHERE steam_id = ?
    ORDER BY unlocked_at DESC, achievement_id ASC
  `).all(steamId).map((row) => {
    const definition = ACHIEVEMENTS.find((item) => item.id === row.achievement_id);
    return {
      id: row.achievement_id,
      title: definition?.title || row.achievement_id,
      description: definition?.description || '',
      unlockedAt: row.unlocked_at,
      metadata: parseJson(row.metadata_json),
    };
  });
}

function countQuestCompletions(steamId) {
  const exists = store.db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'economy_quest_achievements'"
  ).get();
  if (!exists) return 0;
  return Number(store.db.prepare(
    'SELECT COUNT(*) AS count FROM economy_quest_achievements WHERE steam_id = ?'
  ).get(steamId)?.count || 0);
}

function countConfirmedEvents(steamId) {
  const exists = store.db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'event_attendance'"
  ).get();
  if (!exists) return 0;
  return Number(store.db.prepare(
    "SELECT COUNT(*) AS count FROM event_attendance WHERE steam_id = ? AND status = 'paid'"
  ).get(steamId)?.count || 0);
}

function countersFor(steamId) {
  const player = ensurePlayer(steamId);
  return {
    level: Number(player.level) || 1,
    playtime_minutes: Number(player.playtime_intervals || 0) * 5,
    quests: countQuestCompletions(steamId),
    events: countConfirmedEvents(steamId),
  };
}

function unlockEligibleAchievements(steamId) {
  const steam = store.validateSteamId(steamId);
  const counters = countersFor(steam);
  const unlocked = [];

  for (const definition of ACHIEVEMENTS) {
    if (Number(counters[definition.type] || 0) < Number(definition.threshold || 0)) continue;
    const result = store.db.prepare(`
      INSERT INTO progression_achievements (steam_id, achievement_id, metadata_json)
      VALUES (?, ?, ?)
      ON CONFLICT(steam_id, achievement_id) DO NOTHING
    `).run(steam, definition.id, JSON.stringify({
      type: definition.type,
      threshold: definition.threshold,
      value: Number(counters[definition.type] || 0),
    }));
    if (Number(result.changes || 0) > 0) unlocked.push({ ...definition });
  }
  return unlocked;
}

function creditLevelRewardsInTransaction(steamId, oldLevel, newLevel) {
  const rewardedLevels = [];
  for (let level = Math.max(2, Number(oldLevel) + 1); level <= Number(newLevel); level += 1) {
    const key = `progression-level:${steamId}:${level}`;
    const existing = store.db.prepare(
      'SELECT id FROM economy_wallet_ledger WHERE idempotency_key = ?'
    ).get(key);
    if (existing) continue;

    const wallet = store.db.prepare('SELECT balance FROM economy_wallets WHERE steam_id = ?').get(steamId);
    const nextBalance = Number(wallet?.balance || 0) + LEVEL_REWARD_VC;
    const rank = rankForLevel(level);
    store.db.prepare(`
      UPDATE economy_wallets
      SET balance = ?, updated_at = datetime('now')
      WHERE steam_id = ?
    `).run(nextBalance, steamId);
    store.db.prepare(`
      INSERT INTO economy_wallet_ledger
        (id, steam_id, amount, kind, reason, idempotency_key, reference_type, reference_id, metadata_json)
      VALUES (?, ?, ?, 'progression_level_reward', ?, ?, 'progression_level', ?, ?)
    `).run(
      randomUUID(),
      steamId,
      LEVEL_REWARD_VC,
      `Level ${level} reward (+${LEVEL_REWARD_VC} VC)`,
      key,
      String(level),
      JSON.stringify({ level, rank: rank.name, rewardVc: LEVEL_REWARD_VC })
    );
    rewardedLevels.push(level);
  }
  return rewardedLevels;
}

function awardXp({
  steamId,
  amount,
  source,
  reason,
  idempotencyKey,
  referenceType = null,
  referenceId = null,
  metadata = {},
}) {
  const steam = store.validateSteamId(steamId);
  const xpAmount = Number(amount);
  const xpSource = String(source || '').trim();
  const xpReason = String(reason || '').trim();
  const key = String(idempotencyKey || '').trim();
  if (!Number.isSafeInteger(xpAmount) || xpAmount <= 0 || xpAmount > 1000000) {
    throw new Error('XP amount must be a positive whole number');
  }
  if (!xpSource || !xpReason || !key) throw new Error('XP source, reason and idempotency key are required');
  if (key.length > 160) throw new Error('XP idempotency key is too long');

  ensurePlayer(steam);
  store.db.exec('BEGIN IMMEDIATE');
  try {
    const existing = store.db.prepare(
      'SELECT * FROM progression_xp_ledger WHERE idempotency_key = ?'
    ).get(key);
    if (existing) {
      if (existing.steam_id !== steam || Number(existing.amount) !== xpAmount || existing.source !== xpSource) {
        throw new Error('XP idempotency key already exists with different data');
      }
      store.db.exec('COMMIT');
      return { duplicate: true, rewardedLevels: [], profile: readProfile(steam) };
    }

    const before = store.db.prepare('SELECT * FROM progression_players WHERE steam_id = ?').get(steam);
    const oldLevel = Number(before.level) || 1;
    const nextXp = Number(before.xp || 0) + xpAmount;
    const newLevel = levelFromXp(nextXp);

    store.db.prepare(`
      INSERT INTO progression_xp_ledger
        (id, steam_id, amount, source, reason, idempotency_key, reference_type, reference_id, metadata_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      steam,
      xpAmount,
      xpSource,
      xpReason,
      key,
      referenceType ? String(referenceType) : null,
      referenceId ? String(referenceId) : null,
      JSON.stringify(metadata || {})
    );

    store.db.prepare(`
      UPDATE progression_players
      SET xp = ?, level = ?, updated_at = datetime('now')
      WHERE steam_id = ?
    `).run(nextXp, newLevel, steam);

    const rewardedLevels = creditLevelRewardsInTransaction(steam, oldLevel, newLevel);
    store.db.exec('COMMIT');

    const unlockedAchievements = unlockEligibleAchievements(steam);
    return {
      duplicate: false,
      xpAwarded: xpAmount,
      oldLevel,
      newLevel,
      levelsGained: Math.max(0, newLevel - oldLevel),
      rewardedLevels,
      vcAwarded: rewardedLevels.length * LEVEL_REWARD_VC,
      unlockedAchievements,
      profile: readProfile(steam),
    };
  } catch (error) {
    try { store.db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function maxSampleGapSeconds() {
  const value = Number(process.env.PROGRESSION_MAX_SAMPLE_GAP_SECONDS || process.env.WALLET_PLAYTIME_MAX_SAMPLE_GAP_SECONDS || 90);
  return Math.max(30, Math.min(600, Number.isFinite(value) ? value : 90));
}

function trackOnlinePlayers(players, { nowMs = Date.now() } = {}) {
  const ids = [...new Set((players || [])
    .map((player) => String(player?.steamId || '').trim())
    .filter((steamId) => /^\d{17}$/.test(steamId)))];
  const intervalMs = 5 * 60 * 1000;
  const maxGapMs = maxSampleGapSeconds() * 1000;
  const summary = {
    trackedPlayers: ids.length,
    intervalsAwarded: 0,
    xpAwarded: 0,
    levelsGained: 0,
    vcAwarded: 0,
  };

  for (const steam of ids) {
    const prior = ensurePlayer(steam);
    const elapsedMs = prior.playtime_last_seen_ms === null
      ? 0
      : Math.max(0, Number(nowMs) - Number(prior.playtime_last_seen_ms));
    const continuous = prior.playtime_last_seen_ms !== null && elapsedMs > 0 && elapsedMs <= maxGapMs;
    const accrued = Number(prior.playtime_accrued_ms || 0) + (continuous ? elapsedMs : 0);
    const due = Math.floor(accrued / intervalMs);
    const remainder = accrued % intervalMs;
    let sequence = Number(prior.playtime_intervals || 0);

    for (let index = 0; index < due; index += 1) {
      sequence += 1;
      const result = awardXp({
        steamId: steam,
        amount: PLAYTIME_XP_PER_5_MINUTES,
        source: 'playtime',
        reason: 'Verified Hollow Valley playtime',
        idempotencyKey: `progression-playtime:${steam}:${sequence}`,
        referenceType: 'playtime_interval',
        referenceId: String(sequence),
        metadata: { intervalMinutes: 5, sequence },
      });
      if (!result.duplicate) {
        summary.intervalsAwarded += 1;
        summary.xpAwarded += PLAYTIME_XP_PER_5_MINUTES;
        summary.levelsGained += Number(result.levelsGained || 0);
        summary.vcAwarded += Number(result.vcAwarded || 0);
      }
    }

    store.db.prepare(`
      UPDATE progression_players
      SET playtime_last_seen_ms = ?,
          playtime_accrued_ms = ?,
          playtime_intervals = ?,
          updated_at = datetime('now')
      WHERE steam_id = ?
    `).run(Number(nowMs), remainder, sequence, steam);

    syncQuestXp(steam);
    syncEventXp(steam);
    unlockEligibleAchievements(steam);
  }

  return summary;
}

function syncQuestXp(steamId) {
  const steam = store.validateSteamId(steamId);
  const exists = store.db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'economy_quest_achievements'"
  ).get();
  if (!exists) return { checked: 0, awarded: 0 };

  const rows = store.db.prepare(`
    SELECT quest_id, period_key, achieved_at
    FROM economy_quest_achievements
    WHERE steam_id = ?
    ORDER BY achieved_at ASC
  `).all(steam);
  let awarded = 0;
  for (const row of rows) {
    const amount = Number(QUEST_XP[row.quest_id] || 250);
    const result = awardXp({
      steamId: steam,
      amount,
      source: 'quest',
      reason: `Quest completed: ${row.quest_id}`,
      idempotencyKey: `progression-quest:${steam}:${row.quest_id}:${row.period_key}`,
      referenceType: 'quest',
      referenceId: `${row.quest_id}:${row.period_key}`,
      metadata: { questId: row.quest_id, periodKey: row.period_key, achievedAt: row.achieved_at },
    });
    if (!result.duplicate) awarded += amount;
  }
  return { checked: rows.length, awarded };
}

function syncEventXp(steamId) {
  const steam = store.validateSteamId(steamId);
  const exists = store.db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'event_attendance'"
  ).get();
  if (!exists) return { checked: 0, awarded: 0 };

  const rows = store.db.prepare(`
    SELECT event_id, event_title, confirmed_at
    FROM event_attendance
    WHERE steam_id = ? AND status = 'paid'
    ORDER BY confirmed_at ASC
  `).all(steam);
  let awarded = 0;
  for (const row of rows) {
    const result = awardXp({
      steamId: steam,
      amount: 1000,
      source: 'event',
      reason: `Confirmed event attendance: ${row.event_title}`,
      idempotencyKey: `progression-event:${row.event_id}:${steam}`,
      referenceType: 'event',
      referenceId: row.event_id,
      metadata: { eventId: row.event_id, eventTitle: row.event_title, confirmedAt: row.confirmed_at },
    });
    if (!result.duplicate) awarded += 1000;
  }
  return { checked: rows.length, awarded };
}

function readProfile(steamId) {
  const steam = store.validateSteamId(steamId);
  const player = ensurePlayer(steam);
  const level = Number(player.level) || 1;
  const xp = Number(player.xp) || 0;
  const currentLevelXp = xpToReachLevel(level);
  const nextLevelXp = xpToReachLevel(Math.min(MAX_LEVEL, level + 1));
  const denominator = Math.max(1, nextLevelXp - currentLevelXp);
  const progressPercent = level >= MAX_LEVEL
    ? 100
    : Math.max(0, Math.min(100, Math.floor(((xp - currentLevelXp) / denominator) * 100)));

  return {
    steamId: steam,
    username: latestPlayerName(steam),
    xp,
    level,
    maxLevel: MAX_LEVEL,
    rank: rankForLevel(level),
    nextRank: nextRankForLevel(level),
    levelRewardVc: LEVEL_REWARD_VC,
    xpPer5Minutes: PLAYTIME_XP_PER_5_MINUTES,
    xpForCurrentLevel: currentLevelXp,
    xpForNextLevel: level >= MAX_LEVEL ? null : nextLevelXp,
    xpIntoLevel: Math.max(0, xp - currentLevelXp),
    xpNeededForNextLevel: level >= MAX_LEVEL ? 0 : Math.max(0, nextLevelXp - xp),
    progressPercent,
    verifiedPlaytimeMinutes: Number(player.playtime_intervals || 0) * 5,
    questsCompleted: countQuestCompletions(steam),
    eventsAttended: countConfirmedEvents(steam),
    achievements: readAchievements(steam),
    achievementCount: readAchievements(steam).length,
  };
}

function getProfile(steamId, { sync = true } = {}) {
  const steam = store.validateSteamId(steamId);
  ensurePlayer(steam);
  if (sync) {
    syncQuestXp(steam);
    syncEventXp(steam);
    unlockEligibleAchievements(steam);
  }
  return readProfile(steam);
}

function linkDiscordIdentity({ steamId, discordId }) {
  const steam = store.validateSteamId(steamId);
  const discord = validateDiscordId(discordId);
  ensurePlayer(steam);
  store.db.exec('BEGIN IMMEDIATE');
  try {
    store.db.prepare('DELETE FROM progression_discord_links WHERE steam_id = ? AND discord_id <> ?')
      .run(steam, discord);
    store.db.prepare(`
      INSERT INTO progression_discord_links (discord_id, steam_id)
      VALUES (?, ?)
      ON CONFLICT(discord_id) DO UPDATE SET
        steam_id = excluded.steam_id,
        updated_at = datetime('now')
    `).run(discord, steam);
    store.db.exec('COMMIT');
  } catch (error) {
    try { store.db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return { steamId: steam, discordId: discord };
}

function steamIdForDiscord(discordId) {
  const discord = validateDiscordId(discordId);
  return store.db.prepare(
    'SELECT steam_id FROM progression_discord_links WHERE discord_id = ?'
  ).get(discord)?.steam_id || null;
}

function getProfileByDiscord(discordId) {
  const steamId = steamIdForDiscord(discordId);
  if (!steamId) return null;
  return getProfile(steamId);
}

function getLeaderboard({ limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(250, Number(limit) || 100));
  const rows = store.db.prepare(`
    SELECT steam_id, xp, level, playtime_intervals
    FROM progression_players
    ORDER BY level DESC, xp DESC, updated_at ASC
    LIMIT ?
  `).all(safeLimit);

  return rows.map((row, index) => ({
    position: index + 1,
    steamId: row.steam_id,
    username: latestPlayerName(row.steam_id),
    level: Number(row.level) || 1,
    xp: Number(row.xp) || 0,
    rank: rankForLevel(row.level),
    verifiedPlaytimeMinutes: Number(row.playtime_intervals || 0) * 5,
    achievementCount: Number(store.db.prepare(
      'SELECT COUNT(*) AS count FROM progression_achievements WHERE steam_id = ?'
    ).get(row.steam_id)?.count || 0),
  }));
}

function achievementDefinitions() {
  return ACHIEVEMENTS.map((item) => ({ ...item }));
}

module.exports = {
  PLAYTIME_XP_PER_5_MINUTES,
  LEVEL_REWARD_VC,
  QUEST_XP,
  RANKS,
  ACHIEVEMENTS,
  xpToReachLevel,
  levelFromXp,
  rankForLevel,
  nextRankForLevel,
  ensurePlayer,
  awardXp,
  trackOnlinePlayers,
  syncQuestXp,
  syncEventXp,
  unlockEligibleAchievements,
  getProfile,
  getProfileByDiscord,
  linkDiscordIdentity,
  steamIdForDiscord,
  getLeaderboard,
  achievementDefinitions,
};
