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
loadSpecies();
loadRoster();
loadMapPositions();
