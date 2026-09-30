const { api } = window.HDS;

let currentSafeLogRecovery = null;

function safeLogSteamId() {
  return String(document.getElementById('admin-safelog-steam')?.value || '').trim();
}

function safeLogSpecies(classPath) {
  const match = /BP_([^./]+?)(?:_C)?(?:\.|$)/i.exec(String(classPath || ''));
  return match ? match[1].replace(/_C$/i, '') : 'Unknown species';
}

function safeLogDate(epochSeconds) {
  const value = Number(epochSeconds);
  if (!Number.isFinite(value) || value <= 0) return '—';
  return new Date(value * 1000).toLocaleString();
}

function recoverySourceText(recovery) {
  const source = String(recovery?.recordSource || recovery?.recovery?.status || '').toLowerCase();
  return source === 'completed' ? 'Completed safe log' : source === 'pending' ? 'Pending / unconfirmed safe log' : 'Recovery snapshot';
}

function setSafeLogStatus(message) {
  const status = document.getElementById('admin-safelog-status');
  if (status) status.textContent = message || '';
}

function renderSafeLogRecovery(recovery) {
  const result = document.getElementById('admin-safelog-result');
  if (!result) return;
  result.replaceChildren();
  currentSafeLogRecovery = recovery || null;

  if (!recovery) {
    result.hidden = true;
    setSafeLogStatus('No Safe Log recovery snapshot was found for this Steam ID.');
    return;
  }

  result.hidden = false;
  const source = String(recovery.recordSource || recovery?.recovery?.status || '').toLowerCase();
  const sourceLine = document.createElement('p');
  sourceLine.className = 'admin-prime-status';
  sourceLine.textContent = source === 'pending'
    ? 'WARNING: This is an unconfirmed snapshot. Safe Log started, but completion was not observed. Verify the player really lost the dinosaur before restoring.'
    : 'Confirmed Safe Log snapshot. Restore is still manual and never runs automatically.';
  result.append(sourceLine);

  const list = document.createElement('div');
  list.className = 'admin-records-list';
  const growth = Number(recovery.growth);
  const growthText = Number.isFinite(growth) ? `${Math.round(growth <= 1.5 ? growth * 100 : growth)}% growth` : 'Growth unknown';
  const gender = recovery.isFemale === true ? 'Female' : recovery.isFemale === false ? 'Male' : 'Gender unknown';
  const prime = recovery.isPrime === true ? 'Prime' : 'Not Prime';

  const rows = [
    ['Snapshot', recoverySourceText(recovery), safeLogDate(recovery.capturedAt)],
    [safeLogSpecies(recovery.classPath), `${gender} · ${growthText} · ${prime}`, ''],
    ['Safe Log started', safeLogDate(recovery?.recovery?.safeLogStartedAt), ''],
    ['Safe Log completed', safeLogDate(recovery?.recovery?.safeLogCompletedAt), ''],
  ];
  for (const [title, detail, trailing] of rows) {
    const row = document.createElement('div');
    row.className = 'admin-player-row';
    const identity = document.createElement('div');
    identity.className = 'admin-player-identity';
    const heading = document.createElement('strong');
    heading.textContent = title;
    const sub = document.createElement('span');
    sub.textContent = detail;
    identity.append(heading, sub);
    row.append(identity);
    if (trailing) {
      const value = document.createElement('b');
      value.textContent = trailing;
      row.append(value);
    }
    list.append(row);
  }
  result.append(list);

  const actions = document.createElement('div');
  actions.className = 'form-row';

  const restore = document.createElement('button');
  restore.type = 'button';
  restore.className = 'small-button';
  restore.textContent = source === 'pending' ? 'Restore unconfirmed snapshot' : 'Restore snapshot';
  restore.addEventListener('click', restoreSafeLogRecovery);

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'small-button';
  clear.textContent = 'Clear recovery copy';
  clear.addEventListener('click', clearSafeLogRecovery);

  actions.append(restore, clear);
  result.append(actions);
}

