const { api, escapeHtml } = window.HDS;

let speciesByName = {};
let activeCharacter = null;
let storedDinos = [];
let currentFilter = "all";
let marketplaceState = { p2pWritesEnabled: false };
let myMarketplaceListings = [];
let primeTrackerState = null;

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

function skinColorSwatch(color) {
  if (!color || typeof color !== "object") return "";
  const clamp = (value) => Math.max(0, Math.min(255, Math.round((Number(value) || 0) * 255)));
  return `rgb(${clamp(color.r)}, ${clamp(color.g)}, ${clamp(color.b)})`;
}

function renderSkinPreview(skin) {
  if (!skin || typeof skin !== "object") return "";
  const colors = ["body", "markings", "flank", "underbelly", "eyes"]
    .map((key) => skinColorSwatch(skin[key]))
    .filter(Boolean);
  if (!colors.length) return "";
  return `<div class="dino-skin-row">
    <span class="stat-name">SKIN</span>
    <div class="dino-skin-swatches">${colors.map((color) => `<i style="background:${escapeHtml(color)}"></i>`).join("")}</div>
    <small>Pattern ${Number(skin.patternIndex ?? 0)} · Theme ${Number(skin.themeIndex ?? 0)}</small>
  </div>`;
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

function formatPrimeDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes) return `${minutes}m`;
  return total ? `${total}s` : "0m";
}

function primeDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
}

function primeZoneLabel(kind) {
  if (kind === "migration") return "MIGRATION";
  if (kind === "patrol") return "PATROL";
  if (kind === "sanctuary") return "SANCTUARY";
  return String(kind || "ZONE").toUpperCase();
}

function renderPrimeZoneHistory(visits) {
  if (!visits.length) {
    return '<div class="prime-tracker-empty">No mapped zone visits recorded for this dino yet.</div>';
  }
  return `<div class="prime-zone-history">
    ${visits.map((visit) => `
      <div class="prime-zone-row">
        <div>
          <span class="prime-zone-type">${escapeHtml(primeZoneLabel(visit.kind))}</span>
          <strong>${escapeHtml(visit.name || "Unnamed zone")}</strong>
          <small>First seen ${escapeHtml(primeDate(visit.firstSeenAt))}</small>
        </div>
        <div class="prime-zone-meta">
          <b>${escapeHtml(formatPrimeDuration(visit.secondsInside))}</b>
          <span>${visit.kind === "sanctuary" ? "VISITED" : "VISITED · ACTIVE STATE UNKNOWN"}</span>
        </div>
      </div>
    `).join("")}
  </div>`;
}

function renderPrimeTracker(state) {
  const container = document.getElementById("prime-tracker-card");
  if (!container) return;

  if (!state?.enabled) {
    container.innerHTML = `
      <div class="panel prime-tracker-panel">
        <div class="prime-tracker-heading">
          <div><p class="overline green">PRIME TRACKER</p><h3>Prime tracking is staged.</h3></div>
          <span class="tag-pill">OFFLINE</span>
        </div>
        <p class="section-intro">Prime and zone-history tracking is installed but not enabled on the automation feed yet.</p>
      </div>`;
    return;
  }

  const life = state.activeLife;
  if (!life) {
    container.innerHTML = `
      <div class="panel prime-tracker-panel">
        <div class="prime-tracker-heading">
          <div><p class="overline green">PRIME TRACKER</p><h3>No tracked dino life yet.</h3></div>
          <span class="tag-pill">READY</span>
        </div>
        <p class="section-intro">Spawn in-game and the next verified presence sample will start this dino's Prime history.</p>
      </div>`;
    return;
  }

  const progress = state.progress || {};
  const growth = Math.round((Number(life.growth) || 0) * 100);
  const current = state.currentZones || {};
  const currentZones = [
    ...(current.migrations || []).map((name) => `Migration: ${name}`),
    ...(current.patrolZones || []).map((name) => `Patrol: ${name}`),
    ...(current.sanctuaries || []).map((name) => `Sanctuary: ${name}`)
  ];

  container.innerHTML = `
    <div class="panel prime-tracker-panel">
      <div class="prime-tracker-heading">
        <div>
          <p class="overline green">PRIME TRACKER</p>
          <h3>${escapeHtml(life.species || "Unknown")} · ${growth}% growth</h3>
          <small>Tracking this dino life since ${escapeHtml(primeDate(life.startedAt))}</small>
        </div>
        <span class="prime-tracker-status ${life.isPrime ? "is-prime" : ""}">${life.isPrime ? "● PRIME" : "○ NOT PRIME"}</span>
      </div>

      <div class="prime-tracker-stats">
        <div><small>TRACKED PRIME TIME</small><b>${escapeHtml(formatPrimeDuration(progress.primeSeconds))}</b><span>${progress.primePreexisting ? "Prime before tracking · exact date unknown" : progress.primeStartedAt ? `Since ${escapeHtml(primeDate(progress.primeStartedAt))}` : "Not reached yet"}</span></div>
        <div><small>MIGRATION ZONES</small><b>${Number(progress.migrationZonesVisited || 0)}</b><span>Unique mapped footprints visited</span></div>
        <div><small>PATROL ZONES</small><b>${Number(progress.patrolZonesVisited || 0)}</b><span>Unique mapped footprints visited</span></div>
        <div><small>SANCTUARIES</small><b>${Number(progress.sanctuariesVisited || 0)}</b><span>Unique mapped footprints visited</span></div>
      </div>

      <div class="prime-current-zone">
        <small>CURRENT MAPPED ZONE</small>
        <div class="prime-current-zone-chips">
          ${currentZones.length
            ? currentZones.map((label) => `<span>${escapeHtml(label)}</span>`).join("")
            : "<span>Outside tracked migration / patrol / sanctuary zones</span>"}
        </div>
      </div>

      <div class="prime-tracker-note">
        <strong>ZONE STATUS</strong>
        <span>${escapeHtml(state.activeStateNote || "Migration and patrol activity state is not available from the current game feed.")}</span>
      </div>

      <div class="list-heading prime-history-heading">
        <span>ZONE HISTORY</span>
        <small>${(state.zoneVisits || []).length} unique visits</small>
      </div>
      ${renderPrimeZoneHistory(state.zoneVisits || [])}
    </div>`;
}

