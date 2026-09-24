const { api, escapeHtml } = window.HDS;

const COLOR_FIELDS = [
  ["body", "Body", "#6f7652"],
  ["markings", "Markings", "#232713"],
  ["flank", "Flank", "#59613d"],
  ["underbelly", "Underbelly", "#b7ae8d"],
  ["detail1", "Detail", "#9c7b46"],
  ["eyes", "Eyes", "#b7ff35"],
  ["teeth", "Teeth", "#ded6b8"],
  ["mouth", "Mouth", "#6d2e34"],
  ["claws", "Claws", "#28251e"],
  ["maleDisplay", "Male display", "#a6732b"],
];

let me = { loggedIn: false, user: null };
let speciesList = [];
let storeState = null;
let mineState = null;
let storedDinos = [];
let externalQueue = [];
let editingPresetId = null;

const EXTERNAL_LIBRARY_RE = /^\[External Library:([^\]]+)\]\s*/;

function requestKey(prefix) {
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${id}`;
}

function showAlert(message, kind = "info") {
  const box = document.getElementById("skin-alert");
  box.hidden = !message;
  box.className = `skin-alert ${kind}`;
  box.textContent = message || "";
  if (message) box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function hexToColor(hex) {
  const value = String(hex || "#000000").replace("#", "");
  const safe = /^[0-9a-f]{6}$/i.test(value) ? value : "000000";
  return {
    r: parseInt(safe.slice(0, 2), 16) / 255,
    g: parseInt(safe.slice(2, 4), 16) / 255,
    b: parseInt(safe.slice(4, 6), 16) / 255,
    a: 1,
  };
}

function colorToHex(color) {
  const channel = (value) => Math.max(0, Math.min(255, Math.round(Number(value || 0) * 255))).toString(16).padStart(2, "0");
  return `#${channel(color?.r)}${channel(color?.g)}${channel(color?.b)}`;
}

function editorSkin() {
  const skin = {};
  for (const [key] of COLOR_FIELDS) {
    skin[key] = hexToColor(document.getElementById(`skin-color-${key}`).value);
  }
  skin.patternIndex = Number(document.getElementById("skin-pattern").value) || 0;
  skin.themeIndex = Number(document.getElementById("skin-theme").value) || 0;
  skin.skinVariation = Number(document.getElementById("skin-variation").value) || 0;
  return skin;
}

function applySkinToEditor(skin) {
  for (const [key, _label, fallback] of COLOR_FIELDS) {
    const input = document.getElementById(`skin-color-${key}`);
    input.value = colorToHex(skin?.[key] || hexToColor(fallback));
  }
  document.getElementById("skin-pattern").value = Number(skin?.patternIndex) || 0;
  document.getElementById("skin-theme").value = Number(skin?.themeIndex) || 0;
  document.getElementById("skin-variation").value = Number(skin?.skinVariation) || 0;
  updatePreview();
}

function updatePreview() {
  const skin = editorSkin();
  const stage = document.getElementById("skin-preview-stage");
  stage.style.setProperty("--skin-body", colorToHex(skin.body));
  stage.style.setProperty("--skin-markings", colorToHex(skin.markings));
  stage.style.setProperty("--skin-flank", colorToHex(skin.flank));
  stage.style.setProperty("--skin-underbelly", colorToHex(skin.underbelly));
  stage.style.setProperty("--skin-eye", colorToHex(skin.eyes));
  document.getElementById("preview-name").textContent = document.getElementById("skin-name").value.trim() || "Untitled Skin";
  const option = document.getElementById("skin-species").selectedOptions[0];
  document.getElementById("preview-species").textContent = option?.textContent || "Choose a species";
}

function buildColorEditor() {
  const host = document.getElementById("skin-colors");
  host.innerHTML = COLOR_FIELDS.map(([key, label, fallback]) => `
    <label class="skin-color-control">
      <span>${escapeHtml(label)}</span>
      <input type="color" id="skin-color-${key}" value="${fallback}" aria-label="${escapeHtml(label)} colour">
      <code id="skin-color-code-${key}">${fallback.toUpperCase()}</code>
    </label>
  `).join("");

  host.querySelectorAll('input[type="color"]').forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.id.replace("skin-color-", "");
      document.getElementById(`skin-color-code-${key}`).textContent = input.value.toUpperCase();
      updatePreview();
    });
  });
}

