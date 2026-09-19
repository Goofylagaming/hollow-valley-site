(() => {
  const TOKEN_KEY = 'hdsAutomationAdminToken';
  const consoleRoot = document.getElementById('admin-console');
  const activityPanel = document.querySelector('.presence-panel');
  const anchor = activityPanel || document.querySelector('.rcon-panel');
  if (!consoleRoot || !anchor) return;

  const panel = document.createElement('article');
  panel.className = 'automation-panel migration-readiness-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="panel-heading">
      <div><small>MIGRATION</small><h3>Deployment readiness</h3></div>
      <span class="panel-pill" id="migration-stage">Checking</span>
    </div>
    <div class="summary-grid automation-summary-grid">
      <div class="summary-tile"><small>ISOLATED SERVICE</small><b id="migration-isolated">—</b><span>Safe separate deployment</span></div>
      <div class="summary-tile"><small>LIVE MIGRATION</small><b id="migration-live">—</b><span>Website → automation handoff</span></div>
      <div class="summary-tile"><small>REQUIRED SETUP</small><b id="migration-required">0 / 0</b><span>Core configuration checks</span></div>
    </div>
    <div class="list-heading"><span>READINESS CHECKS</span></div>
    <div id="migration-check-list" class="automation-list">
      <div class="empty-roster"><strong>Checking configuration</strong><span>Migration safeguards are being evaluated.</span></div>
    </div>
  `;
  anchor.parentNode.insertBefore(panel, anchor);

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const token = () => sessionStorage.getItem(TOKEN_KEY) || '';

  function stageLabel(stage) {
    return ({
      setup: 'Setup required',
      attention: 'Needs attention',
      'isolated-ready': 'Isolated ready',
      'migration-ready': 'Migration ready',
    })[stage] || 'Checking';
  }

  function render(readiness) {
    panel.hidden = false;
    document.getElementById('migration-stage').textContent = stageLabel(readiness.stage);
    document.getElementById('migration-isolated').textContent = readiness.readyForIsolatedDeployment ? 'Ready' : 'Not ready';
    document.getElementById('migration-live').textContent = readiness.readyForCommandBridgeMigration ? 'Ready' : 'Locked';
    document.getElementById('migration-required').textContent = `${readiness.requiredReady || 0} / ${readiness.requiredTotal || 0}`;

    const list = document.getElementById('migration-check-list');
    const checks = Array.isArray(readiness.checks) ? readiness.checks : [];
    if (!checks.length) {
      list.innerHTML = '<div class="empty-roster"><strong>No readiness data</strong><span>The service returned no migration checks.</span></div>';
      return;
    }

    list.innerHTML = checks.map((item) => {
      const state = item.ready ? 'ready' : item.level === 'optional' ? 'pending' : item.level === 'activation' ? 'unknown' : 'failed';
      const badge = item.ready ? 'Ready' : item.level === 'optional' ? 'Optional' : item.level === 'activation' ? 'Locked' : 'Missing';
      return `<div class="request-row"><div><b>${escapeHtml(item.label)}</b><small>${escapeHtml(item.detail)}</small></div><strong class="request-status ${state}">${badge}</strong></div>`;
    }).join('');
  }

  async function refresh() {
    const adminToken = token();
    if (!adminToken || consoleRoot.hidden) {
      panel.hidden = true;
      return;
    }
    try {
      const response = await fetch('/api/admin/migration-readiness', {
        headers: { Accept: 'application/json', Authorization: `Bearer ${adminToken}` },
      });
      if (response.status === 401 || response.status === 503) {
        panel.hidden = true;
        return;
      }
      if (!response.ok) throw new Error(`Readiness check failed (${response.status})`);
      const payload = await response.json();
      render(payload.readiness || {});
    } catch (error) {
      panel.hidden = false;
      document.getElementById('migration-stage').textContent = 'Unavailable';
      document.getElementById('migration-check-list').innerHTML = `<div class="empty-roster"><strong>Migration readiness unavailable</strong><span>${escapeHtml(error.message)}</span></div>`;
    }
  }

  const observer = new MutationObserver(() => refresh());
  observer.observe(consoleRoot, { attributes: true, attributeFilter: ['hidden'] });
  refresh();
  setInterval(refresh, 30_000);
})();
