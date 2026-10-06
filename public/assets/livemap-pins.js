(() => {
  const viewport = document.getElementById("map-viewport");
  const world = document.getElementById("map-world");
  const layer = document.getElementById("tracker-target-pins");
  const clearButton = document.getElementById("clear-target-pins");
  const status = document.getElementById("target-pin-status");
  if (!viewport || !world || !layer) return;

  const STORAGE_PREFIX = "hollow-valley-map-target-pins:v1:";
  const MAX_PINS = 20;
  let storageKey = `${STORAGE_PREFIX}browser`;
  let pins = [];
  let mapData = window.HVLiveMapData || null;

  function clamp01(value) {
    return Math.max(0, Math.min(1, Number(value) || 0));
  }

  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || "[]");
      pins = (Array.isArray(parsed) ? parsed : [])
        .filter((pin) => Number.isFinite(Number(pin?.left)) && Number.isFinite(Number(pin?.top)))
        .slice(-MAX_PINS)
        .map((pin) => ({
          id:String(pin.id || `pin-${Date.now()}`),
          left:clamp01(pin.left),
          top:clamp01(pin.top),
          createdAt:Number(pin.createdAt) || Date.now(),
        }));
    } catch {
      pins = [];
    }
  }

  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(pins)); } catch {}
  }

  function pinDetails(pin) {
    if (!mapData?.bounds || !mapData?.grid) return null;
    const minLat = mapData.bounds.minX / 1000;
    const maxLat = mapData.bounds.maxX / 1000;
    const minLong = mapData.bounds.minY / 1000;
    const maxLong = mapData.bounds.maxY / 1000;
    const lat = minLat + clamp01(pin.top) * (maxLat - minLat);
    const long = minLong + clamp01(pin.left) * (maxLong - minLong);
    const cells = Number(mapData.grid.cells) || 20;
    const row = Math.max(0, Math.min(cells - 1, Math.floor((lat - mapData.grid.rowOrigin) / mapData.grid.rowSize)));
    const col = Math.max(0, Math.min(cells - 1, Math.floor((long - mapData.grid.colOrigin) / mapData.grid.colSize)));
    const grid = `${String.fromCharCode(65 + row)}${col + 1}`;
    return { lat, long, grid };
  }

  function updateStatus() {
    if (!status) return;
    status.textContent = pins.length
      ? `${pins.length}/${MAX_PINS} private pin${pins.length === 1 ? "" : "s"} · Shift + click map to add · click a pin to remove.`
      : "Shift + click anywhere on the map to drop a private target pin.";
  }

  function render() {
    layer.innerHTML = pins.map((pin, index) => {
      const detail = pinDetails(pin);
      const label = detail
        ? `${detail.grid} · Lat ${detail.lat.toFixed(1)} · Long ${detail.long.toFixed(1)}`
        : `Private pin ${index + 1}`;
      return `<button type="button" class="target-pin-button" data-pin-id="${pin.id}" style="left:${(pin.left * 100).toFixed(3)}%;top:${(pin.top * 100).toFixed(3)}%" aria-label="${label}. Click to remove."><span class="target-pin-marker"></span><span class="target-pin-label">${label}<br>Click to remove</span></button>`;
    }).join("");
    updateStatus();
  }

  function addPin(left, top) {
    const id = `pin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    pins.push({ id, left:clamp01(left), top:clamp01(top), createdAt:Date.now() });
    pins = pins.slice(-MAX_PINS);
    save();
    render();
  }

  function removePin(id) {
    pins = pins.filter((pin) => pin.id !== id);
    save();
    render();
  }

  layer.addEventListener("click", (event) => {
    const button = event.target.closest(".target-pin-button");
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    removePin(button.dataset.pinId);
  });

  viewport.addEventListener("click", (event) => {
    if (!event.shiftKey) return;
    if (event.target.closest(".map-controls, .map-navigator, .target-pin-button")) return;
    const rect = world.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const left = (event.clientX - rect.left) / rect.width;
    const top = (event.clientY - rect.top) / rect.height;
    if (left < 0 || left > 1 || top < 0 || top > 1) return;
    event.preventDefault();
    event.stopPropagation();
    addPin(left, top);
  });

  clearButton?.addEventListener("click", () => {
    pins = [];
    save();
    render();
  });

  window.addEventListener("hv:mapdata", (event) => {
    mapData = event.detail || null;
    window.HVLiveMapData = mapData;
    render();
  });

  async function initIdentity() {
    try {
      const me = await window.HDS?.loadMe?.();
      const identity = me?.user?.steam_id || me?.user?.id || "browser";
      storageKey = `${STORAGE_PREFIX}${identity}`;
    } catch {}
    load();
    render();
  }

  initIdentity();
})();
