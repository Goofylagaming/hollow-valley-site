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

function updateQuestProgress(steamId, {
  elapsedSeconds = 0,
  continuous = false,
  nowMs = Date.now(),
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
  return {
    state,
    keys,
    newlyAchieved,
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
  };
}

module.exports = {
  QUESTS,
  timezone,
  boostForQuest,
  maxTotalBoostPercent,
  periodKeys,
  questDefinitions,
  updateQuestProgress,
  getQuestStatus,
};
