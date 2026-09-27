const { randomUUID } = require('node:crypto');
const store = require('./economyStore');

const QUESTS = Object.freeze([
  {
    id: 'daily-consecutive-1h',
    cadence: 'daily',
    metric: 'consecutive',
    thresholdSeconds: 60 * 60,
    title: 'Stay Alive',
    description: 'Play for 1 consecutive hour today.',
    boostEnv: 'WALLET_QUEST_DAILY_1H_BOOST_PERCENT',
    defaultBoostPercent: 5,
  },
  {
    id: 'daily-total-3h',
    cadence: 'daily',
    metric: 'total',
    thresholdSeconds: 3 * 60 * 60,
    title: 'Three Hour Survivor',
    description: 'Accumulate 3 verified hours online today.',
    boostEnv: 'WALLET_QUEST_DAILY_3H_BOOST_PERCENT',
    defaultBoostPercent: 10,
  },
  {
    id: 'daily-total-6h',
    cadence: 'daily',
    metric: 'total',
    thresholdSeconds: 6 * 60 * 60,
    title: 'Six Hour Survivor',
    description: 'Accumulate 6 verified hours online today.',
    boostEnv: 'WALLET_QUEST_DAILY_6H_BOOST_PERCENT',
    defaultBoostPercent: 15,
  },
  {
    id: 'weekly-total-12h',
    cadence: 'weekly',
    metric: 'total',
    thresholdSeconds: 12 * 60 * 60,
    title: 'Weekly Regular',
    description: 'Accumulate 12 verified hours online this week.',
    boostEnv: 'WALLET_QUEST_WEEKLY_12H_BOOST_PERCENT',
    defaultBoostPercent: 10,
  },
  {
    id: 'weekly-total-24h',
    cadence: 'weekly',
    metric: 'total',
    thresholdSeconds: 24 * 60 * 60,
    title: 'Weekly Veteran',
    description: 'Accumulate 24 verified hours online this week.',
    boostEnv: 'WALLET_QUEST_WEEKLY_24H_BOOST_PERCENT',
    defaultBoostPercent: 20,
  },
  {
    id: 'weekly-total-36h',
    cadence: 'weekly',
    metric: 'total',
    thresholdSeconds: 36 * 60 * 60,
    title: 'Go Touch Grass',
    description: 'Accumulate 36 verified hours online this week.',
    boostEnv: 'WALLET_QUEST_WEEKLY_36H_BOOST_PERCENT',
    defaultBoostPercent: 25,
  },
  {
    id: 'weekly-total-72h',
    cadence: 'weekly',
    metric: 'total',
    thresholdSeconds: 72 * 60 * 60,
    title: 'What Life?',
    description: 'Accumulate 72 verified hours online this week.',
    boostEnv: 'WALLET_QUEST_WEEKLY_72H_BOOST_PERCENT',
    defaultBoostPercent: 50,
  },
]);

const CHALLENGES = Object.freeze([
  {
    id: 'growth-25',
    cadence: 'daily',
    category: 'GROWTH',
    icon: 'G',
    title: 'Fresh Legs',
    description: 'Grow a dinosaur from spawn to at least 25% growth.',
    tracker: 'Character growth',
    target: 'Reach 25%',
    targetGrowth: 0.25,
    rewardCoins: 1500,
    requiresSpawnStart: true,
  },
  {
    id: 'growth-50',
    cadence: 'daily',
    category: 'GROWTH',
    icon: 'G',
    title: 'Awkward Teen Phase',
    description: 'Reach at least 50% growth on an active dinosaur.',
    tracker: 'Character growth',
    target: 'Reach 50%',
    targetGrowth: 0.50,
    rewardCoins: 2500,
  },
  {
    id: 'growth-75',
    cadence: 'weekly',
    category: 'GROWTH',
    icon: 'G',
    title: 'Built Different',
    description: 'Take a dinosaur to at least 75% growth.',
    tracker: 'Character growth',
    target: 'Reach 75%',
    targetGrowth: 0.75,
    rewardCoins: 4000,
  },
  {
    id: 'growth-adult',
    cadence: 'weekly',
    category: 'GROWTH',
    icon: 'A',
    title: 'Full Send Adult',
    description: 'Reach full adult growth on any eligible dinosaur.',
    tracker: 'Character growth',
    target: 'Reach 100%',
    targetGrowth: 1.0,
    rewardCoins: 7500,
  },
]);

