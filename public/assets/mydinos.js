const { api, escapeHtml } = window.HDS;

let speciesByName = {};
let activeCharacter = null;
let storedDinos = [];
let currentFilter = "all";
let bodyDropRefreshTimer;
let bodyDropStatusBusy = false;
let marketplaceState = { p2pWritesEnabled: false };
let myMarketplaceListings = [];

function pct(value, max, fallback = 0) {
  const n = Number(value);
  const m = Number(max);
  if (!Number.isFinite(n)) return fallback;
  if (Number.isFinite(m) && m > 0) return Math.max(0, Math.min(100, Math.round((n / m) * 100)));
  if (n >= 0 && n <= 1) return Math.round(n * 100);
  return Math.max(0, Math.min(100, Math.round(n)));
}

function growthPct(dino) {
  const n = Number(dino?.growth);
  if (!Number.isFinite(n)) return 0;
  return n <= 1 ? Math.round(n * 100) : Math.round(n);
}

function speciesInfo(name) {
  return speciesByName[String(name || "").toLowerCase()] || null;
}

function dietLabel(name) {
  const info = speciesInfo(name);
  if (!info?.category) return "Unknown diet";
  return info.category.charAt(0).toUpperCase() + info.category.slice(1);
}

async function loadSpeciesMap() {
  const list = await api("/api/species");
  speciesByName = {};
  for (const species of list) {
    speciesByName[String(species.name || "").toLowerCase()] = species;
    speciesByName[String(species.id || "").toLowerCase()] = species;
  }
}

function sameSpecies(a, b) {
  return String(a || "").toLowerCase() === String(b || "").toLowerCase();
}

function redeemEligibility(dino) {
  if (!activeCharacter) return { ok: false, reason: "Spawn in-game as this species first" };
  if (!sameSpecies(activeCharacter.species, dino.species)) {
    return { ok: false, reason: `Spawn as ${dino.species} first` };
  }
  if (dino.gender && activeCharacter.gender && dino.gender !== activeCharacter.gender) {
    return { ok: false, reason: `Spawn as a ${dino.gender.toLowerCase()} ${dino.species}` };
  }
  return { ok: true, reason: "Redeem this dino" };
}

function listingForSlot(slot) {
  const activeStatuses = new Set(["escrowing", "active", "reserved", "transfer_uncertain", "cancelling"]);
  return myMarketplaceListings.find((listing) => listing.original_slot === slot && activeStatuses.has(listing.status));
}

async function runDinoStorageStore() {
  try {
    const response = await api("/api/mydinos/park-active", { method: "POST" });
    alert(response.message || `Stored in ${response.slot}`);
    return response;
  } catch (err) {
    alert(err.message || "Failed to store active dinosaur");
    return null;
  }
}

async function loadActiveCharacter() {
  const container = document.getElementById("active-character-card");
  if (!container) return;

  try {
    const res = await api("/api/mydinos/active-character");
    activeCharacter = res?.active ? res.character : null;
    if (!activeCharacter) {
      const reason = res?.reason === "server_offline"
        ? "Game server is offline. Your stored dinos are still available to view."
        : "Spawn in-game when you are ready to store or redeem a dinosaur.";
      container.innerHTML = `<div class="panel"><p class="overline green">LIVE DINO</p><p class="section-intro">${escapeHtml(reason)}</p></div>`;
      return;
    }

    const growth = growthPct(activeCharacter);
    container.innerHTML = `
      <div class="active-char-banner">
        <div class="active-char-info">
          <span class="tag-pill active-tag">LIVE IN GAME</span>
          <h3>${escapeHtml(activeCharacter.species || "Unknown")} · ${growth}% growth${activeCharacter.isPrime ? " · PRIME" : ""}</h3>
          <small>${escapeHtml(activeCharacter.gender || "Unknown gender")} · ${escapeHtml(activeCharacter.name || "Survivor")}</small>
        </div>
        <button id="park-active-btn" class="primary-button green">Store Current In-Game Dino</button>
      </div>
    `;

    document.getElementById("park-active-btn")?.addEventListener("click", async () => {
      const btn = document.getElementById("park-active-btn");
      if (!confirm("Store your current live dino? The mod will save its state, then return you to the spawn screen.")) return;
      btn.disabled = true;
      btn.textContent = "Storing...";
      const response = await runDinoStorageStore();
      if (response) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await refresh();
      } else {
        btn.disabled = false;
        btn.textContent = "Store Current In-Game Dino";
      }
    });
  } catch (err) {
    activeCharacter = null;
    container.innerHTML = `<div class="panel"><p class="section-intro">Live dino unavailable: ${escapeHtml(err.message)}</p></div>`;
  }
}

function statBar(label, value, className) {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  return `
    <div class="stat-group">
      <div class="stat-label-row"><span class="stat-name">${escapeHtml(label)}</span><span class="stat-val">${safe}%</span></div>
      <div class="progress-bg"><div class="progress-fill ${className}" style="width:${safe}%"></div></div>
    </div>`;
}

