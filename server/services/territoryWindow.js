// War contests run inside one weekly window. Australia/Brisbane is AEST (UTC+10)
// all year; Intl is used so a different TERRITORY_WARS_WINDOW_TZ still works.
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function parseClock(value, fallback) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallback;
  return hour * 60 + minute;
}

function config(env = process.env) {
  const day = Number(env.TERRITORY_WARS_WINDOW_DAY ?? 6);
  const startMinutes = parseClock(env.TERRITORY_WARS_WINDOW_START, 19 * 60);
  const endMinutes = parseClock(env.TERRITORY_WARS_WINDOW_END, 21 * 60);
  return {
    day: Number.isInteger(day) && day >= 0 && day <= 6 ? day : 6,
    startMinutes,
    endMinutes: endMinutes > startMinutes ? endMinutes : startMinutes + 120,
    timeZone: String(env.TERRITORY_WARS_WINDOW_TZ || "Australia/Brisbane").trim() || "Australia/Brisbane",
  };
}

function zonedParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    weekday: WEEKDAYS[parts.weekday],
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function utcForZoned(year, month, day, minutes, timeZone) {
  const guess = Date.UTC(year, month - 1, day, 0, minutes) - 10 * 60 * 60 * 1000;
  for (let hour = -36; hour <= 36; hour += 1) {
    const candidate = new Date(guess + hour * 60 * 60 * 1000);
    const parts = zonedParts(candidate, timeZone);
    if (parts.year === year && parts.month === month && parts.day === day && parts.minutes === minutes) {
      return candidate;
    }
  }
  return new Date(guess);
}

function isOpen(nowMs = Date.now(), env = process.env) {
  const cfg = config(env);
  const parts = zonedParts(new Date(nowMs), cfg.timeZone);
  return parts.weekday === cfg.day && parts.minutes >= cfg.startMinutes && parts.minutes < cfg.endMinutes;
}

function windowStartContaining(nowMs, env = process.env) {
  if (!isOpen(nowMs, env)) return null;
  const cfg = config(env);
  const parts = zonedParts(new Date(nowMs), cfg.timeZone);
  return utcForZoned(parts.year, parts.month, parts.day, cfg.startMinutes, cfg.timeZone);
}

function nextWindowStart(nowMs = Date.now(), env = process.env) {
  const cfg = config(env);
  const origin = zonedParts(new Date(nowMs), cfg.timeZone);
  for (let offset = 0; offset <= 8; offset += 1) {
    const probe = new Date(Date.UTC(origin.year, origin.month - 1, origin.day + offset, 12, 0, 0));
    const parts = zonedParts(probe, cfg.timeZone);
    const start = utcForZoned(parts.year, parts.month, parts.day, cfg.startMinutes, cfg.timeZone);
    const startParts = zonedParts(start, cfg.timeZone);
    if (startParts.weekday !== cfg.day) continue;
    if (start.getTime() > nowMs) return start;
  }
  return new Date(nowMs + 7 * 24 * 60 * 60 * 1000);
}

function describe(nowMs = Date.now(), env = process.env) {
  const cfg = config(env);
  const open = isOpen(nowMs, env);
  const next = nextWindowStart(nowMs, env);
  const current = windowStartContaining(nowMs, env);
  return {
    open,
    timeZone: cfg.timeZone,
    day: cfg.day,
    startMinutes: cfg.startMinutes,
    endMinutes: cfg.endMinutes,
    currentStart: current ? current.toISOString() : null,
    nextStart: next.toISOString(),
    label: open ? "War window open" : "Protected until the next war window",
  };
}

module.exports = {
  config,
  zonedParts,
  isOpen,
  windowStartContaining,
  nextWindowStart,
  describe,
};
