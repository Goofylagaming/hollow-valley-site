(() => {
  const api = window.HDS?.api;
  if (!api) return;

  const REQUIRED_COLORS = [
    "body", "markings", "flank", "underbelly", "detail1",
    "eyes", "teeth", "mouth", "claws", "maleDisplay",
  ];

  const state = { pack: null, items: [] };

  function esc(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setAlert(message, kind = "info") {
    const box = document.getElementById("skin-alert");
    if (!box) return;
    box.hidden = !message;
    box.className = `skin-alert ${kind}`;
    box.textContent = message || "";
  }

  function setStatus(message) {
    const el = document.getElementById("hv-pack-status");
    if (el) el.textContent = message;
  }

  function hexToColor(hex) {
    const value = String(hex || "").replace("#", "").toUpperCase();
    if (!/^[0-9A-F]{6}$/.test(value)) throw new Error(`Invalid HEX colour: ${hex}`);
    return {
      r: parseInt(value.slice(0, 2), 16) / 255,
      g: parseInt(value.slice(2, 4), 16) / 255,
      b: parseInt(value.slice(4, 6), 16) / 255,
      a: 1,
    };
  }

  function normalisePack(raw) {
    const pack = Array.isArray(raw)
      ? { format: "hollow-valley-skin-pack", version: 1, name: "Uploaded Hollow Valley Pack", species: "Universal", skins: raw }
      : raw;

    if (!pack || typeof pack !== "object" || !Array.isArray(pack.skins)) {
      throw new Error("This file is not a Hollow Valley skin pack.");
    }
    if (!pack.skins.length) throw new Error("The skin pack is empty.");
    if (pack.skins.length > 50) throw new Error("Skin packs are limited to 50 skins at a time.");

    const items = pack.skins.map((entry, index) => {
      if (!entry || typeof entry !== "object") throw new Error(`Skin ${index + 1} is invalid.`);
      const name = String(entry.name || "").trim();
      if (name.length < 2 || name.length > 60) throw new Error(`Skin ${index + 1} needs a name between 2 and 60 characters.`);
      const colors = entry.colors || entry.skin;
      if (!colors || typeof colors !== "object") throw new Error(`${name} is missing its colour zones.`);

      for (const key of REQUIRED_COLORS) {
        if (!colors[key]) throw new Error(`${name} is missing ${key}.`);
        hexToColor(colors[key]);
      }

      const safeIndex = (value, label) => {
        const number = Number(value ?? 0);
        if (!Number.isInteger(number) || number < 0 || number > 65535) throw new Error(`${name}: ${label} must be 0-65535.`);
        return number;
      };

      return {
        index,
        name,
        description: String(entry.description || "Hollow Valley original skin.").trim().slice(0, 160),
        rarity: String(entry.rarity || "Unclassified").trim().slice(0, 30),
        suggestedPrice: Math.max(0, Math.floor(Number(entry.suggestedPrice) || 0)),
        species: String(entry.species || pack.species || "Universal").trim() || "Universal",
        colors: Object.fromEntries(REQUIRED_COLORS.map((key) => [key, String(colors[key]).toUpperCase()])),
        skin: {
          ...Object.fromEntries(REQUIRED_COLORS.map((key) => [key, hexToColor(colors[key])])),
          patternIndex: safeIndex(entry.patternIndex, "patternIndex"),
          themeIndex: safeIndex(entry.themeIndex, "themeIndex"),
          skinVariation: safeIndex(entry.skinVariation, "skinVariation"),
        },
      };
    });

    return {
      id: String(pack.id || "uploaded-pack").trim().slice(0, 80) || "uploaded-pack",
      name: String(pack.name || "Hollow Valley Skin Pack").trim().slice(0, 100),
      version: Number(pack.version) || 1,
      items,
    };
  }

  function swatches(item) {
    return REQUIRED_COLORS.slice(0, 6).map((key) =>
      `<span title="${esc(key)}" style="background:${esc(item.colors[key])}"></span>`
    ).join("");
  }

  function renderPack(pack) {
    state.pack = pack;
    state.items = pack.items;
    const grid = document.getElementById("skin-library-queue");
    const importButton = document.getElementById("hv-pack-import");
    if (!grid || !importButton) return;

    grid.innerHTML = state.items.map((item) => `
      <article class="skin-card" data-hv-pack-index="${item.index}">
        <div class="skin-card-art" style="--card-body:${esc(item.colors.body)};--card-markings:${esc(item.colors.markings)};--card-flank:${esc(item.colors.flank)};--card-eye:${esc(item.colors.eyes)}">
          <span class="skin-card-pattern"></span><span class="skin-card-eye"></span>
        </div>
        <div class="skin-card-body">
          <div class="skin-card-topline"><span>${esc(item.species)}</span><b>${esc(item.rarity)}</b></div>
          <h3>${esc(item.name)}</h3>
          <p>${esc(item.description)}</p>
          <div class="skin-swatch-row">${swatches(item)}</div>
          <div class="skin-card-meta">
            <span>${item.suggestedPrice.toLocaleString()} VC suggested</span>
            <span>Pattern ${item.skin.patternIndex}</span>
            <span>Theme ${item.skin.themeIndex}</span>
            <span>Variation ${item.skin.skinVariation}</span>
          </div>
        </div>
      </article>
    `).join("");

    importButton.disabled = false;
    importButton.textContent = `Import all ${state.items.length} as drafts`;
    setStatus(`${pack.name}: ${state.items.length} skins ready. One click imports the full pack as unpublished drafts.`);
    setAlert(`Loaded ${pack.name}. Review the previews, then choose Import all ${state.items.length} as drafts.`, "success");
  }

  async function loadBundledPack() {
    const button = document.getElementById("hv-pack-load");
    if (button) button.disabled = true;
    setStatus("Loading Hollow Valley Originals…");
    try {
      const response = await fetch("/assets/hollow-valley-skin-pack.json?v=1", { cache: "no-store" });
      if (!response.ok) throw new Error(`Skin pack could not be loaded (${response.status}).`);
      renderPack(normalisePack(await response.json()));
    } catch (error) {
      setStatus(error.message);
      setAlert(error.message, "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function loadUploadedPack(file) {
    if (!file) return;
    if (file.size > 250000) return setAlert("Skin pack file is too large.", "warning");
    try {
      const raw = JSON.parse(await file.text());
      renderPack(normalisePack(raw));
    } catch (error) {
      setStatus(error.message);
      setAlert(`Could not load skin pack: ${error.message}`, "error");
    }
  }

  async function importAll() {
    if (!state.pack || !state.items.length) return setAlert("Load a Hollow Valley skin pack first.", "warning");
    const button = document.getElementById("hv-pack-import");
    button.disabled = true;
    let saved = 0;

    try {
      for (const item of state.items) {
        setStatus(`Importing ${saved + 1}/${state.items.length}: ${item.name}…`);
        const metadata = `${item.description} · Rarity: ${item.rarity} · Suggested price: ${item.suggestedPrice.toLocaleString()} VC`;
        await api("/api/skins/studio", {
          method: "POST",
          body: JSON.stringify({
            species: item.species,
            name: item.name,
            description: `[External Library:${state.pack.name}] ${metadata}`.slice(0, 240),
            skin: item.skin,
            idempotencyKey: `hv-pack:${state.pack.id}:v${state.pack.version}:${item.index}`,
          }),
        });
        saved += 1;
      }

      setStatus(`Imported ${saved}/${state.items.length} skins. All remain unpublished drafts.`);
      setAlert(`Imported the full ${state.pack.name}: ${saved} skins saved as drafts. Nothing was published automatically.`, "success");
      document.getElementById("skin-library-refresh")?.click();
    } catch (error) {
      setStatus(`Imported ${saved}/${state.items.length} before stopping: ${error.message}`);
      setAlert(`Batch stopped after ${saved} skins: ${error.message}. Re-running is safe because the pack uses stable idempotency keys.`, "warning");
      button.disabled = false;
      return;
    }

    button.disabled = false;
  }

  function installControls() {
    const textarea = document.getElementById("skin-library-batch");
    if (!textarea || document.getElementById("hv-pack-tools")) return;

    const host = document.createElement("div");
    host.id = "hv-pack-tools";
    host.className = "skin-capture-note";
    host.innerHTML = `
      <strong>Hollow Valley batch packs</strong>
      <span>Load the bundled 20-skin collection or choose a future Hollow Valley JSON pack. Names, descriptions, rarity, prices and all ten colour zones are preserved automatically.</span>
      <div class="skin-editor-actions">
        <button class="primary-button green" id="hv-pack-load" type="button">Load Hollow Valley 20-Pack <b>→</b></button>
        <label class="small-button" for="hv-pack-file">Choose JSON pack</label>
        <input id="hv-pack-file" type="file" accept="application/json,.json" hidden>
        <button class="small-button" id="hv-pack-import" type="button" disabled>Import all as drafts</button>
        <span id="hv-pack-status">No Hollow Valley pack loaded.</span>
      </div>
    `;
    textarea.parentElement.insertBefore(host, textarea);

    document.getElementById("hv-pack-load")?.addEventListener("click", loadBundledPack);
    document.getElementById("hv-pack-file")?.addEventListener("change", (event) => loadUploadedPack(event.target.files?.[0]));
    document.getElementById("hv-pack-import")?.addEventListener("click", importAll);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installControls, { once: true });
  } else {
    installControls();
  }
})();
