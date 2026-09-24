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
  }
});

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
      questSection("WEEKLY QUESTS", "Resets Monday at 00:00 Brisbane time", weekly)
    ].join("");
  } catch (error) {
    listEl.innerHTML = `<div class="empty-roster"><strong>Could not load quests</strong><span>${escapeHtml(error.message || "Quest data unavailable.")}</span></div>`;
  }
}

loadQuests();