async function loadPrimeTracker() {
  const container = document.getElementById("prime-tracker-card");
  if (!container) return;
  try {
    primeTrackerState = await api("/api/mydinos/prime-tracker");
    renderPrimeTracker(primeTrackerState);
  } catch (error) {
    primeTrackerState = null;
    container.innerHTML = `<div class="panel prime-tracker-panel"><p class="overline green">PRIME TRACKER</p><p class="section-intro">Prime tracker unavailable: ${escapeHtml(error.message || "Unknown error")}</p></div>`;
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
  const scrap = dino.scrap || {};
  const sellAction = listing
    ? `<button class="btn-dino-action sell" disabled>◇ Listed · ${Number(listing.price).toLocaleString()} Valley Coin</button>`
    : `<button class="btn-dino-action sell stored-sell" data-slot="${escapeHtml(dino.slot)}" ${marketplaceState.p2pWritesEnabled ? "" : "disabled"}>◇ ${marketplaceState.p2pWritesEnabled ? "List for Sale" : "Player Selling Coming Online"}</button>`;
  const scrapAction = `<button class="btn-dino-action prime stored-scrap" data-slot="${escapeHtml(dino.slot)}" ${listing || !scrap.enabled ? "disabled" : ""}>♻ ${listing ? "Listed dinos cannot be scrapped" : scrap.enabled ? `Scrap · ${Number(scrap.payout || 0).toLocaleString()} VC` : (scrap.reason || "Scrap unavailable")}</button>`;
  const deleteAction = `<button class="btn-dino-action danger stored-delete" data-slot="${escapeHtml(dino.slot)}" ${listing ? "disabled" : ""}>✕ Delete</button>`;

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
      ${renderSkinPreview(dino.skin)}
      <div class="dino-actions-row">
        <button class="btn-dino-action redeem stored-redeem" data-slot="${escapeHtml(dino.slot)}" ${eligibility.ok || listing ? (listing ? "disabled" : "") : "disabled"}>↻ ${escapeHtml(listing ? "Listed dinos cannot be redeemed" : eligibility.reason)}</button>
        <button class="btn-dino-action parked-tool" data-tool="mutations" data-slot="${escapeHtml(dino.slot)}" ${listing ? "disabled" : ""}>🧬 Mutations</button>
        <button class="btn-dino-action parked-tool" data-tool="skins" data-slot="${escapeHtml(dino.slot)}" ${listing ? "disabled" : ""}>◈ Skins</button>
        ${sellAction}
        ${scrapAction}
        ${deleteAction}
      </div>
    </article>`;
}


function ensureParkedToolsDialog() {
  let dialog = document.getElementById("parked-dino-tools-dialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "parked-dino-tools-dialog";
  dialog.className = "parked-tools-dialog";
  dialog.innerHTML = `
    <div class="parked-tools-shell">
      <button class="parked-tools-close" type="button" aria-label="Close">×</button>
      <div id="parked-tools-content"></div>
    </div>
  `;
  document.body.appendChild(dialog);
  dialog.querySelector(".parked-tools-close").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  return dialog;
}

function selectedDino(slot) {
  return storedDinos.find((dino) => dino.slot === slot) || null;
}

function openDialogWith(title, subtitle, body) {
  const dialog = ensureParkedToolsDialog();
  const content = dialog.querySelector("#parked-tools-content");
  content.innerHTML = `
    <p class="overline green">PARKED DINO</p>
    <h2>${escapeHtml(title)}</h2>
    <p class="section-intro parked-tools-intro">${escapeHtml(subtitle)}</p>
    <div class="parked-tools-body">${body}</div>
  `;
  if (!dialog.open) dialog.showModal();
  return { dialog, content };
}

async function openMutationEditor(dino) {
  const { content } = openDialogWith(
    "Mutation loadout",
    `Edit the four active mutation slots on your parked ${dino.species}. Inherited and elder mutations are preserved.`,
    '<p class="section-intro">Loading mutation data…</p>'
  );
  try {
    const data = await api(`/api/mydinos/stored/${encodeURIComponent(dino.slot)}/mutations`);
    const options = (slotKey, selected) => [
      '<option value="">Empty slot</option>',
      ...((data.slotCatalog?.[slotKey]) || data.catalog || []).map((name) =>
        `<option value="${escapeHtml(name)}" ${name === selected ? "selected" : ""}>${escapeHtml(name)}</option>`
      ),
    ].join("");
    content.querySelector(".parked-tools-body").innerHTML = `
      <form id="mutation-editor-form" class="parked-tool-form">
        <div class="mutation-editor-grid">
          ${["Slot1","Slot2","Slot3","Slot4"].map((slotKey, index) => `
            <label><span>ACTIVE SLOT ${index + 1}</span><select name="${slotKey}">${options(slotKey, data.mutations?.[slotKey] || "")}</select></label>
          `).join("")}
        </div>
        <div class="parked-tool-note">${data.writeEnabled ? "Changes are written only to this parked DinoStorage slot." : "Mutation editing is currently locked until the parked-dino write gate is enabled."}</div>
        <button class="primary-button" type="submit" ${data.writeEnabled ? "" : "disabled"}>Save mutations <b>→</b></button>
      </form>`;
    content.querySelector("#mutation-editor-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = "Saving…";
      try {
        await api(`/api/mydinos/stored/${encodeURIComponent(dino.slot)}/mutations`, {
          method: "PUT",
          body: JSON.stringify({ mutations: Object.fromEntries(new FormData(form).entries()) }),
        });
        alert("Mutation loadout updated on the parked dino.");
        ensureParkedToolsDialog().close();
        await refresh();
      } catch (error) {
        alert(error.message || "Could not update mutations.");
        button.disabled = false;
        button.textContent = "Save mutations →";
      }
    });
  } catch (error) {
    content.querySelector(".parked-tools-body").innerHTML = `<div class="empty-roster"><strong>Mutation editor unavailable</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

function skinPresetCard(preset, dino, applyEnabled) {
  const premium = preset.isPremium || preset.is_premium;
  return `<div class="skin-preset-row">
    <div><b>${escapeHtml(preset.name || "Unnamed skin")}${premium ? " ★" : ""}</b><small>${escapeHtml(preset.species || dino.species)} · Pattern ${Number(preset.skin?.patternIndex ?? 0)}</small></div>
    <button class="small-button apply-skin-preset" type="button" data-preset-id="${escapeHtml(preset.id)}" ${applyEnabled ? "" : "disabled"}>Apply</button>
  </div>`;
}

async function openSkinManager(dino) {
  const { content } = openDialogWith(
    "Skin presets",
    `Save the exact captured skin from this parked ${dino.species}, or apply one of your saved ${dino.species} presets.`,
    '<p class="section-intro">Loading skin presets…</p>'
  );
  try {
    const data = await api(`/api/skins/mine?species=${encodeURIComponent(dino.species || "")}`);
    const presets = Array.isArray(data.presets) ? data.presets : [];
    content.querySelector(".parked-tools-body").innerHTML = `
      <div class="skin-manager-grid">
        <section>
          <div class="list-heading"><span>SAVED PRESETS</span><small>${presets.length} available</small></div>
          <div class="skin-preset-list">${presets.length ? presets.map((preset) => skinPresetCard(preset, dino, data.applyEnabled)).join("") : '<div class="empty-roster"><strong>No saved skins for this species</strong><span>Save this parked dino’s current skin to create your first preset.</span></div>'}</div>
        </section>
        <section class="skin-save-panel">
          <div class="list-heading"><span>SAVE CURRENT SKIN</span><small>${Number(data.createCost || 0).toLocaleString()} Valley Coin</small></div>
          <form id="skin-save-form" class="parked-tool-form">
            <label><span>PRESET NAME</span><input name="name" maxlength="60" minlength="2" placeholder="e.g. Ash Hunter" required></label>
            <p class="parked-tool-note">Saves the real body colors, markings, pattern, variation and theme captured with this parked dino.</p>
            <button class="primary-button" type="submit" ${data.systemEnabled ? "" : "disabled"}>Save skin <b>→</b></button>
          </form>
        </section>
      </div>`;
    content.querySelectorAll(".apply-skin-preset").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "Applying…";
        try {
          await api(`/api/skins/${encodeURIComponent(button.dataset.presetId)}/apply`, {
            method: "POST",
            body: JSON.stringify({ slot: dino.slot }),
          });
          alert("Skin applied to the parked dino.");
          ensureParkedToolsDialog().close();
          await refresh();
        } catch (error) {
          alert(error.message || "Could not apply skin.");
          button.disabled = false;
          button.textContent = "Apply";
        }
      });
    });
    content.querySelector("#skin-save-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = "Saving…";
      try {
        await api("/api/skins/from-stored", {
          method: "POST",
          body: JSON.stringify({ slot: dino.slot, name: new FormData(form).get("name") }),
        });
        alert("Skin preset saved.");
        await openSkinManager(dino);
      } catch (error) {
        alert(error.message || "Could not save skin preset.");
        button.disabled = false;
        button.textContent = "Save skin →";
      }
    });
  } catch (error) {
    content.querySelector(".parked-tools-body").innerHTML = `<div class="empty-roster"><strong>Skin manager unavailable</strong><span>${escapeHtml(error.message)}</span></div>`;
  }
}

