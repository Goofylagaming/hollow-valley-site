const { api, escapeHtml } = window.HDS;

let data = { mostKills: [], bestKd: [], mostPlaytime: [] };
let activeTab = "mostKills";

const labels = { mostKills: "Kills", bestKd: "K:D", mostPlaytime: "Verified minutes · 31 days" };

function render() {
  const body = document.getElementById("lb-body");
  document.getElementById("lb-metric-label").textContent = labels[activeTab];
  const rows = data[activeTab] || [];
  if (!rows.length) {
    const message = activeTab === "mostPlaytime"
      ? (data.playtimeTrackingEnabled === false
          ? "Verified playtime tracking is currently unavailable."
          : "No verified playtime has been recorded in this 31-day window.")
      : (data.combatFeedEnabled
          ? "No verified combat events have been recorded in this 31-day window."
          : "Combat ranking unavailable — waiting for an authoritative kill/death feed.");
    body.innerHTML = `<tr><td colspan="3">${message}</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((row, i) => {
      const value = activeTab === "mostKills"
        ? row.kills
        : activeTab === "bestKd"
          ? row.kd
          : Number(row.playtime_minutes || 0).toLocaleString();
      return `<tr><td>${i + 1}</td><td>${escapeHtml(row.username || "Unknown")}</td><td>${value}</td></tr>`;
    })
    .join("");
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
  const tabMap = { kills: "mostKills", kd: "bestKd", playtime: "mostPlaytime" };
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
