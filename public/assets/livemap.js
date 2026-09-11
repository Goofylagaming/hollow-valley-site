const { api, escapeHtml } = window.HDS;

async function loadMap() {
  const status = document.getElementById("map-status");
  const list = document.getElementById("contacts-list");
  try {
    const data = await api("/api/map/positions");
    if (!data.connected) {
      status.textContent = "Server feed not connected yet";
      return;
    }
    status.textContent = `Connected • ${data.positions.length} contacts`;
    if (data.positions.length) {
      list.innerHTML = data.positions
        .map((p) => `<div><span>${escapeHtml(p.name)}</span><b>${escapeHtml(p.species || "")}</b></div>`)
        .join("");
    }
  } catch (err) {
    status.textContent = "Unable to reach map feed";
    console.error(err);
  }
}

loadMap();
