const { api, escapeHtml } = window.HDS;

let data = { mostKills: [], bestKd: [], mostPlaytime: [] };
let activeTab = "mostKills";

const labels = { mostKills: "Kills", bestKd: "K:D", mostPlaytime: "Minutes played" };

function render() {
  const body = document.getElementById("lb-body");
  document.getElementById("lb-metric-label").textContent = labels[activeTab];
  const rows = data[activeTab] || [];
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="3">No ranked players yet — stats populate once the server reports match data.</td></tr>`;
    return;
  }
  body.innerHTML = rows
    .map((row, i) => {
      const value = activeTab === "mostKills" ? row.kills : activeTab === "bestKd" ? row.kd : row.playtime_minutes;
      return `<tr><td>${i + 1}</td><td>${escapeHtml(row.username)}</td><td>${value}</td></tr>`;
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
    data = await api("/api/leaderboards");
  } catch (err) {
    console.error("Failed to load leaderboards", err);
  }
  render();
}

init();
