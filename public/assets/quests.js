const { api, escapeHtml } = window.HDS;

const QUEST_META = Object.freeze({
  "daily-consecutive-1h": { category: "SURVIVAL", icon: "S", title: "Hold Your Ground", description: "Remain continuously active in Hollow Valley for 1 hour." },
  "daily-total-3h": { category: "ACTIVITY", icon: "A", title: "Roam the Valley", description: "Accumulate 3 verified hours in the server today." },
  "daily-total-6h": { category: "ENDURANCE", icon: "E", title: "Long Haul", description: "Accumulate 6 verified hours in the server today." },
  "weekly-total-12h": { category: "WEEKLY", icon: "W", title: "Valley Regular", description: "Accumulate 12 verified hours before the weekly reset." },
  "weekly-total-24h": { category: "VETERAN", icon: "V", title: "Valley Veteran", description: "Accumulate 24 verified hours before the weekly reset." }
});

const EXPERIMENTAL_QUESTS = Object.freeze([
  { id: "survival-no-death", icon: "N", category: "SURVIVAL", cadence: "DAILY", title: "Not Today, Extinction", description: "Stay alive for 2 hours without a recorded death.", target: "2h alive", tracker: "Presence + combat", reward: "+5% boost" },
  { id: "explore-three-regions", icon: "M", category: "EXPLORATION", cadence: "DAILY", title: "Map? What Map?", description: "Visit 3 different named regions of Gateway in one session.", target: "3 regions", tracker: "Map location", reward: "2,500 VC" },
  { id: "explore-distance", icon: "R", category: "EXPLORATION", cadence: "WEEKLY", title: "Scenic Route", description: "Cover a large amount of ground across Gateway during the week.", target: "Distance target TBD", tracker: "Map location", reward: "5,000 VC" },
  { id: "group-three", icon: "P", category: "SOCIAL", cadence: "DAILY", title: "Safety in Numbers", description: "Spend time grouped with at least 3 other players.", target: "30m grouped", tracker: "Group activity", reward: "2,500 VC" },
  { id: "group-hour", icon: "P", category: "SOCIAL", cadence: "WEEKLY", title: "Pack Tax", description: "Accumulate 2 hours of verified group play this week.", target: "2h grouped", tracker: "Group activity", reward: "5,000 VC" },
  { id: "nest-participate", icon: "E", category: "NESTING", cadence: "WEEKLY", title: "Eggcellent Decisions", description: "Successfully participate in a nesting or hatch cycle.", target: "1 successful nest", tracker: "Nesting event", reward: "5,000 VC" },
  { id: "event-winner", icon: "W", category: "EVENT", cadence: "WEEKLY", title: "Main Character Energy", description: "Earn a winner or bonus payout during an official Hollow Valley event.", target: "1 event bonus", tracker: "Event rewards", reward: "Bonus + quest reward" },
  { id: "survival-lucky", icon: "L", category: "SURVIVAL", cadence: "DAILY", title: "Lucky Escape", description: "Survive a long session after dropping below a low-health threshold.", target: "Survive after critical health", tracker: "Character health", reward: "3,000 VC" },
  { id: "mutation-three", icon: "M", category: "MUTATION", cadence: "WEEKLY", title: "Genetic Overachiever", description: "Reach a three-mutation build on a dinosaur.", target: "3 mutations", tracker: "Character mutations", reward: "5,000 VC" },
  { id: "prime-elder", icon: "P", category: "GROWTH", cadence: "WEEKLY", title: "Golden Oldie", description: "Reach Prime Elder on an eligible dinosaur.", target: "Prime Elder", tracker: "Character state", reward: "10,000 VC" }
]);

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes) return `${minutes}m`;
  return `${total}s`;
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
      <div class="quest-card-heading">
        <div class="quest-card-tags"><span>${escapeHtml(meta.category)}</span><em>${cadence}</em></div>
        <h3>${escapeHtml(meta.title)}</h3>
      </div>
      <div class="quest-card-status ${quest.completed ? "complete" : ""}">${quest.completed ? "✓" : `${percent}%`}</div>
    </div>
    <p class="quest-card-description">${escapeHtml(meta.description)}</p>
    <div class="quest-card-progress-row">
      <strong>${formatDuration(progress)} <span>/ ${formatDuration(threshold)}</span></strong>
      <small>${quest.completed ? "Objective completed" : `${formatDuration(remaining)} remaining`}</small>
    </div>
    <div class="quest-progress-track quest-card-track"><i style="width:${percent}%"></i></div>
    <div class="quest-card-footer">
      <div class="quest-reward-block"><span class="quest-coin-icon">V</span><div><small>REWARD</small><strong>+${Number(quest.boostPercent || 0)}% COIN BOOST</strong></div></div>
      <span class="quest-auto-label">${quest.completed ? "REWARD ACTIVE" : "AUTO TRACKED"}</span>
    </div>
  </article>`;
}

function questSection(title, subtitle, quests) {
  return `<section class="quest-group">
    <div class="quest-group-heading">
      <div><span>${escapeHtml(title)}</span><small>${escapeHtml(subtitle)}</small></div>
      <b>${quests.filter((quest) => quest.completed).length}/${quests.length} COMPLETE</b>
    </div>
    <div class="quest-card-grid">
      ${quests.length ? quests.map(questCard).join("") : '<p class="section-intro">No quests available.</p>'}
    </div>
  </section>`;
}

function brisbaneDateKey() {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Australia/Brisbane",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function seededScore(value, seed) {
  let hash = 2166136261;
  const input = `${seed}:${value}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function experimentalRotation(excludedIds = new Set(), count = 6) {
  const seed = brisbaneDateKey();
  return EXPERIMENTAL_QUESTS
    .filter((quest) => !excludedIds.has(quest.id))
    .sort((a, b) => seededScore(a.id, seed) - seededScore(b.id, seed))
    .slice(0, count);
}

