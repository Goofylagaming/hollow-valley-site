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

function skinCard(preset, mode) {
  const owned = Boolean(preset.owned || preset.isPremium || mode === "mine");
  const price = Number(preset.price) || 0;
  const description = preset.description || (preset.published ? "Published Hollow Valley skin." : "Saved Skin Studio design.");
  const ownerBadge = preset.owner_steam_id && me.user?.steam_id === preset.owner_steam_id ? "Creator" : "";
  const status = preset.published ? (preset.isPremium ? "Free" : `${price.toLocaleString()} VC`) : "Draft";

  const actions = [];
  if (mode === "store" && !owned) {
    actions.push(`<button class="small-button skin-buy" data-id="${preset.id}">Unlock · ${price.toLocaleString()} VC</button>`);
  }
  if (owned) {
    actions.push(`<button class="small-button skin-wear" data-id="${preset.id}">Wear live</button>`);
    actions.push(`<button class="small-button skin-apply-stored" data-id="${preset.id}">Apply to parked</button>`);
  }
  if (mode === "mine" && me.user?.is_admin) {
    actions.push(`<button class="small-button skin-publish" data-id="${preset.id}" data-price="${price}">${preset.published ? "Update shop" : "Publish"}</button>`);
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
          ${ownerBadge ? `<span>${ownerBadge}</span>` : ""}
        </div>
        <div class="skin-card-code">${preset.share_code ? `Share: <strong>${escapeHtml(preset.share_code)}</strong>` : ""}</div>
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

  root.querySelectorAll(".skin-publish").forEach((button) => button.addEventListener("click", async () => {
    const priceRaw = prompt("Valley Coin price (0 = free):", button.dataset.price || "0");
    if (priceRaw === null) return;
    const price = Number(priceRaw);
    if (!Number.isInteger(price) || price < 0) return showAlert("Price must be a whole number of Valley Coin.", "warning");
    const description = prompt("Shop description (optional):", "") ?? "";
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

async function loadMine() {
  const guard = document.getElementById("skin-mine-guard");
  const grid = document.getElementById("skin-mine-grid");
  if (!me.loggedIn || !me.user?.steam_id) {
    guard.hidden = false;
    grid.hidden = true;
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
  } catch (err) {
    grid.innerHTML = `<div class="empty-roster"><strong>Could not load My Skins</strong><span>${escapeHtml(err.message)}</span></div>`;
  }
}

async function loadStoredSlots() {
  const select = document.getElementById("skin-stored-slot");
  if (!me.loggedIn || !me.user?.steam_id) return;
  try {
    const dinos = await api("/api/mydinos");
    select.innerHTML = '<option value="">Parked dino slot (optional)</option>' + (dinos || []).map((dino) => {
      const slot = dino.slot || dino.name || "";
      const label = dino.species || dino.speciesId || dino.classPath || "Stored dino";
      return `<option value="${escapeHtml(slot)}">${escapeHtml(label)} · ${escapeHtml(slot)}</option>`;
    }).join("");
  } catch {
    select.innerHTML = '<option value="">Parked dinos unavailable</option>';
  }
}

function wireTabs() {
  document.querySelectorAll(".skin-tab").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".skin-tab").forEach((tab) => tab.classList.toggle("active", tab === button));
    document.querySelectorAll(".skin-panel").forEach((panel) => panel.classList.toggle("active", panel.dataset.skinPanel === button.dataset.skinTab));
  }));
}

async function initSpecies() {
  speciesList = await api("/api/species");
  const options = speciesList.map((species) => `<option value="${escapeHtml(species.id)}">${escapeHtml(species.name)}</option>`).join("");
  document.getElementById("skin-species").innerHTML = options;
  document.getElementById("skin-store-species").innerHTML = '<option value="">All species</option>' + options;
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

document.getElementById("skin-reset").addEventListener("click", resetEditor);

document.getElementById("skin-save").addEventListener("click", async () => {
  if (!me.loggedIn || !me.user?.steam_id) return showAlert("Sign in with Steam before saving a skin.", "warning");
  const name = document.getElementById("skin-name").value.trim();
  if (name.length < 2) return showAlert("Give the skin a name first.", "warning");
  const button = document.getElementById("skin-save");
  button.disabled = true;
  try {
    const result = await api("/api/skins/studio", {
      method: "POST",
      body: JSON.stringify({
        species: document.getElementById("skin-species").value,
        name,
        description: document.getElementById("skin-description").value.trim(),
        skin: editorSkin(),
        idempotencyKey: requestKey("skin-save"),
      }),
    });
    showAlert(`Saved ${result.preset?.name || name}. Share code: ${result.preset?.share_code || "created"}.`, "success");
    await loadMine();
  } catch (err) {
    showAlert(err.message, "error");
  } finally {
    button.disabled = false;
  }
});

document.getElementById("skin-store-refresh").addEventListener("click", loadStore);
document.getElementById("skin-store-species").addEventListener("change", loadStore);
document.getElementById("skin-mine-refresh").addEventListener("click", loadMine);

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
