(() => {
  const { api, escapeHtml } = window.HDS || {};
  const container = document.getElementById("prime-map-summary");
  if (!container || typeof api !== "function") return;

  function duration(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    if (hours) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
    if (minutes) return `${minutes}m`;
    return total ? `${total}s` : "0m";
  }

  function shortDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "—";
  }

  function zoneLabel(kind) {
    if (kind === "migration") return "MIGRATION";
    if (kind === "patrol") return "PATROL";
    if (kind === "sanctuary") return "SANCTUARY";
    return String(kind || "ZONE").toUpperCase();
  }

  function render(state) {
    if (!state?.enabled) {
      container.innerHTML = `<div class="panel prime-map-summary-panel"><p class="overline green">PRIME TRACKER</p><p class="section-intro">Prime tracking is not enabled yet.</p></div>`;
      return;
    }

    const life = state.activeLife;
    if (!life) {
      container.innerHTML = `<div class="panel prime-map-summary-panel"><p class="overline green">PRIME TRACKER</p><p class="section-intro">Spawn in-game to begin tracked Prime progress.</p></div>`;
      return;
    }

    const progress = state.progress || {};
    const current = state.currentZones || {};
    const currentZones = [
      ...(current.migrations || []).map((name) => `Migration: ${name}`),
      ...(current.patrolZones || []).map((name) => `Patrol: ${name}`),
      ...(current.sanctuaries || []).map((name) => `Sanctuary: ${name}`),
    ];
    const recent = (state.zoneVisits || []).slice(-4).reverse();
    const growth = Math.round((Number(life.growth) || 0) * 100);

    container.innerHTML = `
      <section class="panel prime-map-summary-panel" aria-label="Compact Prime tracker summary">
        <div class="prime-map-summary-head">
          <div>
            <p class="overline green">PRIME TRACKER · LIVE MAP</p>
            <strong>${escapeHtml(life.species || "Dinosaur")} · ${growth}%</strong>
            <small>Tracked since ${escapeHtml(shortDate(life.startedAt))}</small>
          </div>
          <span class="prime-tracker-status ${life.isPrime ? "is-prime" : ""}">${life.isPrime ? "● PRIME" : "○ NOT PRIME"}</span>
        </div>

        <div class="prime-map-mini-stats">
          <div><small>TRACKED PRIME TIME</small><b>${escapeHtml(duration(progress.primeSeconds))}</b></div>
          <div><small>MIGRATION</small><b>${Number(progress.migrationZonesVisited || 0)}</b></div>
          <div><small>PATROL</small><b>${Number(progress.patrolZonesVisited || 0)}</b></div>
          <div><small>SANCTUARIES</small><b>${Number(progress.sanctuariesVisited || 0)}</b></div>
        </div>

        <div class="prime-map-current">
          <small>CURRENT MAPPED ZONE</small>
          <span>${currentZones.length ? currentZones.map((name) => escapeHtml(name)).join(" · ") : "Outside tracked zones"}</span>
        </div>

        <div class="prime-map-mini-history">
          <small>RECENT ZONE HISTORY</small>
          <div class="prime-map-mini-history-list">
            ${recent.length ? recent.map((visit) => `
              <span class="prime-map-mini-visit">
                <em>${escapeHtml(zoneLabel(visit.kind))}</em>
                <strong>${escapeHtml(visit.name || "Unnamed zone")}</strong>
                <b>${escapeHtml(duration(visit.secondsInside))}</b>
              </span>`).join("") : '<span class="prime-map-mini-empty">No mapped zone visits yet.</span>'}
          </div>
        </div>
      </section>`;
  }

  async function load() {
    try {
      render(await api("/api/mydinos/prime-tracker"));
    } catch (error) {
      container.innerHTML = `<div class="panel prime-map-summary-panel"><p class="overline green">PRIME TRACKER</p><p class="section-intro">${error?.status === 401 ? "Sign in with Steam to see Prime progress." : escapeHtml(error?.message || "Prime tracker unavailable.")}</p></div>`;
    }
  }

  load();
  const timer = setInterval(() => {
    if (!document.hidden) load();
  }, 15000);
  window.addEventListener("beforeunload", () => clearInterval(timer), { once: true });
})();
