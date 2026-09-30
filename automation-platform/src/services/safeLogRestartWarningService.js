const store = require('./automationStore');
const rconControl = require('./rconControlService');

const BRISBANE_OFFSET_MS = 10 * 60 * 60 * 1000;
const DEFAULT_WARNING_TIMES = ['11:51', '23:51'];
const DEFAULT_MESSAGE = 'SERVER RESTART IN 10 MINUTES — DO NOT SAFE LOG UNTIL AFTER THE RESTART. If you are already safe logging, cancel and wait for the server to return.';

let timer = null;
let cycleRunning = false;

function enabled(env = process.env) {
  return String(env.SAFELOG_RESTART_WARNINGS_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
}

function warningTimes(env = process.env) {
  const raw = String(env.SAFELOG_RESTART_WARNING_TIMES || DEFAULT_WARNING_TIMES.join(','));
  const values = [...new Set(raw.split(',').map((value) => value.trim()).filter(Boolean))];
  for (const value of values) {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      throw new Error(`Invalid SAFELOG_RESTART_WARNING_TIMES value: ${value}`);
    }
  }
  return values.length ? values : DEFAULT_WARNING_TIMES;
}

function brisbaneClock(nowMs = Date.now()) {
  const shifted = new Date(nowMs + BRISBANE_OFFSET_MS);
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const min = String(shifted.getUTCMinutes()).padStart(2, '0');
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` };
}

function warningMessage(env = process.env) {
  return rconControl.validateMessage(env.SAFELOG_RESTART_WARNING_MESSAGE || DEFAULT_MESSAGE);
}

async function runWarningCycle({ nowMs = Date.now() } = {}) {
  if (!enabled()) return { skipped: true, reason: 'disabled' };
  if (cycleRunning) return { skipped: true, reason: 'busy' };

  const clock = brisbaneClock(nowMs);
  if (!warningTimes().includes(clock.time)) return { skipped: true, reason: 'not-due', clock };

  const key = `safelog-restart-warning:${clock.date}:${clock.time}`;
  if (store.getState(key, null)?.value?.sentAt) return { skipped: true, reason: 'already-sent', clock };

  cycleRunning = true;
  try {
    if (!rconControl.writeEnabled('announce')) {
      return { skipped: true, reason: 'rcon-announcement-disabled', clock };
    }

    const result = await rconControl.execute('announce', { message: warningMessage() });
    store.setState(key, {
      sentAt: new Date().toISOString(),
      clock,
      confirmed: result.confirmed === true,
      response: result.response || null,
    });
    return { skipped: false, sent: true, clock, result };
  } finally {
    cycleRunning = false;
  }
}

function startSafeLogRestartWarnings() {
  if (timer) return timer;
  runWarningCycle().catch((error) => console.warn('[safelog-restart-warning]', error.message));
  timer = setInterval(() => {
    runWarningCycle().catch((error) => console.warn('[safelog-restart-warning]', error.message));
  }, 15000);
  timer.unref?.();
  return timer;
}

module.exports = {
  BRISBANE_OFFSET_MS,
  DEFAULT_WARNING_TIMES,
  DEFAULT_MESSAGE,
  enabled,
  warningTimes,
  brisbaneClock,
  warningMessage,
  runWarningCycle,
  startSafeLogRestartWarnings,
};
