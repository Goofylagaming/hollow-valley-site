(() => {
  const TOKEN_KEY = 'hdsAutomationAdminToken';

  function ensurePanel() {
    if (document.getElementById('monitor-panel')) return;
    const consoleRoot = document.getElementById('admin-console');
    if (!consoleRoot) return;
    const auditPanel = document.getElementById('audit-panel');
    const panel = document.createElement('article');
    panel.id = 'monitor-panel';
    panel.className = 'automation-panel request-panel';
    panel.innerHTML = `
      <div class="panel-heading"><div><small>SERVER MONITOR</small><h3>Offline & recovery alerts</h3></div><span class="panel-pill" id="monitor-health">Disabled</span></div>
      <div class="module-list">
        <div class="module-row"><span class="module-icon">◉</span><div><b id="monitor-state">Not active</b><small id="monitor-detail">Enable monitoring and configure a Discord alert channel to begin.</small></div><button class="small-button" id="monitor-check-now" type="button">Check now</button></div>
        <div class="module-row"><span class="module-icon">⌁</span><div><b id="monitor-threshold">3 failed checks</b><small id="monitor-last-check">No monitor check recorded</small></div><span class="module-state queued" id="monitor-alert-state">No alert</span></div>
      </div>
      <div class="automation-notice" id="monitor-notice" hidden></div>`;
    if (auditPanel) consoleRoot.insertBefore(panel, auditPanel);
    else consoleRoot.appendChild(panel);

    document.getElementById('monitor-check-now')?.addEventListener('click', runCheck);
  }

  function token() {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  }

  function formatTime(value) {
    if (!value) return null;
    const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
    return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : value;
  }

  function render(state) {
    ensurePanel();
    const badge = document.getElementById('monitor-health');
    const title = document.getElementById('monitor-state');
    const detail = document.getElementById('monitor-detail');
    const threshold = document.getElementById('monitor-threshold');
    const lastCheck = document.getElementById('monitor-last-check');
    const alertState = document.getElementById('monitor-alert-state');
    const button = document.getElementById('monitor-check-now');
    if (!badge || !title || !detail || !threshold || !lastCheck || !alertState || !button) return;

    if (!state.enabled) {
      badge.textContent = 'Disabled';
      title.textContent = 'Monitoring disabled';
      detail.textContent = 'Set SERVER_MONITOR_ENABLED=true when you want Discord outage monitoring.';
      button.disabled = true;
    } else if (!state.configured) {
      badge.textContent = 'Setup required';
      title.textContent = 'Alert channel not configured';
      detail.textContent = 'Add DISCORD_ALERT_CHANNEL_ID before the monitor can send transitions.';
      button.disabled = true;
    } else {
      badge.textContent = state.confirmed === 'offline' ? 'Offline confirmed' : state.confirmed === 'online' ? 'Healthy' : 'Watching';
      title.textContent = state.confirmed === 'offline' ? 'Server marked offline' : state.confirmed === 'online' ? 'Server confirmed online' : 'Building baseline';
      detail.textContent = state.lastError || `${state.consecutiveFailures || 0} consecutive failed health checks.`;
      button.disabled = false;
    }

    threshold.textContent = `${state.failureThreshold || 3} failed checks required`;
    lastCheck.textContent = state.lastCheckedAt ? `Last check ${formatTime(state.lastCheckedAt)}` : 'No monitor check recorded';
    alertState.textContent = state.lastAlertAt ? `Alert ${formatTime(state.lastAlertAt)}` : 'No alert sent';
    alertState.className = `module-state ${state.lastAlertAt ? 'ready' : 'queued'}`;
  }

  function notice(message, isError = false) {
    const box = document.getElementById('monitor-notice');
    if (!box) return;
    box.hidden = !message;
    box.textContent = message || '';
    box.classList.toggle('error', Boolean(isError));
  }

  async function fetchMonitor(path = '/api/admin/monitor', options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token()}`,
        ...(options.headers || {}),
      },
    });
    let body = null;
    try { body = await response.json(); } catch {}
    if (!response.ok) throw new Error(body?.error || `Monitor request failed (${response.status})`);
    return body;
  }

  async function load() {
    if (!token()) return;
    try { render(await fetchMonitor()); } catch {}
  }

  async function runCheck() {
    const button = document.getElementById('monitor-check-now');
    if (!button) return;
    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = 'Checking…';
    notice('');
    try {
      const result = await fetchMonitor('/api/admin/monitor/check', { method: 'POST' });
      render(result);
      if (result.transition) notice(`Server transition recorded: ${result.transition}.`);
      else if (result.reason) notice(`Monitor check skipped: ${result.reason}.`);
      else notice('Monitor check completed with no state change.');
    } catch (error) {
      notice(error.message, true);
      await load();
    } finally {
      button.textContent = oldText;
      const state = await fetchMonitor().catch(() => null);
      if (state) render(state);
    }
  }

  ensurePanel();
  load();
  setInterval(load, 15_000);
})();
