const fs = require('node:fs');
const path = require('node:path');

const EVENTS = new Set([
  'warning_sent',
  'save_requested',
  'save_succeeded',
  'shutdown_requested',
  'process_exited',
  'process_started',
  'rcon_online',
  'success',
  'failure',
]);

function dataFile() {
  const dbPath = process.env.AUTOMATION_DB_PATH || path.join(__dirname, '..', '..', 'data', 'automation.sqlite');
  return process.env.RESTART_TELEMETRY_PATH || path.join(path.dirname(dbPath), 'restart-telemetry.json');
}

function emptyState() {
  return { version: 1, current: null, history: [] };
}

function readRaw() {
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
    return {
      version: 1,
      current: parsed?.current || null,
      history: Array.isArray(parsed?.history) ? parsed.history.slice(0, 20) : [],
    };
  } catch {
    return emptyState();
  }
}

function writeRaw(state) {
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

function cleanDetails(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/token|password|secret|authorization|cookie/i.test(key)) continue;
    if (['string', 'number', 'boolean'].includes(typeof entry)) {
      out[key] = typeof entry === 'string' ? entry.slice(0, 300) : entry;
    }
  }
  return out;
}

function nextRestartAt(now = new Date()) {
  // Brisbane is UTC+10 year-round. Scheduled game restarts are 00:01 and 12:01.
  const offsetMs = 10 * 60 * 60 * 1000;
  const local = new Date(now.getTime() + offsetMs);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  const candidates = [
    Date.UTC(y, m, d, 0, 1) - offsetMs,
    Date.UTC(y, m, d, 12, 1) - offsetMs,
    Date.UTC(y, m, d + 1, 0, 1) - offsetMs,
  ];
  return new Date(candidates.find((value) => value > now.getTime())).toISOString();
}

function ingest(payload = {}) {
  const restartId = String(payload.restartId || '').trim();
  const event = String(payload.event || '').trim();
  if (!/^[A-Za-z0-9:_-]{8,128}$/.test(restartId)) {
    const error = new Error('A valid restartId is required.');
    error.code = 'RESTART_TELEMETRY_INVALID';
    throw error;
  }
  if (!EVENTS.has(event)) {
    const error = new Error('Unsupported restart telemetry event.');
    error.code = 'RESTART_TELEMETRY_INVALID';
    throw error;
  }

  const parsedAt = new Date(payload.at || Date.now());
  if (Number.isNaN(parsedAt.getTime())) {
    const error = new Error('A valid telemetry timestamp is required.');
    error.code = 'RESTART_TELEMETRY_INVALID';
    throw error;
  }
  const at = parsedAt.toISOString();
  const state = readRaw();

  if (!state.current || state.current.restartId !== restartId) {
    if (state.current) {
      state.history.unshift({
        ...state.current,
        result: 'unknown',
        completedAt: at,
        message: 'A newer restart run began before this run completed.',
      });
    }
    state.current = {
      restartId,
      startedAt: at,
      completedAt: null,
      result: 'in_progress',
      message: null,
      events: [],
    };
  }

  const duplicate = state.current.events.some((entry) => entry.event === event && entry.at === at);
  if (!duplicate) {
    state.current.events.push({ event, at, details: cleanDetails(payload.details) });
    state.current.events = state.current.events.slice(-30);
  }

  if (event === 'failure' || event === 'success') {
    state.current.result = event === 'success' ? 'success' : 'failure';
    state.current.completedAt = at;
    state.current.message = String(payload.message || '').slice(0, 500) || null;
    state.history.unshift(state.current);
    state.history = state.history.slice(0, 20);
    state.current = null;
  }

  writeRaw(state);
  return { accepted: true, duplicate, restartTelemetry: getState() };
}

function getState(now = new Date()) {
  const state = readRaw();
  const lastRestart = state.history[0] || null;
  return {
    schedule: {
      timezone: 'Australia/Brisbane',
      localTimes: ['00:01', '12:01'],
    },
    current: state.current,
    lastRestart,
    nextRestartAt: nextRestartAt(now),
    recent: state.history.slice(0, 10),
  };
}

module.exports = { EVENTS, ingest, getState, nextRestartAt };
