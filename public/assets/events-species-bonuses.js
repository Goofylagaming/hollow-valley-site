// Public read-only display for temporary dinosaur bonus events.
(() => {
  'use strict';
  const api = window.HDS?.api;
  const escapeHtml = window.HDS?.escapeHtml || ((s) => String(s || ''));
  const target = document.getElementById('species-random-events-list');
  if (!target || typeof api !== 'function') return;
  let events = [];

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
  const remaining = (iso) => {
    const ms = new Date(iso).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) return 'Ending / expired';
    const minutes = Math.ceil(ms / 60_000);
    if (minutes < 60) return minutes + ' min remaining';
    return Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm remaining';
  };
  function render() {
    if (!events.length) {
      target.innerHTML = '<div class="empty-roster"><strong>No random dinosaur bonuses currently scheduled.</strong><p>Keep an eye on this page for community events.</p></div>';
      return;
    }
    target.innerHTML = events.map((event) => {
      const active = event.status === 'active' &&
        Date.now() >= new Date(event.startsAt).getTime() &&
        Date.now() < new Date(event.endsAt).getTime();
      const status = active ? remaining(event.endsAt) :
        Date.now() < new Date(event.startsAt).getTime()
          ? 'Starts ' + formatDate(event.startsAt)
          : 'Event ended';
      return '<div class="event-card">' +
        '<div><small>' + (active ? 'LIVE RANDOM EVENT' : 'UPCOMING DINOSAUR BONUS') +
        '</small><h3>' + escapeHtml(event.title || 'Dinosaur bonus') + '</h3>' +
        '<p>Play <strong>' + escapeHtml(event.species) + '</strong> for an extra <strong>' +
        Number(event.coinsPerMinute || 0).toLocaleString() +
        ' Valley Coins per verified minute</strong>.</p>' +
        '<small>Ends ' + escapeHtml(formatDate(event.endsAt)) + '</small></div>' +
        '<div class="event-date"><strong>' + escapeHtml(status) + '</strong></div></div>';
    }).join('');
  }
  async function refresh() {
    try {
      const state = await api('/api/events/species-bonuses');
      events = Array.isArray(state.events) ? state.events : [];
      render();
    } catch {
      target.innerHTML = '<div class="empty-roster"><strong>Bonus event status is temporarily unavailable.</strong></div>';
    }
  }
  refresh();
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 30_000);
})();
