const { api, escapeHtml } = window.HDS;

const QUEST_META = Object.freeze({
  "daily-consecutive-1h": { category: "SURVIVAL", icon: "S", title: "Hold Your Ground", description: "Remain continuously active in Hollow Valley for 1 hour." },
  "daily-total-3h": { category: "ACTIVITY", icon: "A", title: "Roam the Valley", description: "Accumulate 3 verified hours in the server today." },
  "daily-total-6h": { category: "ENDURANCE", icon: "E", title: "Long Haul", description: "Accumulate 6 verified hours in the server today." },
  "weekly-total-12h": { category: "WEEKLY", icon: "W", title: "Valley Regular", description: "Accumulate 12 verified hours before the weekly reset." },
  "weekly-total-24h": { category: "VETERAN", icon: "V", title: "Valley Veteran", description: "Accumulate 24 verified hours before the weekly reset." },
  "weekly-total-36h": { category: "ENDURANCE", icon: "G", title: "Go Touch Grass", description: "Accumulate 36 verified hours before the weekly reset." },
  "weekly-total-72h": { category: "NO LIFE", icon: "?", title: "What Life?", description: "Accumulate 72 verified hours before the weekly reset." }
});

const EXPERIMENTAL_QUESTS = Object.freeze([
  { id: "survival-no-death", icon: "N", category: "SURVIVAL", cadence: "DAILY", title: "Not Today, Extinction", description: "Stay alive for 2 hours without a recorded death.", target: "2h alive", tracker: "Presence + combat", reward: "+5% boost" },
  { id: "explore-three-regions", icon: "M", category: "EXPLORATION", cadence: "DAILY", title: "Map? What Map?", description: "Visit 3 different named regions of Gateway in one session.", target: "3 regions", tracker: "Map location", reward: "2,500 VC" },
  { id: "explore-distance", icon: "R", category: "EXPLORATION", cadence: "WEEKLY", title: "Scenic Route", description: "Cover a large amount of ground across Gateway during the week.", target: "Distance target TBD", tracker: "Map location", reward: "5,000 VC" },
  { id: "group-three", icon: "P", category: "SOCIAL", cadence: "DAILY", title: "Safety in Numbers", description: "Spend time grouped with at least 3 other players.", target: "30m grouped", tracker: "Group activity", reward: "2,500 VC" },
  { id: "group-hour", icon: "P", category: "SOCIAL", cadence: "WEEKLY", title: "Pack Tax", description: "Accumulate 2 hours of verified group play this week.", target: "2h grouped", tracker: "Group activity", reward: "5,000 VC" },
  { id: "nest-participate", icon: "E", category: "NESTING", cadence: "WEEKLY", title: "Eggcellent Decisions", description: "Successfully participate in a nesting or hatch cycle.", target: "1 successful nest", tracker: "Nesting event", reward: "5,000 VC" },
  { id: "species-variety", icon: "V", category: "SPECIES", cadence: "WEEKLY", title: "Menu Variety", description: "Record meaningful playtime on 3 different species this week.", target: "3 species", tracker: "Species presence", reward: "5,000 VC" },
  { id: "event-attendance", icon: "E", category: "EVENT", cadence: "WEEKLY", title: "Actually Showed Up", description: "Attend a Hollow Valley event and have attendance confirmed by an admin.", target: "1 confirmed event", tracker: "Event attendance", reward: "5,000 VC" },
  { id: "event-winner", icon: "W", category: "EVENT", cadence: "WEEKLY", title: "Main Character Energy", description: "Earn a winner or bonus payout during an official Hollow Valley event.", target: "1 event bonus", tracker: "Event rewards", reward: "Bonus + quest reward" },
  { id: "survival-lucky", icon: "L", category: "SURVIVAL", cadence: "DAILY", title: "Lucky Escape", description: "Survive a long session after dropping below a low-health threshold.", target: "Survive after critical health", tracker: "Character health", reward: "3,000 VC" }
]);

const FILTERS = Object.freeze([
  ["daily", "TODAY"], ["weekly", "THIS WEEK"], ["playtime", "PLAYTIME"], ["growth", "GROWTH"],
  ["combat", "COMBAT"], ["species", "SPECIES"], ["survival", "SURVIVAL"], ["exploration", "EXPLORATION"],
  ["event", "EVENTS"], ["social", "SOCIAL"], ["approved", "APPROVED POOL"]
]);

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes) return `${minutes}m`;
  return `${total}s`;
}

function formatCoins(value) {
  return Math.max(0, Number(value) || 0).toLocaleString("en-AU");
}

