const express = require("express");
const { requireAuth } = require("../middleware/requireAuth");
const automation = require("../services/automationWebsiteClient");

const router = express.Router();

const HERBIVORE_MARKERS = [
  "triceratops",
  "stegosaurus",
  "tenontosaurus",
  "dryosaurus",
  "hypsilophodon",
  "pachycephalosaurus",
  "diabloceratops",
  "maiasaura",
  "psittacosaurus"
];

const SMALL_CARNIVORE_MARKERS = [
  "omniraptor",
  "utahraptor",
  "troodon",
  "herrerasaurus"
];

function mapAutomationError(error, fallback) {
  if (Number.isInteger(error?.status)) {
    return { status: error.status, body: { error: error.message || fallback } };
  }
  if (error?.code === "AUTOMATION_TIMEOUT") {
    return { status: 504, body: { error: "The automation service did not respond in time." } };
  }
  return { status: 502, body: { error: error?.message || fallback } };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function growthPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const percent = number <= 1.5 ? number * 100 : number;
  return clamp(percent, 0, 100);
}

function brisbanePeriodStarts(nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));

  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)])
  );
  const localMidnightUtc = Date.UTC(values.year, values.month - 1, values.day) - 10 * 60 * 60 * 1000;
  const localDate = new Date(Date.UTC(values.year, values.month - 1, values.day));
  const day = localDate.getUTCDay();
  const daysSinceMonday = (day + 6) % 7;

  return {
    dailyStartMs: localMidnightUtc,
    weeklyStartMs: localMidnightUtc - daysSinceMonday * 86400000,
    nowMs,
  };
}

function sessionOverlapSeconds(session, startMs, endMs) {
  const start = Date.parse(session?.started_at || session?.startedAt || "");
  const end = Date.parse(
    session?.ended_at ||
    session?.endedAt ||
    session?.last_seen_at ||
    session?.lastSeenAt ||
    new Date(endMs).toISOString()
  );
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.floor((Math.min(end, endMs) - Math.max(start, startMs)) / 1000));
}

function normalizeSpecies(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^bp_/, "")
    .replace(/_c$/, "")
    .replace(/[^a-z0-9]/g, "");
}

function matchesAnySpecies(species, markers) {
  const normalized = normalizeSpecies(species);
  return markers.some((marker) => normalized.includes(normalizeSpecies(marker)));
}

function speciesProgress(sessions, startMs, endMs, predicate) {
  let seconds = 0;
  for (const session of sessions) {
    if (!predicate(session.species)) continue;
    seconds += sessionOverlapSeconds(session, startMs, endMs);
  }
  return seconds;
}

function weeklySpeciesVariety(sessions, startMs, endMs) {
  const totals = new Map();
  for (const session of sessions) {
    const species = normalizeSpecies(session.species);
    if (!species || species === "unknown") continue;
    const seconds = sessionOverlapSeconds(session, startMs, endMs);
    if (!seconds) continue;
    totals.set(species, (totals.get(species) || 0) + seconds);
  }
  return [...totals.values()].filter((seconds) => seconds >= 15 * 60).length;
}

function killsForPlayer(payload, steamId) {
  const rows = Array.isArray(payload?.mostKills) ? payload.mostKills : [];
  const row = rows.find((item) => String(item.steamId) === String(steamId));
  return Number(row?.kills || 0);
}

function confirmedAttendanceThisWeek(payload, weeklyStartMs, nowMs) {
  const rows = Array.isArray(payload?.attendance) ? payload.attendance : [];
  return rows.filter((item) => {
    if (!(item?.status === "paid" || item?.confirmedAt)) return false;
    const confirmedAt = Date.parse(item.confirmedAt || item.eventStart || item.updatedAt || "");
    return Number.isFinite(confirmedAt) && confirmedAt >= weeklyStartMs && confirmedAt <= nowMs;
  }).length;
}

function challenge({
  id,
  icon,
  category,
  cadence,
  title,
  description,
  progress,
  threshold,
  unit,
  tracker,
  reward,
  trackingAvailable = true,
  resetLabel,
}) {
  const safeProgress = Math.max(0, Number(progress) || 0);
  const safeThreshold = Math.max(1, Number(threshold) || 1);
  return {
    id,
    icon,
    category,
    cadence,
    title,
    description,
    progress: Math.min(safeProgress, safeThreshold),
    threshold: safeThreshold,
    unit,
    completed: trackingAvailable && safeProgress >= safeThreshold,
    trackingAvailable,
    tracker,
    reward,
    rewardActive: false,
    resetLabel,
  };
}