function randomHex() {
  const base = () => Math.floor(30 + Math.random() * 190);
  return `#${[base(), base(), base()].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function resetEditor() {
  for (const [key, _label, fallback] of COLOR_FIELDS) {
    const input = document.getElementById(`skin-color-${key}`);
    input.value = fallback;
    document.getElementById(`skin-color-code-${key}`).textContent = fallback.toUpperCase();
  }
  document.getElementById("skin-pattern").value = 0;
  document.getElementById("skin-theme").value = 0;
  document.getElementById("skin-variation").value = 0;
  updatePreview();
}

function swatches(skin) {
  return COLOR_FIELDS.slice(0, 6).map(([key, label]) =>
    `<span title="${escapeHtml(label)}" style="background:${colorToHex(skin?.[key])}"></span>`
  ).join("");
}

function externalLibraryMeta(description) {
  const text = String(description || "");
  const match = EXTERNAL_LIBRARY_RE.exec(text);
  return {
    source: match?.[1] || null,
    description: text.replace(EXTERNAL_LIBRARY_RE, "").trim(),
  };
}

function externalLibraryDescription(source, description = "") {
  const safeSource = String(source || "External").replace(/[\[\]]/g, "").trim().slice(0, 60) || "External";
  const body = String(description || "").trim() || "Imported external skin draft.";
  return `[External Library:${safeSource}] ${body}`.slice(0, 240);
}

function skinCard(preset, mode) {
  const owned = Boolean(preset.owned || preset.isPremium || mode === "mine" || mode === "library");
  const price = Number(preset.price) || 0;
  const externalMeta = externalLibraryMeta(preset.description);
  const description = externalMeta.description || (preset.published ? "Published Hollow Valley skin." : "Saved Skin Studio design.");
  const isCreator = Boolean(preset.owner_steam_id && me.user?.steam_id === preset.owner_steam_id);
  const ownerBadge = isCreator ? "Creator" : "";
  const status = preset.exclusive
    ? (preset.granted ? "Exclusive · Granted" : "Exclusive")
    : preset.published ? (preset.isPremium ? "Free" : `${price.toLocaleString()} VC`) : "Draft";

  const actions = [];
  if (mode === "store" && !owned) {
    actions.push(`<button class="small-button skin-buy" data-id="${preset.id}">Unlock · ${price.toLocaleString()} VC</button>`);
  }
  if (owned && mode !== "library") {
    actions.push(`<button class="small-button skin-wear" data-id="${preset.id}">Wear live</button>`);
    actions.push(`<button class="small-button skin-apply-stored" data-id="${preset.id}" data-species="${escapeHtml(preset.species)}">Apply to parked</button>`);
  }
  if (mode === "library" && me.user?.is_admin) {
    actions.push(`<button class="small-button skin-library-edit" data-id="${preset.id}">Open in Studio</button>`);
  }
  if ((mode === "mine" || mode === "library") && me.user?.is_admin && isCreator) {
    if (mode === "mine") actions.push(`<button class="small-button skin-edit" data-id="${preset.id}">Edit</button>`);
    actions.push(`<button class="small-button skin-grant" data-id="${preset.id}" data-name="${escapeHtml(preset.name)}">Grant exclusive</button>`);
    actions.push(`<button class="small-button skin-grants" data-id="${preset.id}" data-name="${escapeHtml(preset.name)}">Grants</button>`);
    if (!preset.exclusive) {
      actions.push(`<button class="small-button skin-publish" data-id="${preset.id}" data-price="${price}">${preset.published ? "Update shop" : "Publish"}</button>`);
    }
    actions.push(`<button class="small-button skin-delete" data-id="${preset.id}" data-name="${escapeHtml(preset.name)}">Delete</button>`);
  }

  return `
    <article class="skin-card" data-skin-id="${preset.id}">
      <div class="skin-card-art" style="
        --card-body:${colorToHex(preset.skin?.body)};
        --card-markings:${colorToHex(preset.skin?.markings)};
        --card-flank:${colorToHex(preset.skin?.flank)};
        --card-eye:${colorToHex(preset.skin?.eyes)}">
        <span class="skin-card-pattern"></span>
        <span class="skin-card-eye"></span>
      </div>
      <div class="skin-card-body">
        <div class="skin-card-topline"><span>${escapeHtml(preset.species)}</span><b>${escapeHtml(status)}</b></div>
        <h3>${escapeHtml(preset.name)}</h3>
        <p>${escapeHtml(description)}</p>
        <div class="skin-swatch-row">${swatches(preset.skin)}</div>
        <div class="skin-card-meta">
          <span>Pattern ${Number(preset.skin?.patternIndex) || 0}</span>
          <span>Theme ${Number(preset.skin?.themeIndex) || 0}</span>
          <span>Variation ${Number(preset.skin?.skinVariation) || 0}</span>
          ${ownerBadge ? `<span>${ownerBadge}</span>` : ""}
          ${preset.exclusive ? "<span>🔒 Non-transferable</span>" : ""}
          ${preset.granted ? "<span>Admin granted</span>" : ""}
          ${mode === "library" && externalMeta.source ? `<span>Source: ${escapeHtml(externalMeta.source)}</span>` : ""}
        </div>
        <div class="skin-card-code">${(!preset.exclusive && !preset.granted && preset.share_code) ? `Share: <strong>${escapeHtml(preset.share_code)}</strong>` : (preset.exclusive ? "Exclusive skin · share code hidden" : "")}</div>
        <div class="skin-card-actions">${actions.join("")}</div>
      </div>
    </article>
  `;
}

function wireCardActions(root) {
  root.querySelectorAll(".skin-buy").forEach((button) => button.addEventListener("click", async () => {
    if (!me.loggedIn) return showAlert("Sign in with Steam before unlocking a skin.", "warning");
    button.disabled = true;
    try {
      const result = await api(`/api/skins/${button.dataset.id}/buy`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: requestKey("skin-buy") }),
      });
      showAlert(`Skin unlocked. Valley Coin balance: ${result.wallet?.balance ?? "updated"}.`, "success");
      await Promise.all([loadStore(), loadMine()]);
    } catch (err) {
      showAlert(err.message, "error");
    } finally {
      button.disabled = false;
    }
  }));

  root.querySelectorAll(".skin-edit").forEach((button) => button.addEventListener("click", () => {
    const preset = (mineState?.presets || []).find((item) => String(item.id) === String(button.dataset.id));
    if (!preset) return showAlert("Skin could not be found.", "error");
    const meta = externalLibraryMeta(preset.description);
    editingPresetId = preset.id;
    document.getElementById("skin-species").value = preset.species;
    document.getElementById("skin-name").value = preset.name || "";
    document.getElementById("skin-description").value = meta.description || "";
    applySkinToEditor(preset.skin);
    document.getElementById("skin-save").textContent = "Update design →";
    updatePreview();
    activateSkinTab("studio");
    showAlert(`Editing ${preset.name}. Save will update this existing skin.`, "info");
  }));

  root.querySelectorAll(".skin-grant").forEach((button) => button.addEventListener("click", async () => {
    const skinName = button.dataset.name || "this skin";
    const steamId = prompt(`Grant "${skinName}" exclusively to which Steam ID?\nEnter the player's 17-digit Steam ID.`, "");
    if (steamId === null) return;
    const target = String(steamId || "").trim();
    if (!/^\d{17}$/.test(target)) return showAlert("Enter a valid 17-digit Steam ID.", "warning");
    const note = prompt("Optional grant note (event reward, supporter reward, staff skin, etc.):", "") ?? "";
    if (!confirm(`Grant "${skinName}" to Steam ${target}?\n\nThis will make the skin EXCLUSIVE, remove it from the public shop, hide its share code, and add it directly to that player's My Skins library.`)) return;
    button.disabled = true;
    try {
      await api(`/api/skins/${button.dataset.id}/grant`, {
        method: "POST",
        body: JSON.stringify({ steamId: target, note }),
      });
      showAlert(`Granted ${skinName} exclusively to ${target}. The skin is now private and non-transferable.`, "success");
      await Promise.all([loadMine(), loadStore()]);
    } catch (err) {
      showAlert(err.message, "error");
      button.disabled = false;
    }
  }));

  root.querySelectorAll(".skin-grants").forEach((button) => button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      const result = await api(`/api/skins/${button.dataset.id}/grants`);
      const grants = Array.isArray(result.grants) ? result.grants : [];
      if (!grants.length) {
        alert(`No active grants for ${button.dataset.name || "this skin"}.`);
        return;
      }
      const summary = grants.map((grant) => {
        const note = grant.note ? ` · ${grant.note}` : "";
        return `${grant.steam_id}${note}`;
      }).join("\n");
      const revoke = prompt(`Active grants for ${button.dataset.name || "skin"}:\n\n${summary}\n\nTo revoke one, enter its Steam ID below. Leave blank to close.`, "");
      if (revoke === null || !String(revoke).trim()) return;
      const target = String(revoke).trim();
      if (!/^\d{17}$/.test(target)) return showAlert("Enter a valid 17-digit Steam ID.", "warning");
      if (!confirm(`Revoke this skin from Steam ${target}? They will immediately lose access to Wear Live and parked-dino application for this skin.`)) return;
      await api(`/api/skins/${button.dataset.id}/revoke`, {
        method: "POST",
        body: JSON.stringify({ steamId: target }),
      });
      showAlert(`Exclusive skin access revoked from ${target}.`, "success");
      await loadMine();
    } catch (err) {
      showAlert(err.message, "error");
    } finally {
      button.disabled = false;
    }
  }));

  root.querySelectorAll(".skin-delete").forEach((button) => button.addEventListener("click", async () => {
    const name = button.dataset.name || "this skin";
    if (!confirm(`Delete "${name}" from My Skins? This cannot be undone.`)) return;
    button.disabled = true;
    try {
      await api(`/api/skins/${button.dataset.id}`, { method: "DELETE", body: "{}" });
      showAlert(`Deleted ${name}.`, "success");
      await Promise.all([loadMine(), loadStore()]);
    } catch (err) {
      showAlert(err.message, "error");
      button.disabled = false;
    }
  }));

  root.querySelectorAll(".skin-wear").forEach((button) => button.addEventListener("click", async () => {
    if (!me.loggedIn) return showAlert("Sign in with Steam before wearing a skin.", "warning");
    button.disabled = true;
    try {
      const result = await api(`/api/skins/${button.dataset.id}/wear`, { method: "POST", body: "{}" });
      showAlert(result.confirmed ? "Skin applied to your live dinosaur." : (result.message || "Skin request queued."), result.confirmed ? "success" : "info");
    } catch (err) {
      showAlert(err.message, "error");
    } finally {
      button.disabled = false;
    }
  }));

  root.querySelectorAll(".skin-apply-stored").forEach((button) => button.addEventListener("click", async () => {
    const slot = document.getElementById("skin-stored-slot").value;
    if (!slot) return showAlert("Choose a parked dino slot under My Skins first.", "warning");

    const selectedDino = storedDinos.find((dino) => String(dino.slot || dino.name || "") === slot);
    const presetSpecies = String(button.dataset.species || "").trim();
    const dinoSpecies = String(selectedDino?.species || selectedDino?.speciesId || "").trim();
    if (presetSpecies && presetSpecies.toLowerCase() !== "universal" && dinoSpecies && presetSpecies.toLowerCase() !== dinoSpecies.toLowerCase()) {
      return showAlert(`This skin is for ${presetSpecies}, but the selected parked dinosaur is ${dinoSpecies}.`, "warning");
    }

    button.disabled = true;
    try {
      await api(`/api/skins/${button.dataset.id}/apply`, {
        method: "POST",
        body: JSON.stringify({ slot }),
      });
      showAlert("Skin applied to the parked dinosaur. It will use the skin when redeemed.", "success");
    } catch (err) {
      showAlert(err.message, "error");
    } finally {
      button.disabled = false;
    }
  }));

  root.querySelectorAll(".skin-library-edit").forEach((button) => button.addEventListener("click", () => {
    const preset = (mineState?.presets || []).find((item) => String(item.id) === String(button.dataset.id));
    if (!preset) return showAlert("External library skin could not be found.", "error");
    const meta = externalLibraryMeta(preset.description);
    document.getElementById("skin-species").value = preset.species;
    document.getElementById("skin-name").value = preset.name || "";
    document.getElementById("skin-description").value = meta.description || "";
    applySkinToEditor(preset.skin);
    updatePreview();
    activateSkinTab("studio");
    showAlert(`Loaded ${preset.name} from the external library into Skin Studio. Saving creates a new draft; the original remains unchanged.`, "info");
  }));

  root.querySelectorAll(".skin-publish").forEach((button) => button.addEventListener("click", async () => {
    const preset = (mineState?.presets || []).find((item) => String(item.id) === String(button.dataset.id));
    const meta = externalLibraryMeta(preset?.description);
    const priceRaw = prompt("Valley Coin price (0 = free):", button.dataset.price || "0");
    if (priceRaw === null) return;
    const price = Number(priceRaw);
    if (!Number.isInteger(price) || price < 0) return showAlert("Price must be a whole number of Valley Coin.", "warning");
    const descriptionRaw = prompt("Shop description (optional):", meta.description || "") ?? "";
    const description = meta.source
      ? externalLibraryDescription(meta.source, descriptionRaw)
      : descriptionRaw;
    button.disabled = true;
    try {
      await api(`/api/skins/${button.dataset.id}/publish`, {
        method: "POST",
        body: JSON.stringify({ price, description, published: true }),
      });
      showAlert("Skin published to the Valley Skin Shop.", "success");
      await Promise.all([loadStore(), loadMine()]);
    } catch (err) {
      showAlert(err.message, "error");
    } finally {
      button.disabled = false;
    }
  }));
}

