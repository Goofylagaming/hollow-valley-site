(() => {
  const TOKEN_KEY = 'hdsAutomationAdminToken';
  const consoleRoot = document.getElementById('admin-console');
  const anchor = document.querySelector('.rcon-panel');
  if (!consoleRoot || !anchor) return;

  const panel = document.createElement('article');
  panel.className = 'automation-panel presence-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="panel-heading">
      <div><small>PLAYER ACTIVITY</small><h3>Tracked presence</h3></div>
      <span class="panel-pill" id="presence-window">24 hours</span>
    </div>
    <div class="summary-grid automation-summary-grid">
      <div class="summary-tile"><small>UNIQUE PLAYERS</small><b id="presence-unique">0</b><span>Tracked in the last 24h</span></div>
      <div class="summary-tile"><small>PEAK CONCURRENT</small><b id="presence-peak">0</b><span>Tracked session overlap</span></div>
      <div class="summary-tile"><small>TRACKED PLAYTIME</small><b id="presence-minutes">0m</b><span id="presence-sessions">0 sessions</span></div>
    </div>
    <div class="list-heading"><span>TOP TRACKED PLAYERS</span></div>
    <div id="presence-top" class="automation-list">
      <div class="empty-roster"><strong>Presence tracking is disabled</strong><span>Enable it only after read-only RCON has been verified.</span></div>
    </div>
  `;
  anchor.parentNode.insertBefore(panel, anchor);

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  function token() {
    return sessionStorage.getItem(TOKEN_KEY) || '';
  }

  function render(analytics) {
    panel.hidden = false;
    document.getElementById('presence-window').textContent = `${analytics.hours || 24} hours`;
    document.getElementById('presence-unique').textContent = String(analytics.uniquePlayers || 0);
    document.getElementById('presence-peak').textContent = String(analytics.peakConcurrent || 0);
    document.getElementById('presence-minutes').textContent = `${analytics.trackedMinutes || 0}m`;
    document.getElementById('presence-sessions').textContent = `${analytics.sessions || 0} sessions`;

    const list = document.getElementById('presence-top');
    if (!analytics.enabled) {
      list.innerHTML = '<div class="empty-roster"><strong>Presence tracking is disabled</strong><span>Set PLAYER_PRESENCE_ENABLED=true only after read-only RCON has been verified.</span></div>';
      return;
    }
    if (!analytics.topPlayers?.length) {
      list.innerHTML = '<div class="empty-roster"><strong>No tracked sessions yet</strong><span>Player activity will appear after successful RCON presence samples.</span></div>';
      return;
    }
    list.innerHTML = analytics.topPlayers.slice(0, 10).map((player, index) => `
      <div class="request-row">
        <div><b>${index + 1}. ${escapeHtml(player.name)}</b><small>${escapeHtml(player.steamId)} · ${player.sessions} session${player.sessions === 1 ? '' : 's'}</small></div>
        <strong class="request-status ready">${player.trackedMinutes}m</strong>
      </div>
    `).join('');
  }

  async function refresh() {
    const adminToken = token();
    if (!adminToken || consoleRoot.hidden) {
      panel.hidden = true;
      return;
    }
    try {
      const response = await fetch('/api/admin/presence/analytics?hours=24', {
        headers: { Accept: 'application/json', Authorization: `Bearer ${adminToken}` },
      });
      if (response.status === 401 || response.status === 503) {
        panel.hidden = true;
        return;
      }
      if (!response.ok) throw new Error(`Presence analytics failed (${response.status})`);
      const payload = await response.json();
      render(payload.analytics || {});
    } catch (error) {
      panel.hidden = false;
      const list = document.getElementById('presence-top');
      list.innerHTML = `<div class="empty-roster"><strong>Presence analytics unavailable</strong><span>${escapeHtml(error.message)}</span></div>`;
    }
  }

  const observer = new MutationObserver(() => refresh());
  observer.observe(consoleRoot, { attributes: true, attributeFilter: ['hidden'] });
  refresh();
  setInterval(refresh, 30_000);
})();
