const { api, escapeHtml } = window.HDS;

const REFRESH_MS = 30_000;

// Static Gateway layer data - fetched once, then re-rendered locally whenever a
// layer toggle changes.
let mapData = null;
let activityHistory = null;
let lastMapState = null;

// Point layers render as dots with a hover label; label layers render as plain
// text on the map; path layers render as SVG polylines.
const POINT_LAYERS = ["saltLicks", "water", "wallows"];
const LABEL_LAYERS = ["areas", "landmarks"];
// Zones are filled areas (ellipses or polygons); caves stay open outlines.
const ZONE_LAYERS = ["migrations", "patrolZones", "sanctuaries"];
const PATH_LAYERS = ["caves"];
const ALL_LAYERS = [...POINT_LAYERS, ...LABEL_LAYERS, ...PATH_LAYERS, ...ZONE_LAYERS, "players"];

function pct(n) {
  return `${(n * 100).toFixed(2)}%`;
}

function isLayerOn(key) {
  const input = document.getElementById(`layer-${key}`);
  return Boolean(input && input.checked);
}

function statBar(label, value) {
  if (!Number.isFinite(value)) return "";
  const percent = Math.round(value * 100);
  const low = percent <= 25 ? " low" : "";
  return `<div class="vital"><span class="vital-label">${escapeHtml(label)}</span>
    <span class="vital-track"><span class="vital-fill${low}" style="width:${percent}%"></span></span>
    <span class="vital-value">${percent}%</span></div>`;
}

// Shapes are drawn into a 0..1000 viewBox with preserveAspectRatio="none", so
// projected fractions map straight onto it regardless of the rendered size.
function svgUnits(n) {
  return (n * 1000).toFixed(1);
}

function zoneElement(key, zone) {
  const title = `<title>${escapeHtml(zone.name)}</title>`;

  if (zone.shape === "ellipse") {
    const cx = svgUnits(zone.left);
    const cy = svgUnits(zone.top);
    // Vulnona stores a rotation for each zone ellipse; without it the larger
    // migration zones sit at visibly the wrong angle against the terrain.
    const rotate = zone.rotation
      ? ` transform="rotate(${zone.rotation} ${cx} ${cy})"`
      : "";
    return `<ellipse class="zone ${key}" cx="${cx}" cy="${cy}" rx="${svgUnits(zone.rx)}" ry="${svgUnits(zone.ry)}"${rotate}>${title}</ellipse>`;
  }

  const points = zone.points.map(([l, t]) => `${svgUnits(l)},${svgUnits(t)}`).join(" ");
  return `<polygon class="zone ${key}" points="${points}">${title}</polygon>`;
}

function renderShapes() {
  const svg = document.getElementById("tracker-shapes");
  if (!svg) return;
  if (!mapData) {
    svg.innerHTML = "";
    return;
  }

  const parts = [];

  for (const key of ZONE_LAYERS) {
    if (!isLayerOn(key)) continue;
    for (const zone of mapData.layers[key] || []) {
      parts.push(zoneElement(key, zone));
    }
  }

  for (const key of PATH_LAYERS) {
    if (!isLayerOn(key)) continue;
    for (const shape of mapData.layers[key] || []) {
      if (shape.points.length < 2) continue;
      const points = shape.points.map(([l, t]) => `${svgUnits(l)},${svgUnits(t)}`).join(" ");
      parts.push(`<polyline class="shape ${key}" points="${points}"><title>${escapeHtml(shape.name)}</title></polyline>`);
    }
  }

  svg.innerHTML = parts.join("");
}

function renderPois() {
  const layer = document.getElementById("tracker-pois");
  const labels = document.getElementById("tracker-labels");
  if (!layer || !labels) return;
  if (!mapData) {
    layer.innerHTML = "";
    labels.innerHTML = "";
    return;
  }

  const dots = [];
  for (const key of POINT_LAYERS) {
    if (!isLayerOn(key)) continue;
    for (const poi of mapData.layers[key] || []) {
      dots.push(
        `<span class="poi ${key}" style="left:${pct(poi.left)};top:${pct(poi.top)}"><span class="poi-label">${escapeHtml(poi.name)}</span></span>`
      );
    }
  }
  layer.innerHTML = dots.join("");

  const text = [];
  for (const key of LABEL_LAYERS) {
    if (!isLayerOn(key)) continue;
    for (const poi of mapData.layers[key] || []) {
      text.push(
        `<span class="map-label ${key}" style="left:${pct(poi.left)};top:${pct(poi.top)}">${escapeHtml(poi.name)}</span>`
      );
    }
  }
  labels.innerHTML = text.join("");
}