async function loadStore() {
  const grid = document.getElementById("skin-store-grid");
  const species = document.getElementById("skin-store-species").value;
  grid.innerHTML = '<p class="section-intro">Loading skin shop…</p>';
  try {
    storeState = await api(`/api/skins${species ? `?species=${encodeURIComponent(species)}` : ""}`);
    const skins = storeState.skins || [];
    document.getElementById("skin-system-state").textContent = storeState.systemEnabled ? "ONLINE" : "DISABLED";
    grid.innerHTML = skins.length
      ? skins.map((preset) => skinCard(preset, "store")).join("")
      : '<div class="empty-roster"><strong>No published skins yet</strong><span>Published designs will appear here.</span></div>';
    wireCardActions(grid);
  } catch (err) {
    grid.innerHTML = `<div class="empty-roster"><strong>Skin Shop unavailable</strong><span>${escapeHtml(err.message)}</span></div>`;
  }
}

function queueSkinCard(item, index) {
  const parsed = item.parsed || {};
  const warning = (parsed.warnings || []).join(" ");
  return `
    <article class="skin-card" data-queue-index="${index}">
      <div class="skin-card-art" style="
        --card-body:${colorToHex(item.skin?.body)};
        --card-markings:${colorToHex(item.skin?.markings)};
        --card-flank:${colorToHex(item.skin?.flank)};
        --card-eye:${colorToHex(item.skin?.eyes)}">
        <span class="skin-card-pattern"></span>
        <span class="skin-card-eye"></span>
      </div>
      <div class="skin-card-body">
        <div class="skin-card-topline"><span>${escapeHtml(item.species)}</span><b>Queued</b></div>
        <label>Draft name<input class="skin-library-queue-name" data-index="${index}" maxlength="60" value="${escapeHtml(item.name)}"></label>
        <p>${escapeHtml(parsed.sourceLabel || "External skin")}</p>
        <div class="skin-swatch-row">${swatches(item.skin)}</div>
        <div class="skin-card-meta">
          <span>Pattern ${Number(item.skin?.patternIndex) || 0}</span>
          <span>Theme ${Number(item.skin?.themeIndex) || 0}</span>
          <span>Variation ${Number(item.skin?.skinVariation) || 0}</span>
        </div>
        ${warning ? `<small>${escapeHtml(warning)}</small>` : ""}
      </div>
    </article>
  `;
}

