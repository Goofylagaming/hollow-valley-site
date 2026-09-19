const { api, escapeHtml } = window.HDS;

// ---------- Section reveal helpers (wired once the shared nav has loaded) ----------
function revealSection(section) {
  if (!section) return;
  section.hidden = false;
  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

document.addEventListener("hds:nav-ready", () => {
  const walletSection = document.getElementById("wallet");
  document.querySelectorAll('a[href="/#wallet"], a[href="#wallet"]').forEach((link) => {
    link.addEventListener("click", (event) => {
      if (link.getAttribute("href").startsWith("/#") && window.location.pathname !== "/") return;
      event.preventDefault();
      revealSection(walletSection);
      loadWallet();
      history.replaceState(null, "", "#wallet");
    });
  });

  const questsSection = document.getElementById("quests");
  document.querySelectorAll(".quests-nav-link").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (window.location.pathname !== "/") return;
      event.preventDefault();
      revealSection(questsSection);
      loadQuests();
      history.replaceState(null, "", "#quests");
    });
  });

  const speciesSection = document.getElementById("species");
  document.querySelectorAll(".species-nav-link").forEach((link) => {
    link.addEventListener("click", (event) => {
      if (window.location.pathname !== "/") return;
      event.preventDefault();
      revealSection(speciesSection);
      const targetFilter = document.querySelector(`.filter[data-filter="${link.dataset.filter}"]`);
      targetFilter?.click();
      history.replaceState(null, "", "#species");
    });
  });

  // Deep-link support: opening index.html#wallet directly reveals that section.
  if (window.location.hash === "#wallet") {
    revealSection(walletSection);
    loadWallet();
  } else if (window.location.hash === "#quests") {
    revealSection(questsSection);
    loadQuests();
  } else if (window.location.hash === "#species") {
    revealSection(speciesSection);
  }
});

// ---------- Species ----------
let dinoDialogWired = false;

function wireDinoDialog() {
  const dinoDialog = document.querySelector(".dino-dialog");
  if (!dinoDialog) return;
  const dialogTitle = dinoDialog.querySelector("#dialog-title");
  const dialogRole = dinoDialog.querySelector(".dialog-role");
  const dialogDescription = dinoDialog.querySelector(".dialog-description");
  const dialogStatus = dinoDialog.querySelector(".dialog-status");
  const dialogSocial = dinoDialog.querySelector(".dialog-social strong");
  const statPack = dinoDialog.querySelector(".stat-pack");
  const statWeight = dinoDialog.querySelector(".stat-weight");
  const statBite = dinoDialog.querySelector(".stat-bite");
  const statGrowth = dinoDialog.querySelector(".stat-growth");

  document.querySelectorAll(".dino-card").forEach((card) => {
    card.tabIndex = 0;
    const openDetails = () => {
      dialogTitle.textContent = card.dataset.dino;
      dialogRole.textContent = card.dataset.role;
      dialogDescription.textContent = card.dataset.description;
      dialogSocial.textContent = card.dataset.social;
      if (statPack) statPack.textContent = card.dataset.packLimit || "TBD in Evrima";
      if (statWeight) statWeight.textContent = card.dataset.peakWeight ? `${card.dataset.peakWeight}%` : "TBD in Evrima";
      if (statBite) statBite.textContent = card.dataset.biteForce || "Not yet documented";
      if (statGrowth) statGrowth.textContent = card.dataset.growthTime || "Not yet documented";
      if (dialogStatus) dialogStatus.hidden = card.dataset.released !== "false";
      dinoDialog.showModal();
    };
    card.addEventListener("click", openDetails);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetails();
      }
    });
  });

  if (!dinoDialogWired) {
    dinoDialog.querySelector(".dialog-close")?.addEventListener("click", () => dinoDialog.close());
    dinoDialog.addEventListener("click", (event) => {
      if (event.target === dinoDialog) dinoDialog.close();
    });
    dinoDialogWired = true;
  }
}

function wireSpeciesFilters() {
  const filters = document.querySelectorAll(".filter");
  filters.forEach((filter) => {
    filter.addEventListener("click", () => {
      const category = filter.dataset.filter;
      filters.forEach((button) => button.classList.toggle("active", button === filter));
      document.querySelectorAll(".dino-card").forEach((card) => {
        card.hidden = category !== "all" && card.dataset.category !== category;
      });
    });
  });
}

