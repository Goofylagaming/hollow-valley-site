(() => {
  const TOKEN_KEY = 'hdsAutomationAdminToken';

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function ensurePanel() {
    if (document.getElementById('audit-panel')) return;
    const consoleRoot = document.getElementById('admin-console');
    if (!consoleRoot) return;
    const errorBox = document.getElementById('status-error');
    const panel = document.createElement('article');
    panel.id = 'audit-panel';
    panel.className = 'automation-panel request-panel';
    panel.innerHTML = `
      <div class="panel-heading"><div><small>OPERATOR AUDIT</small><h3>Recent operator actions</h3></div><span class="panel-pill" id="audit-count">0 recorded</span></div>
      <div id="audit-list" class="automation-list"><div class="empty-roster"><strong>No operator actions yet</strong><span>Privileged actions will appear here after they are attempted.</span></div></div>`;
    if (errorBox) consoleRoot.insertBefore(panel, errorBox);
    else consoleRoot.appendChild(panel);
  }

  function formatDetails(details) {
    const entries = Object.entries(details || {}).filter(([, value]) => value !== null && value !== undefined && value !== '');
    if (!entries.length) return 'No additional metadata';
    return entries.map(([key, value]) => {
      const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return `${key}: ${text}`;
    }).join(' · ');
  }

  function statusClass(status) {
    if (status === 'succeeded') return 'ready';
    if (status === 'failed') return 'failed';
    return 'pending';
  }

  function render(rows) {
    ensurePanel();
    const list = document.getElementById('audit-list');
    const count = document.getElementById('audit-count');
    if (!list || !count) return;
    count.textContent = `${rows.length} recorded`;
    if (!rows.length) {
      list.innerHTML = '<div class="empty-roster"><strong>No operator actions yet</strong><span>Privileged actions will appear here after they are attempted.</span></div>';
      return;
    }
    list.innerHTML = rows.slice(0, 50).map((entry) => {
      const when = entry.created_at ? new Date(`${entry.created_at.replace(' ', 'T')}Z`).toLocaleString() : '';
      const title = `${entry.category} · ${entry.action}`;
      const details = formatDetails(entry.details);
      const message = entry.message ? `<span>${escapeHtml(entry.message)}</span>` : '';
      return `<div class="request-row"><div><b>${escapeHtml(title)}</b><small>${escapeHtml(when)}</small><span>${escapeHtml(details)}</span>${message}</div><strong class="request-status ${statusClass(entry.status)}">${escapeHtml(entry.status)}</strong></div>`;
    }).join('');
  }

  async function loadAudit() {
    const token = sessionStorage.getItem(TOKEN_KEY) || '';
    if (!token) return;
    try {
      const response = await fetch('/api/admin/audit?limit=50', {
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const body = await response.json();
      render(body.audit || []);
    } catch {}
  }

  ensurePanel();
  loadAudit();
  setInterval(loadAudit, 15_000);
  window.addEventListener('storage', loadAudit);

  const monitorScript = document.createElement('script');
  monitorScript.src = '/assets/monitor-panel.js?v=1';
  monitorScript.defer = true;
  document.body.appendChild(monitorScript);
})();