function questMeta(quest) {
  return QUEST_META[quest.id] || {
    category: quest.cadence === "weekly" ? "WEEKLY" : "DAILY",
    icon: quest.cadence === "weekly" ? "W" : "D",
    title: quest.title,
    description: quest.description
  };
}

function questCard(quest) {
  const threshold = Math.max(1, Number(quest.thresholdSeconds) || 1);
  const progress = Math.max(0, Math.min(threshold, Number(quest.progressSeconds) || 0));
  const percent = Math.round((progress / threshold) * 100);
  const meta = questMeta(quest);
  const cadence = quest.cadence === "weekly" ? "WEEKLY" : "DAILY";
  const remaining = Math.max(0, threshold - progress);
  return `<article class="quest-card ${quest.completed ? "completed" : ""}" data-quest-id="${escapeHtml(quest.id)}">
    <div class="quest-card-top">
      <div class="quest-card-icon">${escapeHtml(meta.icon)}</div>
      <div class="quest-card-heading"><div class="quest-card-tags"><span>${escapeHtml(meta.category)}</span><em>${cadence}</em></div><h3>${escapeHtml(meta.title)}</h3></div>
      <div class="quest-card-status ${quest.completed ? "complete" : ""}">${quest.completed ? "✓" : `${percent}%`}</div>
    </div>
    <p class="quest-card-description">${escapeHtml(meta.description)}</p>
    <div class="quest-card-progress-row"><strong>${formatDuration(progress)} <span>/ ${formatDuration(threshold)}</span></strong><small>${quest.completed ? "Objective completed" : `${formatDuration(remaining)} remaining`}</small></div>
    <div class="quest-progress-track quest-card-track"><i style="width:${percent}%"></i></div>
    <div class="quest-card-footer"><div class="quest-reward-block"><span class="quest-coin-icon">V</span><div><small>REWARD</small><strong>+${Number(quest.boostPercent || 0)}% COIN BOOST</strong></div></div><span class="quest-auto-label">${quest.completed ? "REWARD ACTIVE" : "AUTO TRACKED"}</span></div>
  </article>`;
}

function questSection(title, subtitle, quests) {
  if (!quests.length) return "";
  return `<section class="quest-group"><div class="quest-group-heading"><div><span>${escapeHtml(title)}</span><small>${escapeHtml(subtitle)}</small></div><b>${quests.filter((quest) => quest.completed).length}/${quests.length} COMPLETE</b></div><div class="quest-card-grid">${quests.map(questCard).join("")}</div></section>`;
}

function challengeProgress(challenge) {
  const metric = String(challenge.metric || (challenge.targetGrowth ? "growth" : "")).toLowerCase();
  if (metric === "kills") {
    const current = Math.max(0, Number(challenge.progressCount ?? challenge.progressValue) || 0);
    const target = Math.max(1, Number(challenge.targetCount ?? challenge.targetValue) || 1);
    return { percent: challenge.completed ? 100 : Math.min(100, Math.round((current / target) * 100)), label: `${current} kill${current === 1 ? "" : "s"}`, targetLabel: `${target} kill${target === 1 ? "" : "s"}` };
  }
  if (metric === "seconds") {
    const current = Math.max(0, Number(challenge.progressSeconds ?? challenge.progressValue) || 0);
    const target = Math.max(1, Number(challenge.targetSeconds ?? challenge.targetValue) || 1);
    return { percent: challenge.completed ? 100 : Math.min(100, Math.round((current / target) * 100)), label: formatDuration(current), targetLabel: formatDuration(target) };
  }
  const target = Math.max(0.01, Number(challenge.targetGrowth ?? challenge.targetValue) || 1);
  const current = Math.max(0, Math.min(target, Number(challenge.progressGrowth ?? challenge.progressValue) || 0));
  return { percent: challenge.completed ? 100 : Math.min(100, Math.round((current / target) * 100)), label: `${Math.round(current * 100)}%`, targetLabel: `${Math.round(target * 100)}%` };
}

