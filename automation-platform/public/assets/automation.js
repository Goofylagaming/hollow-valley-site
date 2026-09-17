const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'hdsAutomationAdminToken';
let adminToken = sessionStorage.getItem(TOKEN_KEY) || '';

function setState(id, text, state) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.dataset.state = state || '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function setHeader(server) {
  const dot = $('header-dot');
  $('header-status').textContent = server.online ? 'Server online' : server.configured ? 'Server check failed' : 'Setup required';
  dot?.classList.toggle('online', Boolean(server.online));
  dot?.classList.toggle('offline', !server.online);
}

function renderPublicStatus(status) {
  const { server, integrations } = status;
  setHeader(server);
  setState('public-server-state', server.online ? 'Online' : server.configured ? 'Offline' : 'Not set', server.online ? 'online' : 'offline');
  $('public-server-detail').textContent = server.online ? 'Evrima RCON responding' : server.error || 'RCON configuration required';
  $('public-player-count').textContent = server.online ? String(server.playerCount) : '—';
  $('public-player-capacity').textContent = server.maxPlayers ? `${server.playerCount} / ${server.maxPlayers} slots` : server.online ? `${server.playerCount} online` : 'Capacity unknown';
  const ready = integrations.rcon || integrations.commandBridge;
  setState('public-automation-state', ready ? 'Ready' : 'Setup', ready ? 'online' : 'offline');
}

function renderPlayers(server) {
  const list = $('players-list');
  if (!list) return;
  if (!server.configured) {
    list.innerHTML = '<div class="empty-roster"><strong>RCON is not configured</strong><span>Add the Evrima RCON environment variables to this service.</span></div>';
    return;
  }
  if (!server.online) {
    list.innerHTML = '<div class="empty-roster"><strong>Server unavailable</strong><span>The automation service could not read the Evrima RCON endpoint.</span></div>';
    return;
  }
  if (!server.players?.length) {
    list.innerHTML = '<div class="empty-roster"><strong>No players online</strong><span>The server is responding normally.</span></div>';
    return;
  }

  list.innerHTML = server.players.map((player) => {
    const species = player.species || 'Character data pending';
    const growth = Number.isFinite(player.growth) ? `${Math.round(player.growth * 100)}% growth` : 'Online';
    return `<div class="player-row"><div><b>${escapeHtml(player.name)}</b><small>${escapeHtml(player.steamId)} · ${escapeHtml(growth)}</small></div><span class="player-species">${escapeHtml(species)}</span></div>`;
  }).join('');
}

function requestStatusClass(status) {
  if (['confirmed', 'accepted'].includes(status)) return 'ready';
  if (status === 'failed') return 'failed';
  if (status === 'unknown') return 'unknown';
  return 'pending';
}

function renderRequests(requests) {
  const list = $('request-list');
  if (!list) return;
  $('request-total').textContent = `${requests.length} tracked`;
  if (!requests.length) {
    list.innerHTML = '<div class="empty-roster"><strong>No automation requests yet</strong><span>BodyDrop and DinoStorage requests will appear here.</span></div>';
    return;
  }

  list.innerHTML = requests.slice(0, 50).map((request) => {
    const title = request.kind === 'bodydrop' ? 'BodyDrop' : request.details?.action === 'redeem' ? 'Dino redeem' : 'Dino store';
    const created = request.created_at ? new Date(`${request.created_at.replace(' ', 'T')}Z`).toLocaleString() : '';
    const message = request.message || request.error || request.id;
    return `<div class="request-row"><div><b>${escapeHtml(title)}</b><small>${escapeHtml(request.steam_id || 'No Steam ID')} · ${escapeHtml(created)}</small><span>${escapeHtml(message)}</span></div><strong class="request-status ${requestStatusClass(request.status)}">${escapeHtml(request.status)}</strong></div>`;
  }).join('');
}

