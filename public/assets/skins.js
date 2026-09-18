const { api, escapeHtml } = window.HDS;

function colorSwatch(color) {
  if (!color || typeof color !== "object") return "";
  const clamp = (value) => Math.max(0, Math.min(255, Math.round((Number(value) || 0) * 255)));
  return `rgb(${clamp(color.r)}, ${clamp(color.g)}, ${clamp(color.b)})`;
}

function renderPreset(preset) {
  const skin = preset.skin || {};
  const colors = ["body", "markings", "flank", "underbelly", "eyes"]
    .map((key) => colorSwatch(skin[key]))
    .filter(Boolean);

  return `
    <article class="storage-card">
      <h3>${escapeHtml(preset.name || "Unnamed skin")}${preset.isPremium || preset.is_premium ? " ★" : ""}</h3>
      <small>${escapeHtml(preset.species || "Unknown species")} · Pattern ${Number(skin.patternIndex ?? 0)} · Theme ${Number(skin.themeIndex ?? 0)}</small>
      <div class="skin-color-preview" aria-label="Skin color preview">
        ${colors.map((color) => `<span style="background:${escapeHtml(color)}"></span>`).join("")}
      </div>
      <p class="section-intro">Apply this preset to a parked ${escapeHtml(preset.species || "dinosaur")} from My Dinos.</p>
      <div class="actions"><a class="small-button" href="/mydinos">Open My Dinos</a></div>
    </article>
  `;
}

async function loadLibrary() {
  const library = document.getElementById("skins-library");
  const note = document.getElementById("skins-cost-note");
  try {
    const data = await api("/api/skins/mine");
    const presets = Array.isArray(data.presets) ? data.presets : [];
    if (note) {
      note.textContent = data.systemEnabled
        ? `${Number(data.createCost || 0).toLocaleString()} Valley Coin to save a new preset`
        : "Skin creation currently locked";
    }
    if (!presets.length) {
      library.innerHTML = `<div class="empty-roster"><strong>No real skin presets yet</strong><span>Park a dinosaur, open My Dinos, then use its Skins button to save the captured skin.</span></div>`;
      return;
    }
    library.innerHTML = presets.map(renderPreset).join("");
  } catch (err) {
    library.innerHTML = `<div class="empty-roster"><strong>Skin library unavailable</strong><span>${escapeHtml(err.message || "Could not load skin presets.")}</span></div>`;
  }
}

async function init() {
  const me = await window.HDS.loadMe();
  document.getElementById("skins-guard").hidden = me.loggedIn;
  document.getElementById("skins-content").hidden = !me.loggedIn;
  if (me.loggedIn) await loadLibrary();
}

init();