function challengeCard(challenge) {
  const progress = challengeProgress(challenge);
  const cadence = challenge.cadence === "weekly" ? "WEEKLY" : "DAILY";
  return `<article class="quest-card ${challenge.completed ? "completed" : ""}" data-challenge-id="${escapeHtml(challenge.id)}">
    <div class="quest-card-top">
      <div class="quest-card-icon">${escapeHtml(challenge.icon || "Q")}</div>
      <div class="quest-card-heading"><div class="quest-card-tags"><span>${escapeHtml(challenge.category || "CHALLENGE")}</span><em>${cadence}</em></div><h3>${escapeHtml(challenge.title)}</h3></div>
      <div class="quest-card-status ${challenge.completed ? "complete" : ""}">${challenge.completed ? "✓" : `${progress.percent}%`}</div>
    </div>
    <p class="quest-card-description">${escapeHtml(challenge.description)}</p>
    <div class="quest-card-progress-row"><strong>${escapeHtml(progress.label)} <span>/ ${escapeHtml(progress.targetLabel)}</span></strong><small>${challenge.completed ? "Objective completed" : escapeHtml(challenge.target || "Auto tracked")}</small></div>
    <div class="quest-progress-track quest-card-track"><i style="width:${progress.percent}%"></i></div>
    <div class="quest-card-footer"><div class="quest-reward-block"><span class="quest-coin-icon">V</span><div><small>VC REWARD</small><strong>+${formatCoins(challenge.rewardCoins)} VC</strong></div></div><span class="quest-auto-label">${challenge.completed ? "VC PAID" : "AUTO TRACKED"}</span></div>
  </article>`;
}

function challengeSection(title, subtitle, challenges) {
  if (!challenges.length) return "";
  return `<section class="quest-group"><div class="quest-group-heading"><div><span>${escapeHtml(title)}</span><small>${escapeHtml(subtitle)}</small></div><b>${challenges.filter((challenge) => challenge.completed).length}/${challenges.length} COMPLETE</b></div><div class="quest-card-grid">${challenges.map(challengeCard).join("")}</div></section>`;
}

function experimentalCard(quest) {
  return `<article class="quest-card quest-concept-card" data-concept-id="${escapeHtml(quest.id)}"><div class="quest-card-top"><div class="quest-card-icon">${escapeHtml(quest.icon)}</div><div class="quest-card-heading"><div class="quest-card-tags"><span>${escapeHtml(quest.category)}</span><em>${escapeHtml(quest.cadence)}</em></div><h3>${escapeHtml(quest.title)}</h3></div><div class="quest-concept-badge">APPROVED</div></div><p class="quest-card-description">${escapeHtml(quest.description)}</p><div class="quest-concept-target"><small>OBJECTIVE</small><strong>${escapeHtml(quest.target)}</strong></div><div class="quest-card-footer"><div class="quest-reward-block"><span class="quest-coin-icon">V</span><div><small>PROPOSED REWARD</small><strong>${escapeHtml(quest.reward)}</strong></div></div><span class="quest-concept-tracker">${escapeHtml(quest.tracker)}</span></div></article>`;
}

function approvedSection(quests, title = "APPROVED / COMING NEXT") {
  if (!quests.length) return "";
  return `<section class="quest-group quest-experimental-group"><div class="quest-group-heading"><div><span>${escapeHtml(title)}</span><small>Approved concepts waiting on tracker rollout or final rule definition</small></div><b>${quests.length} STAGED</b></div><div class="quest-experimental-banner"><strong>APPROVED QUEST POOL</strong><span>Growth, Combat and the first Species challenges are live. The remaining concepts stay staged until their tracker rules are validated.</span></div><div class="quest-card-grid">${quests.map(experimentalCard).join("")}</div></section>`;
}

function filterBar(active) {
  return `<div class="page-toolbar" style="display:flex;flex-wrap:wrap;gap:8px;margin:0 0 24px">${FILTERS.map(([id, label]) => `<button type="button" class="small-button quest-filter-button" data-quest-filter="${id}" aria-pressed="${id === active ? "true" : "false"}" style="${id === active ? "opacity:1;box-shadow:inset 0 -2px 0 currentColor" : "opacity:.7"}">${label}</button>`).join("")}</div>`;
}

function approvedForFilter(filter) {
  const categoryMap = { species: ["SPECIES"], survival: ["SURVIVAL"], exploration: ["EXPLORATION"], event: ["EVENT"], social: ["SOCIAL", "NESTING"] };
  const categories = categoryMap[filter];
  if (!categories) return [];
  return EXPERIMENTAL_QUESTS.filter((quest) => categories.includes(quest.category));
}

