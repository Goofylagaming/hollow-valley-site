// Admin-only timed species coin events. Coin awards happen exclusively on
// the server from trusted presence samples, never in this browser.
(() => {
  'use strict';
  const { api, escapeHtml } = window.HDS || {};
  if (typeof api !== 'function') return;
  const DRAFT_KEY = 'hvSpeciesCoinEventPendingV1';
  let state = null;

  const el = (id) => document.getElementById(id);
  function text(id, value) { if (el(id)) el(id).textContent = String(value || ''); }
  function formatDate(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('en-AU') : '—';
  }
  function pending() {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function savePending(value) {
    try {
      if (value) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(value));
      else sessionStorage.removeItem(DRAFT_KEY);
    } catch {}
  }
  function selectedSpecies() {
    return el('ops-species-event-species')?.selectedOptions?.[0]?.textContent || 'a dinosaur';
  }
  function preview() {
    const coins = Number(el('ops-species-event-coins')?.value || 0);
    const minutes = Number(el('ops-species-event-duration')?.value || 0);
    const budget = coins > 0 && minutes > 0 ? coins * minutes : 0;
    text('ops-species-event-preview',
      'Extra ' + (Number.isFinite(coins) ? coins : 0).toLocaleString() +
      ' VC/min · ' + selectedSpecies() + ' · up to ' +
      (Number.isFinite(budget) ? budget : 0).toLocaleString() +
      ' bonus VC per eligible player (separate from regular playtime rewards).');
  }
  ['ops-species-event-species', 'ops-species-event-coins', 'ops-species-event-duration',
   'ops-species-event-start-at', 'ops-species-event-title',
   'ops-species-event-auto-announce'].forEach((id) => {
    el(id)?.addEventListener('input', preview);
  });

  function render(data) {
    state = data;
    const configured = data?.enabled === true;
    const status = el('ops-species-event-state');
    if (status) {
      status.className = 'ops-status-label ' + (configured ? 'ready' : 'attention');
      status.textContent = configured ? 'EVENT PAYOUTS ARMED' : 'EVENT PAYOUTS DISABLED';
    }
    const create = el('ops-species-event-create');
    if (create) create.disabled = !configured;
    text('ops-species-event-detail', configured
      ? 'Uses verified presence; bonuses stop when the event ends or a player switches species.'
      : 'Backend feature switch is off. No bonus credits can be awarded.');

    const select = el('ops-species-event-species');
    if (select && Array.isArray(data?.species)) {
      const previous = select.value || 'omniraptor';
      select.replaceChildren();
      for (const species of data.species) {
        const option = document.createElement('option');
        option.value = String(species.id);
        option.textContent = String(species.name);
        select.append(option);
      }
      if (data.species.some((species) => species.id === previous)) select.value = previous;
    }
    const events = Array.isArray(data?.events) ? data.events : [];
    const body = el('ops-species-event-list');
    if (body) {
      body.innerHTML = events.length ? events.map((event) => {
        const stop = ['active', 'scheduled'].includes(event.status)
          ? '<button type="button" class="small-button" data-stop-event="' +
            escapeHtml(event.id) + '">Stop</button>' : '';
        const announce = event.status === 'active'
          ? '<button type="button" class="small-button" data-announce-event="' +
            escapeHtml(event.id) + '">Prepare announcement</button>' : '';
        return '<tr><td>' + escapeHtml(event.title) + '</td><td>' +
          escapeHtml(event.species) + '</td><td>' +
          Number(event.coinsPerMinute).toLocaleString() + ' VC/min</td><td>' +
          escapeHtml(formatDate(event.startsAt)) + ' – ' +
          escapeHtml(formatDate(event.endsAt)) + '</td><td>' +
          escapeHtml(event.status) + '</td><td>' + stop + announce + '</td></tr>';
      }).join('') : '<tr><td colspan="6">No configured dinosaur coin events.</td></tr>';
    }
    preview();
  }

  async function refresh() {
    text('ops-species-event-message', 'Refreshing random event status…');
    try {
      const data = await api('/api/admin-operations/species-coin-events');
      render(data);
      text('ops-species-event-message', data.enabled
        ? 'Ready. Starting a species event does not modify global growth or restart the game server.'
        : 'Random event payouts are disabled until the automation feature switch is enabled.');
    } catch (error) {
      if (el('ops-species-event-create')) el('ops-species-event-create').disabled = true;
      text('ops-species-event-message', error.message || 'Dinosaur event status is unavailable.');
    }
  }

  function draftPayload() {
    const title = el('ops-species-event-title')?.value.trim() || '';
    const species = el('ops-species-event-species')?.value || '';
    const coinsPerMinute = Number(el('ops-species-event-coins')?.value || 0);
    const durationMinutes = Number(el('ops-species-event-duration')?.value || 0);
    const localStart = el('ops-species-event-start-at')?.value || '';
    if (!title || !species || !Number.isSafeInteger(coinsPerMinute) ||
        coinsPerMinute < 1 || coinsPerMinute > 1000 ||
        !Number.isSafeInteger(durationMinutes) ||
        durationMinutes < 5 || durationMinutes > 720) {
      throw new Error('Enter a dinosaur, 1–1,000 VC/min, and a duration of 5–720 minutes.');
    }
    if (localStart && !Number.isFinite(new Date(localStart).getTime())) {
      throw new Error('Choose a valid local date and time.');
    }
    return { title, species, coinsPerMinute, durationMinutes,
      startsAt: localStart ? new Date(localStart).toISOString() : null,
      autoAnnounce: el('ops-species-event-auto-announce')?.checked !== false };
  }

  el('ops-species-event-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state?.enabled) return;
    let draft;
    try { draft = draftPayload(); }
    catch (error) { text('ops-species-event-message', error.message); return; }
    const older = pending();
    const sameDraft = older && JSON.stringify(older.form) === JSON.stringify(draft);
    const payload = sameDraft ? older.payload : {
      ...draft, startsAt: draft.startsAt || new Date().toISOString(),
      requestId: crypto.randomUUID(),
    };
    const copy = 'Start ' + draft.title + ' for ' + draft.species + ' at ' +
      draft.coinsPerMinute + ' bonus VC per minute for ' + draft.durationMinutes +
      ' minutes? It will end automatically. This does NOT increase species growth.';
    if (!window.confirm(copy)) return;

    savePending({ form: draft, payload });
    const button = el('ops-species-event-create');
    if (button) button.disabled = true;
    text('ops-species-event-message', 'Creating event…');
    try {
      const response = await api('/api/admin-operations/species-coin-events', {
        method: 'POST', body: JSON.stringify(payload),
      });
      savePending(null);
      const created = response.event || {};
      text('ops-species-event-message', 'Created ' + (created.title || 'event') +
        ' (' + (created.status || 'scheduled') +
        '). Use the Feature Announcements panel to publish the confirmed event.');
      await refresh();
    } catch (error) {
      text('ops-species-event-message', (error.message || 'Event submission failed') +
        '. Refresh the list before retrying. The original request ID is retained to avoid duplicate events.');
    } finally {
      if (button) button.disabled = !state?.enabled;
    }
  });

  el('ops-species-event-list')?.addEventListener('click', async (event) => {
    const stop = event.target.closest('button[data-stop-event]');
    if (stop) {
      const id = stop.dataset.stopEvent;
      if (!window.confirm('Stop this species coin event now? Eligible players will stop earning new event bonus coins.')) return;
      stop.disabled = true;
      try {
        await api('/api/admin-operations/species-coin-events/' + encodeURIComponent(id) + '/stop', {
          method: 'POST', body: JSON.stringify({ confirm: 'STOP EVENT' }),
        });
        await refresh();
        text('ops-species-event-message', 'Event stopped. Existing earned Valley Coins were preserved.');
      } catch (error) {
        text('ops-species-event-message', error.message || 'Unable to stop event.');
        stop.disabled = false;
      }
      return;
    }
    const announce = event.target.closest('button[data-announce-event]');
    if (announce) {
      const active = state?.events?.find((item) => item.id === announce.dataset.announceEvent);
      if (!active) return;
      const type = el('ops-feature-type');
      const message = el('ops-feature-custom');
      if (!type || !message) return;
      type.value = 'custom';
      message.value = '🦖 Hollow Valley Random Event: ' + active.title + '! Play ' +
        active.species + ' for an extra ' + active.coinsPerMinute +
        ' Valley Coins per minute until ' + formatDate(active.endsAt) + '.';
      type.dispatchEvent(new Event('input', { bubbles: true }));
      el('feature-announcements')?.scrollIntoView({ behavior: 'smooth' });
      text('ops-species-event-message', 'Announcement text prepared. Confirm the event is active before queueing it.');
    }
  });
  el('ops-species-event-refresh')?.addEventListener('click', refresh);
  async function init() {
    const identity = await window.HDS.loadMe();
    if (identity?.loggedIn && identity.user?.is_admin) await refresh();
  }
  init().catch((error) => text('ops-species-event-message', error.message || 'Failed to initialize events.'));
})();
