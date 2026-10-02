const resetButton = document.getElementById('admin-combat-reset');
const resetStatus = document.getElementById('admin-combat-reset-status');

async function resetCombatStats() {
  const steamId = String(document.getElementById('admin-records-steam')?.value || '').trim();
  if (!/^\d{17}$/.test(steamId)) {
    if (resetStatus) resetStatus.textContent = 'Look up or select a player first.';
    return;
  }

  if (!confirm(`Reset all leaderboard kills, deaths and K:D for ${steamId}? Historical combat events will be retained for audit, but this player's leaderboard score will restart from zero.`)) return;

  if (resetButton) resetButton.disabled = true;
  if (resetStatus) resetStatus.textContent = 'Resetting combat stats…';

  try {
    const data = await window.HDS.api('/api/admin-combat/reset', {
      method: 'POST',
      body: JSON.stringify({ steamId, confirm: 'RESET COMBAT' }),
    });
    const reset = data?.reset || {};
    const name = reset.displayName || steamId;
    if (resetStatus) resetStatus.textContent = `${name}'s kills, deaths and K:D were reset.`;
  } catch (error) {
    if (resetStatus) resetStatus.textContent = error.message || 'Could not reset combat stats.';
  } finally {
    if (resetButton) resetButton.disabled = false;
  }
}

resetButton?.addEventListener('click', resetCombatStats);
