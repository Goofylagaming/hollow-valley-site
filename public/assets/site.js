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

  if (window.location.hash === "#wallet") {
    revealSection(walletSection);
    loadWallet();
  } else if (window.location.hash === "#quests") {
    revealSection(questsSection);
    loadQuests();
  }
});

// ---------- Wallet ----------
function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return `${hours}h ${minutes}m`;
  if (minutes) return `${minutes}m`;
  return `${total}s`;
}

function walletActivityLabel(transaction) {
  const kind = String(transaction?.kind || "");
  if (kind === "playtime_reward") return "Playtime reward";
  if (kind === "marketplace_purchase") return "Marketplace purchase";
  if (kind === "marketplace_refund") return "Marketplace refund";
  if (kind === "marketplace_p2p_hold") return "Dino purchase";
  if (kind === "marketplace_p2p_refund") return "Dino purchase refund";
  if (kind === "marketplace_p2p_sale") return "Dino sold";
  if (kind === "skin_preset_create") return "Skin preset";
  return transaction?.reason || "Valley Coin activity";
}

async function loadWallet() {
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

    const baseRate = document.getElementById("wallet-base-rate");
    const boost = document.getElementById("wallet-active-boost");
    const payout = document.getElementById("wallet-current-payout");
    const progress = document.getElementById("wallet-progress-fill");
    const progressText = document.getElementById("wallet-progress-text");
    const nextPayout = document.getElementById("wallet-next-payout");

    if (baseRate) baseRate.textContent = earning.configured
      ? `${Number(earning.coinsPer5Minutes || 0).toLocaleString()} / 5 min`
      : "Not enabled";
    if (boost) boost.textContent = `+${Number(earning.activeBoostPercent || 0)}%`;
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
          <span><strong>${escapeHtml(walletActivityLabel(transaction))}</strong><small>${escapeHtml(transaction.reason || "")}</small></span>
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
loadRoster();
loadMapPositions();
