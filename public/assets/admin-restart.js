(() => {
  const api = window.HDS?.api;
  if (typeof api !== 'function') return;

  function tile(label, valueId, detailId) {
    const wrapper = document.createElement('div');
    wrapper.className = 'summary-tile';
    const small = document.createElement('small');
    small.textContent = label;
    const value = document.createElement('b');
    value.id = valueId;
    value.textContent = 'Checking…';
    const detail = document.createElement('span');
    detail.id = detailId;
    detail.textContent = '—';
    wrapper.append(small, value, detail);
    return wrapper;
  }

  function ensureTiles() {
    const grid = document.querySelector('.admin-hub-status-grid');
    if (!grid || document.getElementById('hub-restart-last')) return;
    grid.append(
      tile('LAST RESTART', 'hub-restart-last', 'hub-restart-last-detail'),
      tile('NEXT RESTART', 'hub-restart-next', 'hub-restart-next-detail'),
      tile('RESTART RESULT', 'hub-restart-result', 'hub-restart-result-detail'),
    );
  }

  function setText(id, value) {
    const node = document.getElementById(id);
    if (node) node.textContent = value ?? '—';
  }

  function formatDate(value) {
    if (!value) return 'No verified restart yet';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleString();
  }

  function latestEvent(run) {
    const events = Array.isArray(run?.events) ? run.events : [];
    return events.length ? events[events.length - 1] : null;
  }

  function render(telemetry) {
    const last = telemetry?.lastRestart || null;
    const current = telemetry?.current || null;
    const latest = latestEvent(current);

    setText('hub-restart-last', last ? formatDate(last.completedAt || last.startedAt) : 'Not verified');
    setText('hub-restart-last-detail', last
      ? `Run ${last.restartId} · ${String(last.result || 'unknown').toUpperCase()}`
      : 'Telemetry will populate after the next instrumented restart.');

    setText('hub-restart-next', formatDate(telemetry?.nextRestartAt));
    setText('hub-restart-next-detail', 'Scheduled 12:01 AM / 12:01 PM · Brisbane');

    if (current) {
      setText('hub-restart-result', 'IN PROGRESS');
      setText('hub-restart-result-detail', latest
        ? `${latest.event.replaceAll('_', ' ')} · ${formatDate(latest.at)}`
        : `Run ${current.restartId}`);
      return;
    }

    if (!last) {
      setText('hub-restart-result', 'NO EVIDENCE');
      setText('hub-restart-result-detail', 'No completed restart telemetry received yet.');
      return;
    }

    setText('hub-restart-result', String(last.result || 'unknown').toUpperCase());
    setText('hub-restart-result-detail', last.message || `Completed ${formatDate(last.completedAt)}`);
  }

  async function loadRestartTelemetry() {
    ensureTiles();
    try {
      const data = await api('/api/admin-operations');
      render(data?.status?.restartTelemetry || null);
    } catch (error) {
      setText('hub-restart-last', 'Unavailable');
      setText('hub-restart-next', 'Unavailable');
      setText('hub-restart-result', 'Unavailable');
      setText('hub-restart-result-detail', error?.message || 'Could not load restart telemetry.');
    }
  }

  ensureTiles();
  loadRestartTelemetry();
  document.getElementById('admin-hub-refresh')?.addEventListener('click', () => {
    setTimeout(loadRestartTelemetry, 50);
  });
  setInterval(loadRestartTelemetry, 60000);
})();
