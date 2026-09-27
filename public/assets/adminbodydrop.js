const { api } = window.HDS;

async function resetBodyDrop(event) {
  event.preventDefault();
  const steamId = String(document.getElementById('admin-bodydrop-steam')?.value || '').trim();
  const button = document.getElementById('admin-bodydrop-reset');
  const status = document.getElementById('admin-bodydrop-status');

  if (!/^\d{17}$/.test(steamId)) {
    if (status) status.textContent = 'Enter a valid 17-digit Steam ID.';
    return;
  }

  const confirmed = window.prompt(
    'This clears the player\'s latest BodyDrop pending/cooldown lock.\n\n' +
    'The original game command may already have executed.\n\n' +
    'Type RESET BODYDROP exactly to continue:',
    ''
  );
  if (confirmed === null) return;
  if (confirmed !== 'RESET BODYDROP') {
    if (status) status.textContent = 'Reset cancelled. Confirmation did not match.';
    return;
  }

  if (button) button.disabled = true;
  if (status) status.textContent = 'Resetting BodyDrop lock…';

  try {
    const data = await api('/api/admin-bodydrop-reset', {
      method: 'POST',
      body: JSON.stringify({ steamId, confirm: confirmed }),
    });
    const reset = data?.reset || {};
    if (status) {
      status.textContent = reset.changed
        ? `Reset complete. Previous status: ${reset.previousStatus || 'unknown'}. The player can request BodyDrop again.`
        : (reset.message || 'No BodyDrop request was found for that Steam ID.');
    }
  } catch (error) {
    if (status) status.textContent = error.message || 'BodyDrop reset failed.';
  } finally {
    if (button) button.disabled = false;
  }
}

async function init() {
  const me = await window.HDS.loadMe();
  const guard = document.getElementById('admin-bodydrop-guard');
  const content = document.getElementById('admin-bodydrop-content');

  if (!me.loggedIn || !me.user?.is_admin) {
    if (guard) {
      guard.hidden = false;
      guard.innerHTML = '<p class="section-intro">Admin access is required.</p>';
    }
    if (content) content.hidden = true;
    return;
  }

  if (guard) guard.hidden = true;
  if (content) content.hidden = false;
}

document.getElementById('admin-bodydrop-reset-form')?.addEventListener('submit', resetBodyDrop);
init();