function renderSpecies(list) {
  const grid = document.getElementById("dino-grid");
  const count = document.getElementById("roster-count");
  if (count) count.textContent = `${list.length} / LIVE EVRIMA ROSTER`;
  if (!grid) return;
  if (!list.length) {
    grid.innerHTML = '<p class="section-intro">No species data available.</p>';
    return;
  }
  grid.innerHTML = list
    .map((dino) => {
      const featuredClass = dino.featured ? " featured" : "";
      return `<article class="dino-card${featuredClass}" data-category="${dino.category}" data-dino="${escapeHtml(dino.name)}" data-role="${escapeHtml(dino.role)}" data-description="${escapeHtml(dino.description)}" data-social="${escapeHtml(dino.social)}" data-pack-limit="${escapeHtml(String(dino.packLimit ?? ""))}" data-peak-weight="${escapeHtml(String(dino.peakWeightPercent ?? ""))}" data-bite-force="${escapeHtml(dino.biteForce || "")}" data-growth-time="${escapeHtml(dino.growthTime || "")}" data-released="${dino.releasedInEvrima === false ? "false" : "true"}"
        <div class="dino-art ${dino.art}"><span>${dino.name.toUpperCase()}</span></div>
        <div class="dino-info"><div><small>${dino.role.toUpperCase()}</small><h3>${escapeHtml(dino.name)}</h3></div><b class="dino-arrow">↗</b></div>
        <div class="meter"><span style="width:${dino.threatPercent}%"></span></div>
        <div class="dino-meta"><span>Threat <i>${dino.threatDots}</i></span><span>${escapeHtml(dino.social)}</span></div>
      </article>`;
    })
    .join("");
  wireSpeciesFilters();
  wireDinoDialog();
}

async function loadSpecies() {
  try {
    const list = await api("/api/species");
    renderSpecies(list);
  } catch (err) {
    console.error("Failed to load species", err);
    const grid = document.getElementById("dino-grid");
    if (grid) grid.innerHTML = '<p class="section-intro">Could not load species data. Try again shortly.</p>';
  }
}

