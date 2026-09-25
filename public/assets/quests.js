const { api, escapeHtml } = window.HDS;

const QUEST_META = Object.freeze({
  "daily-consecutive-1h": {
    category: "SURVIVAL",
    icon: "S",
    title: "Hold Your Ground",
    description: "Remain continuously active in Hollow Valley for 1 hour."
  },
  "daily-total-3h": {
    category: "ACTIVITY",
    icon: "A",
    title: "Roam the Valley",
    description: "Accumulate 3 verified hours in the server today."
  },
  "daily-total-6h": {
    category: "ENDURANCE",
    icon: "E",
    title: "Long Haul",
    description: "Accumulate 6 verified hours in the server today."
  },
  "weekly-total-12h": {
    category: "WEEKLY",
    icon: "W",
    title: "Valley Regular",
    description: "Accumulate 12 verified hours before the weekly reset."
  },
  "weekly-total-24h": {
    category: "VETERAN",
    icon: "V",
    title: "Valley Veteran",
    description: "Accumulate 24 verified hours before the weekly reset."
  },
  "weekly-total-36h": {
    category: "ENDURANCE",
    icon: "G",
    title: "Go Touch Grass",
    description: "Accumulate 36 verified hours before the weekly reset."
  },
  "weekly-total-72h": {
    category: "NO LIFE",
    icon: "?",
    title: "What Life?",
    description: "Accumulate 72 verified hours before the weekly reset."
  }
});

