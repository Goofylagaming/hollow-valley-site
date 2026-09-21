const store = require('./automationStore');

const STATE_KEY = 'discord:scheduled-events';

function staleAfterMs(env = process.env) {
  const seconds = Number(env.DISCORD_EVENTS_STALE_SECONDS || 300);
  const safeSeconds = Math.max(60, Math.min(3600, Number.isFinite(seconds) ? seconds : 300));
  return safeSeconds * 1000;
}

function cleanText(value, max) {
  const text = String(value || '').replace(/[\x00-\x1f\x7f]/g, '').trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, max) : null;
}

function validateSnowflake(value, label) {
  const id = String(value || '').trim();
  if (!/^\d{10,24}$/.test(id)) throw new Error(`${label} must be a Discord snowflake`);
  return id;
}

function isoOrNull(value, { required = false } = {}) {
  if (value === null || value === undefined || value === '') {
    if (required) throw new Error('Scheduled event startTime is required');
    return null;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Scheduled event time is invalid');
  return date.toISOString();
}

function normalizeEvent(raw, guildId) {
  const id = validateSnowflake(raw?.id, 'Scheduled event ID');
  const title = cleanText(raw?.title || raw?.name, 120);
  if (!title) throw new Error('Scheduled event title is required');
  const startTime = isoOrNull(raw?.startTime || raw?.scheduled_start_time, { required: true });
  const endTime = isoOrNull(raw?.endTime || raw?.scheduled_end_time);
  const attendees = Math.max(0, Math.min(1000000, Number(raw?.attendees ?? raw?.userCount ?? 0) || 0));
  const eventGuildId = validateSnowflake(raw?.guildId || guildId, 'Guild ID');

  return {
    id,
    guildId: eventGuildId,
    title,
    description: cleanText(raw?.description, 1000),
    startTime,
    endTime,
    location: cleanText(raw?.location, 200),
    attendees,
    url: `https://discord.com/events/${eventGuildId}/${id}`,
  };
}

function syncEvents({ guildId, events, syncedAt = new Date().toISOString() }) {
  const safeGuildId = validateSnowflake(guildId, 'Guild ID');
  if (!Array.isArray(events)) throw new Error('Scheduled events must be an array');
  if (events.length > 250) throw new Error('Scheduled event sync exceeds 250 events');

  const normalized = events
    .map((event) => normalizeEvent(event, safeGuildId))
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

  const seen = new Set();
  for (const event of normalized) {
    if (seen.has(event.id)) throw new Error(`Duplicate scheduled event ID: ${event.id}`);
    seen.add(event.id);
  }

  const synced = isoOrNull(syncedAt, { required: true });
  const state = store.setState(STATE_KEY, {
    guildId: safeGuildId,
    events: normalized,
    syncedAt: synced,
  });

  return {
    configured: true,
    guildId: safeGuildId,
    events: normalized,
    syncedAt: synced,
    stale: false,
    updatedAt: state?.updatedAt || null,
  };
}

function getEvents({ env = process.env, nowMs = Date.now() } = {}) {
  const state = store.getState(STATE_KEY, null);
  if (!state?.value) {
    return {
      configured: false,
      guildId: null,
      events: [],
      syncedAt: null,
      stale: false,
      ageSeconds: null,
    };
  }

  const value = state.value || {};
  const syncedAt = value.syncedAt || state.updatedAt || null;
  const syncedMs = syncedAt ? new Date(syncedAt).getTime() : NaN;
  const ageMs = Number.isFinite(syncedMs) ? Math.max(0, nowMs - syncedMs) : null;
  const stale = ageMs === null ? true : ageMs > staleAfterMs(env);

  return {
    configured: true,
    guildId: value.guildId || null,
    events: Array.isArray(value.events) ? value.events : [],
    syncedAt,
    stale,
    ageSeconds: ageMs === null ? null : Math.floor(ageMs / 1000),
  };
}

module.exports = {
  staleAfterMs,
  normalizeEvent,
  syncEvents,
  getEvents,
  _test: { STATE_KEY },
};