function renderExternalQueue() {
  const grid = document.getElementById("skin-library-queue");
  const saveButton = document.getElementById("skin-library-save");
  const result = document.getElementById("skin-library-result");
  if (!grid || !saveButton || !result) return;

  if (!externalQueue.length) {
    grid.innerHTML = '<div class="empty-roster"><strong>No imports queued</strong><span>Paste external codes above and choose Preview batch.</span></div>';
    saveButton.disabled = true;
    result.textContent = "Nothing queued.";
    return;
  }

  grid.innerHTML = externalQueue.map(queueSkinCard).join("");
  saveButton.disabled = false;
  result.textContent = `${externalQueue.length} skin${externalQueue.length === 1 ? "" : "s"} queued as unpublished drafts.`;
  grid.querySelectorAll(".skin-library-queue-name").forEach((input) => input.addEventListener("input", () => {
    const index = Number(input.dataset.index);
    if (externalQueue[index]) externalQueue[index].name = input.value.slice(0, 60);
  }));
}

function renderExternalLibrary() {
  const grid = document.getElementById("skin-library-grid");
  if (!grid) return;

  if (!me.loggedIn || !me.user?.steam_id) {
    grid.innerHTML = '<div class="empty-roster"><strong>Steam sign-in required</strong><span>Sign in before using the external skin library.</span></div>';
    return;
  }

  const presets = (mineState?.presets || []).filter((preset) => Boolean(externalLibraryMeta(preset.description).source));
  grid.innerHTML = presets.length
    ? presets.map((preset) => skinCard(preset, "library")).join("")
    : '<div class="empty-roster"><strong>No external drafts yet</strong><span>Batch-import codes above to build the admin catalogue.</span></div>';
  wireCardActions(grid);
}