// ---------- Wallet ----------
function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${total}s`;
}

function walletActivityDetail(transaction) {
  const kind = String(transaction?.kind || "");
  const metadata = transaction?.metadata || {};
  if (kind === "playtime_reward") {
    const base = Number(metadata.baseCoins);
    const quest = Number(metadata.questBoostPercent || metadata.boostPercent || 0);
    const multiplier = Number(metadata.supporterMultiplier || 1);
    const parts = [];
    if (Number.isFinite(base)) parts.push(`${base.toLocaleString()} base`);
    if (quest > 0) parts.push(`+${quest}% quest boost`);
    if (multiplier > 1) parts.push(`×${multiplier} supporter`);
    return parts.length ? parts.join(" · ") : transaction?.reason || "";
  }
  if (kind === "daily_login_bonus") {
    const base = Number(metadata.baseAmount);
    const multiplier = Number(metadata.supporterMultiplier || 1);
    const parts = [];
    if (Number.isFinite(base)) parts.push(`${base.toLocaleString()} base daily reward`);
    if (multiplier > 1) parts.push(`×${multiplier} supporter`);
    return parts.length ? parts.join(" · ") : transaction?.reason || "";
  }
  return transaction?.reason || "";
}

function walletActivityLabel(transaction) {
  const kind = String(transaction?.kind || "");
  if (kind === "playtime_reward") return "Playtime reward";
  if (kind === "daily_login_bonus") return "Daily login bonus";
  if (kind === "marketplace_purchase") return "Marketplace purchase";
  if (kind === "marketplace_refund") return "Marketplace refund";
  if (kind === "marketplace_p2p_hold") return "Dino purchase";
  if (kind === "marketplace_p2p_refund") return "Dino purchase refund";
  if (kind === "marketplace_p2p_sale") return "Dino sold";
  if (kind === "skin_preset_create") return "Skin preset";
  return transaction?.reason || "Valley Coin activity";
}

function renderDailyBonus(bonus) {
  const amountEl = document.getElementById("wallet-daily-amount");
  const statusEl = document.getElementById("wallet-daily-status");
  const claimButton = document.getElementById("wallet-daily-claim");
  if (!amountEl || !statusEl || !claimButton) return;

  const base = Number(bonus?.baseAmount ?? bonus?.amount ?? 0);
  const effective = Number(bonus?.effectiveAmount ?? base);
  const multiplier = Number(bonus?.supporterMultiplier || 1);

  amountEl.textContent = bonus?.enabled
    ? `${effective.toLocaleString()} Valley Coin`
    : "Not enabled";

  if (!bonus?.enabled) {
    statusEl.textContent = "Daily login rewards are currently disabled.";
  } else if (bonus?.claimed) {
    statusEl.textContent = "Claimed today. Come back after the daily reset.";
  } else if (multiplier > 1) {
    statusEl.textContent = `${base.toLocaleString()} base ×${multiplier} supporter multiplier.`;
  } else {
    statusEl.textContent = `${base.toLocaleString()} Valley Coin available today.`;
  }

  claimButton.disabled = !bonus?.claimable;
  claimButton.textContent = bonus?.claimed ? "Claimed ✓" : "Claim";
}

async function loadDailyBonus() {
  try {
    const bonus = await api("/api/daily-bonus");
    renderDailyBonus(bonus);
    return bonus;
  } catch (err) {
    const statusEl = document.getElementById("wallet-daily-status");
    if (statusEl) statusEl.textContent = err.message || "Could not load daily login bonus.";
    return null;
  }
}

let dailyBonusWired = false;
function wireDailyBonusClaim() {
  if (dailyBonusWired) return;
  const button = document.getElementById("wallet-daily-claim");
  if (!button) return;
  dailyBonusWired = true;
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Claiming…";
    try {
      await api("/api/daily-bonus/claim", { method: "POST" });
      await Promise.all([loadDailyBonus(), loadWallet({ skipDailyBonus: true })]);
    } catch (err) {
      const statusEl = document.getElementById("wallet-daily-status");
      if (statusEl) statusEl.textContent = err.message || "Could not claim daily login bonus.";
      button.disabled = false;
      button.textContent = "Claim";
    }
  });
}

async function loadWallet({ skipDailyBonus = false } = {}) {
  const balanceEl = document.getElementById("wallet-balance");
  const txEl = document.getElementById("wallet-transactions");
  if (!balanceEl || !txEl) return;

  const me = await window.HDS.loadMe();
  if (!me.loggedIn) {
    balanceEl.textContent = "0";
    txEl.innerHTML = `<div class="empty-roster"><strong>Login required</strong><span>Sign in with Steam to view your Valley Coin balance.</span></div>`;
    return;
  }

  try {
    const wallet = await api("/api/wallet");
    const earning = wallet.earning || {};
    balanceEl.textContent = Number(wallet.balance || 0).toLocaleString();
    wireDailyBonusClaim();
    if (!skipDailyBonus) loadDailyBonus();

    const baseRate = document.getElementById("wallet-base-rate");
    const boost = document.getElementById("wallet-active-boost");
    const payout = document.getElementById("wallet-current-payout");
    const supporterMultiplier = document.getElementById("wallet-supporter-multiplier");
    const supporterTier = document.getElementById("wallet-supporter-tier");
    const progress = document.getElementById("wallet-progress-fill");
    const progressText = document.getElementById("wallet-progress-text");
    const nextPayout = document.getElementById("wallet-next-payout");

    if (baseRate) baseRate.textContent = earning.configured
      ? `${Number(earning.coinsPer5Minutes || 0).toLocaleString()} / 5 min`
      : "Not enabled";
    if (boost) boost.textContent = `+${Number(earning.activeBoostPercent || 0)}%`;
    if (supporterMultiplier) supporterMultiplier.textContent = `×${Number(earning.supporterMultiplier || 1)}`;
    if (supporterTier) supporterTier.textContent = earning.supporterTier
      ? String(earning.supporterTier).replace(/^./, (value) => value.toUpperCase())
      : "No active tier";
    if (payout) payout.textContent = earning.configured
      ? `${Number(earning.boostedCoinsPer5Minutes || earning.coinsPer5Minutes || 0).toLocaleString()} / 5 min`
      : "—";

    const intervalSeconds = Math.max(1, Number(earning.intervalSeconds || 300));
    const accruedSeconds = Math.max(0, Math.min(intervalSeconds, Number(earning.accruedSeconds || 0)));
    const percent = Math.round((accruedSeconds / intervalSeconds) * 100);
    if (progress) progress.style.width = `${percent}%`;
    if (progressText) progressText.textContent = earning.configured
      ? `${formatDuration(accruedSeconds)} / 5m verified`
      : "Playtime rewards are staged but currently disabled";
    if (nextPayout) nextPayout.textContent = earning.configured && earning.nextRewardInSeconds !== null
      ? `Next payout in ${formatDuration(earning.nextRewardInSeconds)}`
      : "Base earning rate has not been enabled yet";

    if (!wallet.transactions?.length) {
      txEl.innerHTML = `<div class="empty-roster"><strong>No transactions yet</strong><span>Your Valley Coin earnings and spending will appear here.</span></div>`;
    } else {
      txEl.innerHTML = wallet.transactions.map((transaction) => {
        const amount = Number(transaction.amount) || 0;
        const when = transaction.created_at ? new Date(transaction.created_at).toLocaleString() : "";
        return `<div class="activity-row">
          <span><strong>${escapeHtml(walletActivityLabel(transaction))}</strong><small>${escapeHtml(walletActivityDetail(transaction))}</small></span>
          <b>${amount > 0 ? "+" : ""}${amount.toLocaleString()}</b>
          <small>${escapeHtml(when)}</small>
        </div>`;
      }).join("");
    }
  } catch (err) {
    console.error("Failed to load wallet", err);
    txEl.innerHTML = `<div class="empty-roster"><strong>Could not load wallet</strong><span>${escapeHtml(err.message)}</span></div>`;
  }
}

// ---------- Quests ----------
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
  const listEl = document.getElementById("quest-list");
  if (!listEl) return;

  const me = await window.HDS.loadMe();
  if (!me.loggedIn) {
    listEl.innerHTML = `<p class="section-intro">Sign in with Steam to view your verified playtime quests.</p>`;
    return;
  }

  try {
    const result = await api("/api/quests");
    const quests = Array.isArray(result.quests) ? result.quests : [];
    const summary = document.getElementById("quest-active-boost");
    if (summary) summary.textContent = `+${Number(result.activeBoostPercent || 0)}%`;
    const intro = document.querySelector(".quest-section-intro");
    if (intro) {
      intro.textContent = result.trackingEnabled
        ? "Verified online time completes these automatically. No manual claiming."
        : "Playtime quest tracking is staged but currently disabled until presence sampling is enabled.";
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
      </div>
    `;
  } catch (err) {
    console.error("Failed to load quests", err);
    listEl.innerHTML = `<p class="section-intro">Could not load quests. Try again shortly.</p>`;
  }
}