const EXPERIMENTAL_QUESTS = Object.freeze([
  {
    id: "combat-two-kills",
    icon: "K",
    category: "COMBAT",
    cadence: "DAILY",
    title: "Teeth First, Questions Later",
    description: "Score 2 confirmed player kills in one day.",
    target: "2 confirmed kills",
    tracker: "Combat feed",
    reward: "2,500 VC"
  },
  {
    id: "survival-no-death",
    icon: "N",
    category: "SURVIVAL",
    cadence: "DAILY",
    title: "Not Today, Extinction",
    description: "Stay alive for 2 hours without a recorded death.",
    target: "2h alive",
    tracker: "Presence + combat",
    reward: "+5% boost"
  },
  {
    id: "growth-25",
    icon: "G",
    category: "GROWTH",
    cadence: "DAILY",
    title: "Fresh Legs",
    description: "Grow a dinosaur from spawn to at least 25% growth.",
    target: "Reach 25%",
    tracker: "Character growth",
    reward: "1,500 VC"
  },
  {
    id: "growth-50",
    icon: "G",
    category: "GROWTH",
    cadence: "DAILY",
    title: "Awkward Teen Phase",
    description: "Reach at least 50% growth on an active dinosaur.",
    target: "Reach 50%",
    tracker: "Character growth",
    reward: "2,500 VC"
  },
  {
    id: "growth-75",
    icon: "G",
    category: "GROWTH",
    cadence: "WEEKLY",
    title: "Built Different",
    description: "Take a dinosaur to at least 75% growth.",
    target: "Reach 75%",
    tracker: "Character growth",
    reward: "4,000 VC"
  },
  {
    id: "growth-adult",
    icon: "A",
    category: "GROWTH",
    cadence: "WEEKLY",
    title: "Full Send Adult",
    description: "Reach full adult growth on any eligible dinosaur.",
    target: "Reach 100%",
    tracker: "Character growth",
    reward: "7,500 VC"
  },
  {
    id: "explore-three-regions",
    icon: "M",
    category: "EXPLORATION",
    cadence: "DAILY",
    title: "Map? What Map?",
    description: "Visit 3 different named regions of Gateway in one session.",
    target: "3 regions",
    tracker: "Map location",
    reward: "2,500 VC"
  },
  {
    id: "explore-distance",
    icon: "R",
    category: "EXPLORATION",
    cadence: "WEEKLY",
    title: "Scenic Route",
    description: "Cover a large amount of ground across Gateway during the week.",
    target: "Distance target TBD",
    tracker: "Map location",
    reward: "5,000 VC"
  },
  {
    id: "group-three",
    icon: "P",
    category: "SOCIAL",
    cadence: "DAILY",
    title: "Safety in Numbers",
    description: "Spend time grouped with at least 3 other players.",
    target: "30m grouped",
    tracker: "Group activity",
    reward: "2,500 VC"
  },
  {
    id: "group-hour",
    icon: "P",
    category: "SOCIAL",
    cadence: "WEEKLY",
    title: "Pack Tax",
    description: "Accumulate 2 hours of verified group play this week.",
    target: "2h grouped",
    tracker: "Group activity",
    reward: "5,000 VC"
  },
  {
    id: "nest-participate",
    icon: "E",
    category: "NESTING",
    cadence: "WEEKLY",
    title: "Eggcellent Decisions",
    description: "Successfully participate in a nesting or hatch cycle.",
    target: "1 successful nest",
    tracker: "Nesting event",
    reward: "5,000 VC"
  },
  {
    id: "small-carnivore",
    icon: "C",
    category: "SPECIES",
    cadence: "DAILY",
    title: "Tiny Terror",
    description: "Play an eligible small carnivore for 90 verified minutes.",
    target: "90m eligible species",
    tracker: "Species presence",
    reward: "2,500 VC"
  },
  {
    id: "herbivore-time",
    icon: "H",
    category: "SPECIES",
    cadence: "DAILY",
    title: "Salad Enthusiast",
    description: "Play an eligible herbivore for 90 verified minutes.",
    target: "90m herbivore",
    tracker: "Species presence",
    reward: "2,500 VC"
  },
  {
    id: "species-variety",
    icon: "V",
    category: "SPECIES",
    cadence: "WEEKLY",
    title: "Menu Variety",
    description: "Record meaningful playtime on 3 different species this week.",
    target: "3 species",
    tracker: "Species presence",
    reward: "5,000 VC"
  },
  {
    id: "event-attendance",
    icon: "E",
    category: "EVENT",
    cadence: "WEEKLY",
    title: "Actually Showed Up",
    description: "Attend a Hollow Valley event and have attendance confirmed by an admin.",
    target: "1 confirmed event",
    tracker: "Event attendance",
    reward: "5,000 VC"
  },
  {
    id: "event-winner",
    icon: "W",
    category: "EVENT",
    cadence: "WEEKLY",
    title: "Main Character Energy",
    description: "Earn a winner or bonus payout during an official Hollow Valley event.",
    target: "1 event bonus",
    tracker: "Event rewards",
    reward: "Bonus + quest reward"
  },
  {
    id: "combat-revenge",
    icon: "R",
    category: "COMBAT",
    cadence: "WEEKLY",
    title: "Return to Sender",
    description: "Record 5 confirmed player kills during the weekly rotation.",
    target: "5 confirmed kills",
    tracker: "Combat feed",
    reward: "7,500 VC"
  },
  {
    id: "survival-lucky",
    icon: "L",
    category: "SURVIVAL",
    cadence: "DAILY",
    title: "Lucky Escape",
    description: "Survive a long session after dropping below a low-health threshold.",
    target: "Survive after critical health",
    tracker: "Character health",
    reward: "3,000 VC"
  }
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
  const status = quest.completed ? "COMPLETE" : `${percent}%`;
  const remaining = Math.max(0, threshold - progress);

  return `<article class="quest-card ${quest.completed ? "completed" : ""}" data-quest-id="${escapeHtml(quest.id)}">
    <div class="quest-card-top">
      <div class="quest-card-icon">${escapeHtml(meta.icon)}</div>
      <div class="quest-card-heading">
        <div class="quest-card-tags">
          <span>${escapeHtml(meta.category)}</span>
          <em>${cadence}</em>
        </div>
        <h3>${escapeHtml(meta.title)}</h3>
      </div>
      <div class="quest-card-status ${quest.completed ? "complete" : ""}">${quest.completed ? "✓" : status}</div>
    </div>

    <p class="quest-card-description">${escapeHtml(meta.description)}</p>

    <div class="quest-card-progress-row">
      <strong>${formatDuration(progress)} <span>/ ${formatDuration(threshold)}</span></strong>
      <small>${quest.completed ? "Objective completed" : `${formatDuration(remaining)} remaining`}</small>
    </div>

    <div class="quest-progress-track quest-card-track"><i style="width:${percent}%"></i></div>

    <div class="quest-card-footer">
      <div class="quest-reward-block">
        <span class="quest-coin-icon">V</span>
        <div>
          <small>REWARD</small>
          <strong>+${Number(quest.boostPercent || 0)}% COIN BOOST</strong>
        </div>
      </div>
      <span class="quest-auto-label">${quest.completed ? "REWARD ACTIVE" : "AUTO TRACKED"}</span>
    </div>
  </article>`;
}

function questSection(title, subtitle, quests) {
  return `<section class="quest-group">
    <div class="quest-group-heading">
      <div>
        <span>${escapeHtml(title)}</span>
        <small>${escapeHtml(subtitle)}</small>
      </div>
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

function experimentalRotation(count = 8) {
  const seed = brisbaneDateKey();
  return [...EXPERIMENTAL_QUESTS]
    .sort((a, b) => seededScore(a.id, seed) - seededScore(b.id, seed))
    .slice(0, count);
}

function experimentalCard(quest) {
  return `<article class="quest-card quest-concept-card" data-concept-id="${escapeHtml(quest.id)}">
    <div class="quest-card-top">
      <div class="quest-card-icon">${escapeHtml(quest.icon)}</div>
      <div class="quest-card-heading">
        <div class="quest-card-tags">
          <span>${escapeHtml(quest.category)}</span>
          <em>${escapeHtml(quest.cadence)}</em>
        </div>
        <h3>${escapeHtml(quest.title)}</h3>
      </div>
      <div class="quest-concept-badge">APPROVED</div>
    </div>

    <p class="quest-card-description">${escapeHtml(quest.description)}</p>

    <div class="quest-concept-target">
      <small>OBJECTIVE</small>
      <strong>${escapeHtml(quest.target)}</strong>
    </div>

    <div class="quest-card-footer">
      <div class="quest-reward-block">
        <span class="quest-coin-icon">V</span>
        <div>
          <small>PROPOSED REWARD</small>
          <strong>${escapeHtml(quest.reward)}</strong>
        </div>
      </div>
      <span class="quest-concept-tracker">${escapeHtml(quest.tracker)}</span>
    </div>
  </article>`;
}

function experimentalSection() {
  const rotation = experimentalRotation(8);
  return `<section class="quest-group quest-experimental-group">
    <div class="quest-group-heading">
      <div>
        <span>APPROVED CHALLENGE POOL</span>
        <small>Daily rotation from the approved Hollow Valley quest pool · tracker rollout staged</small>
      </div>
      <b>ROTATES DAILY</b>
    </div>
    <div class="quest-experimental-banner">
      <strong>APPROVED QUEST POOL</strong>
      <span>These challenge concepts are approved for Hollow Valley. They remain outside your active boost until each required tracker is connected and validated.</span>
    </div>
    <div class="quest-card-grid">
      ${rotation.map(experimentalCard).join("")}
    </div>
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
    const completed = quests.filter((quest) => quest.completed).length;

    document.getElementById("quest-active-boost").textContent = `+${Number(result.activeBoostPercent || 0)}%`;
    document.getElementById("quest-completed-count").textContent = `${completed} / ${quests.length}`;

    const intro = document.querySelector(".quest-section-intro");
    if (intro) {
      intro.textContent = result.trackingEnabled
        ? "Progress updates automatically from verified Hollow Valley server activity."
        : "Quest tracking is currently staged until verified presence sampling is enabled.";
    }

    const daily = quests.filter((quest) => quest.cadence === "daily");
    const weekly = quests.filter((quest) => quest.cadence === "weekly");

    listEl.innerHTML = [
      questSection("DAILY QUESTS", "Resets every Brisbane day", daily),
      questSection("WEEKLY QUESTS", "Resets Monday at 00:00 Brisbane time", weekly),
      experimentalSection()
    ].join("");
  } catch (error) {
    listEl.innerHTML = `<div class="empty-roster"><strong>Could not load quests</strong><span>${escapeHtml(error.message || "Quest data unavailable.")}</span></div>`;
  }
}

loadQuests();