function renderDinoCard(dino) {
  const growth = growthPct(dino);
  const health = pct(dino.health, dino.maxHealth, 100);
  const hunger = pct(dino.hunger, dino.maxHunger, 0);
  const stamina = pct(dino.stamina, dino.maxStamina, 0);
  const thirst = pct(dino.thirst, dino.maxThirst, 0);
  const blood = pct(dino.blood, dino.maxBlood, 100);
  const eligibility = redeemEligibility(dino);
  const mutations = Array.isArray(dino.mutationList) ? dino.mutationList : [];
  const storedAt = dino.capturedAt ? new Date(Number(dino.capturedAt) * 1000).toLocaleString() : "Unknown time";
  const listing = listingForSlot(dino.slot);
  const sellAction = listing
    ? `<button class="btn-dino-action sell" disabled>◇ Listed · ${Number(listing.price).toLocaleString()} Valley Coin</button>`
    : `<button class="btn-dino-action sell stored-sell" data-slot="${escapeHtml(dino.slot)}" ${marketplaceState.p2pWritesEnabled ? "" : "disabled"}>◇ ${marketplaceState.p2pWritesEnabled ? "List for Sale" : "Player Selling Coming Online"}</button>`;

  return `
    <article class="dino-card-v2 storage-dino-card" data-prime="${dino.isPrime ? "true" : "false"}">
      <div class="dino-header">
        <div class="dino-title-area">
          <div class="dino-avatar">☠</div>
          <div class="dino-main-info">
            <h2>${escapeHtml(dino.species || "Unknown")}</h2>
            <div class="dino-sub">${escapeHtml(dietLabel(dino.species))} · ${escapeHtml(dino.gender || "Unknown gender")}</div>
            <div class="dino-loc"><span>Stored ${escapeHtml(storedAt)}</span><span class="growth-highlight">GROWTH ${growth}%</span></div>
          </div>
        </div>
        ${dino.isPrime ? `<div class="prime-badge">♛ PRIME ELDER</div>` : ""}
      </div>
      <div class="stats-grid">
        ${statBar("HEALTH", health, "health")}
        ${statBar("HUNGER", hunger, "hunger")}
        ${statBar("STAMINA", stamina, "stamina")}
        ${statBar("THIRST", thirst, "thirst")}
        ${statBar("BLOOD", blood, "blood")}
        ${statBar("SIZE", growth, "size")}
      </div>
      ${mutations.length ? `<div class="mutations-row"><span class="stat-name">MUTATIONS</span>${mutations.map((m) => `<span class="mutation-chip">🧬 ${escapeHtml(m)}</span>`).join("")}</div>` : ""}
      <div class="dino-actions-row">
        <button class="btn-dino-action redeem stored-redeem" data-slot="${escapeHtml(dino.slot)}" ${eligibility.ok || listing ? (listing ? "disabled" : "") : "disabled"}>↻ ${escapeHtml(listing ? "Listed dinos cannot be redeemed" : eligibility.reason)}</button>
        ${sellAction}
      </div>
    </article>`;
}

function wireStorageActions(grid) {
  grid.querySelectorAll(".stored-redeem").forEach((button) => {
    button.addEventListener("click", async () => {
      const slot = button.dataset.slot;
      const dino = storedDinos.find((item) => item.slot === slot);
      if (!dino) return;
      if (!confirm(`Redeem your stored ${dino.species}? This slot is consumed after the restore finishes.`)) return;
      button.disabled = true;
      button.textContent = "Redeeming...";
      try {
        const response = await api(`/api/mydinos/stored/${encodeURIComponent(slot)}/redeem`, { method: "POST" });
        alert(response.message || "Redeem started.");
        await new Promise((resolve) => setTimeout(resolve, 5500));
        await refresh();
      } catch (err) {
        alert(err.message || "DinoStorage redeem failed");
        await refresh();
      }
    });
  });

  grid.querySelectorAll(".stored-sell").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!marketplaceState.p2pWritesEnabled) return;
      const slot = button.dataset.slot;
      const dino = storedDinos.find((item) => item.slot === slot);
      if (!dino) return;
      const raw = prompt(`List your ${dino.species} for how many Valley Coin?`, "1000");
      if (raw === null) return;
      const price = Number(raw);
      if (!Number.isSafeInteger(price) || price <= 0 || price > 100000000) {
        return alert("Enter a positive whole-number price.");
      }
      if (!confirm(`List this ${dino.species} for ${price.toLocaleString()} Valley Coin? It will move into marketplace escrow until sold or cancelled.`)) return;
      button.disabled = true;
      button.textContent = "Listing...";
      try {
        await api("/api/marketplace/listings", {
          method: "POST",
          body: JSON.stringify({ slot, price }),
        });
        alert("Dino listed for sale.");
        await refresh();
      } catch (err) {
        alert(err.message || "Failed to list dino");
        await refresh();
      }
    });
  });
}

