(() => {
  const viewport = document.getElementById("map-viewport");
  const stroke = document.getElementById("zone-border-width");
  const fill = document.getElementById("zone-fill-strength");
  const strokeValue = document.getElementById("zone-border-value");
  const fillValue = document.getElementById("zone-fill-value");
  if (!viewport || !stroke || !fill) return;

  const STORAGE_KEY = "hollow-valley-live-map-precision-v1";

  function readSaved() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function apply() {
    const strokeWidth = Math.max(.55, Math.min(1.8, Number(stroke.value) / 100));
    const fillOpacity = Math.max(0, Math.min(.28, Number(fill.value) / 100));
    viewport.style.setProperty("--hv-zone-stroke", strokeWidth);
    viewport.style.setProperty("--hv-zone-fill", fillOpacity);
    if (strokeValue) strokeValue.textContent = strokeWidth.toFixed(2);
    if (fillValue) fillValue.textContent = Math.round(fillOpacity * 100) + "%";
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        stroke: Number(stroke.value),
        fill: Number(fill.value),
      }));
    } catch {}
  }

  const saved = readSaved();
  if (Number.isFinite(Number(saved.stroke))) stroke.value = String(saved.stroke);
  if (Number.isFinite(Number(saved.fill))) fill.value = String(saved.fill);

  stroke.addEventListener("input", apply);
  fill.addEventListener("input", apply);
  apply();
})();