async function getTrackedChallenges(steamId) {
  const periods = brisbanePeriodStarts();

  const [combat24, combatWeek, activeCharacter, attendance, presence] = await Promise.allSettled([
    automation.getCombatLeaderboard({ hours: 24 }),
    automation.getCombatLeaderboard({ hours: 24 * 7 }),
    automation.getActiveCharacter(steamId),
    automation.getEventAttendance(steamId),
    automation.getAdminPresence({ steamId, limit: 500 }),
  ]);

  const combat24Data = combat24.status === "fulfilled" ? combat24.value : null;
  const combatWeekData = combatWeek.status === "fulfilled" ? combatWeek.value : null;
  const combat24Available = Boolean(combat24Data?.enabled && combat24Data?.configured);
  const combatWeekAvailable = Boolean(combatWeekData?.enabled && combatWeekData?.configured);

  const activeData = activeCharacter.status === "fulfilled" ? activeCharacter.value : null;
  const activeGrowth = activeData?.active ? growthPercent(activeData.character?.growth) : 0;
  const growthTrackingAvailable = activeCharacter.status === "fulfilled";

  const attendanceData = attendance.status === "fulfilled" ? attendance.value : null;
  const attendanceAvailable = attendance.status === "fulfilled";

  const presenceData = presence.status === "fulfilled" ? presence.value : null;
  const sessions = Array.isArray(presenceData?.sessions) ? presenceData.sessions : [];
  const speciesTrackingAvailable = presence.status === "fulfilled";

  const herbivoreDailySeconds = speciesTrackingAvailable
    ? speciesProgress(sessions, periods.dailyStartMs, periods.nowMs, (species) => matchesAnySpecies(species, HERBIVORE_MARKERS))
    : 0;
  const smallCarnDailySeconds = speciesTrackingAvailable
    ? speciesProgress(sessions, periods.dailyStartMs, periods.nowMs, (species) => matchesAnySpecies(species, SMALL_CARNIVORE_MARKERS))
    : 0;
  const speciesCountWeekly = speciesTrackingAvailable
    ? weeklySpeciesVariety(sessions, periods.weeklyStartMs, periods.nowMs)
    : 0;

  const attendanceCount = attendanceAvailable
    ? confirmedAttendanceThisWeek(attendanceData, periods.weeklyStartMs, periods.nowMs)
    : 0;

  return [
    challenge({
      id: "combat-two-kills",
      icon: "K",
      category: "COMBAT",
      cadence: "DAILY",
      title: "Teeth First, Questions Later",
      description: "Score 2 confirmed player kills in the rolling 24-hour window.",
      progress: combat24Available ? killsForPlayer(combat24Data, steamId) : 0,
      threshold: 2,
      unit: "kills",
      tracker: "Verified combat feed",
      reward: "2,500 VC",
      trackingAvailable: combat24Available,
      resetLabel: "Rolling 24h",
    }),
    challenge({
      id: "combat-revenge",
      icon: "R",
      category: "COMBAT",
      cadence: "WEEKLY",
      title: "Return to Sender",
      description: "Record 5 confirmed player kills in the rolling 7-day window.",
      progress: combatWeekAvailable ? killsForPlayer(combatWeekData, steamId) : 0,
      threshold: 5,
      unit: "kills",
      tracker: "Verified combat feed",
      reward: "7,500 VC",
      trackingAvailable: combatWeekAvailable,
      resetLabel: "Rolling 7d",
    }),
    challenge({
      id: "growth-25",
      icon: "G",
      category: "GROWTH",
      cadence: "DAILY",
      title: "Fresh Legs",
      description: "Reach at least 25% growth on your currently active dinosaur.",
      progress: activeGrowth,
      threshold: 25,
      unit: "percent",
      tracker: "Live character snapshot",
      reward: "1,500 VC",
      trackingAvailable: growthTrackingAvailable,
      resetLabel: "Live snapshot",
    }),
    challenge({
      id: "growth-50",
      icon: "G",
      category: "GROWTH",
      cadence: "DAILY",
      title: "Awkward Teen Phase",
      description: "Reach at least 50% growth on your currently active dinosaur.",
      progress: activeGrowth,
      threshold: 50,
      unit: "percent",
      tracker: "Live character snapshot",
      reward: "2,500 VC",
      trackingAvailable: growthTrackingAvailable,
      resetLabel: "Live snapshot",
    }),
    challenge({
      id: "growth-75",
      icon: "G",
      category: "GROWTH",
      cadence: "WEEKLY",
      title: "Built Different",
      description: "Reach at least 75% growth on your currently active dinosaur.",
      progress: activeGrowth,
      threshold: 75,
      unit: "percent",
      tracker: "Live character snapshot",
      reward: "4,000 VC",
      trackingAvailable: growthTrackingAvailable,
      resetLabel: "Live snapshot",
    }),
    challenge({
      id: "growth-adult",
      icon: "A",
      category: "GROWTH",
      cadence: "WEEKLY",
      title: "Full Send Adult",
      description: "Reach full adult growth on your currently active dinosaur.",
      progress: activeGrowth,
      threshold: 100,
      unit: "percent",
      tracker: "Live character snapshot",
      reward: "7,500 VC",
      trackingAvailable: growthTrackingAvailable,
      resetLabel: "Live snapshot",
    }),
    challenge({
      id: "herbivore-time",
      icon: "H",
      category: "SPECIES",
      cadence: "DAILY",
      title: "Salad Enthusiast",
      description: "Accumulate 90 verified minutes on an eligible herbivore today.",
      progress: herbivoreDailySeconds,
      threshold: 90 * 60,
      unit: "seconds",
      tracker: "Verified species presence",
      reward: "2,500 VC",
      trackingAvailable: speciesTrackingAvailable,
      resetLabel: "Brisbane midnight",
    }),
    challenge({
      id: "small-carnivore",
      icon: "C",
      category: "SPECIES",
      cadence: "DAILY",
      title: "Tiny Terror",
      description: "Accumulate 90 verified minutes on Omniraptor, Troodon or Herrerasaurus today.",
      progress: smallCarnDailySeconds,
      threshold: 90 * 60,
      unit: "seconds",
      tracker: "Verified species presence",
      reward: "2,500 VC",
      trackingAvailable: speciesTrackingAvailable,
      resetLabel: "Brisbane midnight",
    }),
    challenge({
      id: "species-variety",
      icon: "V",
      category: "SPECIES",
      cadence: "WEEKLY",
      title: "Menu Variety",
      description: "Record at least 15 minutes on 3 different species this week.",
      progress: speciesCountWeekly,
      threshold: 3,
      unit: "species",
      tracker: "Verified species presence",
      reward: "5,000 VC",
      trackingAvailable: speciesTrackingAvailable,
      resetLabel: "Monday 00:00",
    }),
    challenge({
      id: "event-attendance",
      icon: "E",
      category: "EVENT",
      cadence: "WEEKLY",
      title: "Actually Showed Up",
      description: "Attend a Hollow Valley event and have attendance confirmed by an admin this week.",
      progress: attendanceCount,
      threshold: 1,
      unit: "events",
      tracker: "Confirmed event attendance",
      reward: "5,000 VC",
      trackingAvailable: attendanceAvailable,
      resetLabel: "Monday 00:00",
    }),
  ];
}

router.get("/", requireAuth, async (req, res) => {
  if (!req.user?.steam_id) {
    return res.status(400).json({ error: "Your Steam account is not linked. Please sign in with Steam first." });
  }

  const steamId = String(req.user.steam_id);

  try {
    const base = await automation.getQuests(steamId);
    let trackedChallenges = [];
    try {
      trackedChallenges = await getTrackedChallenges(steamId);
    } catch (error) {
      console.warn("[quests] extended challenge tracking unavailable:", error.message);
    }
    return res.json({ ...base, trackedChallenges });
  } catch (error) {
    const mapped = mapAutomationError(error, "Could not read playtime quests.");
    return res.status(mapped.status).json(mapped.body);
  }
});

router.post("/:id/claim", requireAuth, (_req, res) => {
  res.status(410).json({ error: "Playtime quests complete automatically and no longer use manual claims." });
});

module.exports = router;
