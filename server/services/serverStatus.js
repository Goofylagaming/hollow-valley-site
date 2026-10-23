// Maintains the live website's server-status cache.
//
// The website reads the automation platform's authoritative server snapshot.
// Direct game-server RCON access is intentionally not supported here: the
// BinaryLane agent and automation service own game connectivity and presence.
const automation = require("./automationWebsiteClient");
const snapshots = require('./readSnapshots');

const DEFAULT_MAX_PLAYERS = Number(process.env.MAX_PLAYERS) || 100;

function automationConfigured() {
  return Boolean(
    String(process.env.AUTOMATION_SERVICE_URL || "").trim() &&
    String(process.env.HOLLOW_VALLEY_API_TOKEN || "").trim()
  );
}

function pollIntervalMs() {
  const fallback = 15_000;
  const value = Number(process.env.SERVER_STATUS_POLL_INTERVAL_MS || fallback);
  return Math.max(10_000, Math.min(600_000, Number.isFinite(value) ? value : fallback));
}

const state = {
  configured: automationConfigured(),
  online: false,
  playerCount: 0,
  maxPlayers: DEFAULT_MAX_PLAYERS,
  players: [],
  characters: [],
  lastChecked: null,
  lastError: null,
  source: "automation-cache",
  stale: true,
};

try {
  const saved = snapshots.load('server-status', 15 * 60 * 1000);
  if (saved) Object.assign(state, saved.value, { configured: automationConfigured(), stale: true });
} catch { /* A cache failure must not prevent website startup. */ }

let polling = false;

async function readSnapshot() {
  if (!automationConfigured()) {
    throw new Error("Automation server status is not configured");
  }
  return automation.getServerSnapshot();
}

async function poll() {
  if (!state.configured || polling) return;
  polling = true;
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
    state.source = "automation-cache";
    state.stale = Boolean(snapshot.error);
    if (!state.stale) {
      try { snapshots.save('server-status', state); } catch { console.warn('[server-status] snapshot persistence failed'); }
    }
  } catch (err) {
    state.stale = true;
    state.lastError = err.message;
    console.warn(`[server-status] automation-cache poll failed: ${err.message}`);
  } finally { polling = false; }
}

function start() {
  if (!state.configured) {
    console.log("[server-status] automation service unconfigured - live status disabled");
    return;
  }
  poll();
  const timer = setInterval(poll, pollIntervalMs());
  timer.unref?.();
}

function getState() {
  // Territory calculations must never use retained positions as live evidence.
  return state.stale ? { ...state, online: false, players: [], characters: [], playerCount: 0 } : state;
}

function getDisplayState() {
  if (state.stale && Date.now() - Date.parse(state.lastChecked || 0) > 15 * 60 * 1000) return getState();
  return state;
}

module.exports = {
  start,
  getState,
  getDisplayState,
  poll,
  pollIntervalMs,
  automationConfigured,
};
