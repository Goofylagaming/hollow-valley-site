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
    balanceEl.textContent = wallet.balance ?? 0;
    if (!wallet.transactions?.length) {
      txEl.innerHTML = `<div class="empty-roster"><strong>No transactions yet</strong><span>Your earnings and spending will show up here once the server goes live.</span></div>`;
    } else {
      txEl.innerHTML = wallet.transactions
        .map(
          (t) =>
            `<div class="activity-row"><span>${escapeHtml(t.reason)}</span><b>${t.amount > 0 ? "+" : ""}${t.amount}</b><small>${new Date(t.created_at).toLocaleString()}</small></div>`
        )
        .join("");
    }
  } catch (err) {
    console.error("Failed to load wallet", err);
    txEl.innerHTML = `<div class="empty-roster"><strong>Could not load wallet</strong><span>${escapeHtml(err.message)}</span></div>`;
  }
}

// ---------- Quests ----------
async function loadQuests() {
  const listEl = document.getElementById("quest-list");
  if (!listEl) return;
  const me = await window.HDS.loadMe();
  if (!me.loggedIn) {
    listEl.innerHTML = `<p class="section-intro">Sign in with Steam to view and claim quests.</p>`;
    return;
  }
  try {
    const quests = await api("/api/quests");
    listEl.innerHTML = quests
      .map(
        (q) => `<div class="quest-row" data-quest-id="${q.id}">
          <div><strong>${escapeHtml(q.title)}</strong><span>${escapeHtml(q.description)}</span></div>
          <div class="quest-reward">+${q.reward} Valley Coin</div>
          <button class="outline-button quest-claim" data-quest-id="${q.id}" ${q.claimed ? "disabled" : ""}>${q.claimed ? "Claimed" : "Claim"}</button>
        </div>`
      )
      .join("");
    listEl.querySelectorAll(".quest-claim").forEach((button) => {
      button.addEventListener("click", async () => {
        const questId = button.dataset.questId;
        button.disabled = true;
        button.textContent = "Claiming…";
        try {
          const result = await api(`/api/quests/${questId}/claim`, { method: "POST" });
          button.textContent = "Claimed";
          const balanceEl = document.getElementById("wallet-balance");
          if (balanceEl) balanceEl.textContent = result.wallet.balance;
        } catch (err) {
          button.disabled = false;
          button.textContent = "Claim";
          alert(err.message);
        }
      });
    });
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
