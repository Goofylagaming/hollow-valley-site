const menuButton = document.querySelector(".menu-toggle");
const navLinks = document.querySelector(".main-nav");

menuButton?.addEventListener("click", () => {
  const isOpen = navLinks.classList.toggle("open");
  menuButton.setAttribute("aria-expanded", String(isOpen));
});

navLinks?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    navLinks.classList.remove("open");
    menuButton?.setAttribute("aria-expanded", "false");
  });
});

navLinks?.querySelectorAll(".nav-group > button").forEach((button) => {
  button.addEventListener("click", () => {
    const group = button.parentElement;
    const isOpen = group.classList.toggle("open");
    button.setAttribute("aria-expanded", String(isOpen));
    navLinks.querySelectorAll(".nav-group").forEach((other) => {
      if (other !== group) {
        other.classList.remove("open");
        other.querySelector("button")?.setAttribute("aria-expanded", "false");
      }
    });
  });
});

// ---------- Section reveal helpers ----------
function revealSection(section) {
  if (!section) return;
  section.hidden = false;
  section.scrollIntoView({ behavior: "smooth", block: "start" });
}

const walletSection = document.getElementById("wallet");
document.querySelectorAll('a[href="#wallet"]').forEach((link) => {
  link.addEventListener("click", () => {
    revealSection(walletSection);
    loadWallet();
  });
});

const marketplaceSection = document.getElementById("marketplace");
document.querySelectorAll('a[href="#marketplace"]').forEach((link) => {
  link.addEventListener("click", () => revealSection(marketplaceSection));
});

const questsSection = document.getElementById("quests");
document.querySelectorAll(".quests-nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    revealSection(questsSection);
    loadQuests();
  });
});

const speciesSection = document.getElementById("species");
document.querySelectorAll(".species-nav-link").forEach((link) => {
  link.addEventListener("click", () => {
    revealSection(speciesSection);
    const targetFilter = document.querySelector(`.filter[data-filter="${link.dataset.filter}"]`);
    targetFilter?.click();
  });
});

// ---------- API helpers ----------
async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    const message = body?.error || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body;
}

// ---------- Auth state ----------
const authAction = document.getElementById("auth-action");
const heroHeading = document.getElementById("hero-heading");

async function loadMe() {
  try {
    const me = await api("/api/me");
    if (me.loggedIn && me.user) {
      if (authAction) {
        authAction.textContent = "Logout";
        authAction.href = "/auth/logout";
        authAction.classList.add("logged-in");
      }
      if (heroHeading) {
        heroHeading.innerHTML = `Welcome back,<br><span>${escapeHtml(me.user.username)}</span>`;
      }
    } else {
      if (authAction) {
        const label = me.discordLoginConfigured ? "Login with Discord" : "Discord login not configured";
        authAction.innerHTML = `<span class="online-dot"></span> ${label} <b>↗</b>`;
        authAction.href = me.discordLoginConfigured ? "/auth/discord" : "#";
      }
      if (heroHeading) {
        heroHeading.innerHTML = "Welcome,<br><span>survivor.</span>";
      }
    }
    return me;
  } catch (err) {
    console.error("Failed to load /api/me", err);
    return { loggedIn: false, user: null };
  }
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

// ---------- Species ----------
let dinoDialogWired = false;

function wireDinoDialog() {
  const dinoDialog = document.querySelector(".dino-dialog");
  if (!dinoDialog) return;
  const dialogTitle = dinoDialog.querySelector("#dialog-title");
  const dialogRole = dinoDialog.querySelector(".dialog-role");
  const dialogDescription = dinoDialog.querySelector(".dialog-description");
  const dialogSocial = dinoDialog.querySelector(".dialog-social strong");

  document.querySelectorAll(".dino-card").forEach((card) => {
    card.tabIndex = 0;
    const openDetails = () => {
      dialogTitle.textContent = card.dataset.dino;
      dialogRole.textContent = card.dataset.role;
      dialogDescription.textContent = card.dataset.description;
      dialogSocial.textContent = card.dataset.social;
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
      return `<article class="dino-card${featuredClass}" data-category="${dino.category}" data-dino="${escapeHtml(dino.name)}" data-role="${escapeHtml(dino.role)}" data-description="${escapeHtml(dino.description)}" data-social="${escapeHtml(dino.social)}">
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
  const me = await loadMe();
  if (!me.loggedIn) {
    balanceEl.textContent = "0";
    txEl.innerHTML = `<div class="empty-roster"><strong>Login required</strong><span>Log in with Discord to view your Amber balance.</span></div>`;
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
  const me = await loadMe();
  if (!me.loggedIn) {
    listEl.innerHTML = `<p class="section-intro">Log in with Discord to view and claim quests.</p>`;
    return;
  }
  try {
    const quests = await api("/api/quests");
    listEl.innerHTML = quests
      .map(
        (q) => `<div class="quest-row" data-quest-id="${q.id}">
          <div><strong>${escapeHtml(q.title)}</strong><span>${escapeHtml(q.description)}</span></div>
          <div class="quest-reward">+${q.reward} Amber</div>
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

// ---------- Roster & Map ----------
async function loadRoster() {
  const rosterEl = document.getElementById("roster-empty-state");
  if (!rosterEl) return;
  const me = await loadMe();
  if (!me.loggedIn) return;
  try {
    const roster = await api("/api/roster");
    if (roster.length) {
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
    const map = await api("/api/map/positions");
    contactsEl.textContent = map.connected
      ? `${map.positions.length} contacts in your visibility scope`
      : "Live map offline — server not connected yet";
  } catch (err) {
    console.error("Failed to load map positions", err);
  }
}

// ---------- Init ----------
loadMe();
loadSpecies();
loadRoster();
loadMapPositions();