async function lookupSafeLogRecovery(event) {
  event?.preventDefault();
  const steamId = safeLogSteamId();
  if (!/^\d{17}$/.test(steamId)) {
    currentSafeLogRecovery = null;
    renderSafeLogRecovery(null);
    setSafeLogStatus('Enter a valid 17-digit Steam ID.');
    return;
  }

  const button = document.querySelector('#admin-safelog-form button[type="submit"]');
  if (button) button.disabled = true;
  setSafeLogStatus('Checking Safe Log recovery snapshots…');
  try {
    const data = await api(`/api/admin-safelog-recovery/${encodeURIComponent(steamId)}`);
    renderSafeLogRecovery(data.recovery || null);
    if (data.recovery) setSafeLogStatus(`Recovery copy found for ${steamId}.`);
  } catch (error) {
    currentSafeLogRecovery = null;
    const result = document.getElementById('admin-safelog-result');
    if (result) result.hidden = true;
    setSafeLogStatus(error.message || 'Could not load Safe Log recovery.');
  } finally {
    if (button) button.disabled = false;
  }
}

async function restoreSafeLogRecovery() {
  const steamId = safeLogSteamId();
  const recovery = currentSafeLogRecovery;
  if (!recovery || !/^\d{17}$/.test(steamId)) return;
  const source = String(recovery.recordSource || recovery?.recovery?.status || '').toLowerCase();
  const species = safeLogSpecies(recovery.classPath);
  const warning = source === 'pending'
    ? `Restore the UNCONFIRMED ${species} snapshot for ${steamId}? Only continue if the player has definitely lost the dinosaur.`
    : `Restore the confirmed ${species} Safe Log snapshot for ${steamId}? The player must already be connected as the same species and gender.`;
  if (!confirm(warning)) return;

  setSafeLogStatus('Restoring Safe Log snapshot in game…');
  try {
    const data = await api('/api/admin-safelog-recovery/restore', {
      method: 'POST',
      body: JSON.stringify({
        steamId,
        source: source === 'completed' || source === 'pending' ? source : null,
        confirm: 'RESTORE SAFELOG',
      }),
    });
    setSafeLogStatus(data?.restore?.message || 'Safe Log snapshot restored. Recovery copy was retained.');
  } catch (error) {
    setSafeLogStatus(error.message || 'Safe Log restore failed.');
  }
}

async function clearSafeLogRecovery() {
  const steamId = safeLogSteamId();
  const recovery = currentSafeLogRecovery;
  if (!recovery || !/^\d{17}$/.test(steamId)) return;
  const source = String(recovery.recordSource || recovery?.recovery?.status || '').toLowerCase();
  if (!confirm(`Clear the ${source || 'current'} Safe Log recovery copy for ${steamId}? This cannot be undone.`)) return;

  setSafeLogStatus('Clearing recovery copy…');
  try {
    const data = await api('/api/admin-safelog-recovery/clear', {
      method: 'POST',
      body: JSON.stringify({
        steamId,
        source: source === 'completed' || source === 'pending' ? source : 'both',
        confirm: 'CLEAR SAFELOG',
      }),
    });
    currentSafeLogRecovery = null;
    const result = document.getElementById('admin-safelog-result');
    if (result) result.hidden = true;
    setSafeLogStatus(data?.clear?.message || 'Safe Log recovery copy cleared.');
  } catch (error) {
    setSafeLogStatus(error.message || 'Could not clear Safe Log recovery.');
  }
}

document.getElementById('admin-safelog-form')?.addEventListener('submit', lookupSafeLogRecovery);
document.getElementById('admin-safelog-steam')?.addEventListener('input', () => {
  currentSafeLogRecovery = null;
  const result = document.getElementById('admin-safelog-result');
  if (result) result.hidden = true;
  setSafeLogStatus('Enter a Steam ID to check the latest Safe Log recovery copy.');
});