store.db.exec(`
  CREATE TABLE IF NOT EXISTS economy_challenge_growth_progress (
    steam_id TEXT NOT NULL,
    challenge_id TEXT NOT NULL,
    period_key TEXT NOT NULL,
    species TEXT,
    last_growth REAL,
    min_growth REAL,
    max_growth REAL,
    started_below INTEGER NOT NULL DEFAULT 0,
    spawn_seen INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (steam_id, challenge_id, period_key),
    FOREIGN KEY (steam_id) REFERENCES economy_wallets(steam_id)
  );
  CREATE INDEX IF NOT EXISTS idx_economy_challenge_growth_progress_steam
    ON economy_challenge_growth_progress(steam_id, updated_at DESC);

  CREATE TABLE IF NOT EXISTS economy_challenge_achievements (
    steam_id TEXT NOT NULL,
    challenge_id TEXT NOT NULL,
    period_key TEXT NOT NULL,
    reward_coins INTEGER NOT NULL DEFAULT 0 CHECK(reward_coins >= 0),
    achieved_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (steam_id, challenge_id, period_key),
    FOREIGN KEY (steam_id) REFERENCES economy_wallets(steam_id)
  );
  CREATE INDEX IF NOT EXISTS idx_economy_challenge_achievements_steam
    ON economy_challenge_achievements(steam_id, achieved_at DESC);
`);

function timezone() {
  return String(process.env.ECONOMY_TIMEZONE || 'Australia/Brisbane').trim() || 'Australia/Brisbane';
}

function boostForQuest(quest) {
  const raw = process.env[quest.boostEnv];
  const value = raw === undefined || raw === '' ? Number(quest.defaultBoostPercent || 0) : Number(raw);
  if (!Number.isSafeInteger(value)) return Math.max(0, Math.min(500, Number(quest.defaultBoostPercent || 0)));
  return Math.max(0, Math.min(500, value));
}

function maxTotalBoostPercent() {
  const value = Number(process.env.WALLET_QUEST_MAX_TOTAL_BOOST_PERCENT || 100);
  return Math.max(0, Math.min(1000, Number.isSafeInteger(value) ? value : 100));
}

