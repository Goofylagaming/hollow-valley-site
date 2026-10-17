(() => {
  const HISTORY_MS = 60 * 60 * 1000;
  const MAX_POINTS = 900;
  const MIN_MOVE = 0.0005;
  const MAX_CONTINUOUS_JUMP = 0.08;
  const STORAGE_PREFIX = "hollow-valley-live-trail:v1:";
  const ENABLED_KEY = "hollow-valley-live-trail-enabled";
  const WINDOW_KEY = "hollow-valley-live-trail-window";
  const MODE_KEY = "hollow-valley-live-trail-mode";
  const VALID_WINDOWS = new Set([10, 30, 60]);
  const VALID_MODES = new Set(["both", "breadcrumb", "footprints"]);

  let storageKey = null;
  let state = { signature: null, lastGrowth: null, points: [] };
  let mapBounds = null;
  let rerenderTimer = null;

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function safeTime(value) {
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : Date.now();
  }

  function storageGet(key, fallback = null) {
    try {
      const value = localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, String(value)); } catch {}
  }

  function enabled() {
    return Boolean(document.getElementById("layer-trails")?.checked);
  }

  function selectedWindowMinutes() {
    const select = document.getElementById("trail-window");
    const value = Number(select?.value || storageGet(WINDOW_KEY, 30));
    return VALID_WINDOWS.has(value) ? value : 30;
  }

  function selectedMode() {
    const select = document.getElementById("trail-mode");
    const value = String(select?.value || storageGet(MODE_KEY, "both"));
    return VALID_MODES.has(value) ? value : "both";
  }

  function cleanPoints(points, now = Date.now()) {
    return (Array.isArray(points) ? points : [])
      .filter((point) => {
        const x = finite(point?.x);
        const y = finite(point?.y);
        const t = finite(point?.t);
        return x !== null && y !== null && t !== null && now - t <= HISTORY_MS;
      })
      .slice(-MAX_POINTS)
      .map((point) => ({
        x: Number(point.x),
        y: Number(point.y),
        t: Number(point.t),
        breakBefore: Boolean(point.breakBefore),
      }));
  }

  function loadStoredState() {
    if (!storageKey) return;
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (!stored || typeof stored !== "object") return;
      state = {
        signature: typeof stored.signature === "string" ? stored.signature : null,
        lastGrowth: finite(stored.lastGrowth),
        points: cleanPoints(stored.points),
      };
    } catch {
      state = { signature: null, lastGrowth: null, points: [] };
    }
  }

  function saveStoredState() {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // Trail remains available for the current page session.
    }
  }

  function resetTrail({ keepIdentity = false } = {}) {
    state = {
      signature: keepIdentity ? state.signature : null,
      lastGrowth: keepIdentity ? state.lastGrowth : null,
      points: [],
    };
    saveStoredState();
    renderTrail();
  }

  function trailSignature(me) {
    return `${String(me?.name || "").trim()}|${String(me?.species || "").trim()}`;
  }

  function addPosition(data) {
    const me = data?.me;
    const x = finite(me?.position?.left);
    const y = finite(me?.position?.top);

    if (!data?.connected || !me || x === null || y === null) {
      state.points = cleanPoints(state.points);
      renderTrail();
      return;
    }

    const signature = trailSignature(me);
    const growth = finite(me.growth);
    const respawned =
      state.lastGrowth !== null &&
      growth !== null &&
      state.lastGrowth >= 0.45 &&
      growth <= 0.2 &&
      state.lastGrowth - growth >= 0.3;

    if (!state.signature || state.signature !== signature || respawned) {
      state = { signature, lastGrowth: growth, points: [] };
    }

    const now = safeTime(data.lastChecked);
    state.points = cleanPoints(state.points, now);
    const previous = state.points.at(-1) || null;

    if (previous) {
      const distance = Math.hypot(x - previous.x, y - previous.y);
      if (distance < MIN_MOVE) {
        state.lastGrowth = growth;
        saveStoredState();
        renderTrail();
        return;
      }

      state.points.push({
        x,
        y,
        t: now,
        breakBefore: distance > MAX_CONTINUOUS_JUMP,
      });
    } else {
      state.points.push({ x, y, t: now, breakBefore: true });
    }

    state.lastGrowth = growth;
    state.points = cleanPoints(state.points, now);
    saveStoredState();
    renderTrail();
  }

  function visiblePoints(now = Date.now()) {
    const cutoff = now - selectedWindowMinutes() * 60 * 1000;
    return cleanPoints(state.points, now).filter((point) => point.t >= cutoff);
  }

  function mapSpanMeters() {
    const bounds = mapBounds || window.HVLiveMapData?.bounds || {};
    const horizontal = finite(bounds.maxY) !== null && finite(bounds.minY) !== null
      ? Math.abs(Number(bounds.maxY) - Number(bounds.minY)) / 100
      : 11120;
    const vertical = finite(bounds.maxX) !== null && finite(bounds.minX) !== null
      ? Math.abs(Number(bounds.maxX) - Number(bounds.minX)) / 100
      : 11160;
    return { horizontal, vertical };
  }

  function segmentMeters(a, b) {
    const span = mapSpanMeters();
    const dx = (b.x - a.x) * span.horizontal;
    const dy = (b.y - a.y) * span.vertical;
    return Math.hypot(dx, dy);
  }

  function trailDistance(points) {
    let meters = 0;
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const point = points[index];
      if (point.breakBefore) continue;
      meters += segmentMeters(previous, point);
    }
    return meters;
  }

  function distanceLabel(meters) {
    if (!Number.isFinite(meters) || meters <= 0) return "0 m";
    if (meters < 1000) return `${Math.round(meters)} m`;
    return `${(meters / 1000).toFixed(meters >= 10_000 ? 1 : 2)} km`;
  }

  function renderStats(points) {
    const stats = document.getElementById("trail-stats");
    if (!stats) return;

    const windowMinutes = selectedWindowMinutes();
    const distance = trailDistance(points);
    if (!points.length) {
      stats.textContent = `${windowMinutes} MIN · no movement samples yet`;
      return;
    }

    stats.textContent = `${windowMinutes} MIN · ${distanceLabel(distance)} · ${points.length} sample${points.length === 1 ? "" : "s"}`;
  }

  function footprintMarkup(point, previous, opacity) {
    if (!previous || point.breakBefore) return "";
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    if (Math.hypot(dx, dy) < MIN_MOVE) return "";

    const x = (point.x * 1000).toFixed(1);
    const y = (point.y * 1000).toFixed(1);
    const angle = (Math.atan2(dy, dx) * 180 / Math.PI + 90).toFixed(1);
    return `<g class="dino-trail-footprint" transform="translate(${x} ${y}) rotate(${angle})" style="opacity:${opacity.toFixed(3)}">
      <ellipse cx="0" cy="3.2" rx="2.1" ry="3.2"></ellipse>
      <ellipse cx="-3.0" cy="-1.4" rx="1.0" ry="3.2" transform="rotate(-24 -3 -1.4)"></ellipse>
      <ellipse cx="0" cy="-2.8" rx="1.0" ry="3.5"></ellipse>
      <ellipse cx="3.0" cy="-1.4" rx="1.0" ry="3.2" transform="rotate(24 3 -1.4)"></ellipse>
    </g>`;
  }

  function renderTrail() {
    const svg = document.getElementById("tracker-trails");
    if (!svg) return;

    const now = Date.now();
    state.points = cleanPoints(state.points, now);
    const points = visiblePoints(now);
    renderStats(points);

    if (!enabled() || points.length < 2) {
      svg.innerHTML = "";
      return;
    }

    const mode = selectedMode();
    const showLine = mode === "both" || mode === "breadcrumb";
    const showFootprints = mode === "both" || mode === "footprints";
    const windowMs = selectedWindowMinutes() * 60 * 1000;
    const pieces = [];
    let footprintCounter = 0;

    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const point = points[index];
      if (point.breakBefore) continue;

      const age = Math.max(0, now - point.t);
      const freshness = Math.max(0.08, Math.min(1, 1 - age / windowMs));
      const x1 = (previous.x * 1000).toFixed(1);
      const y1 = (previous.y * 1000).toFixed(1);
      const x2 = (point.x * 1000).toFixed(1);
      const y2 = (point.y * 1000).toFixed(1);

      if (showLine) {
        pieces.push(`<line class="dino-trail-glow" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="opacity:${(freshness * 0.24).toFixed(3)}"></line>`);
        pieces.push(`<line class="dino-trail-segment" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="opacity:${(freshness * 0.82).toFixed(3)}"></line>`);
      }

      footprintCounter += 1;
      if (showFootprints && (footprintCounter % 4 === 0 || index === points.length - 1)) {
        pieces.push(footprintMarkup(point, previous, Math.max(0.16, freshness * 0.9)));
      }
    }

    svg.innerHTML = pieces.join("");
  }

  async function resolveStorageKey() {
    try {
      const me = await window.HDS?.loadMe?.();
      const identity = me?.user?.steam_id || me?.user?.id || "signed-in";
      storageKey = `${STORAGE_PREFIX}${identity}`;
    } catch {
      storageKey = `${STORAGE_PREFIX}signed-in`;
    }
    loadStoredState();
  }

  async function init() {
    const toggle = document.getElementById("layer-trails");
    const svg = document.getElementById("tracker-trails");
    const tools = document.getElementById("trail-tools");
    const windowSelect = document.getElementById("trail-window");
    const modeSelect = document.getElementById("trail-mode");
    const clearButton = document.getElementById("trail-clear");
    if (!toggle || !svg) return;

    toggle.checked = storageGet(ENABLED_KEY, "1") !== "0";
    if (tools) tools.hidden = !toggle.checked;

    const storedWindow = Number(storageGet(WINDOW_KEY, 30));
    if (windowSelect) windowSelect.value = String(VALID_WINDOWS.has(storedWindow) ? storedWindow : 30);
    const storedMode = storageGet(MODE_KEY, "both");
    if (modeSelect) modeSelect.value = VALID_MODES.has(storedMode) ? storedMode : "both";

    toggle.addEventListener("change", () => {
      storageSet(ENABLED_KEY, toggle.checked ? "1" : "0");
      if (tools) tools.hidden = !toggle.checked;
      renderTrail();
    });
    windowSelect?.addEventListener("change", () => {
      storageSet(WINDOW_KEY, selectedWindowMinutes());
      renderTrail();
    });
    modeSelect?.addEventListener("change", () => {
      storageSet(MODE_KEY, selectedMode());
      renderTrail();
    });
    clearButton?.addEventListener("click", () => resetTrail({ keepIdentity: true }));

    window.addEventListener("hv:mapdata", (event) => {
      mapBounds = event.detail?.bounds || null;
      renderTrail();
    });
    window.addEventListener("hv:map-state", (event) => addPosition(event.detail));

    await resolveStorageKey();

    if (window.HVLiveMapData?.bounds) mapBounds = window.HVLiveMapData.bounds;
    if (window.HVLiveMapState) addPosition(window.HVLiveMapState);
    else renderTrail();

    window.addEventListener("storage", (event) => {
      if (event.key === storageKey) {
        loadStoredState();
        renderTrail();
      }
    });

    rerenderTimer = setInterval(renderTrail, 30_000);
    window.addEventListener("pagehide", () => clearInterval(rerenderTimer), { once: true });
  }

  init();
})();
