const store = require('./automationStore');
const audit = require('./auditService');
const discord = require('./discordAutomationService');
const { getServerSnapshot } = require('./statusService');

const STATE_KEY = 'server_monitor';
let checkRunning = false;

function enabled() {
  return String(process.env.SERVER_MONITOR_ENABLED || '').toLowerCase() === 'true';
}

function failureThreshold() {
  const value = Number(process.env.SERVER_MONITOR_FAILURE_THRESHOLD || 3);
  return Number.isInteger(value) ? Math.max(2, Math.min(10, value)) : 3;
}

function normalizeState(value = {}) {
  return {
    confirmed: ['online', 'offline'].includes(value.confirmed) ? value.confirmed : null,
    consecutiveFailures: Math.max(0, Number(value.consecutiveFailures) || 0),
    lastCheckedAt: value.lastCheckedAt || null,
    lastChangedAt: value.lastChangedAt || null,
    lastAlertAt: value.lastAlertAt || null,
    lastError: value.lastError || null,
  };
}

function nextMonitorState(previousValue, online, threshold = 3, nowIso = new Date().toISOString()) {
  const previous = normalizeState(previousValue);
  if (online) {
    const transition = previous.confirmed === 'offline' ? 'recovered' : null;
    return {
      transition,
      state: {
        ...previous,
        confirmed: 'online',
        consecutiveFailures: 0,
        lastCheckedAt: nowIso,
        lastChangedAt: transition ? nowIso : previous.lastChangedAt,
        lastError: null,
      },
    };
  }

  const consecutiveFailures = previous.consecutiveFailures + 1;
  const transition = consecutiveFailures >= threshold && previous.confirmed !== 'offline' ? 'offline' : null;
  return {
    transition,
    state: {
      ...previous,
      confirmed: transition ? 'offline' : previous.confirmed,
      consecutiveFailures,
      lastCheckedAt: nowIso,
      lastChangedAt: transition ? nowIso : previous.lastChangedAt,
    },
  };
}

function getPersistedState() {
  return normalizeState(store.getState(STATE_KEY, { value: {} })?.value || {});
}

function getState() {
  return {
    enabled: enabled(),
    configured: enabled() && discord.alertConfigured(),
    failureThreshold: failureThreshold(),
    ...getPersistedState(),
  };
}

function alertText(transition, snapshot, failures) {
  if (transition === 'offline') {
    const reason = snapshot.error ? ` RCON check: ${snapshot.error}.` : '';
    return `🔴 Hollow Valley server alert: the Evrima server has failed ${failures} consecutive health checks and is being marked offline.${reason}`;
  }
  const count = Array.isArray(snapshot.players) ? snapshot.players.length : 0;
  return `🟢 Hollow Valley server recovered: Evrima RCON is responding again and ${count} player${count === 1 ? '' : 's'} are currently online.`;
}

async function checkServerMonitor({ force = false } = {}) {
  if (checkRunning) return { skipped: true, reason: 'check-already-running', ...getState() };
  if (!enabled()) return { skipped: true, reason: 'disabled', ...getState() };
  if (!discord.alertConfigured()) return { skipped: true, reason: 'herbybot-bridge-not-configured', ...getState() };

  checkRunning = true;
  try {
    const snapshot = await getServerSnapshot({ force });
    if (!snapshot.configured) return { skipped: true, reason: 'rcon-not-configured', ...getState() };

    const previous = getPersistedState();
    const nowIso = new Date().toISOString();
    const next = nextMonitorState(previous, Boolean(snapshot.online), failureThreshold(), nowIso);
    next.state.lastError = snapshot.error || null;

    if (!next.transition) {
      store.setState(STATE_KEY, next.state);
      return { skipped: false, transition: null, ...getState() };
    }

    try {
      await audit.run('monitor', `server_${next.transition}`, {
        consecutiveFailures: next.state.consecutiveFailures,
      }, () => {
        const transitionNonce = next.transition === 'offline'
          ? `hollow-valley-server:offline:${next.state.consecutiveFailures}`
          : `hollow-valley-server:recovered:${previous.lastChangedAt ? Date.parse(previous.lastChangedAt) : 'offline'}`;
        return discord.sendAlert(
          alertText(next.transition, snapshot, next.state.consecutiveFailures),
          { nonce: transitionNonce }
        );
      }, (value) => ({ outboxEventId: value.id || null, queued: Boolean(value.queued) }));
      next.state.lastAlertAt = nowIso;
      store.setState(STATE_KEY, next.state);
      return { skipped: false, transition: next.transition, alerted: true, ...getState() };
    } catch (error) {
      const retryState = {
        ...next.state,
        confirmed: previous.confirmed,
        lastChangedAt: previous.lastChangedAt,
        lastError: `Alert queueing failed: ${error.message}`,
      };
      store.setState(STATE_KEY, retryState);
      throw error;
    }
  } finally {
    checkRunning = false;
  }
}

function startServerMonitor() {
  if (!enabled()) return null;
  const configuredInterval = Number(process.env.SERVER_MONITOR_INTERVAL_MS || 300_000);
  const intervalMs = Math.max(300_000, Math.min(600_000, Number.isFinite(configuredInterval) ? configuredInterval : 300_000));
  checkServerMonitor().catch((error) => console.warn('[server-monitor]', error.message));
  const timer = setInterval(() => {
    checkServerMonitor().catch((error) => console.warn('[server-monitor]', error.message));
  }, intervalMs);
  timer.unref?.();
  return timer;
}

module.exports = {
  enabled,
  failureThreshold,
  normalizeState,
  nextMonitorState,
  getState,
  checkServerMonitor,
  startServerMonitor,
};
