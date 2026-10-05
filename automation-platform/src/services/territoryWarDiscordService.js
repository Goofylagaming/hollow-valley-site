const store = require('./automationStore');
const herbyBot = require('./herbyBotOutboxService');

const STATE_KEY = 'territory-war-discord:v1';
const DEFAULT_POLL_MS = 15000;
const BASE_RELAY_KINDS = new Set(['status', 'attack', 'contest', 'capture', 'defence']);

let timer = null;
let running = false;
let lastPollAt = null;
let lastError = null;

function enabled(env = process.env) {
  return String(env.TERRITORY_WARS_DISCORD_ENABLED || '').toLowerCase() === 'true';
}

function stateUrl(env = process.env) {
  const value = String(env.TERRITORY_WARS_STATE_URL || '').trim();
  return /^https:\/\//i.test(value) ? value : '';
}

function mapUrl(env = process.env) {
  const configured = String(env.TERRITORY_WARS_MAP_URL || '').trim();
  return /^https:\/\//i.test(configured)
    ? configured
    : 'https://hollowvalleyisle.com/groups/territory-wars/';
}

function pollIntervalMs(env = process.env) {
  const value = Number(env.TERRITORY_WARS_DISCORD_POLL_MS || DEFAULT_POLL_MS);
  return Math.max(5000, Math.min(120000, Number.isFinite(value) ? value : DEFAULT_POLL_MS));
}

function relayKinds(env = process.env) {
  const kinds = new Set(BASE_RELAY_KINDS);
  if (String(env.TERRITORY_WARS_DISCORD_KILLS || '').toLowerCase() === 'true') kinds.add('kill');
  return kinds;
}

function clean(value, fallback = '') {
  const text = String(value ?? '').replace(/[\x00-\x1f\x7f]/g, '').trim().replace(/\s+/g, ' ');
  return (text || fallback).slice(0, 1000);
}

function label(value) {
  return clean(value, 'Territory').toUpperCase();
}

function formatMessage(entry, event, env = process.env) {
  const kind = String(entry?.kind || '').toLowerCase();
  const territory = clean(event?.territory_name, 'Territory');
  const message = clean(entry?.message, 'Territory War updated.');
  const owner = clean(event?.owner_name, 'Admin');
  const challenger = clean(event?.challenger_name, 'Open');
  const link = mapUrl(env);

  if (kind === 'capture') {
    return `🏴 **${label(territory)} CAPTURED**\n${message}\nCurrent owner: **${owner}**\n${link}`;
  }
  if (kind === 'attack') {
    return `⚔️ **ATTACK — ${label(territory)}**\n${message}\nOwner: **${owner}** · Challenger: **${challenger}**\n${link}`;
  }
  if (kind === 'contest') {
    return `🔥 **${label(territory)} CONTESTED**\n${message}\n${link}`;
  }
  if (kind === 'defence') {
    return `🛡️ **${label(territory)} DEFENDED**\n${message}\n${link}`;
  }
  if (kind === 'kill') {
    return `☠️ **${label(territory)} BATTLEFIELD**\n${message}`;
  }
  if (kind === 'status') {
    if (/ended|frozen/i.test(message)) {
      return `🏁 **${label(territory)} WAR ENDED**\n${message}\nFinal owner: **${owner}**\n${link}`;
    }
    if (/started|live/i.test(message)) {
      return `⚔️ **${label(territory)} WAR HAS BEGUN**\n${message}\nCurrent owner: **${owner}**\n${link}`;
    }
    return `📣 **${label(territory)} WAR STATUS**\n${message}\n${link}`;
  }
  return `📣 **${label(territory)} TERRITORY WAR**\n${message}\n${link}`;
}

function readCursor(storeApi = store) {
  return storeApi.getState(STATE_KEY, {
    value: { eventId: null, lastLogId: 0, primedAt: null, lastRelayAt: null },
  })?.value || { eventId: null, lastLogId: 0, primedAt: null, lastRelayAt: null };
}

function writeCursor(value, storeApi = store) {
  return storeApi.setState(STATE_KEY, value);
}

