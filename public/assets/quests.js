const { api, escapeHtml } = window.HDS;

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${total}s`;
}

function questCard(quest) {
  const threshold = Math.max(1, Number(quest.thresholdSeconds) || 1);
  const progress = Math.max(0, Math.min(threshold, Number(quest.progressSeconds) || 0));
  const percent = Math.round((progress / threshold) * 100);
  const cadence = quest.cadence === "weekly" ? "WEEKLY" : "DAILY";
  const status = quest.completed ? "COMPLETE" : `${percent}%`;

  return `<div class="quest-row quest-progress-row ${quest.completed ? "completed" : ""}" data-quest-id="${escapeHtml(quest.id)}">
    <div class="quest-copy">
      <div class="quest-title-line"><strong>${escapeHtml(quest.title)}</strong><em>${cadence}</em></div>
      <span>${escapeHtml(quest.description)}</span>
      <div class="quest-progress-track"><i style="width:${percent}%"></i></div>
      <small>${formatDuration(progress)} / ${formatDuration(threshold)}</small>
    </div>
    <div class="quest-boost">+${Number(quest.boostPercent || 0)}%</div>
    <div class="quest-status ${quest.completed ? "complete" : ""}">${status}</div>
  </div>`;
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
    document.getElementById("quest-active-boost").textContent = `+${Number(result.activeBoostPercent || 0)}%`;

    const intro = document.querySelector(".quest-section-intro");
    if (intro) {
      intro.textContent = result.trackingEnabled
        ? "Verified online time completes these automatically. No manual claiming."
        : "Quest tracking is currently staged until verified presence sampling is enabled.";
    }

    const daily = quests.filter((quest) => quest.cadence === "daily");
    const weekly = quests.filter((quest) => quest.cadence === "weekly");

    listEl.innerHTML = `
      <div class="quest-group">
        <div class="list-heading"><span>DAILY ACTIVITY</span><small>Resets each Brisbane day</small></div>
        ${daily.length ? daily.map(questCard).join("") : '<p class="section-intro">No daily quests available.</p>'}
      </div>
      <div class="quest-group">
        <div class="list-heading"><span>WEEKLY ACTIVITY</span><small>Resets Monday</small></div>
        ${weekly.length ? weekly.map(questCard).join("") : '<p class="section-intro">No weekly quests available.</p>'}
      </div>`;
  } catch (error) {
    listEl.innerHTML = `<div class="empty-roster"><strong>Could not load quests</strong><span>${escapeHtml(error.message || "Quest data unavailable.")}</span></div>`;
  }
}

loadQuests();
