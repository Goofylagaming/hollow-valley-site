const { api, escapeHtml } = window.HDS;

const RANKS = [
  [1, "Hypsilophodon"],
  [5, "Dryosaurus"],
  [10, "Beipiaosaurus"],
  [15, "Troodon"],
  [20, "Gallimimus"],
  [25, "Pachycephalosaurus"],
  [30, "Dilophosaurus"],
  [35, "Omniraptor"],
  [40, "Ceratosaurus"],
  [45, "Maiasaura"],
  [50, "Stegosaurus"],
  [60, "Deinosuchus"],
  [70, "Carnotaurus"],
  [80, "Triceratops"],
  [90, "Tyrannosaurus"],
  [100, "Hollow Valley Apex"],
];

function number(value) {
  return Number(value || 0).toLocaleString();
}

function playtime(minutes) {
  const total = Math.max(0, Number(minutes || 0));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function renderRanks(profile) {
  const currentLevel = Number(profile.level || 1);
  const currentRank = profile.rank?.name || "";
  document.getElementById("profile-rank-ladder").innerHTML = RANKS.map(([level, name]) => {
    const reached = currentLevel >= level;
    const current = name === currentRank;
    return `<div class="profile-rank-step ${reached ? "reached" : ""} ${current ? "current" : ""}">
      <span>LV ${level}</span>
      <b>${escapeHtml(name)}</b>
      <small>${current ? "CURRENT" : reached ? "UNLOCKED" : "LOCKED"}</small>
    </div>`;
  }).join("");
}

function renderAchievements(profile) {
  const target = document.getElementById("profile-achievements");
  const achievements = Array.isArray(profile.achievements) ? profile.achievements : [];
  if (!achievements.length) {
    target.innerHTML = `<div class="profile-empty">No achievements unlocked yet. Keep playing, completing quests and attending events.</div>`;
    return;
  }
  target.innerHTML = achievements.map((achievement) => `
    <article class="profile-achievement">
      <span>🏆</span>
      <div>
        <b>${escapeHtml(achievement.title || achievement.id)}</b>
        <p>${escapeHtml(achievement.description || "")}</p>
        <small>${achievement.unlockedAt ? new Date(achievement.unlockedAt).toLocaleString() : "Unlocked"}</small>
      </div>
    </article>
  `).join("");
}

function render(profile) {
  document.getElementById("profile-level").textContent = `LEVEL ${number(profile.level)}`;
  document.getElementById("profile-rank").textContent = profile.rank?.name || "Hypsilophodon";
  document.getElementById("profile-xp-fill").style.width = `${Math.max(0, Math.min(100, Number(profile.progressPercent || 0)))}%`;
  document.getElementById("profile-xp").textContent = `${number(profile.xp)} XP total`;
  document.getElementById("profile-xp-next").textContent = profile.xpForNextLevel
    ? `${number(profile.xpNeededForNextLevel)} XP to level ${Number(profile.level || 1) + 1}`
    : "Maximum tracked level reached";
  document.getElementById("profile-vc-reward").textContent = `+${number(profile.levelRewardVc || 100)} VC`;
  document.getElementById("profile-achievement-count").textContent = number(profile.achievementCount);
  document.getElementById("profile-playtime").textContent = playtime(profile.verifiedPlaytimeMinutes);
  document.getElementById("profile-quests").textContent = number(profile.questsCompleted);
  document.getElementById("profile-events").textContent = number(profile.eventsAttended);
  document.getElementById("profile-next-rank").textContent = profile.nextRank
    ? `${profile.nextRank.name} · Lv ${profile.nextRank.level}`
    : "Apex unlocked";
  renderRanks(profile);
  renderAchievements(profile);
}

async function init() {
  const me = await window.HDS.loadMe();
  const guard = document.getElementById("profile-guard");
  const content = document.getElementById("profile-content");

  if (!me.loggedIn || !me.user?.steam_id) {
    guard.hidden = false;
    content.hidden = true;
    return;
  }

  guard.hidden = true;
  content.hidden = false;
  try {
    const payload = await api("/api/progression");
    render(payload.profile || {});
  } catch (error) {
    content.innerHTML = `<p class="section-intro">Progression is temporarily unavailable: ${escapeHtml(error.message)}</p>`;
  }
}

init();
