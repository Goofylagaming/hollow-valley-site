const { api, escapeHtml } = window.HDS;

let data = {
  dailyKills: [],
  dailyKd: [],
  weeklyKills: [],
  weeklyKd: [],
  mostPlaytime: [],
  mostLevels: [],
};
let activeTab = "mostKills";

function combatEmptyMessage() {
  return data.combatFeedEnabled
    ? "No verified combat events have been recorded in this period yet."
    : "Combat ranking unavailable — waiting for the authoritative kill/death feed.";
}

function combatTable(title, rows, metric, note = "") {
  const body = !rows.length
    ? `<tr><td colspan="5">${combatEmptyMessage()}</td></tr>`
    : rows.map((row, i) => {
        const value = metric === "kills" ? row.kills : Number(row.kd || 0).toFixed(2);
        return `<tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(row.username || "Unknown")}</td>
          <td>${Number(row.kills || 0).toLocaleString()}</td>
          <td>${Number(row.deaths || 0).toLocaleString()}</td>
          <td>${value}</td>
        </tr>`;
      }).join("");

  return `<section class="leaderboard-period">
    <div class="leaderboard-period-heading">
      <h2>${title}</h2>
      ${note ? `<p>${escapeHtml(note)}</p>` : ""}
    </div>
    <table class="leaderboard-table">
      <thead><tr><th>#</th><th>Player</th><th>Kills</th><th>Deaths</th><th>${metric === "kills" ? "Total Kills" : "K:D"}</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </section>`;
}

function renderCombat() {
  const container = document.getElementById("lb-content");
  if (activeTab === "mostKills") {
    container.innerHTML =
      combatTable("Daily Kills", data.dailyKills || [], "kills", "Resets at midnight Brisbane time · 500 VC prize") +
      combatTable("Weekly Total Kills", data.weeklyKills || [], "kills", "Monday–Sunday Brisbane time · 2,500 VC prize");
    return;
  }

  container.innerHTML =
    combatTable(
      "Daily K:D Ratio",
      data.dailyKd || [],
      "kd",
      `Minimum ${Number(data.dailyKdMinKills || 3)} kills to qualify · 500 VC prize`
    ) +
    combatTable(
      "Weekly K:D Ratio",
      data.weeklyKd || [],
      "kd",
      `Minimum ${Number(data.weeklyKdMinKills || 10)} kills to qualify · 2,500 VC prize`
    );
}

function renderSimple() {
  const container = document.getElementById("lb-content");
  const rows = activeTab === "mostLevels" ? (data.mostLevels || []) : (data.mostPlaytime || []);
  const label = activeTab === "mostLevels" ? "Level · XP" : "Verified minutes · 31 days";
  const empty = activeTab === "mostLevels"
    ? "No permanent progression has been recorded yet."
    : (data.playtimeTrackingEnabled === false
        ? "Verified playtime tracking is currently unavailable."
        : "No verified playtime has been recorded in this 31-day window.");

  const body = !rows.length
    ? `<tr><td colspan="3">${empty}</td></tr>`
    : rows.map((row, i) => {
        const value = activeTab === "mostLevels"
          ? `Lv ${Number(row.level || 1).toLocaleString()} · ${Number(row.xp || 0).toLocaleString()} XP · ${escapeHtml(row.rank?.name || "Hollow Valley")}`
          : Number(row.playtime_minutes || 0).toLocaleString();
        return `<tr><td>${i + 1}</td><td>${escapeHtml(row.username || "Unknown")}</td><td>${value}</td></tr>`;
      }).join("");

  container.innerHTML = `<table class="leaderboard-table">
    <thead><tr><th>#</th><th>Player</th><th>${label}</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function render() {
  if (activeTab === "mostKills" || activeTab === "bestKd") renderCombat();
  else renderSimple();
}

document.querySelectorAll(".filter").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach((t) => t.classList.toggle("active", t === tab));
    activeTab = tab.dataset.tab;
    render();
  });
});

function applyTabFromQuery() {
  const tab = new URLSearchParams(window.location.search).get("tab");
  const tabMap = { levels: "mostLevels", kills: "mostKills", kd: "bestKd", playtime: "mostPlaytime" };
  if (tab && tabMap[tab]) {
    activeTab = tabMap[tab];
    document.querySelectorAll(".filter").forEach((t) => t.classList.toggle("active", t.dataset.tab === activeTab));
  }
}

async function init() {
  applyTabFromQuery();
  try {
    data = { ...data, ...(await api("/api/leaderboards")) };
  } catch (err) {
    console.error("Failed to load leaderboards", err);
  }
  render();
}

init();
