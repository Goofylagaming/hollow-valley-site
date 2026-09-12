const { api, escapeHtml } = window.HDS;

const REFRESH_MS = 20_000;
const GRID_SIZE = 20;
// Cartography is static, so it's fetched once and cached for the page's life.
let cartography = null;

function pct(n) {
  return `${(n * 100).toFixed(2)}%`;
}

function statBar(label, value) {
  if (!Number.isFinite(value)) return "";
  const percent = Math.round(value * 100);
  const low = percent <= 25 ? " low" : "";
  return `<div class="vital"><span class="vital-label">${escapeHtml(label)}</span>
    <span class="vital-track"><span class="vital-fill${low}" style="width:${percent}%"></span></span>
    <span class="vital-value">${percent}%</span></div>`;
}

// The grid overlay is drawn once; only markers are re-rendered on refresh.
function buildGrid() {
  const grid = document.getElementById("map-grid");
  if (!grid || grid.childElementCount) return;
  const step = 100 / GRID_SIZE;
  let html = "";
  for (let i = 1; i < GRID_SIZE; i += 1) {
    html += `<span class="grid-line v" style="left:${i * step}%"></span>`;
    html += `<span class="grid-line h" style="top:${i * step}%"></span>`;
  }
  for (let i = 0; i < GRID_SIZE; i += 1) {
    const offset = i * step + step / 2;
    html += `<span class="grid-label col" style="left:${offset}%">${i + 1}</span>`;
    html += `<span class="grid-label row" style="top:${offset}%">${String.fromCharCode(65 + i)}</span>`;
  }
  grid.innerHTML = html;
}

function renderRegions(regions) {
  const layer = document.getElementById("map-regions");
  if (!layer || layer.childElementCount || !regions) return;
  layer.innerHTML = regions
    .filter((r) => r.position)
    .map(
      (r) =>
        `<span class="region-label" style="left:${pct(r.position.left)};top:${pct(r.position.top)}">${escapeHtml(r.name)}</span>`
    )
    .join("");
}

