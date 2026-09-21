const DISCORD_API = "https://discord.com/api/v10";
const CACHE_TTL_MS = 60 * 1000;

let cachedEvents = null;
let cachedAt = 0;
let resolvedGuildId = null;
let lastInvalidatedAt = null;
let lastInvalidationReason = null;

function botToken(env = process.env) {
  return String(env.DISCORD_EVENTS_BOT_TOKEN || env.DISCORD_BOT_TOKEN || "").trim();
}

function configuredGuildId(env = process.env) {
  return String(env.DISCORD_EVENTS_GUILD_ID || env.DISCORD_GUILD_ID || "").trim();
}

function isConfigured(env = process.env) {
  return Boolean(
    botToken(env) &&
    (configuredGuildId(env) || String(env.DISCORD_STATUS_CHANNEL_ID || "").trim())
  );
}

async function discordRequest(path, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const token = botToken(env);
  if (!token) throw new Error("Discord events bot token is not configured");
  const response = await fetchImpl(`${DISCORD_API}${path}`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`Discord request failed (${response.status})`);
  }
  return response.json();
}

async function getGuildId({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const direct = configuredGuildId(env);
  if (direct) return direct;
  if (resolvedGuildId) return resolvedGuildId;

  const statusChannelId = String(env.DISCORD_STATUS_CHANNEL_ID || "").trim();
  if (!statusChannelId) return null;

  const channel = await discordRequest(`/channels/${statusChannelId}`, { env, fetchImpl });
  resolvedGuildId = channel?.guild_id ? String(channel.guild_id) : null;
  return resolvedGuildId;
}

function normalizeEvent(event, guildId) {
  return {
    id: String(event.id),
    title: event.name || "Untitled event",
    description: event.description || null,
    startTime: event.scheduled_start_time,
    endTime: event.scheduled_end_time || null,
    location: event.entity_metadata?.location || null,
    attendees: Number(event.user_count || 0),
    status: Number(event.status || 0),
    entityType: Number(event.entity_type || 0),
    image: event.image || null,
    url: `https://discord.com/events/${guildId}/${event.id}`,
  };
}

function invalidateCache(reason = "discord-event-change") {
  cachedEvents = null;
  cachedAt = 0;
  lastInvalidatedAt = new Date().toISOString();
  lastInvalidationReason = String(reason || "discord-event-change");
}

async function listScheduledEvents({
  force = false,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
} = {}) {
  if (!isConfigured(env)) {
    return {
      configured: false,
      events: [],
      syncedAt: null,
      cacheAgeSeconds: null,
      guildId: null,
    };
  }

  if (!force && cachedEvents && now - cachedAt < CACHE_TTL_MS) {
    return {
      configured: true,
      events: cachedEvents,
      syncedAt: new Date(cachedAt).toISOString(),
      cacheAgeSeconds: Math.max(0, Math.floor((now - cachedAt) / 1000)),
      guildId: await getGuildId({ env, fetchImpl }),
    };
  }

  const guildId = await getGuildId({ env, fetchImpl });
  if (!guildId) throw new Error("Discord guild ID is unavailable");

  const rawEvents = await discordRequest(
    `/guilds/${guildId}/scheduled-events?with_user_count=true`,
    { env, fetchImpl }
  );

  cachedEvents = (Array.isArray(rawEvents) ? rawEvents : [])
    .filter((event) => Number(event.status) !== 3)
    .map((event) => normalizeEvent(event, guildId))
    .filter((event) => event.startTime)
    .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
  cachedAt = now;

  return {
    configured: true,
    events: cachedEvents,
    syncedAt: new Date(cachedAt).toISOString(),
    cacheAgeSeconds: 0,
    guildId,
  };
}

function getSyncState() {
  return {
    cached: Boolean(cachedEvents),
    cachedAt: cachedAt ? new Date(cachedAt).toISOString() : null,
    lastInvalidatedAt,
    lastInvalidationReason,
  };
}

function resetForTests() {
  cachedEvents = null;
  cachedAt = 0;
  resolvedGuildId = null;
  lastInvalidatedAt = null;
  lastInvalidationReason = null;
}

module.exports = {
  CACHE_TTL_MS,
  isConfigured,
  getGuildId,
  listScheduledEvents,
  invalidateCache,
  getSyncState,
  _test: { normalizeEvent, resetForTests, botToken, configuredGuildId },
};
