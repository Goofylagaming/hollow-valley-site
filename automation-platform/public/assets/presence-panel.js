(() => {
  const TOKEN_KEY = 'hdsAutomationAdminToken';
  const consoleRoot = document.getElementById('admin-console');
  const anchor = document.querySelector('.rcon-panel');
  if (!consoleRoot || !anchor) return;

  let windowHours = 24;

  const panel = document.createElement('article');
  panel.className = 'automation-panel presence-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="panel-heading presence-heading">
      <div><small>PLAYER ACTIVITY</small><h3>Session analytics</h3></div>
      <div class="presence-window-controls" role="group" aria-label="Activity window">
        <button class="small-button presence-window-button active" type="button" data-hours="24">24h</button>
        <button class="small-button presence-window-button subtle-button" type="button" data-hours="168">7d</button>
        <button class="small-button presence-window-button subtle-button" type="button" data-hours="720">30d</button>
      </div>
    </div>

    <div class="summary-grid automation-summary-grid presence-summary-grid">
      <div class="summary-tile"><small>UNIQUE PLAYERS</small><b id="presence-unique">0</b><span id="presence-returning">0 returning</span></div>
      <div class="summary-tile"><small>AVERAGE ONLINE</small><b id="presence-average">0</b><span>Successful presence samples</span></div>
      <div class="summary-tile"><small>PEAK CONCURRENT</small><b id="presence-peak">0</b><span>Highest tracked overlap</span></div>
      <div class="summary-tile"><small>TRACKED PLAYTIME</small><b id="presence-minutes">0h</b><span id="presence-sessions">0 sessions</span></div>
      <div class="summary-tile"><small>AVG SESSION</small><b id="presence-average-session">0m</b><span id="presence-median-session">Median 0m</span></div>
      <div class="summary-tile"><small>LONGEST SESSION</small><b id="presence-longest-session">0m</b><span id="presence-sample-count">0 samples</span></div>
    </div>

    <div class="presence-insights-grid">
      <section class="presence-insight-card">
        <div class="list-heading"><span>ACTIVITY TREND</span><small id="presence-trend-caption">No samples yet</small></div>
        <div id="presence-trend" class="presence-trend" aria-label="Player activity trend">
          <div class="empty-roster"><strong>No activity samples yet</strong><span>Successful RCON samples will build this trend.</span></div>
        </div>
      </section>

      <section class="presence-insight-card">
        <div class="list-heading"><span>TOP SPECIES</span><small>Sampled online mix</small></div>
        <div id="presence-species" class="automation-list">
          <div class="empty-roster"><strong>No species history yet</strong><span>Species mix appears after successful RCON samples.</span></div>
        </div>
      </section>
    </div>

    <div class="list-heading presence-top-heading"><span>TOP TRACKED PLAYERS</span><small id="presence-window">Last 24 hours</small></div>
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

  function windowLabel(hours) {
    if (hours === 24) return 'Last 24 hours';
    if (hours === 168) return 'Last 7 days';
    if (hours === 720) return 'Last 30 days';
    return `Last ${hours} hours`;
  }

  function formatMinutes(minutes) {
    const value = Math.max(0, Number(minutes) || 0);
    if (value < 60) return `${Math.round(value)}m`;
    const hours = value / 60;
    return hours >= 100 ? `${Math.round(hours)}h` : `${Math.round(hours * 10) / 10}h`;
  }

  function renderTrend(points = []) {
    const root = document.getElementById('presence-trend');
    const caption = document.getElementById('presence-trend-caption');
    if (!points.length) {
      caption.textContent = 'No samples yet';
      root.innerHTML = '<div class="empty-roster"><strong>No activity samples yet</strong><span>Successful RCON samples will build this trend.</span></div>';
      return;
    }

    const maxPlayers = Math.max(1, ...points.map((point) => Number(point.peakPlayers) || 0));
    caption.textContent = `${points.length} time buckets`;
    root.innerHTML = `
      <div class="presence-bars" role="img" aria-label="Average online players over time">
        ${points.map((point) => {
          const average = Math.max(0, Number(point.averagePlayers) || 0);
          const peak = Math.max(0, Number(point.peakPlayers) || 0);
          const height = Math.max(4, Math.round((average / maxPlayers) * 100));
          const when = new Date(point.startedAt).toLocaleString([], {
            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
          });
          return `<span class="presence-bar" style="height:${height}%" title="${escapeHtml(when)} · avg ${average} · peak ${peak}"></span>`;
        }).join('')}
      </div>
      <div class="presence-trend-scale"><span>${escapeHtml(new Date(points[0].startedAt).toLocaleDateString())}</span><span>Peak ${maxPlayers}</span><span>${escapeHtml(new Date(points[points.length - 1].startedAt).toLocaleDateString())}</span></div>
    `;
  }

  function renderSpecies(species = []) {
    const root = document.getElementById('presence-species');
    if (!species.length) {
      root.innerHTML = '<div class="empty-roster"><strong>No species history yet</strong><span>Species mix appears after successful RCON samples.</span></div>';
      return;
    }
    const max = Math.max(1, ...species.map((item) => Number(item.samplePlayerCount) || 0));
    root.innerHTML = species.slice(0, 8).map((item, index) => {
      const count = Math.max(0, Number(item.samplePlayerCount) || 0);
      const width = Math.max(3, Math.round((count / max) * 100));
      return `
        <div class="presence-species-row">
          <div><b>${index + 1}. ${escapeHtml(item.species)}</b><small>${count} sampled player-observations</small></div>
          <div class="presence-species-meter" aria-hidden="true"><span style="width:${width}%"></span></div>
        </div>
      `;
    }).join('');
  }

  function render(analytics) {
    panel.hidden = false;
    document.getElementById('presence-window').textContent = windowLabel(analytics.hours || windowHours);
    document.getElementById('presence-unique').textContent = String(analytics.uniquePlayers || 0);
    document.getElementById('presence-returning').textContent = `${analytics.returningPlayers || 0} returning`;
    document.getElementById('presence-average').textContent = String(analytics.averageOnline ?? 0);
    document.getElementById('presence-peak').textContent = String(analytics.peakConcurrent || 0);
    document.getElementById('presence-minutes').textContent = formatMinutes(analytics.trackedMinutes || 0);
    document.getElementById('presence-sessions').textContent = `${analytics.sessions || 0} sessions`;
    document.getElementById('presence-average-session').textContent = formatMinutes(analytics.averageSessionMinutes || 0);
    document.getElementById('presence-median-session').textContent = `Median ${formatMinutes(analytics.medianSessionMinutes || 0)}`;
    document.getElementById('presence-longest-session').textContent = formatMinutes(analytics.longestSessionMinutes || 0);
    document.getElementById('presence-sample-count').textContent = `${analytics.sampleCount || 0} samples`;

    const list = document.getElementById('presence-top');
    if (!analytics.enabled) {
      renderTrend([]);
      renderSpecies([]);
      list.innerHTML = '<div class="empty-roster"><strong>Presence tracking is disabled</strong><span>Set PLAYER_PRESENCE_ENABLED=true only after read-only RCON has been verified.</span></div>';
      return;
    }

    renderTrend(analytics.activityTrend || []);
    renderSpecies(analytics.topSpecies || []);

    if (!analytics.topPlayers?.length) {
      list.innerHTML = '<div class="empty-roster"><strong>No tracked sessions yet</strong><span>Player activity will appear after successful RCON presence samples.</span></div>';
      return;
    }

    list.innerHTML = analytics.topPlayers.slice(0, 10).map((player, index) => `
      <div class="request-row">
        <div><b>${index + 1}. ${escapeHtml(player.name)}</b><small>${player.sessions} session${player.sessions === 1 ? '' : 's'}</small></div>
        <strong class="request-status ready">${formatMinutes(player.trackedMinutes)}</strong>
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
      const response = await fetch(`/api/admin/presence/analytics?hours=${windowHours}`, {
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

  panel.addEventListener('click', (event) => {
    const button = event.target.closest('.presence-window-button');
    if (!button) return;
    const next = Number(button.dataset.hours);
    if (![24, 168, 720].includes(next) || next === windowHours) return;
    windowHours = next;
    for (const item of panel.querySelectorAll('.presence-window-button')) {
      const active = Number(item.dataset.hours) === windowHours;
      item.classList.toggle('active', active);
      item.classList.toggle('subtle-button', !active);
    }
    refresh();
  });

  const observer = new MutationObserver(() => refresh());
  observer.observe(consoleRoot, { attributes: true, attributeFilter: ['hidden'] });
  refresh();
  setInterval(refresh, 30_000);
})();