// Draws the island itself: coastline, road network and place names, projected
// with the same Lat/Long -> 0..1 mapping the server uses for player positions.
async function renderCartography() {
  const host = document.getElementById("map-base");
  if (!host || cartography === "failed" || host.childElementCount) return;

  if (!cartography) {
    try {
      const res = await fetch("assets/map-data.json?v=1");
      if (!res.ok) throw new Error(`map data ${res.status}`);
      cartography = await res.json();
    } catch (err) {
      cartography = "failed";
      console.error("map cartography unavailable", err);
      return;
    }
  }

  const b = cartography.bounds;
  const W = 1000;
  const H = 1000;
  const px = (long) => (((long - b.minY) / (b.maxY - b.minY)) * W).toFixed(1);
  const py = (lat) => (((lat - b.minX) / (b.maxX - b.minX)) * H).toFixed(1);
  const toPath = (pts, close) =>
    pts.map((p, i) => `${i ? "L" : "M"}${px(p.long)} ${py(p.lat)}`).join("") + (close ? "Z" : "");

  const svg = [`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="map-cartography" aria-hidden="true">`];

  for (const ring of cartography.islands || []) {
    svg.push(`<path class="coast" d="${toPath(ring, true)}"/>`);
  }
  for (const road of cartography.roads || []) {
    svg.push(`<path class="road${road.trail ? " trail" : ""}" d="${toPath(road.points, false)}"/>`);
  }
  for (const cave of cartography.caves || []) {
    svg.push(`<circle class="cave" cx="${px(cave.long)}" cy="${py(cave.lat)}" r="4"/>`);
  }
  for (const w of cartography.water || []) {
    svg.push(`<circle class="water-dot" cx="${px(w.long)}" cy="${py(w.lat)}" r="4"/>`);
    svg.push(`<text class="lbl water" x="${px(w.long)}" y="${py(w.lat) - 9}">${escapeHtml(w.name)}</text>`);
  }
  for (const l of cartography.land || []) {
    svg.push(`<circle class="land-dot" cx="${px(l.long)}" cy="${py(l.lat)}" r="3.5"/>`);
    // Gates, collapsed points and numbered sites are dense and self-explanatory
    // from the grid reference, so they stay as dots rather than adding label noise.
    if (/^(Gate|Collapsed point|Site)\b/i.test(l.name)) continue;
    const name = l.name.replace(/\s*[[(].*$/, "").trim();
    if (!name) continue;
    svg.push(`<text class="lbl land" x="${px(l.long)}" y="${py(l.lat) - 8}">${escapeHtml(name)}</text>`);
  }
  for (const a of cartography.areas || []) {
    svg.push(`<text class="lbl area ${a.size}" x="${px(a.long)}" y="${py(a.lat)}">${escapeHtml(a.name)}</text>`);
  }

  svg.push("</svg>");
  host.innerHTML = svg.join("");

  const credit = document.getElementById("map-credit");
  if (credit && cartography.attribution) {
    credit.textContent = `${cartography.attribution} \u2022 ${cartography.map}`;
  }
}

function renderMarkers(data) {
  const layer = document.getElementById("map-markers");
  if (!layer) return;
  const markers = [];

  if (data.me && data.me.position) {
    markers.push(
      `<span class="marker me" style="left:${pct(data.me.position.left)};top:${pct(data.me.position.top)}" title="${escapeHtml(data.me.name)} - ${escapeHtml(data.me.species || "")}">
         <span class="marker-dot"></span><span class="marker-name">${escapeHtml(data.me.name)}</span></span>`
    );
  }

  // Only populated for admins; regular players never receive other positions.
  if (data.othersHavePositions) {
    for (const other of data.others) {
      if (!other.position) continue;
      markers.push(
        `<span class="marker other" style="left:${pct(other.position.left)};top:${pct(other.position.top)}" title="${escapeHtml(other.name)} - ${escapeHtml(other.species || "")}">
           <span class="marker-dot"></span></span>`
      );
    }
  }

  layer.innerHTML = markers.join("");
}

function renderMe(data) {
  const panel = document.getElementById("my-character");
  if (!panel) return;

  if (!data.connected) {
    panel.innerHTML = `<div class="empty-roster"><strong>Server offline</strong><span>Your character will appear here when Hollow Valley is back online.</span></div>`;
    return;
  }
  if (!data.linked) {
    panel.innerHTML = `<div class="empty-roster"><strong>Steam account not linked</strong><span>Sign in with Steam so we can match your website account to your in-game character.</span></div>`;
    return;
  }
  if (!data.me) {
    panel.innerHTML = `<div class="empty-roster"><strong>Not currently in-game</strong><span>Join Hollow Valley and your character will show up here within 30 seconds.</span></div>`;
    return;
  }

  const me = data.me;
  const growth = Number.isFinite(me.growth) ? `${Math.round(me.growth * 100)}%` : "—";
  const mutations = me.mutations && me.mutations.length
    ? me.mutations.map((m) => `<span class="mut-chip">${escapeHtml(m)}</span>`).join("")
    : `<span class="mut-none">No mutations</span>`;

  panel.innerHTML = `
    <div class="char-card">
      <div class="char-head">
        <div>
          <p class="overline green">YOUR CHARACTER</p>
          <h2>${escapeHtml(me.species || "Unknown")}${me.isPrime ? ` <span class="prime-tag">PRIME ELDER</span>` : ""}</h2>
          <p class="char-sub">${escapeHtml(me.name)}${me.gender ? ` &middot; ${escapeHtml(me.gender)}` : ""} &middot; Growth ${growth}</p>
        </div>
        <div class="char-loc">
          <span class="grid-ref">${escapeHtml(me.grid || "—")}</span>
          <span class="loc-region">${escapeHtml(me.region || "")}</span>
          <span class="loc-coords">Lat ${me.coords ? me.coords.lat : "—"} &middot; Long ${me.coords ? me.coords.long : "—"}</span>
        </div>
      </div>
      <div class="vitals">
        ${statBar("Health", me.health)}
        ${statBar("Stamina", me.stamina)}
        ${statBar("Hunger", me.hunger)}
        ${statBar("Thirst", me.thirst)}
      </div>
      <div class="mut-row">${mutations}</div>
    </div>`;
}

function renderOthers(data) {
  const list = document.getElementById("contacts-list");
  if (!list) return;

  if (!data.connected || !data.others.length) {
    list.innerHTML = `<div class="empty-roster"><strong>No other survivors</strong><span>${
      data.connected ? "Nobody else is online right now." : "The live map goes active once the server is connected."
    }</span></div>`;
    return;
  }

  list.innerHTML = data.others
    .map(
      (p) =>
        `<div><span>${escapeHtml(p.name)}${p.isPrime ? ` <em class="prime-inline">prime</em>` : ""}</span><b>${escapeHtml(p.species || "Unknown")}</b></div>`
    )
    .join("");
}

async function loadMap() {
  const status = document.getElementById("map-status");
  try {
    const data = await api("/api/map/positions");
    buildGrid();
    renderCartography();
    renderMarkers(data);
    renderMe(data);
    renderOthers(data);

    if (!data.connected) {
      status.textContent = data.configured ? "Server offline" : "Server feed not connected yet";
    } else {
      status.textContent = `Live \u2022 ${data.playerCount}/${data.maxPlayers} online`;
    }
  } catch (err) {
    // The map itself is public; only the player overlay needs a session.
    buildGrid();
    renderCartography();
    if (err && err.status === 401) {
      status.textContent = "Sign in to see your character on the map";
      const panel = document.getElementById("my-character");
      if (panel) {
        panel.innerHTML = `<div class="empty-roster"><strong>Sign in required</strong><span>Log in with Steam to track your in-game character here.</span></div>`;
      }
      return;
    }
    status.textContent = "Unable to reach map feed";
    console.error(err);
  }
}

loadMap();
setInterval(loadMap, REFRESH_MS);
