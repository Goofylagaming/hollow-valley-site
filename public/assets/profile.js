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

function renderIdentity(me, profile = {}) {
  const user = me.user || {};
  const username = user.username || profile.username || "Hollow Valley Player";
  const avatar = String(user.avatar || "").trim();
  const steamId = String(user.steam_id || profile.steamId || "");

  document.getElementById("profile-username").textContent = username;
  document.getElementById("profile-steam-id").textContent = steamId || "Unavailable";
  document.getElementById("profile-steam-detail").textContent = steamId
    ? `Steam ${steamId} is the identity used for progression, rewards and My Dinos.`
    : "No Steam identity is linked.";

  const avatarEl = document.getElementById("profile-avatar");
  const fallbackEl = document.getElementById("profile-avatar-fallback");
  if (avatar) {
    avatarEl.src = avatar;
    avatarEl.alt = `${username} Steam avatar`;
    avatarEl.hidden = false;
    fallbackEl.hidden = true;
  } else {
    avatarEl.hidden = true;
    fallbackEl.hidden = false;
    fallbackEl.textContent = username.trim().slice(0, 2).toUpperCase() || "HV";
  }

  const discordLinked = Boolean(user.discord_id);
  const discordConfigured = Boolean(me.discordLoginConfigured);
  const discordBadge = document.getElementById("profile-discord-badge");
  const discordStatus = document.getElementById("profile-discord-status");
  const discordDetail = document.getElementById("profile-discord-detail");
  const discordAction = document.getElementById("profile-discord-action");

  discordBadge.textContent = discordLinked ? "DISCORD LINKED" : "DISCORD NOT LINKED";
  discordBadge.classList.toggle("good", discordLinked);
  discordStatus.textContent = discordLinked ? "Linked" : discordConfigured ? "Not linked" : "Unavailable";
  discordDetail.textContent = discordLinked
    ? "Discord is connected for supporter roles and linked community features."
    : discordConfigured
      ? "Link Discord to enable supporter role sync and connected community features."
      : "Discord OAuth is not configured on the website.";

  if (discordLinked || !discordConfigured) {
    discordAction.hidden = true;
  } else {
    discordAction.hidden = false;
    discordAction.href = "/auth/discord";
  }
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
        ${achievement.verificationStatus === 'under-review' ? '<p role="status">Awaiting evidence review</p>' : ''}
        ${achievement.verificationStatus === 'withdrawn' ? '<p role="status">Withdrawn after evidence review</p>' : ''}
        <small>${achievement.unlockedAt ? new Date(achievement.unlockedAt).toLocaleString() : "Unlocked"}</small>
      </div>
    </article>
  `).join("");
}

function renderTitles(result) {
  const select = document.getElementById('profile-title-choice');
  select.replaceChildren(new Option('No title', ''));
  for (const title of result.titles) {
    if (title.unlocked) select.add(new Option(title.name, title.id));
  }
  select.value = result.selectedTitleId || '';
  const chosen = result.titles.find(title => title.id === result.selectedTitleId);
  document.getElementById('profile-title-current').textContent = chosen ? chosen.name : 'No title selected';
  document.getElementById('profile-title-catalog').innerHTML = result.titles.map(title =>
    `<article class="profile-achievement"><div><b>${escapeHtml(title.name)}</b><p>${escapeHtml(title.requirement)}</p><small>${title.unlocked ? 'UNLOCKED' : 'LOCKED'}</small></div></article>`).join('');
  select.disabled = false;
  document.getElementById('profile-title-save').disabled = false;
}

async function loadTitles() {
  try { renderTitles(await api('/api/progression/titles')); }
  catch {
    document.getElementById('profile-title-current').textContent = 'Titles unavailable';
    document.getElementById('profile-title-status').textContent = 'Verified progression could not be loaded. Your saved title has not changed.';
  }
}

document.getElementById('profile-title-form')?.addEventListener('submit', async event => {
  event.preventDefault();
  const select = document.getElementById('profile-title-choice');
  const button = document.getElementById('profile-title-save');
  if (button.disabled) return;
  button.disabled = true;
  select.disabled = true;
  const status = document.getElementById('profile-title-status');
  status.textContent = 'Saving…';
  try {
    renderTitles(await api('/api/progression/titles', { method: 'POST', body: JSON.stringify({ titleId: select.value || null }) }));
    status.textContent = 'Title saved.';
  } catch (error) {
    status.textContent = error.message || 'Could not save your title.';
  } finally {
    button.disabled = false;
    select.disabled = false;
  }
});

function renderProgression(profile) {
  const rank = profile.rank?.name || "Hypsilophodon";
  const level = Number(profile.level || 1);

  document.getElementById("profile-level").textContent = `LEVEL ${number(level)}`;
  document.getElementById("profile-rank").textContent = rank;
  document.getElementById("profile-hero-rank").textContent = rank;
  document.getElementById("profile-hero-level").textContent = `Level ${number(level)}`;
  document.getElementById("profile-xp-fill").style.width = `${Math.max(0, Math.min(100, Number(profile.progressPercent || 0)))}%`;
  document.getElementById("profile-xp").textContent = `${number(profile.xp)} XP total`;
  document.getElementById("profile-xp-next").textContent = profile.xpForNextLevel
    ? `${number(profile.xpNeededForNextLevel)} XP to level ${level + 1}`
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

function renderWallet(wallet) {
  const target = document.getElementById("profile-wallet-balance");
  if (!wallet) {
    target.textContent = "Unavailable";
    return;
  }
  target.textContent = `${number(wallet.balance)} VC`;
}

function renderSupporter(status) {
  const label = status?.tierLabel || status?.tier || "None";
  const entitled = Boolean(status?.entitled);
  const multiplier = Number(status?.multiplier || 1);
  const badge = document.getElementById("profile-supporter-badge");

  document.getElementById("profile-supporter").textContent = label;
  document.getElementById("profile-supporter-detail").textContent = status?.tier
    ? `${entitled ? "Benefits active" : "Benefits inactive"} · ×${multiplier} eligible reward multiplier`
    : "No active Hollow Valley membership";

  badge.textContent = status?.tier ? String(label).toUpperCase() : "NO MEMBERSHIP";
  badge.classList.toggle("good", entitled);
}

function renderFriends(state) {
  const friends = Array.isArray(state?.friends) ? state.friends : [];
  const online = friends.filter((friend) => friend.online).length;
  document.getElementById("profile-friends-count").textContent = number(friends.length);
  document.getElementById("profile-friends-detail").textContent = `${online} online now`;
}

function renderUnavailable(id, detailId, label = "Unavailable") {
  const target = document.getElementById(id);
  if (target) target.textContent = label;
  if (detailId) {
    const detail = document.getElementById(detailId);
    if (detail) detail.textContent = "This profile source could not be loaded right now.";
  }
}

async function copySteamId() {
  const steamId = document.getElementById("profile-steam-id")?.textContent?.trim();
  if (!steamId || steamId === "Unavailable") return;
  const button = document.getElementById("profile-copy-steam");
  try {
    await navigator.clipboard.writeText(steamId);
    button.textContent = "COPIED";
    window.setTimeout(() => { button.textContent = "COPY"; }, 1400);
  } catch {
    button.textContent = "COPY FAILED";
    window.setTimeout(() => { button.textContent = "COPY"; }, 1600);
  }
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
  renderIdentity(me);
  const titlesLoaded = loadTitles();

  const [progressionResult, walletResult, supporterResult, friendsResult, rewardsResult] = await Promise.allSettled([
    api("/api/progression"),
    api("/api/wallet"),
    api("/api/supporter"),
    api("/api/friends"),
    api("/api/supporter/rewards"),
  ]);

  if (progressionResult.status === "fulfilled") {
    const profile = progressionResult.value?.profile || {};
    renderIdentity(me, profile);
    renderProgression(profile);
    if (progressionResult.value?.stale) {
      const notice = document.createElement('p');
      notice.className = 'profile-empty';
      notice.textContent = `Showing saved progression from ${progressionResult.value.capturedAt || 'the last successful update'}. Live updates are temporarily unavailable.`;
      document.querySelector('.profile-progression-panel')?.prepend(notice);
    }
  } else {
    document.querySelector(".profile-progression-panel").innerHTML =
      `<div class="empty-roster"><strong>Progression unavailable</strong><span>${escapeHtml(progressionResult.reason?.message || "Could not load progression.")}</span></div>`;
    document.getElementById("profile-rank-ladder").innerHTML =
      '<div class="profile-empty">Rank ladder unavailable while progression is offline.</div>';
    document.getElementById("profile-achievements").innerHTML =
      '<div class="profile-empty">Achievements unavailable while progression is offline.</div>';
  }

  if (walletResult.status === "fulfilled") renderWallet(walletResult.value);
  else renderUnavailable("profile-wallet-balance");

  if (supporterResult.status === "fulfilled") renderSupporter(supporterResult.value);
  else renderUnavailable("profile-supporter", "profile-supporter-detail");

  if (rewardsResult.status === "fulfilled") {
    window.HVMembership?.applyProfileAppearance(document, rewardsResult.value);
  }

  if (friendsResult.status === "fulfilled") renderFriends(friendsResult.value);
  else renderUnavailable("profile-friends-count", "profile-friends-detail");
  const card=document.getElementById("profile-collection-features");
  if(card){
    try {
      const response=await fetch("/api/supporter/rewards/collection");
      if(response.ok){
        const book=await response.json(),prefs=book.preferences;
        const owned=book.collectibles.filter(item=>item.earned_at);
        const labels=[["Favourite dinosaur",prefs.favourite_dinosaur],["Featured skin",prefs.featured_skin],
          ["Title",prefs.featured_title],["Achievement",book.achievementIds?.includes(prefs.featured_achievement)||owned.some(i=>i.slug===prefs.featured_achievement)?prefs.featured_achievement:null]];
        for(const [label,value] of labels.filter(pair=>pair[1])){
          const p=document.createElement("p");p.textContent=label+" · "+(owned.find(i=>i.slug===value)?.name||value);card.append(p);
        }
        const accent=owned.find(i=>i.slug===prefs.accent)?.colour,banner=owned.find(i=>i.slug===prefs.banner)?.colour;
        if(/^#[a-f0-9]{6}$/i.test(accent||""))card.parentElement.style.borderColor=accent;
        if(/^#[a-f0-9]{6}$/i.test(banner||""))card.parentElement.style.backgroundImage="linear-gradient(130deg,"+banner+"66,transparent)";
        card.hidden=!card.childElementCount;
      }
    }catch{ /* Other profile features remain available while the collection is offline. */ }
  }
  await titlesLoaded;
}

document.getElementById("profile-copy-steam")?.addEventListener("click", copySteamId);

init().catch((error) => {
  const content = document.getElementById("profile-content");
  if (content) {
    content.hidden = false;
    content.innerHTML = `<div class="empty-roster"><strong>Could not load My Profile</strong><span>${escapeHtml(error.message || "Profile unavailable.")}</span></div>`;
  }
});