function renderAdminStatus(status) {
  const { server, integrations, modules = {}, bridge = {}, requests = {} } = status;
  setHeader(server);
  setState('server-state', server.online ? 'Online' : server.configured ? 'Offline' : 'Not set', server.online ? 'online' : 'offline');
  $('server-detail').textContent = server.online ? 'Evrima RCON responding' : server.error || 'RCON configuration required';
  $('player-count').textContent = server.online ? String(server.playerCount) : '—';
  $('player-capacity').textContent = server.maxPlayers ? `${server.playerCount} / ${server.maxPlayers} slots` : server.online ? `${server.playerCount} online` : 'Capacity unknown';
  setState('rcon-state', integrations.rcon ? 'Configured' : 'Not set', integrations.rcon ? 'online' : 'offline');

  const bridgeHealthy = bridge.enabled && bridge.connected && !bridge.resultsOversize;
  const bridgeLabel = !bridge.enabled ? 'Disabled' : bridge.resultsOversize ? 'Needs attention' : bridge.connected ? bridge.queueBusy ? 'Queue busy' : 'Connected' : 'Offline';
  setState('bridge-state', bridgeLabel, bridgeHealthy ? 'online' : 'offline');
  $('bridge-detail').textContent = bridge.error || (bridge.queueBusy ? 'An unconsumed command is waiting' : bridge.resultsOversize ? 'Results log must be rotated' : bridge.connected ? `${bridge.resultsBytes || 0} bytes of results` : 'VeryGames FTP queue');

  $('pending-count').textContent = String(requests.pending || 0);
  $('pending-detail').textContent = requests.pending ? 'Awaiting bridge/sub-mod result' : 'No queued work';
  $('unknown-count').textContent = String(requests.unknown || 0);

  const moduleMap = [
    ['module-server', modules.serverStatus],
    ['module-bodydrop', modules.bodyDrop],
    ['module-dinostorage', modules.dinoStorage],
  ];
  for (const [id, enabled] of moduleMap) {
    const el = $(id);
    if (!el) continue;
    el.textContent = enabled ? 'Built' : 'Pending';
    el.classList.toggle('ready', Boolean(enabled));
    el.classList.toggle('next', !enabled);
  }
  const discord = $('module-discord');
  if (discord) {
    discord.textContent = modules.discordAutomation ? 'Built' : 'Queued';
    discord.classList.toggle('ready', Boolean(modules.discordAutomation));
    discord.classList.toggle('queued', !modules.discordAutomation);
  }

  if (server.checkedAt) $('last-checked').textContent = `Checked ${new Date(server.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  const errorBox = $('status-error');
  const problems = [server.error && `RCON: ${server.error}`, bridge.error && `Bridge: ${bridge.error}`, bridge.resultsOversize && 'CommandBridge results log exceeds the safe 8 MiB limit.'].filter(Boolean);
  errorBox.hidden = !problems.length;
  errorBox.textContent = problems.join(' ');
  renderPlayers(server);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  let body = null;
  try { body = await response.json(); } catch {}
  if (!response.ok) {
    const error = new Error(body?.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function adminHeaders() {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${adminToken}`,
  };
}

async function loadPublicStatus(force = false) {
  try {
    const status = await fetchJson(`/api/status${force ? '?force=1' : ''}`, { headers: { Accept: 'application/json' } });
    renderPublicStatus(status);
  } catch {
    $('header-status').textContent = 'Service unavailable';
    $('header-dot')?.classList.add('offline');
    setState('public-server-state', 'Unavailable', 'offline');
    setState('public-automation-state', 'Unavailable', 'offline');
  }
}

async function loadRequests() {
  if (!adminToken) return;
  const result = await fetchJson('/api/admin/requests?limit=50', { headers: adminHeaders() });
  renderRequests(result.requests || []);
}

async function loadAdminStatus(force = false) {
  if (!adminToken) return false;
  const refresh = $('refresh-status');
  if (refresh) {
    refresh.disabled = true;
    refresh.textContent = 'Checking…';
  }
  try {
    const status = await fetchJson(`/api/admin/status${force ? '?force=1' : ''}`, { headers: adminHeaders() });
    $('admin-gate').hidden = true;
    $('admin-console').hidden = false;
    renderAdminStatus(status);
    await loadRequests();
    return true;
  } catch (error) {
    if (error.status === 401 || error.status === 503) {
      lockConsole(error.status === 503 ? 'Admin API is not configured yet.' : 'Admin token was rejected.');
    } else {
      const box = $('status-error');
      if (box) {
        box.hidden = false;
        box.textContent = error.message;
      }
    }
    return false;
  } finally {
    if (refresh) {
      refresh.disabled = false;
      refresh.textContent = 'Refresh status';
    }
  }
}

function lockConsole(message = '') {
  adminToken = '';
  sessionStorage.removeItem(TOKEN_KEY);
  $('admin-console').hidden = true;
  $('admin-gate').hidden = false;
  const error = $('admin-login-error');
  if (error) {
    error.hidden = !message;
    error.textContent = message;
  }
  if ($('admin-token')) $('admin-token').value = '';
}

$('admin-login-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = $('admin-token').value.trim();
  if (!token) return;
  adminToken = token;
  const error = $('admin-login-error');
  error.hidden = true;
  const ok = await loadAdminStatus(true);
  if (ok) {
    sessionStorage.setItem(TOKEN_KEY, token);
    $('admin-token').value = '';
  }
});

$('lock-console')?.addEventListener('click', () => lockConsole());
$('refresh-status')?.addEventListener('click', () => loadAdminStatus(true));
$('reconcile-all')?.addEventListener('click', async () => {
  const button = $('reconcile-all');
  button.disabled = true;
  button.textContent = 'Reconciling…';
  try {
    await fetchJson('/api/admin/reconcile', { method: 'POST', headers: adminHeaders() });
    await loadAdminStatus(true);
  } catch (error) {
    const box = $('status-error');
    box.hidden = false;
    box.textContent = error.message;
  } finally {
    button.disabled = false;
    button.textContent = 'Reconcile queues';
  }
});

const menuToggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('.main-nav');
menuToggle?.addEventListener('click', () => {
  const open = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!open));
  nav?.classList.toggle('automation-mobile-open', !open);
});

loadPublicStatus();
if (adminToken) loadAdminStatus(false);
setInterval(() => {
  loadPublicStatus(false);
  if (adminToken) loadAdminStatus(false);
}, 15_000);