function renderMarkers(data) {
  const layer = document.getElementById("tracker-markers");
  if (!layer) return;
  if (!data || !isLayerOn("players")) {
    layer.innerHTML = "";
    return;
  }

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
  const panel = document.getElementById("tracker-character");
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
  const list = document.getElementById("tracker-contacts");
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

function formatVerifiedTime(value) {
  if (!value) return "No data";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "No data";
  return date.toLocaleString();
}

function renderActivityHistory(data) {
  activityHistory = data || null;
  const tracking = data?.trackingEnabled !== false;
  const samples = Number(data?.sampleCount || 0);
  const lastVerified = data?.lastVerifiedAt || null;

  const lastEl = document.getElementById("map-last-verified");
  const peakEl = document.getElementById("map-peak-online");
  const averageEl = document.getElementById("map-average-online");
  const uniqueEl = document.getElementById("map-unique-players");
  const note = document.getElementById("map-history-note");

  if (lastEl) lastEl.textContent = lastVerified ? formatVerifiedTime(lastVerified) : "No data";
  if (peakEl) peakEl.textContent = samples ? String(Number(data.peakConcurrent || 0)) : "—";
  if (averageEl) averageEl.textContent = samples ? String(Number(data.averageOnline || 0)) : "—";
  if (uniqueEl) uniqueEl.textContent = samples ? String(Number(data.uniquePlayers || 0)) : "—";

  if (note) {
    if (!tracking) {
      note.textContent = "Verified presence tracking is currently disabled. Static Gateway layers remain available.";
    } else if (!samples) {
      note.textContent = "No verified activity samples exist in the last 24 hours. No positions are inferred from missing data.";
    } else {
      const species = (data.topSpecies || []).slice(0, 3).map((item) => item.species).filter(Boolean);
      note.textContent = `Verified 24-hour activity · ${samples} samples${species.length ? ` · most observed species: ${species.join(", ")}` : ""}.`;
    }
  }

  if (lastMapState) renderConnectionStatus(lastMapState);
}

function renderConnectionStatus(data) {
  const status = document.getElementById("tracker-status");
  if (!status || !data) return;

  if (!data.connected) {
    const lastVerified = activityHistory?.lastVerifiedAt;
    status.textContent = data.configured
      ? `Server offline · no live positions shown${lastVerified ? ` · last verified activity ${formatVerifiedTime(lastVerified)}` : ""}`
      : "Server feed not configured · no live positions shown";
    status.classList.add("offline");
    return;
  }

  status.classList.remove("offline");
  status.textContent = `Live · ${data.playerCount}/${data.maxPlayers} online · positions from current server snapshot`;
}

async function loadActivityHistory() {
  try {
    const data = await api("/api/map/activity?hours=24");
    renderActivityHistory(data);
  } catch (err) {
    activityHistory = null;
    const note = document.getElementById("map-history-note");
    if (note) note.textContent = "Verified activity history is unavailable. Static Gateway layers remain available.";
    console.error("Failed to load map activity history", err);
  }
}

async function loadLayers() {
  const note = document.getElementById("layer-note");
  try {
    const data = await api("/api/mapdata");
    mapData = data;
    renderShapes();
    renderPois();
    if (note) {
      const counts = data.layers;
      note.textContent = `${counts.saltLicks.length} salt licks, ${counts.migrations.length} migration zones, ${counts.patrolZones.length} patrol zones, ${counts.sanctuaries.length} sanctuaries (${data.mapVersion}).`;
    }
  } catch (err) {
    if (note) note.textContent = "Map layer data is unavailable right now. Live player tracking still works.";
    console.error(err);
  }
}

async function loadMap() {
  const status = document.getElementById("tracker-status");
  try {
    const data = await api("/api/map/positions");
    lastMapState = data;
    renderMarkers(data);
    renderMe(data);
    renderOthers(data);
    renderConnectionStatus(data);
  } catch (err) {
    // Static map layers and aggregate history remain available without player overlays.
    renderMarkers(null);
    lastMapState = null;
    if (err && err.status === 401) {
      if (status) status.textContent = "Sign in to see your character · no player positions are shown";
      const panel = document.getElementById("tracker-character");
      if (panel) {
        panel.innerHTML = `<div class="empty-roster"><strong>Sign in required</strong><span>Log in with Steam to track your current character. Static map layers and verified aggregate activity remain available.</span></div>`;
      }
      return;
    }
    if (status) status.textContent = "Live position feed unavailable · no player positions are shown";
    console.error(err);
  }
}

for (const key of ALL_LAYERS) {
  const input = document.getElementById(`layer-${key}`);
  if (!input) continue;
  input.addEventListener("change", () => {
    if (key === "players") {
      loadMap();
    } else {
      renderShapes();
      renderPois();
    }
  });
}

function initMapZoom() {
  const viewport = document.getElementById("map-viewport");
  const world = document.getElementById("map-world");
  const zoomLabel = document.getElementById("zoom-label");
  const zoomInBtn = document.getElementById("zoom-in");
  const zoomOutBtn = document.getElementById("zoom-out");
  const resetBtn = document.getElementById("zoom-reset");

  if (!viewport || !world) return;

  const MIN_ZOOM = 1;
  const MAX_ZOOM = 8;
  const STEP = 1.35;

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let dragOriginX = 0;
  let dragOriginY = 0;

  let touchDist = 0;
  let touchMidX = 0;
  let touchMidY = 0;

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function constrain() {
    const vw = viewport.clientWidth;
    const vh = viewport.clientHeight;
    const ww = vw * scale;
    const wh = vh * scale;
    if (scale <= 1) {
      offsetX = (vw - ww) / 2;
      offsetY = (vh - wh) / 2;
    } else {
      offsetX = clamp(offsetX, vw - ww, 0);
      offsetY = clamp(offsetY, vh - wh, 0);
    }
  }

  function render() {
    constrain();
    world.style.transform = `translate(${offsetX.toFixed(2)}px, ${offsetY.toFixed(2)}px) scale(${scale.toFixed(4)})`;
    if (zoomLabel) {
      zoomLabel.textContent = `${Math.round(scale * 100)}%`;
    }
  }

  function zoomAt(clientX, clientY, factor) {
    const rect = viewport.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;
    const oldScale = scale;
    const newScale = clamp(scale * factor, MIN_ZOOM, MAX_ZOOM);
    if (newScale === oldScale) return;

    const worldX = (mouseX - offsetX) / oldScale;
    const worldY = (mouseY - offsetY) / oldScale;
    scale = newScale;
    offsetX = mouseX - worldX * scale;
    offsetY = mouseY - worldY * scale;
    render();
  }

  function resetMap() {
    scale = 1;
    offsetX = 0;
    offsetY = 0;
    render();
  }

  if (zoomInBtn) {
    zoomInBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const rect = viewport.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, STEP);
    });
  }

  if (zoomOutBtn) {
    zoomOutBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const rect = viewport.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1 / STEP);
    });
  }

  if (resetBtn) {
    resetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      resetMap();
    });
  }

  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? STEP : 1 / STEP;
    zoomAt(e.clientX, e.clientY, factor);
  }, { passive: false });

  viewport.addEventListener("dblclick", (e) => {
    if (e.target.closest(".map-controls")) return;
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, STEP);
  });

  viewport.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".map-controls")) return;
    dragging = true;
    viewport.classList.add("is-dragging");
    try { viewport.setPointerCapture(e.pointerId); } catch (_) {}
    startX = e.clientX;
    startY = e.clientY;
    dragOriginX = offsetX;
    dragOriginY = offsetY;
  });

  viewport.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    offsetX = dragOriginX + (e.clientX - startX);
    offsetY = dragOriginY + (e.clientY - startY);
    render();
  });

  function stopDrag(e) {
    if (!dragging) return;
    dragging = false;
    viewport.classList.remove("is-dragging");
    try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
  }

  viewport.addEventListener("pointerup", stopDrag);
  viewport.addEventListener("pointercancel", stopDrag);

  viewport.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
      dragging = false;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      touchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      touchMidX = (t1.clientX + t2.clientX) / 2;
      touchMidY = (t1.clientY + t2.clientY) / 2;
    }
  }, { passive: true });

  viewport.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2 && touchDist > 0) {
      e.preventDefault();
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const newDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const factor = newDist / touchDist;
      touchDist = newDist;
      touchMidX = (t1.clientX + t2.clientX) / 2;
      touchMidY = (t1.clientY + t2.clientY) / 2;
      zoomAt(touchMidX, touchMidY, factor);
    }
  }, { passive: false });

  viewport.addEventListener("touchend", () => {
    touchDist = 0;
  }, { passive: true });

  window.addEventListener("resize", render);

  resetMap();
}

initMapZoom();
loadLayers();
loadActivityHistory();
loadMap();
setInterval(loadMap, REFRESH_MS);
setInterval(loadActivityHistory, 5 * 60_000);
