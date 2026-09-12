// "HerbyBot" - the single Discord bot used for both server-status
// broadcasting and (existing) Discord login. This module only handles the
// status side: it logs in with a bot token and keeps its Discord presence
// (and optionally a voice channel name) in sync with the live RCON player
// count from server/services/serverStatus.js.
//
// Fully optional: if DISCORD_BOT_TOKEN isn't set, start() is a no-op so the
// rest of the site keeps working exactly as before.
const { getState } = require("./services/serverStatus");

const PRESENCE_INTERVAL_MS = 30_000;
const CHANNEL_RENAME_INTERVAL_MS = 5 * 60_000; // Discord rate-limits channel renames

let client = null;
let lastChannelName = null;

function isConfigured() {
  return Boolean(process.env.DISCORD_BOT_TOKEN);
}

function formatStatusText(state) {
  if (!state.configured) return "Hollow Valley";
  if (!state.online) return "Hollow Valley - offline";
  return `Hollow Valley - ${state.playerCount} online`;
}

async function updatePresence() {
  if (!client || !client.isReady()) return;
  const state = getState();
  client.user.setPresence({
    activities: [{ name: formatStatusText(state) }],
    status: state.configured && state.online ? "online" : "idle",
  });
}

async function updateStatusChannel() {
  const channelId = process.env.DISCORD_STATUS_CHANNEL_ID;
  if (!client || !client.isReady() || !channelId) return;

  const state = getState();
  const label = !state.configured
    ? "server-status-unavailable"
    : state.online
    ? `🟢-online-${state.playerCount}-players`
    : "🔴-offline";

  if (label === lastChannelName) return;

  try {
    const channel = await client.channels.fetch(channelId);
    if (channel) {
      await channel.setName(label);
      lastChannelName = label;
    }
  } catch (err) {
    console.error("[herbybot] failed to rename status channel:", err.message);
  }
}

function start() {
  if (!isConfigured()) {
    console.log("[herbybot] DISCORD_BOT_TOKEN not set - Discord bot status disabled");
    return;
  }

  const { Client, GatewayIntentBits } = require("discord.js");
  client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once("ready", () => {
    console.log(`[herbybot] logged in as ${client.user.tag}`);
    updatePresence();
    updateStatusChannel();
  });

  client.login(process.env.DISCORD_BOT_TOKEN).catch((err) => {
    console.error("[herbybot] login failed:", err.message);
  });

  setInterval(updatePresence, PRESENCE_INTERVAL_MS);
  setInterval(updateStatusChannel, CHANNEL_RENAME_INTERVAL_MS);
}

module.exports = { start, isConfigured };