async function loadMine() {
  const guard = document.getElementById("skin-mine-guard");
  const grid = document.getElementById("skin-mine-grid");
  if (!me.loggedIn || !me.user?.steam_id) {
    guard.hidden = false;
    grid.hidden = true;
    mineState = { presets: [] };
    renderExternalLibrary();
    return;
  }
  guard.hidden = true;
  grid.hidden = false;
  grid.innerHTML = '<p class="section-intro">Loading your skins…</p>';
  try {
    mineState = await api("/api/skins/mine");
    const skins = mineState.presets || [];
    grid.innerHTML = skins.length
      ? skins.map((preset) => skinCard(preset, "mine")).join("")
      : '<div class="empty-roster"><strong>No saved skins</strong><span>Create a design in Skin Studio or unlock one from the shop.</span></div>';
    wireCardActions(grid);
    renderExternalLibrary();
  } catch (err) {
    grid.innerHTML = `<div class="empty-roster"><strong>Could not load My Skins</strong><span>${escapeHtml(err.message)}</span></div>`;
    const libraryGrid = document.getElementById("skin-library-grid");
    if (libraryGrid) libraryGrid.innerHTML = `<div class="empty-roster"><strong>Could not load external library</strong><span>${escapeHtml(err.message)}</span></div>`;
  }
}

