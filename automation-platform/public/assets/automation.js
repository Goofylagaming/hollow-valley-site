const $ = (id) => document.getElementById(id);

function setState(id, text, state) {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.dataset.state = state || '';
}

function integrationLabel(configured) {
  return configured ? 'Configured' : 'Not set';
}

function setModuleState(id, enabled, enabledLabel = 'Built', disabledLabel = 'Next') {
  const el = $(id);
  if (!el) return;
  el.textContent = enabled ? enabledLabel : disabledLabel;
  el.classList.toggle('ready', Boolean(enabled));
  el.classList.toggle('next', !enabled);
  el.classList.remove('queued');
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
  if (!server.players.length) {
    list.innerHTML = '<div class="empty-roster"><strong>No players online</strong><span>The server is responding normally.</span></div>';
    return;
  }

  list.innerHTML = server.players.map((player) => {
    const species = player.species || 'Character data pending';
    const growth = Number.isFinite(player.growth) ? `${Math.round(player.growth * 100)}% growth` : 'Online';
    return `<div class="player-row"><div><b>${escapeHtml(player.name)}</b><small>${escapeHtml(growth)}</small></div><span class="player-species">${escapeHtml(species)}</span></div>`;
  }).join('');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderStatus(status) {
  const server = status.server;
  const integrations = status.integrations;
  const modules = status.modules || {};
  const headerDot = $('header-dot');
  const errorBox = $('status-error');

  setState('server-state', server.online ? 'Online' : server.configured ? 'Offline' : 'Not set', server.online ? 'online' : 'offline');
  $('server-detail').textContent = server.online ? 'Evrima RCON responding' : server.error || 'RCON configuration required';
  $('player-count').textContent = server.online ? String(server.playerCount) : '—';
  $('player-capacity').textContent = server.maxPlayers ? `${server.playerCount} / ${server.maxPlayers} slots` : server.online ? `${server.playerCount} online` : 'Capacity unknown';

  setState('rcon-state', integrationLabel(integrations.rcon), integrations.rcon ? 'online' : 'offline');
  setState('bridge-state', integrationLabel(integrations.commandBridge), integrations.commandBridge ? 'online' : 'offline');
  setState('discord-state', integrationLabel(integrations.discord), integrations.discord ? 'online' : 'offline');
  setState('database-state', integrations.database ? 'Ready' : 'Unavailable', integrations.database ? 'online' : 'offline');

  setModuleState('module-server', modules.serverStatus, 'Built', 'Pending');
  setModuleState('module-bodydrop', modules.bodyDrop, 'Built', 'Next');
  setModuleState('module-dinostorage', modules.dinoStorage, 'Built', 'Next');
  const discordModule = $('module-discord');
  if (discordModule) {
    discordModule.textContent = modules.discordAutomation ? 'Built' : 'Queued';
    discordModule.classList.toggle('ready', Boolean(modules.discordAutomation));
    discordModule.classList.toggle('queued', !modules.discordAutomation);
    discordModule.classList.remove('next');
  }

  $('header-status').textContent = server.online ? 'Server online' : server.configured ? 'Server check failed' : 'Setup required';
  headerDot.classList.toggle('online', server.online);
  headerDot.classList.toggle('offline', !server.online);

  if (server.checkedAt) $('last-checked').textContent = `Checked ${new Date(server.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  if (server.error) {
    errorBox.hidden = false;
    errorBox.textContent = `RCON: ${server.error}`;
  } else {
    errorBox.hidden = true;
    errorBox.textContent = '';
  }

  renderPlayers(server);
}

async function loadStatus(force = false) {
  const refresh = $('refresh-status');
  if (refresh) {
    refresh.disabled = true;
    refresh.textContent = 'Checking…';
  }
  try {
    const response = await fetch(`/api/status${force ? '?force=1' : ''}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Status request failed (${response.status})`);
    renderStatus(await response.json());
  } catch (error) {
    const errorBox = $('status-error');
    errorBox.hidden = false;
    errorBox.textContent = error.message;
    $('header-status').textContent = 'Service unavailable';
    $('header-dot').classList.add('offline');
  } finally {
    if (refresh) {
      refresh.disabled = false;
      refresh.textContent = 'Refresh status';
    }
  }
}

$('refresh-status')?.addEventListener('click', () => loadStatus(true));

const menuToggle = document.querySelector('.menu-toggle');
const nav = document.querySelector('.main-nav');
menuToggle?.addEventListener('click', () => {
  const open = menuToggle.getAttribute('aria-expanded') === 'true';
  menuToggle.setAttribute('aria-expanded', String(!open));
  nav?.classList.toggle('automation-mobile-open', !open);
});

loadStatus();
setInterval(() => loadStatus(false), 15_000);