async function fetchTerritoryState({ fetchImpl = globalThis.fetch, env = process.env } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('Territory Wars Discord relay requires fetch');
  const url = stateUrl(env);
  if (!url) throw new Error('TERRITORY_WARS_STATE_URL is not configured');
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Territory Wars state returned HTTP ${response.status}`);
  return response.json();
}

async function pollOnce({
  fetchImpl = globalThis.fetch,
  env = process.env,
  storeApi = store,
  outbox = herbyBot,
} = {}) {
  if (running) return { skipped: true, reason: 'poll-already-running' };
  if (!enabled(env)) return { skipped: true, reason: 'disabled' };
  if (!stateUrl(env)) return { skipped: true, reason: 'state-url-not-configured' };
  if (!outbox.configured()) return { skipped: true, reason: 'herbybot-not-configured' };

  running = true;
  try {
    const payload = await fetchTerritoryState({ fetchImpl, env });
    const event = payload?.event || null;
    const logs = (Array.isArray(payload?.log) ? payload.log : [])
      .filter((entry) => Number.isInteger(Number(entry?.id)))
      .sort((left, right) => Number(left.id) - Number(right.id));
    const highestLogId = logs.reduce((max, entry) => Math.max(max, Number(entry.id) || 0), 0);
    const cursor = readCursor(storeApi);

    if (!event?.id) {
      lastPollAt = new Date().toISOString();
      lastError = null;
      return { skipped: false, event: null, queued: 0, checked: logs.length, lastPollAt };
    }

    if (Number(cursor.eventId) !== Number(event.id)) {
      const primed = {
        eventId: Number(event.id),
        lastLogId: highestLogId,
        primedAt: new Date().toISOString(),
        lastRelayAt: cursor.lastRelayAt || null,
      };
      writeCursor(primed, storeApi);
      lastPollAt = new Date().toISOString();
      lastError = null;
      return {
        skipped: false,
        primed: true,
        eventId: Number(event.id),
        queued: 0,
        checked: logs.length,
        lastLogId: highestLogId,
        lastPollAt,
      };
    }

    const allowedKinds = relayKinds(env);
    const pending = logs.filter((entry) => Number(entry.id) > Number(cursor.lastLogId || 0));
    let queued = 0;
    let lastRelayAt = cursor.lastRelayAt || null;

    for (const entry of pending) {
      if (allowedKinds.has(String(entry.kind || '').toLowerCase())) {
        outbox.queueTerritoryWar(formatMessage(entry, event, env), {
          nonce: `territory:${Number(event.id)}:log:${Number(entry.id)}`,
        });
        queued += 1;
        lastRelayAt = new Date().toISOString();
      }
    }

    const lastLogId = Math.max(Number(cursor.lastLogId || 0), highestLogId);
    writeCursor({
      eventId: Number(event.id),
      lastLogId,
      primedAt: cursor.primedAt || new Date().toISOString(),
      lastRelayAt,
    }, storeApi);

    lastPollAt = new Date().toISOString();
    lastError = null;
    return {
      skipped: false,
      primed: false,
      eventId: Number(event.id),
      checked: pending.length,
      queued,
      lastLogId,
      lastPollAt,
    };
  } catch (error) {
    lastError = error.message || String(error);
    throw error;
  } finally {
    running = false;
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(async () => {
    try {
      await pollOnce();
    } catch (error) {
      console.warn('[territory-war-discord]', error.message);
    } finally {
      schedule();
    }
  }, pollIntervalMs());
  timer.unref?.();
}

function start() {
  if (timer || !enabled()) return timer;
  pollOnce().catch((error) => {
    lastError = error.message || String(error);
    console.warn('[territory-war-discord]', lastError);
  }).finally(schedule);
  return timer;
}

function stop() {
  clearTimeout(timer);
  timer = null;
}

function getState() {
  return {
    enabled: enabled(),
    configured: Boolean(stateUrl()) && herbyBot.configured(),
    stateUrlConfigured: Boolean(stateUrl()),
    pollIntervalSeconds: pollIntervalMs() / 1000,
    killsEnabled: relayKinds().has('kill'),
    lastPollAt,
    lastError,
    cursor: readCursor(),
  };
}

module.exports = {
  STATE_KEY,
  enabled,
  stateUrl,
  mapUrl,
  pollIntervalMs,
  relayKinds,
  formatMessage,
  fetchTerritoryState,
  pollOnce,
  start,
  stop,
  getState,
};