async function loadStoredSlots() {
  const select = document.getElementById("skin-stored-slot");
  if (!me.loggedIn || !me.user?.steam_id) return;
  try {
    const dinos = await api("/api/mydinos");
    storedDinos = Array.isArray(dinos) ? dinos : [];
    select.innerHTML = '<option value="">Parked dino slot (optional)</option>' + storedDinos.map((dino) => {
      const slot = dino.slot || dino.name || "";
      const label = dino.species || dino.speciesId || dino.classPath || "Stored dino";
      return `<option value="${escapeHtml(slot)}">${escapeHtml(label)} · ${escapeHtml(slot)}</option>`;
    }).join("");
  } catch {
    storedDinos = [];
    select.innerHTML = '<option value="">Parked dinos unavailable</option>';
  }
}

function activateSkinTab(tabName) {
  const target = String(tabName || "");
  document.querySelectorAll(".skin-tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.skinTab === target));
  document.querySelectorAll(".skin-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.skinPanel === target));
}

function wireTabs() {
  document.querySelectorAll(".skin-tab").forEach((button) => button.addEventListener("click", () => {
    activateSkinTab(button.dataset.skinTab);
  }));
}

async function initSpecies() {
  speciesList = await api("/api/species");
  const options = speciesList.map((species) => `<option value="${escapeHtml(species.id)}">${escapeHtml(species.name)}</option>`).join("");
  document.getElementById("skin-species").innerHTML = '<option value="Universal">Universal / Any Species</option>' + options;
  document.getElementById("skin-store-species").innerHTML = '<option value="">All species</option>' + options;
  const externalSpecies = document.getElementById("skin-external-species");
  if (externalSpecies) externalSpecies.innerHTML = '<option value="Universal">Universal / Any Species</option>' + options;
  const librarySpecies = document.getElementById("skin-library-species");
  if (librarySpecies) librarySpecies.innerHTML = '<option value="Universal">Universal / Any Species</option>' + options;
  updatePreview();
}

document.getElementById("skin-name").addEventListener("input", updatePreview);
document.getElementById("skin-species").addEventListener("change", updatePreview);
["skin-pattern", "skin-theme", "skin-variation"].forEach((id) => document.getElementById(id).addEventListener("input", updatePreview));

document.getElementById("skin-randomize").addEventListener("click", () => {
  for (const [key] of COLOR_FIELDS) {
    const input = document.getElementById(`skin-color-${key}`);
    input.value = randomHex();
    document.getElementById(`skin-color-code-${key}`).textContent = input.value.toUpperCase();
  }
  updatePreview();
});

document.getElementById("skin-reset").addEventListener("click", () => {
  editingPresetId = null;
  document.getElementById("skin-save").textContent = "Save design →";
  resetEditor();
});

document.getElementById("skin-save").addEventListener("click", async () => {
  if (!me.loggedIn || !me.user?.steam_id) return showAlert("Sign in with Steam before saving a skin.", "warning");
  const name = document.getElementById("skin-name").value.trim();
  if (name.length < 2) return showAlert("Give the skin a name first.", "warning");
  const button = document.getElementById("skin-save");
  button.disabled = true;
  try {
    const result = await api(editingPresetId ? `/api/skins/${editingPresetId}` : "/api/skins/studio", {
      method: editingPresetId ? "PUT" : "POST",
      body: JSON.stringify({
        species: document.getElementById("skin-species").value,
        name,
        description: document.getElementById("skin-description").value.trim(),
        skin: editorSkin(),
        ...(editingPresetId ? {} : { idempotencyKey: requestKey("skin-save") }),
      }),
    });
    showAlert(editingPresetId ? `Updated ${result.preset?.name || name}.` : `Saved ${result.preset?.name || name}. Share code: ${result.preset?.share_code || "created"}.`, "success");
    editingPresetId = null;
    document.getElementById("skin-save").textContent = "Save design →";
    await Promise.all([loadMine(), loadStore()]);
  } catch (err) {
    showAlert(err.message, "error");
  } finally {
    button.disabled = false;
  }
});

document.getElementById("skin-store-refresh").addEventListener("click", loadStore);
document.getElementById("skin-store-species").addEventListener("change", loadStore);
document.getElementById("skin-mine-refresh").addEventListener("click", loadMine);
document.getElementById("skin-library-refresh")?.addEventListener("click", loadMine);

document.getElementById("skin-library-parse")?.addEventListener("click", async () => {
  const raw = document.getElementById("skin-library-batch").value.trim();
  const species = document.getElementById("skin-library-species").value;
  const prefix = document.getElementById("skin-library-prefix").value.trim() || "Imported Skin";
  const button = document.getElementById("skin-library-parse");
  button.disabled = true;
  try {
    const result = await api("/api/skins/external/batch-preview", {
      method: "POST",
      body: JSON.stringify({ rawCode: raw, baseSkin: editorSkin() }),
    });
    const items = Array.isArray(result.items) ? result.items : [];
    externalQueue = items.map((item, index) => ({
      parsed: {
        source: item.source,
        sourceLabel: item.sourceLabel,
        speciesCode: item.speciesCode || null,
        warnings: item.warnings || [],
      },
      species,
      name: `${prefix} ${index + 1}`.slice(0, 60),
      skin: item.skin,
    }));
    renderExternalQueue();
    const sources = [...new Set(items.map((item) => item.sourceLabel).filter(Boolean))];
    showAlert(`Prepared ${externalQueue.length} external skin${externalQueue.length === 1 ? "" : "s"} for review from ${sources.join(" + ") || "supported external formats"}.`, "success");
  } catch (err) {
    externalQueue = [];
    renderExternalQueue();
    showAlert(err.message, "error");
  } finally {
    button.disabled = false;
  }
});

document.getElementById("skin-library-save")?.addEventListener("click", async () => {
  if (!me.loggedIn || !me.user?.steam_id) return showAlert("Sign in with Steam before saving external skin drafts.", "warning");
  if (!externalQueue.length) return showAlert("Preview an external skin batch first.", "warning");

  const button = document.getElementById("skin-library-save");
  button.disabled = true;
  let saved = 0;
  let failure = null;
  for (const item of externalQueue) {
    const name = String(item.name || "").trim();
    if (name.length < 2) {
      failure = new Error("Every queued skin needs a name of at least 2 characters.");
      break;
    }
    try {
      await api("/api/skins/studio", {
        method: "POST",
        body: JSON.stringify({
          species: item.species,
          name,
          description: externalLibraryDescription(item.parsed?.sourceLabel, "Imported external skin draft. Review before publishing."),
          skin: item.skin,
          idempotencyKey: requestKey("skin-external-library"),
        }),
      });
      saved += 1;
    } catch (err) {
      failure = err;
      break;
    }
  }

  externalQueue = externalQueue.slice(saved);
  renderExternalQueue();
  await loadMine();
  activateSkinTab("library");
  if (failure) {
    showAlert(`Saved ${saved} draft${saved === 1 ? "" : "s"} before the import stopped: ${failure.message}`, "warning");
  } else {
    document.getElementById("skin-library-batch").value = "";
    showAlert(`Saved ${saved} external skin draft${saved === 1 ? "" : "s"} to the admin library. Nothing was published automatically.`, "success");
  }
});

document.getElementById("skin-share-preview").addEventListener("click", async () => {
  const code = document.getElementById("skin-share-code").value.trim();
  if (!code) return;
  const host = document.getElementById("skin-share-result");
  try {
    const result = await api(`/api/skins/share/${encodeURIComponent(code)}`);
    const preset = result.preset;
    host.innerHTML = skinCard({ ...preset, owned: false }, "share");
  } catch (err) {
    host.innerHTML = `<span>${escapeHtml(err.message)}</span>`;
  }
});

document.getElementById("skin-share-import").addEventListener("click", async () => {
  if (!me.loggedIn || !me.user?.steam_id) return showAlert("Sign in with Steam before importing a skin.", "warning");
  const code = document.getElementById("skin-share-code").value.trim();
  if (!code) return showAlert("Enter a share code first.", "warning");
  try {
    const result = await api("/api/skins/import", {
      method: "POST",
      body: JSON.stringify({ shareCode: code, idempotencyKey: requestKey("skin-import") }),
    });
    showAlert(`Imported ${result.preset?.name || "skin"} into My Skins.`, "success");
    await loadMine();
  } catch (err) {
    showAlert(err.message, "error");
  }
});

document.getElementById("skin-external-load")?.addEventListener("click", async () => {
  const raw = document.getElementById("skin-external-code").value.trim();
  const targetSpecies = document.getElementById("skin-external-species").value;
  const resultEl = document.getElementById("skin-external-result");
  const button = document.getElementById("skin-external-load");

  button.disabled = true;
  resultEl.textContent = "Checking external skin code…";
  try {
    const result = await api("/api/skins/external/preview", {
      method: "POST",
      body: JSON.stringify({ rawCode: raw, baseSkin: editorSkin() }),
    });
    applySkinToEditor(result.skin);

    const selectedTargetSpecies = targetSpecies || "Universal";
    if (selectedTargetSpecies) {
      document.getElementById("skin-species").value = selectedTargetSpecies;
    }
    if (!document.getElementById("skin-description").value.trim()) {
      document.getElementById("skin-description").value = `Imported from ${result.sourceLabel || "external skin code"}.`;
    }
    updatePreview();
    activateSkinTab("studio");

    const warningText = (result.warnings || []).join(" ");
    const targetName = document.getElementById("skin-species").selectedOptions[0]?.textContent || "the selected species";
    const sourcePrefix = result.speciesCode ? ` · Source prefix: ${result.speciesCode}` : "";
    resultEl.textContent = `${result.sourceLabel || "External skin"} detected${sourcePrefix} · Target: ${targetName} · ${Number(result.importedColorCount) || 0} colour zones${result.importedIndexCount ? ` · ${result.importedIndexCount} native index values` : ""} loaded.`;
    showAlert(
      `Loaded ${result.sourceLabel || "external skin"} palette into Skin Studio for ${targetName}. The external species prefix does not restrict the target species. Review the preview before saving.${warningText ? ` ${warningText}` : ""}`,
      warningText ? "warning" : "success"
    );
  } catch (err) {
    resultEl.textContent = err.message;
    showAlert(err.message, "error");
  } finally {
    button.disabled = false;
  }
});

async function init() {
  wireTabs();
  buildColorEditor();
  resetEditor();
  await initSpecies();
  me = await window.HDS.loadMe();
  const note = document.getElementById("skin-save-note");
  note.textContent = me.loggedIn ? "Saving is free. Published skins can be priced in Valley Coin." : "Sign in with Steam to save designs.";
  await Promise.all([loadStore(), loadMine(), loadStoredSlots()]);
}

init().catch((err) => showAlert(err.message, "error"));
