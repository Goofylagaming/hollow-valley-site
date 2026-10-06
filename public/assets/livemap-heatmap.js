(() => {
  const svg = document.getElementById("tracker-heatmap");
  const toggle = document.getElementById("layer-heatmap");
  if (!svg || !toggle) return;

  const RETENTION_MS = 24 * 60 * 60 * 1000;
  const MIN_SAMPLE_MS = 30 * 1000;
  const MIN_MOVE = 0.0008;
  const MAX_POINTS = 4000;
  const BUCKETS = 42;
  const ENABLED_KEY = "hollow-valley-map-heatmap-enabled";
  const STORAGE_PREFIX = "hollow-valley-map-heatmap:v1:";

  let storageKey = null;
  let points = [];

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clean(list, now = Date.now()) {
    return (Array.isArray(list) ? list : [])
      .filter((point) => {
        const x = finite(point?.x);
        const y = finite(point?.y);
        const t = finite(point?.t);
        return x !== null && y !== null && t !== null && x >= 0 && x <= 1 && y >= 0 && y <= 1 && now - t <= RETENTION_MS;
      })
      .slice(-MAX_POINTS)
      .map((point) => ({ x:Number(point.x), y:Number(point.y), t:Number(point.t) }));
  }

  function load() {
    if (!storageKey) return;
    try { points = clean(JSON.parse(localStorage.getItem(storageKey) || "[]")); }
    catch { points = []; }
  }

  function save() {
    if (!storageKey) return;
    try { localStorage.setItem(storageKey, JSON.stringify(points)); } catch {}
  }

  function render() {
    if (!toggle.checked) {
      svg.innerHTML = "";
      return;
    }
    points = clean(points);
    if (!points.length) {
      svg.innerHTML = "";
      return;
    }

    const bins = new Map();
    for (const point of points) {
      const col = Math.max(0, Math.min(BUCKETS - 1, Math.floor(point.x * BUCKETS)));
      const row = Math.max(0, Math.min(BUCKETS - 1, Math.floor(point.y * BUCKETS)));
      const key = `${col}:${row}`;
      const current = bins.get(key) || { col, row, count:0, newest:0 };
      current.count += 1;
      current.newest = Math.max(current.newest, point.t);
      bins.set(key, current);
    }

    const max = Math.max(...[...bins.values()].map((bin) => bin.count), 1);
    const now = Date.now();
    const nodes = [...bins.values()].map((bin) => {
      const density = Math.sqrt(bin.count / max);
      const freshness = Math.max(.28, 1 - Math.max(0, now - bin.newest) / RETENTION_MS);
      const opacity = Math.min(.68, .12 + density * .42) * freshness;
      const radius = 11 + density * 18;
      const cx = ((bin.col + .5) / BUCKETS) * 1000;
      const cy = ((bin.row + .5) / BUCKETS) * 1000;
      return `<circle class="heat-node" cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${radius.toFixed(2)}" opacity="${opacity.toFixed(3)}"></circle>`;
    });

    svg.innerHTML = `<defs><filter id="hv-heat-blur" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="9"></feGaussianBlur></filter></defs><g filter="url(#hv-heat-blur)">${nodes.join("")}</g>`;
  }

  function record(data) {
    const position = data?.connected ? data?.me?.position : null;
    const x = finite(position?.left);
    const y = finite(position?.top);
    if (x === null || y === null) return;

    const parsed = Date.parse(String(data.lastChecked || ""));
    const now = Number.isFinite(parsed) ? parsed : Date.now();
    points = clean(points, now);
    const previous = points.at(-1) || null;
    if (previous) {
      const elapsed = now - previous.t;
      const distance = Math.hypot(x - previous.x, y - previous.y);
      if (elapsed < MIN_SAMPLE_MS && distance < MIN_MOVE) return;
    }

    points.push({ x, y, t:now });
    points = clean(points, now);
    save();
    render();
  }

  toggle.checked = localStorage.getItem(ENABLED_KEY) === "1";
  toggle.addEventListener("change", () => {
    try { localStorage.setItem(ENABLED_KEY, toggle.checked ? "1" : "0"); } catch {}
    render();
  });

  window.addEventListener("hv:map-state", (event) => record(event.detail || null));

  async function init() {
    try {
      const me = await window.HDS?.loadMe?.();
      const identity = me?.user?.steam_id || me?.user?.id || "signed-in";
      storageKey = `${STORAGE_PREFIX}${identity}`;
    } catch {
      storageKey = `${STORAGE_PREFIX}signed-in`;
    }
    load();
    render();
  }

  window.addEventListener("storage", (event) => {
    if (event.key !== storageKey) return;
    load();
    render();
  });

  setInterval(() => {
    points = clean(points);
    save();
    render();
  }, 5 * 60 * 1000);

  init();
})();
