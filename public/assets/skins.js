const { api, escapeHtml } = window.HDS;

async function loadSpeciesOptions() {
  const list = await api("/api/species");
  const select = document.getElementById("skin-species");
  select.innerHTML = list.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  return list;
}

async function loadLibrary() {
  const library = document.getElementById("skins-library");
  try {
    const grouped = await api("/api/skins");
    const withSkins = grouped.filter((entry) => entry.skins.length);
    if (!withSkins.length) {
      library.innerHTML = `<div class="empty-roster"><strong>No skins yet</strong><span>Be the first to create one.</span></div>`;
      return;
    }
    library.innerHTML = withSkins
      .map(
        (entry) => `<div class="storage-card">
          <h3>${escapeHtml(entry.speciesId)}</h3>
          <div class="stat-row">${entry.skins
            .map((skin) => `<span class="tag-pill">${escapeHtml(skin.name)}${skin.is_premium ? " ★" : ""}</span>`)
            .join("")}</div>
        </div>`
      )
      .join("");
  } catch (err) {
    console.error("Failed to load skins", err);
  }
}

document.getElementById("skin-create-btn")?.addEventListener("click", async () => {
  const speciesId = document.getElementById("skin-species").value;
  const name = document.getElementById("skin-name").value.trim();
  if (!name) return alert("Enter a skin name");
  try {
    await api("/api/skins", { method: "POST", body: JSON.stringify({ speciesId, name }) });
    document.getElementById("skin-name").value = "";
    await loadLibrary();
    alert("Skin created! Apply it to a dino from My Dinos.");
  } catch (err) {
    alert(err.message);
  }
});

async function init() {
  await loadSpeciesOptions();
  const me = await window.HDS.loadMe();
  document.getElementById("skins-guard").hidden = me.loggedIn;
  document.getElementById("skins-create").hidden = !me.loggedIn;
  await loadLibrary();
}

init();
