(() => {
  const TOKEN_KEY = 'hdsAutomationAdminToken';
  const consoleRoot = document.getElementById('admin-console');
  const anchor = document.querySelector('.migration-readiness-panel') || document.querySelector('.presence-panel') || document.querySelector('.rcon-panel');
  if (!consoleRoot || !anchor) return;

  const panel = document.createElement('article');
  panel.className = 'automation-panel server-health-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="panel-heading">
      <div><small>RELIABILITY</small><h3>Server health history</h3></div>
      <span class="panel-pill" id="health-history-window">24 hours</span>
    </div>
    <div class="summary-grid automation-summary-grid">
      <div class="summary-tile"><small>AVAILABILITY</small><b id="health-availability">—</b><span id="health-samples">0 samples</span></div>
      <div class="summary-tile"><small>AVERAGE PLAYERS</small><b id="health-average">0</b><span>Online samples only</span></div>
      <div class="summary-tile"><small>PEAK PLAYERS</small><b id="health-peak">0</b><span id="health-capacity">Capacity unknown</span></div>
      <div class="summary-tile"><small>OUTAGE TRANSITIONS</small><b id="health-outages">0</b><span>Online → unavailable changes</span></div>
    </div>
    <div id="health-history-note" class="automation-notice"></div>
  `;
  anchor.parentNode.insertBefore(panel, anchor);

  const token = () => sessionStorage.getItem(TOKEN_KEY) || '';
  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  function render(analytics) {
    panel.hidden = false;
    document.getElementById('health-history-window').textContent = `${analytics.hours || 24} hours`;
    document.getElementById('health-availability').textContent = analytics.availabilityPercent == null ? '—' : `${analytics.availabilityPercent}%`;
    document.getElementById('health-samples').textContent = `${analytics.samples || 0} sample${analytics.samples === 1 ? '' : 's'}`;
    document.getElementById('health-average').textContent = String(analytics.averagePlayers || 0);
    document.getElementById('health-peak').textContent = String(analytics.peakPlayers || 0);
    document.getElementById('health-capacity').textContent = analytics.maxPlayers ? `Latest capacity ${analytics.maxPlayers}` : 'Capacity unknown';
    document.getElementById('health-outages').textContent = String(analytics.outageTransitions || 0);

    const note = document.getElementById('health-history-note');
    if (!analytics.enabled) {
      note.hidden = false;
      note.textContent = 'Server health history is disabled. Enable it only after read-only RCON has been verified.';
      return;
    }
    if (!analytics.samples) {
      note.hidden = false;
      note.textContent = 'Health history is enabled but no samples have been recorded yet.';
      return;
    }
    const errors = Object.entries(analytics.errors || {}).map(([key, count]) => `${key}: ${count}`).join(' · ');
    note.hidden = !errors;
    note.innerHTML = errors ? `Failed checks by category: ${escapeHtml(errors)}` : '';
  }

  async function refresh() {
    const adminToken = token();
    if (!adminToken || consoleRoot.hidden) {
      panel.hidden = true;
      return;
    }
    try {
      const response = await fetch('/api/admin/server-health/analytics?hours=24', {
        headers: { Accept: 'application/json', Authorization: `Bearer ${adminToken}` },
      });
      if (response.status === 401 || response.status === 503) {
        panel.hidden = true;
        return;
      }
      if (!response.ok) throw new Error(`Server health analytics failed (${response.status})`);
      const payload = await response.json();
      render(payload.analytics || {});
    } catch (error) {
      panel.hidden = false;
      const note = document.getElementById('health-history-note');
      note.hidden = false;
      note.textContent = `Server health history unavailable: ${error.message}`;
    }
  }

  const observer = new MutationObserver(() => refresh());
  observer.observe(consoleRoot, { attributes: true, attributeFilter: ['hidden'] });
  refresh();
  setInterval(refresh, 30_000);
})();
