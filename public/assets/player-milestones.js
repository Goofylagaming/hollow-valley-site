(() => {
  'use strict';
  if (window.hvPlayerMilestonesStarted) return;
  window.hvPlayerMilestonesStarted = true;
  const labels = { sanctuary: 'Sanctuary enter / leave', patrol: 'Patrol zone entries', migration: 'Migration zone entries', inGame: 'Also send private in-game messages' };
  let cursor, owner, busy = false, panel, status, stats, controls;
  const toasts = document.createElement('div');
  toasts.className = 'player-milestone-toasts';
  toasts.setAttribute('role', 'status');
  toasts.setAttribute('aria-live', 'polite');
  document.body.append(toasts);
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet'; stylesheet.href = '/assets/player-milestones.css?v=1';
  document.head.append(stylesheet);
  function toast(message) {
    if (toasts.children.length >= 3) toasts.firstElementChild.remove();
    const item = document.createElement('div');
    item.className = 'player-milestone-toast';
    const text = document.createElement('span'); text.textContent = message;
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×';
    close.setAttribute('aria-label', 'Dismiss notification'); close.onclick = () => item.remove();
    item.append(text, close); toasts.append(item);
    setTimeout(() => item.remove(), 10000);
  }
  function settings(data) {
    if (!document.getElementById('profile-content')) return;
    if (!panel) {
      panel = document.createElement('section'); panel.className = 'panel player-milestone-settings'; panel.id = 'player-notifications';
      const heading = document.createElement('h3'); heading.textContent = 'Player notifications';
      const note = document.createElement('p');
      note.textContent = 'Private alerts appear while the website is open. Map visits are sampled estimates; patrol and migration activity is not verified. Counters start when tracking first observes your dinosaur.';
      controls = document.createElement('div'); controls.className = 'player-milestone-controls';
      for (const [key, title] of Object.entries(labels)) {
        const label = document.createElement('label'), input = document.createElement('input');
        input.type = 'checkbox'; input.dataset.preference = key;
        input.addEventListener('change', async () => {
          input.disabled = true;
          try {
            await window.HDS.api('/api/player-milestones/preferences', { method: 'POST', body: JSON.stringify({ [key]: input.checked }) });
            status.textContent = 'Notification settings saved.';
          } catch { input.checked = !input.checked; status.textContent = 'Could not save. Please try again.'; }
          finally { input.disabled = false; }
        });
        label.append(input, document.createTextNode(title)); controls.append(label);
      }
      stats = document.createElement('p'); status = document.createElement('p'); status.setAttribute('role', 'status');
      panel.append(heading, note, controls, stats, status); document.getElementById('profile-content').append(panel);
    }
    for (const input of controls.querySelectorAll('input')) {
      if (document.activeElement !== input) input.checked = data.preferences[input.dataset.preference];
      if (input.dataset.preference === 'inGame') {
        input.disabled = !data.inGameAvailable;
        input.parentElement.title = data.inGameAvailable ? '' : 'Private in-game delivery is not enabled on this server.';
      }
    }
    const s = data.stats;
    stats.textContent = !data.enabled ? 'Notifications are temporarily disabled.' : !s ? 'Waiting for your first dinosaur observation.' :
      `${s.ended ? 'Last life' : 'This life'}: Patrol ${s.unique.patrol} unique / ${s.entries.patrol} entries · Migration ${s.unique.migration} unique / ${s.entries.migration} entries.`;
  }
  async function poll() {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const data = await window.HDS.api('/api/player-milestones' + (cursor === undefined ? '' : '?after=' + cursor));
      // Cursor is account-scoped and kept per tab across navigation. localStorage
      // claims prevent the same event being shown again in a second open tab.
      if (owner !== data.steamId) {
        owner = data.steamId;
        let saved;
        try { saved = sessionStorage.getItem('hv-milestone-cursor:' + owner); } catch {} 
        if (saved != null && /^\d+$/.test(saved) && cursor === undefined) {
          cursor = Math.min(Number(saved), data.cursor); return;
        }
      }
      settings(data);
      for (const event of data.events || []) {
        const key = 'hv-milestone-seen:' + owner;
        const show = () => {
          let seen = 0;
          try { seen = Number(localStorage.getItem(key)) || 0; } catch {}
          if (event.id <= seen) return;
          try { localStorage.setItem(key, String(event.id)); } catch {}
          toast(event.message);
        };
        if (navigator.locks) await navigator.locks.request(key, show); else show();
      }
      cursor = data.cursor;
      try { sessionStorage.setItem('hv-milestone-cursor:' + owner, String(cursor)); } catch {}
    } catch {
      if (status) status.textContent = 'Live notifications are temporarily unavailable. Your saved counters are preserved.';
    } finally { busy = false; }
  }
  poll();
  setInterval(poll, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
})();
