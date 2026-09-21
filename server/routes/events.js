const express = require("express");
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");
const { listSteamLinkedUsers } = require("../db");
const automation = require("../services/automationWebsiteClient");

const router = express.Router();
const DISCORD_API = "https://discord.com/api/v10";
const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedEvents = null;
let cachedAt = 0;

let resolvedGuildId = null;

async function getGuildId() {
  if (resolvedGuildId) return resolvedGuildId;
  const configuredGuildId = process.env.DISCORD_EVENTS_GUILD_ID || process.env.DISCORD_GUILD_ID;
  if (configuredGuildId) return configuredGuildId;

  // The already-configured status channel belongs to the same guild. Resolve
  // it once, so a second guild ID is not required just to show the calendar.
  const statusChannelId = process.env.DISCORD_STATUS_CHANNEL_ID;
  if (!statusChannelId) return null;
  const response = await fetch(`${DISCORD_API}/channels/${statusChannelId}`, {
    headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
  });
  if (!response.ok) throw new Error(`Discord status-channel request failed: ${response.status}`);
  const channel = await response.json();
  resolvedGuildId = channel.guild_id || null;
  return resolvedGuildId;
}

function isConfigured() {
  return Boolean(process.env.DISCORD_BOT_TOKEN && (process.env.DISCORD_EVENTS_GUILD_ID || process.env.DISCORD_GUILD_ID || process.env.DISCORD_STATUS_CHANNEL_ID));
}

router.get("/", async (req, res) => {
  if (!isConfigured()) {
    return res.json({ configured: false, events: [] });
  }

  if (cachedEvents && Date.now() - cachedAt < CACHE_TTL_MS) {
    return res.json({ configured: true, events: cachedEvents });
  }

  try {
    const guildId = await getGuildId();
    if (!guildId) throw new Error("Discord guild ID is unavailable");
    const response = await fetch(`${DISCORD_API}/guilds/${guildId}/scheduled-events?with_user_count=true`, {
      headers: { Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN}` },
    });
    if (!response.ok) {
      throw new Error(`Discord scheduled-events request failed: ${response.status}`);
    }

    const rawEvents = await response.json();
    cachedEvents = rawEvents
      .filter((event) => event.status !== 3)
      .map((event) => ({
        id: event.id,
        title: event.name,
        description: event.description || null,
        startTime: event.scheduled_start_time,
        endTime: event.scheduled_end_time || null,
        location: event.entity_metadata?.location || null,
        attendees: event.user_count || 0,
        url: `https://discord.com/events/${guildId}/${event.id}`,
      }))
      .sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    cachedAt = Date.now();
    res.json({ configured: true, events: cachedEvents });
  } catch (error) {
    console.error("[events] failed to load Discord scheduled events:", error.message);
    res.status(502).json({ error: "Discord events could not be loaded right now." });
  }
});

module.exports = router;


router.get("/rewards/mine", requireAuth, async (req, res) => {
  if (!req.user?.steam_id) {
    return res.status(400).json({ error: "Your Steam account is not linked." });
  }

  try {
    return res.json(await automation.getEventRewards(String(req.user.steam_id)));
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 502;
    return res.status(status).json({ error: error.message || "Could not load event reward history." });
  }
});

router.get("/admin/players", requireAdmin, (req, res) => {
  const players = listSteamLinkedUsers({
    query: req.query.q,
    limit: Number(req.query.limit) || 200,
  }).map((row) => ({
    id: row.id,
    steamId: row.steam_id,
    username: row.username,
    avatar: row.avatar || null,
  }));
  res.json({ players });
});

router.get("/admin/rewards", requireAdmin, async (req, res) => {
  try {
    return res.json(await automation.getAdminEventRewards({ limit: Number(req.query.limit) || 100 }));
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 502;
    return res.status(status).json({ error: error.message || "Could not load event reward administration." });
  }
});

router.post("/admin/reward", requireAdmin, async (req, res) => {
  try {
    const result = await automation.awardAdminEventReward({
      steamId: req.body?.steamId,
      eventId: req.body?.eventId,
      eventTitle: req.body?.eventTitle,
      baseAmount: req.body?.baseAmount,
    });
    return res.status(result.duplicate ? 200 : 201).json(result);
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 502;
    return res.status(status).json({
      error: error.message || "Could not issue event reward.",
      code: error?.payload?.code || error?.code || null,
    });
  }
});
