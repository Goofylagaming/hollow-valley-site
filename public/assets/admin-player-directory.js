const { api } = window.HDS;

let directoryPlayers = [];

function directoryDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

function directoryPlaytime(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function directorySort(players) {
  const sort = document.getElementById('admin-directory-sort')?.value || 'lastSeen';
  const copy = [...players];
  if (sort === 'name') {
    copy.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')) || String(a.uniquePlayerId || '').localeCompare(String(b.uniquePlayerId || '')));
  } else if (sort === 'firstSeen') {
    copy.sort((a, b) => Date.parse(a.firstSeen || 0) - Date.parse(b.firstSeen || 0));
  } else if (sort === 'playtime') {
    copy.sort((a, b) => Number(b.totalPlaytimeSeconds || 0) - Number(a.totalPlaytimeSeconds || 0));
  } else {
    copy.sort((a, b) => Date.parse(b.lastSeen || 0) - Date.parse(a.lastSeen || 0));
  }
  return copy;
}

function openDirectoryPlayer(player) {
  const input = document.getElementById('admin-records-steam');
  const form = document.getElementById('admin-records-form');
  if (!input || !form) return;
  input.value = player.uniquePlayerId || '';
  form.requestSubmit();
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderPlayerDirectory() {
  const body = document.getElementById('admin-directory-body');
  const status = document.getElementById('admin-directory-status');
  if (!body || !status) return;

  const query = String(document.getElementById('admin-directory-search')?.value || '').trim().toLowerCase();
  const filtered = directoryPlayers.filter((player) => {
    if (!query) return true;
    return String(player.name || '').toLowerCase().includes(query) ||
      String(player.uniquePlayerId || '').includes(query);
  });
  const players = directorySort(filtered);
  body.replaceChildren();

  if (!players.length) {
    status.textContent = query ? 'No players match that search.' : 'No player history has been recorded yet.';
    return;
  }

  status.textContent = `${players.length.toLocaleString()} player${players.length === 1 ? '' : 's'} shown${query ? ` of ${directoryPlayers.length.toLocaleString()}` : ''}.`;

  for (const player of players) {
    const row = document.createElement('tr');

    const nameCell = document.createElement('td');
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'admin-directory-name';
    name.textContent = player.name || 'Unknown player';
    name.addEventListener('click', () => openDirectoryPlayer(player));
    nameCell.append(name);
    if (player.online) {
      const badge = document.createElement('span');
      badge.className = 'admin-directory-online';
      badge.textContent = 'ONLINE';
      nameCell.append(' ', badge);
    }

    const idCell = document.createElement('td');
    const id = document.createElement('code');
    id.textContent = player.uniquePlayerId || '—';
    idCell.append(id);

    const firstCell = document.createElement('td');
    firstCell.textContent = directoryDate(player.firstSeen);

    const lastCell = document.createElement('td');
    lastCell.textContent = directoryDate(player.lastSeen);

    const playtimeCell = document.createElement('td');
    playtimeCell.textContent = directoryPlaytime(player.totalPlaytimeSeconds);

    const actionCell = document.createElement('td');
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'small-button';
    action.textContent = 'View records';
    action.addEventListener('click', () => openDirectoryPlayer(player));
    actionCell.append(action);

    row.append(nameCell, idCell, firstCell, lastCell, playtimeCell, actionCell);
    body.append(row);
  }
}

async function loadPlayerDirectory() {
  const refresh = document.getElementById('admin-directory-refresh');
  const status = document.getElementById('admin-directory-status');
  if (refresh) refresh.disabled = true;
  if (status) status.textContent = 'Loading player directory…';

  try {
    const data = await api('/api/admin-player-directory');
    directoryPlayers = Array.isArray(data?.players) ? data.players : [];
    renderPlayerDirectory();
  } catch (error) {
    directoryPlayers = [];
    const body = document.getElementById('admin-directory-body');
    if (body) body.replaceChildren();
    if (status) status.textContent = error.message || 'Could not load player directory.';
  } finally {
    if (refresh) refresh.disabled = false;
  }
}

document.getElementById('admin-directory-refresh')?.addEventListener('click', loadPlayerDirectory);
document.getElementById('admin-directory-search')?.addEventListener('input', renderPlayerDirectory);
document.getElementById('admin-directory-sort')?.addEventListener('change', renderPlayerDirectory);

loadPlayerDirectory();
