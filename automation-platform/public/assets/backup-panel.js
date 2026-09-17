(() => {
  const TOKEN_KEY = 'hdsAutomationAdminToken';
  const consoleRoot = document.getElementById('admin-console');
  const anchor = document.querySelector('.server-health-panel') || document.querySelector('.migration-readiness-panel') || document.querySelector('.rcon-panel');
  if (!consoleRoot || !anchor) return;

  const panel = document.createElement('article');
  panel.className = 'automation-panel backup-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="panel-heading">
      <div><small>BACKUP &amp; RECOVERY</small><h3>Automation database</h3></div>
      <span class="panel-pill" id="backup-health">Disabled</span>
    </div>
    <div class="summary-grid automation-summary-grid">
      <div class="summary-tile"><small>SNAPSHOTS</small><b id="backup-count">0</b><span id="backup-retention">Retention unknown</span></div>
      <div class="summary-tile"><small>LATEST SNAPSHOT</small><b id="backup-latest">None</b><span id="backup-latest-detail">No backup created</span></div>
      <div class="summary-tile"><small>DATABASE</small><b id="backup-configured">Checking</b><span>Consistent SQLite snapshots</span></div>
    </div>
    <div class="page-toolbar">
      <button class="small-button" id="create-backup" type="button">Create snapshot</button>
    </div>
    <div class="automation-notice" id="backup-status" hidden></div>
  `;
  anchor.parentNode.insertBefore(panel, anchor);

  const token = () => sessionStorage.getItem(TOKEN_KEY) || '';
  const formatBytes = (value) => {
    const bytes = Number(value) || 0;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  function render(state) {
    panel.hidden = false;
    document.getElementById('backup-health').textContent = state.enabled ? 'Enabled' : 'Disabled';
    document.getElementById('backup-count').textContent = String(state.count || 0);
    document.getElementById('backup-retention').textContent = `Keep ${state.retention || 0} snapshots`;
    document.getElementById('backup-configured').textContent = state.configured ? 'File backed' : 'Unavailable';
    const latest = state.latest;
    document.getElementById('backup-latest').textContent = latest ? 'Available' : 'None';
    document.getElementById('backup-latest-detail').textContent = latest
      ? `${new Date(latest.modifiedAt).toLocaleString()} · ${formatBytes(latest.size)}`
      : 'No backup created';

    const button = document.getElementById('create-backup');
    button.disabled = !state.configured;
    const status = document.getElementById('backup-status');
    if (!state.enabled) {
      status.hidden = false;
      status.textContent = 'Scheduled backups are disabled. Manual snapshots remain available for a file-backed database.';
    } else if (!state.configured) {
      status.hidden = false;
      status.textContent = 'Backups require a file-backed persistent automation database.';
    } else {
      status.hidden = true;
      status.textContent = '';
    }
  }

  async function adminFetch(url, options = {}) {
    const adminToken = token();
    if (!adminToken) throw new Error('Operator token required');
    return fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${adminToken}`,
        ...(options.headers || {}),
      },
    });
  }

  async function refresh() {
    if (!token() || consoleRoot.hidden) {
      panel.hidden = true;
      return;
    }
    try {
      const response = await adminFetch('/api/admin/backups');
      if (response.status === 401 || response.status === 503) {
        panel.hidden = true;
        return;
      }
      if (!response.ok) throw new Error(`Backup status failed (${response.status})`);
      const payload = await response.json();
      render(payload.backups || {});
    } catch (error) {
      panel.hidden = false;
      const status = document.getElementById('backup-status');
      status.hidden = false;
      status.textContent = `Backup status unavailable: ${error.message}`;
    }
  }

  document.getElementById('create-backup').addEventListener('click', async () => {
    const button = document.getElementById('create-backup');
    const status = document.getElementById('backup-status');
    button.disabled = true;
    status.hidden = false;
    status.textContent = 'Creating consistent database snapshot…';
    try {
      const response = await adminFetch('/api/admin/backups', { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Backup failed (${response.status})`);
      status.textContent = payload.backup?.fileName
        ? `Snapshot created: ${payload.backup.fileName}`
        : 'Snapshot request accepted.';
      await refresh();
    } catch (error) {
      status.textContent = `Backup failed: ${error.message}`;
    } finally {
      button.disabled = false;
    }
  });

  const observer = new MutationObserver(() => refresh());
  observer.observe(consoleRoot, { attributes: true, attributeFilter: ['hidden'] });
  refresh();
  setInterval(refresh, 60_000);
})();
