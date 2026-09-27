(() => {
  const ACTIVE_REFRESH_MS = 5_000;
  const HIDDEN_REFRESH_MS = 30_000;
  const MAX_AGE_MS = 15 * 60 * 1000;
  const MAX_POINTS = 240;
  const MIN_MOVE = 0.0005;
  const MAX_CONTINUOUS_JUMP = 0.08;
  const STORAGE_PREFIX = "hollow-valley-live-trail:v1:";
  const ENABLED_KEY = "hollow-valley-live-trail-enabled";

  let storageKey = null;
  let state = { signature: null, lastGrowth: null, points: [] };
  let timer = null;
  let loading = false;

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function safeTime(value) {
    const parsed = Date.parse(String(value || ""));
    return Number.isFinite(parsed) ? parsed : Date.now();
  }

  function enabled() {
    const toggle = document.getElementById("layer-trails");
    return Boolean(toggle?.checked);
  }

  function cleanPoints(points, now = Date.now()) {
    return (Array.isArray(points) ? points : [])
      .filter((point) => {
        const x = finite(point?.x);
        const y = finite(point?.y);
        const t = finite(point?.t);
        return x !== null && y !== null && t !== null && now - t <= MAX_AGE_MS;
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
      // Trail still works for this page session when browser storage is unavailable.
    }
  }

  function resetTrail(signature = null, growth = null) {
    state = { signature, lastGrowth: finite(growth), points: [] };
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

    if (!enabled()) {
      svg.innerHTML = "";
      return;
    }

    const now = Date.now();
    state.points = cleanPoints(state.points, now);
    if (state.points.length < 2) {
      svg.innerHTML = "";
      return;
    }

    const pieces = [];
    let footprintCounter = 0;

    for (let index = 1; index < state.points.length; index += 1) {
      const previous = state.points[index - 1];
      const point = state.points[index];
      if (point.breakBefore) continue;

      const age = Math.max(0, now - point.t);
      const freshness = Math.max(0.08, Math.min(1, 1 - age / MAX_AGE_MS));
      const x1 = (previous.x * 1000).toFixed(1);
      const y1 = (previous.y * 1000).toFixed(1);
      const x2 = (point.x * 1000).toFixed(1);
      const y2 = (point.y * 1000).toFixed(1);

      pieces.push(`<line class="dino-trail-glow" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="opacity:${(freshness * 0.28).toFixed(3)}"></line>`);
      pieces.push(`<line class="dino-trail-segment" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="opacity:${(freshness * 0.82).toFixed(3)}"></line>`);

      footprintCounter += 1;
      if (footprintCounter % 4 === 0 || index === state.points.length - 1) {
        pieces.push(footprintMarkup(point, previous, Math.max(0.16, freshness * 0.9)));
      }
    }

    svg.innerHTML = pieces.join("");
  }

  async function poll() {
    if (loading || !window.HDS?.api) return;
    loading = true;
    try {
      const data = await window.HDS.api("/api/map/positions");
      addPosition(data);
    } catch {
      state.points = cleanPoints(state.points);
      renderTrail();
    } finally {
      loading = false;
    }
  }

  function scheduleNext() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      await poll();
      scheduleNext();
    }, document.hidden ? HIDDEN_REFRESH_MS : ACTIVE_REFRESH_MS);
  }

  async function init() {
    const toggle = document.getElementById("layer-trails");
    const svg = document.getElementById("tracker-trails");
    if (!toggle || !svg || !window.HDS?.api) return;

    toggle.checked = localStorage.getItem(ENABLED_KEY) !== "0";
    toggle.addEventListener("change", () => {
      try { localStorage.setItem(ENABLED_KEY, toggle.checked ? "1" : "0"); } catch {}
      renderTrail();
    });

    try {
      const me = await window.HDS.loadMe?.();
      const identity = me?.user?.steam_id || me?.user?.id || "signed-in";
      storageKey = `${STORAGE_PREFIX}${identity}`;
      loadStoredState();
    } catch {
      storageKey = `${STORAGE_PREFIX}signed-in`;
      loadStoredState();
    }

    await poll();
    scheduleNext();

    document.addEventListener("visibilitychange", () => {
      clearTimeout(timer);
      poll().finally(scheduleNext);
    });

    window.addEventListener("storage", (event) => {
      if (event.key === storageKey) {
        loadStoredState();
        renderTrail();
      }
    });
  }

  init();
})();