function renderFilterContent(result, filter) {
  const quests = Array.isArray(result.quests) ? result.quests : [];
  const challenges = Array.isArray(result.challenges) ? result.challenges : [];
  const dailyQuests = quests.filter((quest) => quest.cadence === "daily");
  const weeklyQuests = quests.filter((quest) => quest.cadence === "weekly");
  const dailyChallenges = challenges.filter((challenge) => challenge.cadence === "daily");
  const weeklyChallenges = challenges.filter((challenge) => challenge.cadence === "weekly");

  if (filter === "daily") return [questSection("TODAY · PLAYTIME", "Coin-boost quests · resets at midnight Brisbane time", dailyQuests), challengeSection("TODAY · VC CHALLENGES", "Direct Valley Coin payouts · automatic", dailyChallenges)].join("");
  if (filter === "weekly") return [questSection("THIS WEEK · PLAYTIME", "Coin-boost quests · resets Monday 00:00 Brisbane time", weeklyQuests), challengeSection("THIS WEEK · VC CHALLENGES", "Direct Valley Coin payouts · automatic", weeklyChallenges)].join("");
  if (filter === "playtime") return [questSection("DAILY PLAYTIME", "Automatic coin-boost quests", dailyQuests), questSection("WEEKLY PLAYTIME", "Automatic coin-boost quests", weeklyQuests)].join("");
  if (filter === "approved") return approvedSection(EXPERIMENTAL_QUESTS, "APPROVED CHALLENGE POOL");

  const category = filter.toUpperCase();
  const live = challenges.filter((challenge) => String(challenge.category || "").toUpperCase() === category);
  const questMatches = filter === "survival" ? quests.filter((quest) => questMeta(quest).category === "SURVIVAL") : [];
  const approved = approvedForFilter(filter);
  const label = filter === "event" ? "EVENT" : category;
  const sections = [questSection(`${label} · PLAYTIME`, "Active tracked quests", questMatches), challengeSection(`${label} · LIVE CHALLENGES`, "VC paid automatically on completion", live), approvedSection(approved, `${label} · APPROVED / COMING NEXT`)].filter(Boolean).join("");
  return sections || `<div class="empty-roster"><strong>No ${escapeHtml(label.toLowerCase())} challenges yet</strong><span>Nothing is currently released or staged in this category.</span></div>`;
}

let selectedQuestFilter = "daily";
let questRefreshRunning = false;
let hasQuestData = false;

function renderQuestBoard(listEl, result, activeFilter) {
  selectedQuestFilter = activeFilter;
  listEl.innerHTML = `${filterBar(activeFilter)}${renderFilterContent(result, activeFilter)}`;
  listEl.querySelectorAll("[data-quest-filter]").forEach((button) => {
    button.addEventListener("click", () => renderQuestBoard(listEl, result, button.dataset.questFilter || "daily"));
  });
}

async function loadQuests() {
  if (questRefreshRunning || document.hidden) return;
  questRefreshRunning = true;
  try {
    await refreshQuests();
  } finally {
    questRefreshRunning = false;
  }
}

async function refreshQuests() {
  const me = await window.HDS.loadMe();
  const guard = document.getElementById("quests-guard");
  const content = document.getElementById("quests-content");
  if (!me.loggedIn) { guard.hidden = false; content.hidden = true; return; }
  guard.hidden = true;
  content.hidden = false;

  const listEl = document.getElementById("quest-list");
  try {
    const result = await api("/api/quests", { cache: "no-store" });
    const quests = Array.isArray(result.quests) ? result.quests : [];
    const challenges = Array.isArray(result.challenges) ? result.challenges : [];
    const completed = quests.filter((quest) => quest.completed).length + challenges.filter((challenge) => challenge.completed).length;
    document.getElementById("quest-active-boost").textContent = `+${Number(result.activeBoostPercent || 0)}%`;
    document.getElementById("quest-completed-count").textContent = `${completed} / ${quests.length + challenges.length}`;
    const intro = document.querySelector(".quest-section-intro");
    if (intro) intro.textContent = result.trackingEnabled
      ? "Pick a category below. Progress updates automatically from verified server activity and VC challenge rewards pay directly to your wallet."
      : "Quest tracking is currently staged until verified presence sampling is enabled.";
    renderQuestBoard(listEl, result, selectedQuestFilter);
    hasQuestData = true;
  } catch (error) {
    if (hasQuestData) {
      const intro = document.querySelector(".quest-section-intro");
      if (intro) intro.textContent = "Quest refresh failed. Showing the last received progress; retrying automatically.";
      return;
    }
    listEl.innerHTML = `<div class="empty-roster"><strong>Could not load quests</strong><span>${escapeHtml(error.message || "Quest data unavailable.")}</span></div>`;
  }
}

loadQuests();
setInterval(loadQuests, 30000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) loadQuests();
});
