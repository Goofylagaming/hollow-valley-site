// Polls the game server via RCON on an interval and caches the result so
// every request to /api/server-status is instant (no live RCON round-trip
// per page view). If RCON isn't configured or the server is unreachable,
// callers get a clear "unknown"/"offline" state instead of an error.
const { fetchServerStatus } = require("../rcon");

const POLL_INTERVAL_MS = 30_000;
// Fallback used whenever RCON doesn't return a max player count itself
// (the srv:details reply format is undocumented/inconsistent). Override via
// the MAX_PLAYERS env var if the server's slot count changes.
const DEFAULT_MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 100;

const state = {
  configured: Boolean(process.env.RCON_HOST && process.env.RCON_PORT && process.env.RCON_PASSWORD),
  online: false,
  playerCount: 0,
  maxPlayers: DEFAULT_MAX_PLAYERS,
  players: [],
  characters: [],
  lastChecked: null,
  lastError: null,
};

async function poll() {
  if (!state.configured) return;
  try {
    const { players, characters, maxPlayers } = await fetchServerStatus({
      host: process.env.RCON_HOST,
      port: Number(process.env.RCON_PORT),
      password: process.env.RCON_PASSWORD,
    });
    state.online = true;
    state.playerCount = players.length;
    state.maxPlayers = maxPlayers || DEFAULT_MAX_PLAYERS;
    state.players = players;
    state.characters = characters || [];
    state.lastError = null;
  } catch (err) {
    state.online = false;
    state.playerCount = 0;
    state.players = [];
    state.characters = [];
    state.lastError = err.message;
  }
  state.lastChecked = new Date().toISOString();
}

function start() {
  if (!state.configured) {
    console.log("[server-status] RCON_HOST/RCON_PORT/RCON_PASSWORD not set - live status disabled");
    return;
  }
  poll();
  setInterval(poll, POLL_INTERVAL_MS);
}

function getState() {
  return state;
}

module.exports = { start, getState };
