(() => {
  // Preserve real zeroes, but distinguish missing/untracked stored-dino vitals
  // from an actual 0% value. The existing renderer passes fallback=0 for
  // Hunger/Stamina/Thirst and fallback=100 for Health/Blood.
  const basePct = pct;

  pct = function pctWithUnknownState(value, max, fallback = 0) {
    const missing = value === undefined || value === null || value === '';
    if (missing) return fallback === 0 ? null : fallback;
    return basePct(value, max, fallback);
  };

  statBar = function statBarWithUnknownState(label, value, className) {
    const tracked = value !== null
      && value !== undefined
      && value !== ''
      && Number.isFinite(Number(value));

    if (!tracked) {
      return `
        <div class="stat-group stat-untracked" data-tracked="false">
          <div class="stat-label-row"><span class="stat-name">${escapeHtml(label)}</span><span class="stat-val">—</span></div>
          <div class="progress-bg stat-untracked-bg" aria-label="${escapeHtml(label)} not tracked"></div>
        </div>`;
    }

    const safe = Math.max(0, Math.min(100, Number(value)));
    return `
      <div class="stat-group" data-tracked="true">
        <div class="stat-label-row"><span class="stat-name">${escapeHtml(label)}</span><span class="stat-val">${safe}%</span></div>
        <div class="progress-bg"><div class="progress-fill ${className}" style="width:${safe}%"></div></div>
      </div>`;
  };

  if (typeof renderStorage === 'function' && Array.isArray(storedDinos) && storedDinos.length) {
    renderStorage();
  }
})();