function formatChallengeValue(value, unit) {
  const number = Math.max(0, Number(value) || 0);
  if (unit === "seconds") return formatDuration(number);
  if (unit === "percent") return `${Math.round(number)}%`;
  if (unit === "kills") return `${Math.floor(number)} kill${Math.floor(number) === 1 ? "" : "s"}`;
  if (unit === "species") return `${Math.floor(number)} species`;
  if (unit === "events") return `${Math.floor(number)} event${Math.floor(number) === 1 ? "" : "s"}`;
  return String(Math.floor(number));
}

function trackedChallengeCard(quest) {
  const threshold = Math.max(1, Number(quest.threshold) || 1);
  const progress = Math.max(0, Math.min(threshold, Number(quest.progress) || 0));
  const percent = quest.trackingAvailable ? Math.round((progress / threshold) * 100) : 0;
  const stateLabel = !quest.trackingAvailable ? "OFFLINE" : quest.completed ? "COMPLETE" : "LIVE";
  const stateClass = !quest.trackingAvailable ? "offline" : quest.completed ? "complete" : "live";

  return `<article class="quest-card quest-live-card ${quest.completed ? "completed" : ""}" data-challenge-id="${escapeHtml(quest.id)}">
    <div class="quest-card-top">
      <div class="quest-card-icon">${escapeHtml(quest.icon || "Q")}</div>
      <div class="quest-card-heading">
        <div class="quest-card-tags"><span>${escapeHtml(quest.category)}</span><em>${escapeHtml(quest.cadence)}</em></div>
        <h3>${escapeHtml(quest.title)}</h3>
      </div>
      <div class="quest-live-badge ${stateClass}">${stateLabel}</div>
    </div>

    <p class="quest-card-description">${escapeHtml(quest.description)}</p>

    <div class="quest-card-progress-row">
      <strong>${quest.trackingAvailable ? formatChallengeValue(progress, quest.unit) : "Tracker unavailable"} <span>/ ${formatChallengeValue(threshold, quest.unit)}</span></strong>
      <small>${escapeHtml(quest.resetLabel || quest.tracker || "")}</small>
    </div>

    <div class="quest-progress-track quest-card-track"><i style="width:${percent}%"></i></div>

    <div class="quest-card-footer">
      <div class="quest-reward-block">
        <span class="quest-coin-icon">V</span>
        <div><small>PROPOSED REWARD</small><strong>${escapeHtml(quest.reward || "TBD")}</strong></div>
      </div>
      <span class="quest-concept-tracker">${escapeHtml(quest.tracker || "Tracker")}</span>
    </div>
  </article>`;
}

