(() => {
  const form = document.getElementById("map-nav-form");
  const input = document.getElementById("map-nav-query");
  const status = document.getElementById("map-nav-status");
  const myDinoButton = document.getElementById("map-nav-me");
  const gridToggle = document.getElementById("layer-grid");
  const gridSvg = document.getElementById("tracker-grid");
  const targetLayer = document.getElementById("map-navigation-layer");
  if (!form || !input || !status || !gridToggle || !gridSvg || !targetLayer) return;

  const GRID_ENABLED_KEY = "hollow-valley-map-grid-enabled";
  let config = null;
  let latestMapState = null;

  function setStatus(message, error = false) {
    status.textContent = message || "";
    status.classList.toggle("is-error", Boolean(error));
  }

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }

  function projectLatLong(lat, long) {
    if (!config) return null;
    const minLat = config.bounds.minX / 1000;
    const maxLat = config.bounds.maxX / 1000;
    const minLong = config.bounds.minY / 1000;
    const maxLong = config.bounds.maxY / 1000;
    if (lat < minLat || lat > maxLat || long < minLong || long > maxLong) return null;
    return {
      left: (long - minLong) / (maxLong - minLong),
      top: (lat - minLat) / (maxLat - minLat),
    };
  }

  function gridCellForLatLong(lat, long) {
    if (!config) return null;
    const cells = Number(config.grid.cells) || 20;
    const row = Math.max(0, Math.min(cells - 1, Math.floor((lat - config.grid.rowOrigin) / config.grid.rowSize)));
    const col = Math.max(0, Math.min(cells - 1, Math.floor((long - config.grid.colOrigin) / config.grid.colSize)));
    return `${String.fromCharCode(65 + row)}${col + 1}`;
  }

  function gridCenter(ref) {
    if (!config) return null;
    const match = /^([A-T])\s*(\d{1,2})$/i.exec(String(ref || "").trim());
    if (!match) return null;
    const row = match[1].toUpperCase().charCodeAt(0) - 65;
    const col = Number(match[2]) - 1;
    const cells = Number(config.grid.cells) || 20;
    if (row < 0 || row >= cells || col < 0 || col >= cells) return null;
    return {
      ref: `${String.fromCharCode(65 + row)}${col + 1}`,
      lat: config.grid.rowOrigin + (row + 0.5) * config.grid.rowSize,
      long: config.grid.colOrigin + (col + 0.5) * config.grid.colSize,
    };
  }

  function parseCoordinateQuery(query) {
    const values = String(query || "").match(/-?\d+(?:\.\d+)?/g) || [];
    if (values.length !== 2) return null;
    const lat = finite(values[0]);
    const long = finite(values[1]);
    return lat === null || long === null ? null : { lat, long };
  }

  function showTarget(left, top) {
    targetLayer.innerHTML = `<span class="map-nav-target" style="left:${(clamp01(left) * 100).toFixed(3)}%;top:${(clamp01(top) * 100).toFixed(3)}%"></span>`;
  }

  function focusResult({ left, top, label, lat, long }) {
    const view = window.HVLiveMapView;
    if (!view?.focus) {
      setStatus("Map view is still starting. Try again in a moment.", true);
      return;
    }
    showTarget(left, top);
    view.focus(left, top, 4.6);
    setStatus(`${label} · Lat ${lat.toFixed(1)} · Long ${long.toFixed(1)}`);
  }

  function submitQuery(query) {
    const trimmed = String(query || "").trim();
    if (!trimmed) {
      setStatus("Enter a grid such as A12, or coordinates such as -123, 456.", true);
      return;
    }
    if (!config) {
      setStatus("Gateway grid data is still loading.", true);
      return;
    }

    const grid = gridCenter(trimmed);
    if (grid) {
      const projected = projectLatLong(grid.lat, grid.long);
      if (!projected) {
        setStatus(`${grid.ref} falls outside the visible Gateway map bounds.`, true);
        return;
      }
      focusResult({ ...projected, label:grid.ref, lat:grid.lat, long:grid.long });
      return;
    }

    const coords = parseCoordinateQuery(trimmed);
    if (!coords) {
      setStatus("Use A1-T20 or two Lat/Long numbers, for example -123, 456.", true);
      return;
    }
    const projected = projectLatLong(coords.lat, coords.long);
    if (!projected) {
      setStatus("Those coordinates are outside the current Gateway map bounds.", true);
      return;
    }
    focusResult({
      ...projected,
      label:gridCellForLatLong(coords.lat, coords.long),
      lat:coords.lat,
      long:coords.long,
    });
  }

  function renderGrid() {
    if (!gridToggle.checked || !config) {
      gridSvg.innerHTML = "";
      return;
    }

    const { bounds, grid } = config;
    const cells = Number(grid.cells) || 20;
    const minLat = bounds.minX / 1000;
    const maxLat = bounds.maxX / 1000;
    const minLong = bounds.minY / 1000;
    const maxLong = bounds.maxY / 1000;
    const parts = [];

    for (let i = 0; i <= cells; i += 1) {
      const lat = grid.rowOrigin + i * grid.rowSize;
      const top = (lat - minLat) / (maxLat - minLat);
      if (top >= 0 && top <= 1) {
        parts.push(`<line class="grid-line ${i % 5 === 0 ? "major" : ""}" x1="0" y1="${(top * 1000).toFixed(2)}" x2="1000" y2="${(top * 1000).toFixed(2)}"></line>`);
      }
      const long = grid.colOrigin + i * grid.colSize;
      const left = (long - minLong) / (maxLong - minLong);
      if (left >= 0 && left <= 1) {
        parts.push(`<line class="grid-line ${i % 5 === 0 ? "major" : ""}" x1="${(left * 1000).toFixed(2)}" y1="0" x2="${(left * 1000).toFixed(2)}" y2="1000"></line>`);
      }
    }

    for (let row = 0; row < cells; row += 1) {
      const lat = grid.rowOrigin + (row + 0.5) * grid.rowSize;
      const top = (lat - minLat) / (maxLat - minLat);
      if (top < 0 || top > 1) continue;
      for (let col = 0; col < cells; col += 1) {
        const long = grid.colOrigin + (col + 0.5) * grid.colSize;
        const left = (long - minLong) / (maxLong - minLong);
        if (left < 0 || left > 1) continue;
        const ref = `${String.fromCharCode(65 + row)}${col + 1}`;
        parts.push(`<text class="grid-label" x="${(left * 1000).toFixed(2)}" y="${(top * 1000).toFixed(2)}">${ref}</text>`);
      }
    }
    gridSvg.innerHTML = parts.join("");
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    submitQuery(input.value);
  });

  myDinoButton?.addEventListener("click", () => {
    const me = latestMapState?.me;
    if (!me?.position || !me?.coords) {
      setStatus("Your live dinosaur position is not available right now.", true);
      return;
    }
    input.value = `${me.coords.lat}, ${me.coords.long}`;
    focusResult({
      left:me.position.left,
      top:me.position.top,
      label:me.grid || "MY DINO",
      lat:Number(me.coords.lat),
      long:Number(me.coords.long),
    });
  });

  gridToggle.checked = localStorage.getItem(GRID_ENABLED_KEY) === "1";
  gridToggle.addEventListener("change", () => {
    try { localStorage.setItem(GRID_ENABLED_KEY, gridToggle.checked ? "1" : "0"); } catch {}
    renderGrid();
  });

  window.addEventListener("hv:mapdata", (event) => {
    const detail = event.detail || {};
    if (!detail.bounds || !detail.grid) return;
    config = { bounds:detail.bounds, grid:detail.grid };
    renderGrid();
    setStatus("Search by grid A1-T20 or Lat, Long.");
  });

  window.addEventListener("hv:map-state", (event) => {
    latestMapState = event.detail || null;
  });

  window.HVMapNavigator = { submit:submitQuery };
})();
