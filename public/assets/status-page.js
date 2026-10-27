/* Public status display; reads existing endpoints only. Never issues game commands. */
(function () {
  'use strict';
  const REFRESH_MS = 30000;
  const SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;
  let refreshing = false;

  function text(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }

  function card(name, state, label, detail) {
    const el = document.getElementById('status-' + name + '-card');
    if (el) el.dataset.state = state;
    text('status-' + name + '-state', label);
    text('status-' + name + '-detail', detail);
  }

  function timestamp(value) {
    const date = new Date(value);
    if (!value || !Number.isFinite(date.getTime())) return null;
    return date.toLocaleString('en-AU', {
      timeZone: 'Australia/Brisbane',
      dateStyle: 'medium', timeStyle: 'short',
    }) + ' AEST';
  }

  async function request(path) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(path, {
        cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
      });
      const body = await response.json();
      return { httpOk: response.ok, body: body && typeof body === 'object' ? body : {} };
    } finally {
      clearTimeout(timeout);
    }
  }

  function isHealthy(result) {
    return result.status === 'fulfilled' && result.value.httpOk && result.value.body.ok === true;
  }

  function displayGame(result) {
    if (result.status !== 'fulfilled' || !result.value.httpOk) {
      card('game', 'unknown', 'Unknown', 'The latest game-server status could not be checked.');
      text('status-snapshot-time', 'Last verified snapshot unavailable');
      return 'unknown';
    }

    const snapshot = result.value.body;
    const checkedAt = timestamp(snapshot.lastChecked);
    text('status-snapshot-time', checkedAt ? 'Last server snapshot: ' + checkedAt : 'No verified snapshot yet');

    if (!snapshot.configured) {
      card('game', 'unknown', 'Not monitored', 'Game-server status is not configured on this website.');
      return 'unknown';
    }
    const snapshotAge = Date.now() - Date.parse(snapshot.lastChecked || '');
    if (snapshot.stale || !checkedAt || !Number.isFinite(snapshotAge) ||
        snapshotAge > SNAPSHOT_MAX_AGE_MS || snapshotAge < -60000) {
      card('game', 'delayed', 'Delayed', 'The server snapshot is stale. Current online status and player count are unverified.');
      return 'unknown';
    }
    if (snapshot.online === true) {
      const players = Number(snapshot.playerCount);
      const max = Number(snapshot.maxPlayers);
      const validCount = Number.isSafeInteger(players) && players >= 0;
      const validMax = Number.isSafeInteger(max) && max > 0;
      const count = validCount ? String(players) + (validMax ? ' / ' + max : '') + ' players reported.' : 'Player count unavailable.';
      card('game', 'ok', 'Online', 'Latest verified server snapshot: online. ' + count);
      return 'online';
    }
    if (snapshot.online === false) {
      card('game', 'attention', 'Offline', 'The latest verified automation snapshot reports the game server offline.');
      return 'offline';
    }
    card('game', 'unknown', 'Unknown', 'The game server did not report a usable online state.');
    return 'unknown';
  }

  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    const button = document.getElementById('status-refresh');
    if (button) button.disabled = true;
    try {
      const [live, ready, game] = await Promise.allSettled([
        request('/healthz'), request('/readyz'), request('/api/server-status'),
      ]);

      const liveOk = isHealthy(live);
      const readyOk = isHealthy(ready);
      if (liveOk) {
        card('website', 'ok', 'Responding', 'The website process responded to its liveness check.');
      } else if (live.status === 'fulfilled') {
        card('website', 'attention', 'Needs attention', 'The website liveness check did not succeed.');
      } else {
        card('website', 'unknown', 'Unknown', 'Unable to reach the website liveness check.');
      }

      if (readyOk) {
        card('storage', 'ok', 'Ready', 'Local storage check passed; this website is accepting requests.');
      } else if (ready.status === 'fulfilled' && ready.value.body.ok === false) {
        card('storage', 'attention', 'Not ready', 'The website reported it is not ready to serve requests.');
      } else {
        card('storage', 'unknown', 'Unknown', 'Website readiness could not be confirmed.');
      }

      const gameState = displayGame(game);
      let summary = 'Website health needs verification';
      if (liveOk && !readyOk) summary = 'Website process responding · Readiness unverified';
      if (liveOk && ready.status === 'fulfilled' && ready.value.body.ok === false) {
        summary = 'Website process responding · Website not ready';
      }
      if (liveOk && readyOk) {
        summary = gameState === 'online'
          ? 'Website ready · Game server online'
          : gameState === 'offline'
            ? 'Website ready · Game server offline'
            : 'Website ready · Game status unverified';
      }
      text('status-overall', summary);
      text('status-refreshed', 'Checked ' + timestamp(new Date().toISOString()) + ' · Refreshes every 30 seconds');
    } finally {
      refreshing = false;
      if (button) button.disabled = false;
    }
  }

  function init() {
    const button = document.getElementById('status-refresh');
    if (button) button.addEventListener('click', refresh);
    refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, REFRESH_MS);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