function trackedChallengesSection(challenges) {
  if (!challenges.length) return "";
  const available = challenges.filter((quest) => quest.trackingAvailable);
  const completed = available.filter((quest) => quest.completed).length;

  return `<section class="quest-group quest-live-group">
    <div class="quest-group-heading">
      <div>
        <span>LIVE TRACKED CHALLENGES</span>
        <small>Real server data · rewards intentionally disabled during test validation</small>
      </div>
      <b>${completed}/${available.length} COMPLETE</b>
    </div>
    <div class="quest-live-banner">
      <strong>TRACKING IS LIVE</strong>
      <span>Combat, growth, species play and confirmed event attendance now read from Hollow Valley server data. Completion is real; VC and boost payouts remain off until the trackers are signed off.</span>
    </div>
    <div class="quest-card-grid">${challenges.map(trackedChallengeCard).join("")}</div>
  </section>`;
}

function experimentalCard(quest) {
  return `<article class="quest-card quest-concept-card" data-concept-id="${escapeHtml(quest.id)}">
    <div class="quest-card-top">
      <div class="quest-card-icon">${escapeHtml(quest.icon)}</div>
      <div class="quest-card-heading">
        <div class="quest-card-tags"><span>${escapeHtml(quest.category)}</span><em>${escapeHtml(quest.cadence)}</em></div>
        <h3>${escapeHtml(quest.title)}</h3>
      </div>
      <div class="quest-concept-badge">IDEA</div>
    </div>
    <p class="quest-card-description">${escapeHtml(quest.description)}</p>
    <div class="quest-concept-target"><small>OBJECTIVE</small><strong>${escapeHtml(quest.target)}</strong></div>
    <div class="quest-card-footer">
      <div class="quest-reward-block"><span class="quest-coin-icon">V</span><div><small>PROPOSED REWARD</small><strong>${escapeHtml(quest.reward)}</strong></div></div>
      <span class="quest-concept-tracker">${escapeHtml(quest.tracker)}</span>
    </div>
  </article>`;
}

function experimentalSection(excludedIds) {
  const rotation = experimentalRotation(excludedIds, 6);
  return `<section class="quest-group quest-experimental-group">
    <div class="quest-group-heading">
      <div><span>QUEST LAB</span><small>Rotating future quest ideas still waiting on a verified tracker</small></div>
      <b>ROTATES DAILY</b>
    </div>
    <div class="quest-experimental-banner">
      <strong>COMING NEXT</strong>
      <span>These ideas do not affect your wallet or quest completion. They stay here until Hollow Valley has a trustworthy server-side signal for the objective.</span>
    </div>
    <div class="quest-card-grid">${rotation.map(experimentalCard).join("")}</div>
  </section>`;
}

async function loadQuests() {
  const me = await window.HDS.loadMe();
  const guard = document.getElementById("quests-guard");
  const content = document.getElementById("quests-content");

  if (!me.loggedIn) {
    guard.hidden = false;
    content.hidden = true;
    return;
  }

  guard.hidden = true;
  content.hidden = false;

  const listEl = document.getElementById("quest-list");
  try {
    const result = await api("/api/quests");
    const quests = Array.isArray(result.quests) ? result.quests : [];
    const trackedChallenges = Array.isArray(result.trackedChallenges) ? result.trackedChallenges : [];
    const completed = quests.filter((quest) => quest.completed).length;

    document.getElementById("quest-active-boost").textContent = `+${Number(result.activeBoostPercent || 0)}%`;
    document.getElementById("quest-completed-count").textContent = `${completed} / ${quests.length}`;

    const intro = document.querySelector(".quest-section-intro");
    if (intro) {
      intro.textContent = result.trackingEnabled
        ? "Playtime and extended challenge progress now update from verified Hollow Valley server data."
        : "Core playtime tracking is currently staged; extended trackers may still show available server data.";
    }

    const daily = quests.filter((quest) => quest.cadence === "daily");
    const weekly = quests.filter((quest) => quest.cadence === "weekly");
    const trackedIds = new Set(trackedChallenges.map((quest) => quest.id));

    listEl.innerHTML = [
      questSection("DAILY PLAYTIME", "Resets every Brisbane day", daily),
      questSection("WEEKLY PLAYTIME", "Resets Monday at 00:00 Brisbane time", weekly),
      trackedChallengesSection(trackedChallenges),
      experimentalSection(trackedIds)
    ].join("");
  } catch (error) {
    listEl.innerHTML = `<div class="empty-roster"><strong>Could not load quests</strong><span>${escapeHtml(error.message || "Quest data unavailable.")}</span></div>`;
  }
}

loadQuests();