function wireParkedTools(grid) {
  grid.querySelectorAll(".parked-tool:not([disabled])").forEach((button) => {
    button.addEventListener("click", () => {
      const dino = selectedDino(button.dataset.slot);
      if (!dino) return;
      if (button.dataset.tool === "mutations") openMutationEditor(dino);
      if (button.dataset.tool === "skins") openSkinManager(dino);
    });
  });
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


  grid.querySelectorAll(".stored-scrap:not([disabled])").forEach((button) => {
    button.addEventListener("click", async () => {
      const slot = button.dataset.slot;
      const dino = storedDinos.find((item) => item.slot === slot);
      if (!dino) return;
      const payout = Number(dino.scrap?.payout || 0);
      if (!payout) return alert("This dinosaur does not currently have a scrap value.");
      if (!confirm(`Scrap your parked ${dino.species} for ${payout.toLocaleString()} Valley Coin?\n\nThe dinosaur will be permanently deleted. This cannot be undone.`)) return;
      button.disabled = true;
      button.textContent = "Scrapping...";
      try {
        const result = await api(`/api/mydinos/stored/${encodeURIComponent(slot)}/scrap`, { method: "POST" });
        const balance = Number(result.wallet?.balance);
        alert(`${result.species || dino.species} scrapped for ${Number(result.payout || payout).toLocaleString()} Valley Coin.${Number.isFinite(balance) ? `\nNew balance: ${balance.toLocaleString()} VC` : ""}`);
        await refresh();
      } catch (err) {
        alert(err.message || "Could not scrap dinosaur.");
        await refresh();
      }
    });
  });

  grid.querySelectorAll(".stored-delete:not([disabled])").forEach((button) => {
    button.addEventListener("click", async () => {
      const slot = button.dataset.slot;
      const dino = storedDinos.find((item) => item.slot === slot);
      if (!dino) return;
      if (!confirm(`Permanently DELETE your parked ${dino.species}?\n\nYou will receive NO Valley Coin. This cannot be undone.`)) return;
      button.disabled = true;
      button.textContent = "Deleting...";
      try {
        await api(`/api/mydinos/stored/${encodeURIComponent(slot)}/delete`, { method: "POST" });
        alert(`${dino.species} permanently deleted.`);
        await refresh();
      } catch (err) {
        alert(err.message || "Could not delete dinosaur.");
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
  wireParkedTools(grid);
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
  await Promise.all([loadActiveCharacter(), loadPrimeTracker()]);
  try {
    storedDinos = await api("/api/mydinos");
  } catch (err) {
    storedDinos = [];
    document.getElementById("storage-grid").innerHTML = `<div class="empty-roster"><strong>Storage unavailable</strong><span>${escapeHtml(err.message)}</span></div>`;
    return;
  }
  await loadMarketplaceSellingState();
  renderStorage();
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
