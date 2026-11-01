// Omniraptor growth validation preparation. This client is READ ONLY:
// it GETs one Steam-linked player's private snapshot and never sends any
// gameplay, growth, wallet, mutation, configuration, or restart command.
(() => {
  'use strict';
  const api = window.HDS?.api;
  const id = (name) => document.getElementById(name);
  if (typeof api !== 'function' || !id('omni-growth-start')) return;

  const POLL_MS = 30_000;
  const MAX_DURATION_MS = 10 * 60_000;
  const MAX_GAP_MS = 90_000;
  const MAX_SAMPLES = 25;
  const formatter = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Brisbane', day: '2-digit', month: '2-digit',
    year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  });

  let running = false;
  let inFlight = false;
  let pollTimer = null;
  let startedAtMs = null;
  let observations = [];
  let lastStatus = 'Not started. Join with a growing Omniraptor.';

  function label(name, value) {
    if (id(name)) id(name).textContent = value;
  }
  function selectedTarget() {
    const value = Number(id('omni-growth-target')?.value);
    return Number.isSafeInteger(value) && value >= 1 && value <= 10 ? value : null;
  }
  function selection() {
    const target = selectedTarget();
    label('omni-growth-selection', target
      ? target + '× requested · read-only preview, no game command'
      : 'Choose a valid 1×–10× target');
  }
  function formatNumber(value, suffix = '') {
    return typeof value === 'number' && Number.isFinite(value)
      ? value.toFixed(2) + suffix : '—';
  }
  function qldTime(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? formatter.format(date) + ' (QLD)' : '—';
  }
  function observedRate() {
    if (observations.length < 2) return null;
    const first = observations[0];
    const last = observations[observations.length - 1];
    const elapsed = (last.ms - first.ms) / 60_000;
    if (elapsed < 0.5) return null;
    return { minutes: elapsed, change: last.growth - first.growth,
      rate: (last.growth - first.growth) / elapsed };
  }
  function render() {
    selection();
    const table = id('omni-growth-observations');
    if (table) {
      table.replaceChildren();
      if (!observations.length) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 6;
        td.textContent = 'No live observation captured.';
        tr.append(td);
        table.append(tr);
      } else {
        for (const item of observations) {
          const row = document.createElement('tr');
          const cells = [
            qldTime(item.timestamp), formatNumber(item.growth, '%'),
            formatNumber(item.health), formatNumber(item.stamina),
            formatNumber(item.hunger), formatNumber(item.thirst),
          ];
          for (const value of cells) {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.append(cell);
          }
          table.append(row);
        }
      }
    }
    const measured = observedRate();
    label('omni-growth-rate', measured
      ? 'Observed natural growth: ' + formatNumber(measured.rate, ' percentage points/min') +
        ' over ' + formatNumber(measured.minutes, ' min') +
        ' at current global settings. Requested ' + selectedTarget() +
        '× is NOT applied or measured as a separate personal multiplier.'
      : 'Observed natural growth rate: unavailable until two distinct fresh samples are collected.');
    label('omni-growth-state', lastStatus);
    if (id('omni-growth-start')) id('omni-growth-start').disabled = running || !selectedTarget();
    if (id('omni-growth-stop')) id('omni-growth-stop').disabled = !running;
    if (id('omni-growth-copy')) id('omni-growth-copy').disabled = observations.length === 0;
  }
  function stop(reason = 'Observation stopped by administrator.') {
    running = false;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    lastStatus = reason;
    render();
  }
  async function sample() {
    if (!running || inFlight) return;
    if (Date.now() - startedAtMs >= MAX_DURATION_MS ||
        observations.length >= MAX_SAMPLES) {
      stop('Read-only observation finished (10-minute / sample limit). Review the results.');
      return;
    }
    if (document.hidden) {
      stop('Observation stopped when the tab was hidden. No background polling continues.');
      return;
    }
    inFlight = true;
    try {
      const result = await api('/api/admin-operations/growth-validation/omniraptor');
      if (!running) return;
      if (result?.mode !== 'read-only' || result?.gameMutationEnabled !== false ||
          result?.perDinosaurGrowthSupported !== false) {
        stop('Validation endpoint returned an unexpected mode. Observation stopped safely.');
        return;
      }
      if (!['ready', 'fully-grown'].includes(result.status)) {
        const statuses = {
          'server-unavailable': 'The game server is unavailable.',
          'unverified-timestamp': 'The game snapshot has no verified timestamp.',
          'stale-snapshot': 'The latest game snapshot is too old.',
          'player-offline': 'Your Steam account is not online in The Isle.',
          'character-unverified': 'Could not confirm your active dinosaur.',
          'not-omniraptor': 'Your active dinosaur is not an Omniraptor.',
          'growth-unavailable': 'The game did not provide a readable growth percentage.',
        };
        stop((statuses[result.status] || 'Growth observation is not ready.') +
          ' No growth command was sent.');
        return;
      }
      const timestamp = result.observedAt;
      const ms = Date.parse(String(timestamp || ''));
      const growth = Number(result.player?.growthPercent);
      if (!Number.isFinite(ms) || !Number.isFinite(growth) ||
          growth < 0 || growth > 100) {
        stop('Invalid growth sample. Observation stopped without a game change.');
        return;
      }
      const prev = observations.at(-1);
      if (prev) {
        if (ms <= prev.ms) {
          lastStatus = 'Waiting for a new authoritative snapshot. ' +
            observations.length + ' unique sample(s) collected.';
          render();
          return;
        }
        if (ms - prev.ms > MAX_GAP_MS) {
          stop('Presence gap exceeded 90 seconds; this run is no longer continuous. ' +
            'Restart the observation to establish a new baseline.');
          return;
        }
        if (growth + 0.001 < prev.growth) {
          stop('Growth decreased since the previous sample. It may be a new dinosaur or an invalid sample. ' +
            'Run halted without attempting to restore anything.');
          return;
        }
        if (prev.mutationCount !== null &&
            result.player?.mutationCount !== null &&
            Number(result.player.mutationCount) !== prev.mutationCount) {
          stop('Mutation count changed mid-test. Run halted to avoid comparing different character states.');
          return;
        }
      }
      observations.push({
        timestamp, ms, growth,
        health: result.player?.health,
        stamina: result.player?.stamina,
        hunger: result.player?.hunger,
        thirst: result.player?.thirst,
        mutationCount: result.player?.mutationCount,
        source: result.source,
      });
      lastStatus = 'Read-only observation active: ' + observations.length +
        ' unique sample(s), last game snapshot ' +
        result.sampleAgeSeconds + 's old. Requested target ' +
        selectedTarget() + '× has NOT been applied.';
      if (result.status === 'fully-grown') {
        stop('Your Omniraptor is already fully grown. You need a growing Omniraptor to measure natural growth rate.');
        return;
      }
      render();
    } catch (error) {
      stop((error?.message || 'Snapshot request failed.') + ' No game settings were changed.');
    } finally {
      inFlight = false;
    }
  }

  id('omni-growth-target')?.addEventListener('change', () => {
    selection();
    render();
  });
  id('omni-growth-start')?.addEventListener('click', async () => {
    if (running || !selectedTarget()) return;
    observations = [];
    running = true;
    startedAtMs = Date.now();
    lastStatus = 'Checking the live Steam-linked Omniraptor snapshot…';
    render();
    await sample();
    if (running && !pollTimer) {
      pollTimer = setInterval(() => { sample().catch(() => stop('Observation error.')); }, POLL_MS);
    }
  });
  id('omni-growth-stop')?.addEventListener('click', () => stop());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) stop('Observation stopped when tab became hidden.');
  });
  id('omni-growth-copy')?.addEventListener('click', async () => {
    const report = [
      'Hollow Valley — Omniraptor read-only growth validation',
      'Requested effective target: ' + selectedTarget() + '× (NOT applied)',
      'Gameplay mutation: DISABLED; no Game.ini, RCON or wallet changes',
      'Collected samples: ' + observations.length,
      'Run status: ' + lastStatus,
      'Natural observed growth (percentage points/min): ' +
        (observedRate()?.rate?.toFixed(4) ?? 'insufficient data'),
      ...observations.map(item => [
        qldTime(item.timestamp), item.growth.toFixed(3) + '%',
        'health=' + formatNumber(item.health),
        'stamina=' + formatNumber(item.stamina),
        'hunger=' + formatNumber(item.hunger),
        'thirst=' + formatNumber(item.thirst),
        'mutations=' + (item.mutationCount == null ? 'unknown' : item.mutationCount),
        'source=' + String(item.source || 'unknown'),
      ].join(' | ')),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(report);
      lastStatus = 'Read-only test report copied to clipboard. No game change was made.';
    } catch {
      lastStatus = 'Clipboard unavailable; the samples remain displayed below.';
    }
    render();
  });
  render();
})();