function localDateParts(nowMs, zone = timezone()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(nowMs))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function formatYmd(date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function periodKeys(nowMs = Date.now(), zone = timezone()) {
  const parts = localDateParts(nowMs, zone);
  const localDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const daily = formatYmd(localDate);
  const day = localDate.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;
  const monday = new Date(localDate.getTime() - daysSinceMonday * 86400000);
  return { daily, weekly: `week:${formatYmd(monday)}`, timezone: zone };
}

function questDefinitions() {
  return QUESTS.map((quest) => ({
    id: quest.id,
    title: quest.title,
    description: quest.description,
    cadence: quest.cadence,
    metric: quest.metric,
    thresholdSeconds: quest.thresholdSeconds,
    boostPercent: boostForQuest(quest),
  }));
}

function challengeDefinitions() {
  return CHALLENGES.map((challenge) => ({
    id: challenge.id,
    title: challenge.title,
    description: challenge.description,
    cadence: challenge.cadence,
    category: challenge.category,
    icon: challenge.icon,
    tracker: challenge.tracker,
    target: challenge.target,
    targetGrowth: challenge.targetGrowth,
    rewardCoins: challenge.rewardCoins,
  }));
}

function ensureState(steamId, keys) {
  store.ensureWallet(steamId);
  const current = store.getQuestState(steamId);
  if (current) return current;

  store.db.prepare(`
    INSERT INTO economy_quest_state
      (steam_id, daily_period_key, daily_total_seconds, daily_streak_seconds, weekly_period_key, weekly_total_seconds)
    VALUES (?, ?, 0, 0, ?, 0)
  `).run(steamId, keys.daily, keys.weekly);
  return store.getQuestState(steamId);
}

function completeEligibleQuests(steamId, state, keys) {
  const achieved = [];
  for (const quest of QUESTS) {
    const periodKey = quest.cadence === 'daily' ? keys.daily : keys.weekly;
    const progressSeconds = quest.cadence === 'daily'
      ? quest.metric === 'consecutive'
        ? Number(state.daily_streak_seconds)
        : Number(state.daily_total_seconds)
      : Number(state.weekly_total_seconds);

    if (progressSeconds < quest.thresholdSeconds) continue;
    const existing = store.db.prepare(`
      SELECT * FROM economy_quest_achievements
      WHERE steam_id = ? AND quest_id = ? AND period_key = ?
    `).get(steamId, quest.id, periodKey);
    if (existing) continue;

    const boostPercent = boostForQuest(quest);
    store.db.prepare(`
      INSERT INTO economy_quest_achievements
        (steam_id, quest_id, period_key, boost_percent)
      VALUES (?, ?, ?, ?)
    `).run(steamId, quest.id, periodKey, boostPercent);
    achieved.push({
      questId: quest.id,
      title: quest.title,
      boostPercent,
      periodKey,
    });
  }
  return achieved;
}

function normalizeGrowth(value) {
  if (value === null || value === undefined || value === '') return null;
  let growth = Number(value);
  if (!Number.isFinite(growth)) return null;
  if (growth > 1.5) growth /= 100;
  return Math.max(0, Math.min(1, growth));
}

function challengePeriodKey(challenge, keys) {
  return challenge.cadence === 'daily' ? keys.daily : keys.weekly;
}

function challengeAchievement(steamId, challengeId, periodKey) {
  return store.db.prepare(`
    SELECT *
    FROM economy_challenge_achievements
    WHERE steam_id = ? AND challenge_id = ? AND period_key = ?
  `).get(steamId, challengeId, periodKey);
}

function challengeGrowthProgress(steamId, challengeId, periodKey) {
  return store.db.prepare(`
    SELECT *
    FROM economy_challenge_growth_progress
    WHERE steam_id = ? AND challenge_id = ? AND period_key = ?
  `).get(steamId, challengeId, periodKey);
}

function newLifeDetected(row, species, growth) {
  if (!row) return true;
  const previousSpecies = String(row.species || '').trim().toLowerCase();
  const currentSpecies = String(species || '').trim().toLowerCase();
  if (previousSpecies && currentSpecies && previousSpecies !== currentSpecies) return true;

  const lastGrowth = Number(row.last_growth);
  return Number.isFinite(lastGrowth) && lastGrowth >= 0.35 && growth <= 0.12;
}

function writeGrowthProgress({ steamId, challenge, periodKey, species, growth, row }) {
  const reset = newLifeDetected(row, species, growth);
  const minGrowth = reset
    ? growth
    : Math.min(Number.isFinite(Number(row?.min_growth)) ? Number(row.min_growth) : growth, growth);
  const maxGrowth = reset
    ? growth
    : Math.max(Number.isFinite(Number(row?.max_growth)) ? Number(row.max_growth) : growth, growth);
  const startedBelow = reset
    ? growth < challenge.targetGrowth
    : Boolean(Number(row?.started_below)) || growth < challenge.targetGrowth;
  const spawnSeen = reset
    ? growth <= 0.12
    : Boolean(Number(row?.spawn_seen)) || growth <= 0.12;

  store.db.prepare(`
    INSERT INTO economy_challenge_growth_progress
      (steam_id, challenge_id, period_key, species, last_growth, min_growth, max_growth, started_below, spawn_seen, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(steam_id, challenge_id, period_key) DO UPDATE SET
      species = excluded.species,
      last_growth = excluded.last_growth,
      min_growth = excluded.min_growth,
      max_growth = excluded.max_growth,
      started_below = excluded.started_below,
      spawn_seen = excluded.spawn_seen,
      updated_at = datetime('now')
  `).run(
    steamId,
    challenge.id,
    periodKey,
    species || null,
    growth,
    minGrowth,
    maxGrowth,
    startedBelow ? 1 : 0,
    spawnSeen ? 1 : 0
  );

  return { minGrowth, maxGrowth, startedBelow, spawnSeen };
}

function creditChallengeReward(steamId, challenge, periodKey) {
  const idempotencyKey = `quest-challenge:${steamId}:${challenge.id}:${periodKey}`;
  const existing = store.db.prepare(`
    SELECT id
    FROM economy_wallet_ledger
    WHERE idempotency_key = ?
  `).get(idempotencyKey);
  if (existing) return { duplicate: true, amount: challenge.rewardCoins };

  store.ensureWallet(steamId);
  const wallet = store.db.prepare('SELECT balance FROM economy_wallets WHERE steam_id = ?').get(steamId);
  const nextBalance = Number(wallet?.balance || 0) + Number(challenge.rewardCoins || 0);
  store.db.prepare(`
    UPDATE economy_wallets
    SET balance = ?, updated_at = datetime('now')
    WHERE steam_id = ?
  `).run(nextBalance, steamId);

  store.db.prepare(`
    INSERT INTO economy_wallet_ledger
      (id, steam_id, amount, kind, reason, idempotency_key, reference_type, reference_id, metadata_json)
    VALUES (?, ?, ?, 'quest_challenge_reward', ?, ?, 'quest_challenge', ?, ?)
  `).run(
    randomUUID(),
    steamId,
    challenge.rewardCoins,
    `Quest challenge reward: ${challenge.title}`,
    idempotencyKey,
    `${challenge.id}:${periodKey}`,
    JSON.stringify({
      challengeId: challenge.id,
      title: challenge.title,
      cadence: challenge.cadence,
      periodKey,
      rewardCoins: challenge.rewardCoins,
      tracker: challenge.tracker,
    })
  );

  return { duplicate: false, amount: challenge.rewardCoins, balance: nextBalance };
}

function updateGrowthChallenges(steamId, player, keys) {
  const growth = normalizeGrowth(player?.growth);
  if (growth === null) return [];

  const species = String(player?.species || '').trim() || null;
  const completed = [];

  for (const challenge of CHALLENGES) {
    const periodKey = challengePeriodKey(challenge, keys);
    const existingAchievement = challengeAchievement(steamId, challenge.id, periodKey);
    if (existingAchievement) continue;

    const row = challengeGrowthProgress(steamId, challenge.id, periodKey);
    const progress = writeGrowthProgress({ steamId, challenge, periodKey, species, growth, row });

    const startQualified = challenge.requiresSpawnStart ? progress.spawnSeen : progress.startedBelow;
    if (!startQualified || progress.maxGrowth < challenge.targetGrowth) continue;

    const payout = creditChallengeReward(steamId, challenge, periodKey);
    store.db.prepare(`
      INSERT OR IGNORE INTO economy_challenge_achievements
        (steam_id, challenge_id, period_key, reward_coins)
      VALUES (?, ?, ?, ?)
    `).run(steamId, challenge.id, periodKey, challenge.rewardCoins);

    completed.push({
      challengeId: challenge.id,
      title: challenge.title,
      rewardCoins: challenge.rewardCoins,
      periodKey,
      duplicatePayout: Boolean(payout.duplicate),
    });
  }

  return completed;
}

function getChallengeStatus(steamId, keys) {
  return CHALLENGES.map((challenge) => {
    const periodKey = challengePeriodKey(challenge, keys);
    const achievement = challengeAchievement(steamId, challenge.id, periodKey);
    const progress = challengeGrowthProgress(steamId, challenge.id, periodKey);
    const progressGrowth = achievement
      ? challenge.targetGrowth
      : Math.min(challenge.targetGrowth, Math.max(0, Number(progress?.max_growth || 0)));
    const progressPercent = Math.max(
      0,
      Math.min(100, Math.round((progressGrowth / challenge.targetGrowth) * 100))
    );

    return {
      id: challenge.id,
      title: challenge.title,
      description: challenge.description,
      cadence: challenge.cadence,
      category: challenge.category,
      icon: challenge.icon,
      tracker: challenge.tracker,
      target: challenge.target,
      targetGrowth: challenge.targetGrowth,
      progressGrowth,
      progressPercent,
      completed: Boolean(achievement),
      completedAt: achievement?.achieved_at || null,
      periodKey,
      rewardCoins: achievement ? Number(achievement.reward_coins) : challenge.rewardCoins,
      rewardPaid: Boolean(achievement),
    };
  });
}

function updateQuestProgress(steamId, {
  elapsedSeconds = 0,
  continuous = false,
  nowMs = Date.now(),
  player = null,
} = {}) {
  const id = store.validateSteamId(steamId);
  const keys = periodKeys(nowMs);
  const before = ensureState(id, keys);
  const sameDay = before.daily_period_key === keys.daily;
  const sameWeek = before.weekly_period_key === keys.weekly;
  const elapsed = Math.max(0, Math.floor(Number(elapsedSeconds) || 0));

  const dailyTotal = sameDay ? Number(before.daily_total_seconds) + elapsed : 0;
  const dailyStreak = sameDay && continuous
    ? Number(before.daily_streak_seconds) + elapsed
    : 0;
  const weeklyTotal = sameWeek ? Number(before.weekly_total_seconds) + elapsed : 0;

  store.db.prepare(`
    UPDATE economy_quest_state
    SET daily_period_key = ?,
        daily_total_seconds = ?,
        daily_streak_seconds = ?,
        weekly_period_key = ?,
        weekly_total_seconds = ?,
        updated_at = datetime('now')
    WHERE steam_id = ?
  `).run(keys.daily, dailyTotal, dailyStreak, keys.weekly, weeklyTotal, id);

  const state = store.getQuestState(id);
  const newlyAchieved = completeEligibleQuests(id, state, keys);
  const newlyCompletedChallenges = updateGrowthChallenges(id, player, keys);
  return {
    state,
    keys,
    newlyAchieved,
    newlyCompletedChallenges,
    quests: getQuestStatus(id, { nowMs }),
  };
}

function getQuestStatus(steamId, { nowMs = Date.now() } = {}) {
  const id = store.validateSteamId(steamId);
  const keys = periodKeys(nowMs);
  const state = ensureState(id, keys);
  const achievements = store.listQuestAchievements(id, { periodKeys: [keys.daily, keys.weekly] });
  const achievementMap = new Map(achievements.map((item) => [item.quest_id, item]));

  const quests = QUESTS.map((quest) => {
    const periodKey = quest.cadence === 'daily' ? keys.daily : keys.weekly;
    const periodMatches = quest.cadence === 'daily'
      ? state.daily_period_key === keys.daily
      : state.weekly_period_key === keys.weekly;
    const progressSeconds = !periodMatches
      ? 0
      : quest.cadence === 'daily'
        ? quest.metric === 'consecutive'
          ? Number(state.daily_streak_seconds)
          : Number(state.daily_total_seconds)
        : Number(state.weekly_total_seconds);
    const achievement = achievementMap.get(quest.id);
    return {
      id: quest.id,
      title: quest.title,
      description: quest.description,
      cadence: quest.cadence,
      metric: quest.metric,
      thresholdSeconds: quest.thresholdSeconds,
      progressSeconds: Math.min(progressSeconds, quest.thresholdSeconds),
      completed: Boolean(achievement),
      completedAt: achievement?.achieved_at || null,
      periodKey,
      boostPercent: achievement ? Number(achievement.boost_percent) : boostForQuest(quest),
    };
  });

  const rawBoost = quests
    .filter((quest) => quest.completed)
    .reduce((sum, quest) => sum + Number(quest.boostPercent || 0), 0);
  const activeBoostPercent = Math.min(rawBoost, maxTotalBoostPercent());

  return {
    timezone: keys.timezone,
    dailyPeriodKey: keys.daily,
    weeklyPeriodKey: keys.weekly,
    activeBoostPercent,
    maxTotalBoostPercent: maxTotalBoostPercent(),
    quests,
    challenges: getChallengeStatus(id, keys),
  };
}

module.exports = {
  QUESTS,
  CHALLENGES,
  timezone,
  boostForQuest,
  maxTotalBoostPercent,
  periodKeys,
  questDefinitions,
  challengeDefinitions,
  updateQuestProgress,
  getQuestStatus,
};
