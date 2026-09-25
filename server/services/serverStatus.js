// Maintains the live website's server-status cache.
//
// In production the website reads the automation platform's shared RCON
// snapshot instead of opening its own RCON connection. This keeps player-list
// and playData reads centralized so map/status/dashboard requests do not add
// extra game-server load. Direct RCON is retained only for installations that
// do not have the automation service configured.
const { fetchServerStatus } = require("../rcon");
const { recordLivePlaytime } = require("../db");
const automation = require("./automationWebsiteClient");

const DEFAULT_MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 100;
const RCON_HOST = process.env.RCON_HOST || process.env.RCON_IP;

function automationConfigured() {
  return Boolean(
    String(process.env.AUTOMATION_SERVICE_URL || "").trim() &&
    String(process.env.HOLLOW_VALLEY_API_TOKEN || "").trim()
  );
}

function directRconConfigured() {
  return Boolean(RCON_HOST && process.env.RCON_PORT && process.env.RCON_PASSWORD);
}

function pollIntervalMs() {
  // Poll the automation cache frequently enough for the live map. Direct RCON
  // keeps the conservative five-minute floor so website traffic never hammers
  // the game server.
  const usingAutomation = automationConfigured();
  const fallback = usingAutomation ? 15_000 : 300_000;
  const minimum = usingAutomation ? 10_000 : 300_000;
  const value = Number(process.env.SERVER_STATUS_POLL_INTERVAL_MS || fallback);
  return Math.max(minimum, Math.min(600_000, Number.isFinite(value) ? value : fallback));
}

const state = {
  configured: automationConfigured() || directRconConfigured(),
  online: false,
  playerCount: 0,
  maxPlayers: DEFAULT_MAX_PLAYERS,
  players: [],
  characters: [],
  lastChecked: null,
  lastError: null,
  source: automationConfigured() ? "automation-cache" : "direct-rcon",
};

async function readSnapshot() {
  if (automationConfigured()) {
    return automation.getServerSnapshot();
  }

  if (!directRconConfigured()) {
    throw new Error("Server status is not configured");
  }

  const result = await fetchServerStatus({
    host: RCON_HOST,
    port: Number(process.env.RCON_PORT),
    password: process.env.RCON_PASSWORD,
  });
  return {
    configured: true,
    online: true,
    players: result.players || [],
    characters: result.characters || [],
    maxPlayers: result.maxPlayers,
    checkedAt: new Date().toISOString(),
    error: null,
  };
}

async function poll() {
  if (!state.configured) return;
  try {
    const snapshot = await readSnapshot();
    const players = Array.isArray(snapshot.players) ? snapshot.players : [];
    const characters = Array.isArray(snapshot.characters) ? snapshot.characters : [];

    state.online = snapshot.online !== false;
    state.playerCount = state.online ? players.length : 0;
    state.maxPlayers = snapshot.maxPlayers || DEFAULT_MAX_PLAYERS;
    state.players = state.online ? players : [];
    state.characters = state.online ? characters : [];
    state.lastChecked = snapshot.checkedAt || new Date().toISOString();
    state.lastError = snapshot.error || null;
    state.source = automationConfigured() ? "automation-cache" : "direct-rcon";

    if (state.online) recordLivePlaytime(players);
  } catch (err) {
    state.online = false;
    state.playerCount = 0;
    state.players = [];
    state.characters = [];
    state.lastError = err.message;
    state.lastChecked = new Date().toISOString();
    console.warn(`[server-status] ${state.source} poll failed: ${err.message}`);
  }
}

function start() {
  if (!state.configured) {
    console.log("[server-status] automation service and direct RCON are both unconfigured - live status disabled");
    return;
  }
  poll();
  const timer = setInterval(poll, pollIntervalMs());
  timer.unref?.();
}

function getState() {
  return state;
}

module.exports = {
  start,
  getState,
  poll,
  pollIntervalMs,
  automationConfigured,
  directRconConfigured,
};