// ---------- Roster & Map preview on the homepage ----------
async function loadRoster() {
  const rosterEl = document.getElementById("roster-empty-state");
  if (!rosterEl) return;
  const me = await window.HDS.loadMe();
  if (me.loggedIn && me.user) {
    const heroHeading = document.getElementById("hero-heading");
    if (heroHeading) {
      heroHeading.innerHTML = `Welcome back,<br><span>${escapeHtml(me.user.username)}.</span>`;
    }
  }
  if (!me.loggedIn) return;
  try {
    const roster = await api("/api/roster");
    if (roster && roster.length) {
      rosterEl.outerHTML = roster
        .map(
          (r) =>
            `<div class="activity-row"><span>${escapeHtml(r.nickname || r.species_id)}</span><b>${r.status || "Alive"}</b></div>`
        )
        .join("");
    }
  } catch (err) {
    console.error("Failed to load roster", err);
  }
}

async function loadMapPositions() {
  const contactsEl = document.getElementById("map-contacts");
  if (!contactsEl) return;
  try {
    const status = await api("/api/server-status");
    if (status.configured && status.online) {
      contactsEl.textContent = `${status.playerCount}/${status.maxPlayers} players online in the valley`;
    } else {
      contactsEl.textContent = "Live map offline — server not connected yet";
    }
  } catch (err) {
    console.error("Failed to load map contacts", err);
  }
}

// ---------- Init ----------
loadSpecies();
loadRoster();
loadMapPositions();
