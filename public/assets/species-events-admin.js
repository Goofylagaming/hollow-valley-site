// Admin-only timed species coin events. Coin awards happen exclusively on
// the server from trusted presence samples, never in this browser.
(() => {
  'use strict';
  const { api, escapeHtml } = window.HDS || {};
  if (typeof api !== 'function') return;
  const DRAFT_KEY = 'hvSpeciesCoinEventPendingV1';
  let state = null;
  const selectedBonuses = new Map();
  const speciesNames = new Map();

  const el = (id) => document.getElementById(id);
  function text(id, value) { if (el(id)) el(id).textContent = String(value || ''); }
  const qldClock = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Brisbane', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  function formatDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Unknown time';
    const p = Object.fromEntries(qldClock.formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]));
    return `${p.day}-${p.month}-${p.year} ${p.hour}:${p.minute} (QLD time)`;
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
  function speciesName(id) {
    return speciesNames.get(String(id)) || String(id || 'unknown');
  }
  function selectedRates() {
    // One dinosaur without using Add is the backwards-compatible shortcut.
    if (!selectedBonuses.size) {
      return [{
        species: el('ops-species-event-species')?.value || '',
        coinsPerMinute: Number(el('ops-species-event-coins')?.value),
      }];
    }
    return [...selectedBonuses.entries()].map(([species, coinsPerMinute]) =>
      ({ species, coinsPerMinute })).sort((a, b) => a.species.localeCompare(b.species));
  }
  function describeRates(bonuses) {
    return bonuses.map(rate => speciesName(rate.species) + ': +' +
      Number(rate.coinsPerMinute).toLocaleString() + ' VC/min').join('; ');
  }
  function renderSelected() {
    const body = el('ops-species-event-selected');
    if (!body) return;
    body.replaceChildren();
    if (!selectedBonuses.size) {
      const row = document.createElement('tr');
      const cell = document.createElement('td');
      cell.colSpan = 3;
      cell.textContent = 'No dinosaurs added yet. The selected dinosaur above is used for a single-species event.';
      row.append(cell);
      body.append(row);
    }
    for (const [species, rate] of [...selectedBonuses.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const row = document.createElement('tr');
      const nameCell = document.createElement('td');
      nameCell.textContent = speciesName(species);
      const rateCell = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.max = '1000';
      input.step = '1';
      input.value = String(rate);
      input.setAttribute('aria-label', speciesName(species) + ' extra Valley Coins per minute');
      input.style.cssText = 'width:110px;padding:8px;background:#0f172a;color:#fff;border:1px solid #334155';
      input.addEventListener('input', () => {
        selectedBonuses.set(species, Number(input.value));
        preview();
      });
      rateCell.append(input);
      const removeCell = document.createElement('td');
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'small-button';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', 'Remove ' + speciesName(species));
      remove.addEventListener('click', () => {
        selectedBonuses.delete(species);
        renderSelected();
        preview();
      });
      removeCell.append(remove);
      row.append(nameCell, rateCell, removeCell);
      body.append(row);
    }
    text('ops-species-event-selected-caption', selectedBonuses.size
      ? selectedBonuses.size + ' dinosaur(s) included in this event. Set each species rate independently.'
      : 'Choose one dinosaur, or add several above. Each can have its own coin rate.');
  }
  el('ops-species-event-add')?.addEventListener('click', () => {
    const species = el('ops-species-event-species')?.value || '';
    const coins = Number(el('ops-species-event-coins')?.value);
    if (!speciesNames.has(species) || !Number.isSafeInteger(coins) || coins < 1 || coins > 1000) {
      text('ops-species-event-message', 'Choose a playable dinosaur and 1–1,000 bonus Valley Coins/min.');
      return;
    }
    if (!selectedBonuses.has(species) && selectedBonuses.size >= 20) {
      text('ops-species-event-message', 'An event can contain a maximum of 20 dinosaurs.');
      return;
    }
    selectedBonuses.set(species, coins);
    renderSelected();
    preview();
    text('ops-species-event-message', speciesName(species) + ' added to the combined event.');
  });
  const pingLabels = Object.freeze({
    none: 'no Discord ping',
    community: '@Community Member',
    everyone: '@everyone',
  });
  function effectivePing() {
    if (el('ops-species-event-auto-announce')?.checked === false) return 'none';
    return el('ops-species-event-ping')?.value || 'none';
  }
  function syncPingControl() {
    const target = el('ops-species-event-ping');
    if (target) target.disabled = el('ops-species-event-auto-announce')?.checked === false;
  }
  function preview() {
    const bonuses = selectedRates();
    const duration = Number(el('ops-species-event-duration')?.value) || 0;
    const maxRate = Math.max(0, ...bonuses.map(rate => Number(rate.coinsPerMinute) || 0));
    const budget = maxRate * Math.max(0, duration);
    text('ops-species-event-preview',
      bonuses.length + ' dinosaur(s): ' + describeRates(bonuses) +
      ' · up to ' + budget.toLocaleString() +
      ' bonus VC per eligible player for the full duration.' +
      (bonuses.length > 1 ? ' One combined event and one start/end announcement in Community Announcements.' : '') +
      (effectivePing() === 'none' ? ' No Discord start ping.' :
        ' One Discord start ping to ' + pingLabels[effectivePing()] + '.'));
  }
  ['ops-species-event-species', 'ops-species-event-coins', 'ops-species-event-duration',
   'ops-species-event-start-at', 'ops-species-event-title',
   'ops-species-event-auto-announce', 'ops-species-event-ping'].forEach((id) => {
    el(id)?.addEventListener('input', () => { syncPingControl(); preview(); });
  });
  syncPingControl();

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
      speciesNames.clear();
      for (const species of data.species) {
        speciesNames.set(String(species.id), String(species.name));
        const option = document.createElement('option');
        option.value = String(species.id);
        option.textContent = String(species.name);
        select.append(option);
      }
      if (data.species.some((species) => species.id === previous)) select.value = previous;
      renderSelected();
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
        const rates = Array.isArray(event.speciesBonuses) && event.speciesBonuses.length
          ? event.speciesBonuses
          : [{ species: event.species, coinsPerMinute: event.coinsPerMinute }];
        return '<tr><td>' + escapeHtml(event.title) + '</td><td>' +
          escapeHtml(rates.map(rate => speciesName(rate.species)).join(', ')) + '</td><td>' +
          escapeHtml(rates.map(rate => '+' + rate.coinsPerMinute + ' ' + speciesName(rate.species)).join('; ')) +
          ' VC/min</td><td>' +
          escapeHtml(formatDate(event.startsAt)) + ' – ' +
          escapeHtml(formatDate(event.endsAt)) + '</td><td>' +
          escapeHtml(event.status) +
          (event.autoAnnounce && pingLabels[event.pingMode] && event.pingMode !== 'none'
            ? ' · start ping: ' + escapeHtml(pingLabels[event.pingMode])
            : '') +
          '</td><td>' + stop + announce + '</td></tr>';
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
    const durationMinutes = Number(el('ops-species-event-duration')?.value || 0);
    const localStart = el('ops-species-event-start-at')?.value || '';
    const speciesBonuses = selectedRates();
    if (!title || title.length > 90 || !speciesBonuses.length ||
        speciesBonuses.length > 20 || !Number.isSafeInteger(durationMinutes) ||
        durationMinutes < 5 || durationMinutes > 720) {
      throw new Error('Choose 1–20 dinosaurs and a duration of 5–720 minutes.');
    }
    if (new Set(speciesBonuses.map(rate => rate.species)).size !== speciesBonuses.length ||
        speciesBonuses.some(rate => !speciesNames.has(rate.species) ||
          !Number.isSafeInteger(rate.coinsPerMinute) ||
          rate.coinsPerMinute < 1 || rate.coinsPerMinute > 1000)) {
      throw new Error('Each selected dinosaur needs a unique 1–1,000 Valley Coins/min bonus.');
    }
    if (localStart && !Number.isFinite(new Date(localStart).getTime())) {
      throw new Error('Choose a valid local date and time.');
    }
    const pingMode = effectivePing();
    if (!Object.hasOwn(pingLabels, pingMode)) {
      throw new Error('Select a valid Discord notification target.');
    }
    return {
      title,
      // Keep single-species consumers compatible with the first entry.
      species: speciesBonuses[0].species,
      coinsPerMinute: speciesBonuses[0].coinsPerMinute,
      speciesBonuses, durationMinutes,
      startsAt: localStart ? new Date(localStart).toISOString() : null,
      autoAnnounce: el('ops-species-event-auto-announce')?.checked !== false,
      pingMode,
    };
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
    const copy = 'Start ONE event: ' + draft.title + '\n\n' +
      describeRates(draft.speciesBonuses) + '\nDuration: ' + draft.durationMinutes +
      ' minutes.\nThis will end automatically and send ONE grouped start and finish announcement. ' +
      (draft.pingMode === 'none' ? 'No mass ping will be sent.' :
        'The START announcement will ping ' + pingLabels[draft.pingMode] +
        ' once in the Community Announcements channel.') +
      ' This does NOT increase species growth.';
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
      const rates = Array.isArray(active.speciesBonuses) && active.speciesBonuses.length
        ? active.speciesBonuses
        : [{ species: active.species, coinsPerMinute: active.coinsPerMinute }];
      message.value = '🦖 Hollow Valley Random Event: ' + active.title +
        '! Featured dinosaurs: ' + describeRates(rates) +
        '. Extra Valley Coins for each verified minute until ' + formatDate(active.endsAt) + '.';
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