function renderStorage() {
  const grid = document.getElementById("storage-grid");
  document.getElementById("mydinos-count").textContent = `${storedDinos.length} in storage`;
  const filtered = storedDinos.filter((dino) => currentFilter === "all" || (currentFilter === "prime" && dino.isPrime));

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-roster"><b>◇</b><strong>${storedDinos.length ? "No dinos match this filter" : "No stored dinos yet"}</strong><span>${storedDinos.length ? "Try another filter." : "Spawn in-game and use Store Current In-Game Dino."}</span></div>`;
    return;
  }

  grid.innerHTML = filtered.map(renderDinoCard).join("");
  wireStorageActions(grid);
}

function wireFilters() {
  document.querySelectorAll(".filter[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".filter[data-filter]").forEach((item) => item.classList.remove("active"));
      button.classList.add("active");
      currentFilter = button.dataset.filter;
      renderStorage();
    });
  });
}

function formatCooldown(seconds) {
  if (seconds === null || seconds === undefined) return "pending";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins <= 0 ? `${secs}s` : `${mins}m ${String(secs).padStart(2, "0")}s`;
}

function renderBodyDropStatus(data) {
  const container = document.getElementById("bodydrop-content");
  if (!container) return;

  const eligibilityBlocked = data.eligibility?.eligible === false && Boolean(data.eligibility?.reason);
  const status = !data.steamLinked
    ? "Sign in with Steam first"
    : !data.serverOnline
      ? "Server sync offline"
      : data.cooldown?.active
        ? data.cooldown.reason === "pending" ? "Request pending" : `Cooldown ${formatCooldown(data.cooldown.remainingSeconds)}`
        : eligibilityBlocked
          ? data.eligibility.reason
          : "Available now · carnivores at 60% growth or below";
  const disabled = !data.steamLinked || !data.serverOnline || data.cooldown?.active || eligibilityBlocked;
  const options = (data.options || []).map((option) => `
    <button class="bodydrop-option" data-drop-type="${escapeHtml(option.id)}" ${disabled ? "disabled" : ""}>
      <strong>${escapeHtml(option.name)}</strong><span>${escapeHtml(option.description)}</span>
    </button>`).join("");
  container.innerHTML = `<div class="bodydrop-status ${disabled ? "blocked" : "ready"}"><b>${escapeHtml(status)}</b></div><div class="bodydrop-options">${options}</div>`;
  container.querySelectorAll(".bodydrop-option").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("Request this body drop on the live server?")) return;
      button.disabled = true;
      try {
        const response = await api("/api/bodydrop", { method: "POST", body: JSON.stringify({ dropType: button.dataset.dropType }) });
        alert(response.result?.message || "Body drop requested.");
        await loadBodyDropStatus();
      } catch (err) {
        alert(err.message || "Failed to request body drop");
        await loadBodyDropStatus();
      }
    });
  });
}

async function loadBodyDropStatus() {
  if (bodyDropStatusBusy) return;
  clearTimeout(bodyDropRefreshTimer);
  const container = document.getElementById("bodydrop-content");
  if (!container) return;
  bodyDropStatusBusy = true;
  try {
    const data = await api("/api/bodydrop");
    renderBodyDropStatus(data);
    if (data.cooldown?.reason === "pending") {
      bodyDropRefreshTimer = setTimeout(loadBodyDropStatus, 10000);
    }
  } catch (err) {
    container.innerHTML = `<p class="section-intro" style="color:#ef9a8a;">${escapeHtml(err.message || "Body Drop is unavailable right now.")}</p>`;
    bodyDropRefreshTimer = setTimeout(loadBodyDropStatus, 30000);
  } finally {
    bodyDropStatusBusy = false;
  }
}

async function loadMarketplaceSellingState() {
  try {
    const [state, mine] = await Promise.all([
      api("/api/marketplace/state"),
      api("/api/marketplace/listings/mine"),
    ]);
    marketplaceState = state || { p2pWritesEnabled: false };
    myMarketplaceListings = Array.isArray(mine) ? mine : [];
  } catch (err) {
    marketplaceState = { p2pWritesEnabled: false };
    myMarketplaceListings = [];
    console.warn("Marketplace selling state unavailable", err);
  }
}

async function refresh() {
  await loadActiveCharacter();
  try {
    storedDinos = await api("/api/mydinos");
  } catch (err) {
    storedDinos = [];
    document.getElementById("storage-grid").innerHTML = `<div class="empty-roster"><strong>Storage unavailable</strong><span>${escapeHtml(err.message)}</span></div>`;
    return;
  }
  await loadMarketplaceSellingState();
  renderStorage();
  await loadBodyDropStatus();
}

async function init() {
  const me = await window.HDS.loadMe();
  const guard = document.getElementById("mydinos-guard");
  const content = document.getElementById("mydinos-content");
  if (!me.loggedIn) {
    guard.hidden = false;
    content.hidden = true;
    return;
  }
  guard.hidden = true;
  content.hidden = false;
  await loadSpeciesMap();
  wireFilters();
  await refresh();
}

init();
