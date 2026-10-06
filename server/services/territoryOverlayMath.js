const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const CLAIM_ARM_MS = 2 * 60 * 1000;

function parseTime(value) {
  if (!value) return null;
  const raw = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? `${raw.replace(" ", "T")}Z`
    : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function direction8(from, to, { minimumDistance = 1 } = {}) {
  if (!from || !to) return null;
  const fromLat = Number(from.lat);
  const fromLong = Number(from.long);
  const toLat = Number(to.lat);
  const toLong = Number(to.long);
  if (![fromLat, fromLong, toLat, toLong].every(Number.isFinite)) return null;

  const south = toLat - fromLat;
  const east = toLong - fromLong;
  const distance = Math.hypot(south, east);
  if (distance < Math.max(0, Number(minimumDistance) || 0)) return null;

  const north = -south;
  const degrees = (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
  return COMPASS[Math.round(degrees / 45) % 8];
}

function timerState(event, attack, now = Date.now()) {
  const nowMs = Number(now) || Date.now();
  if (!event) return { phase: "idle", label: "Territory Wars", endsAt: null };

  if (event.status === "ended") {
    return { phase: "ended", label: "Event ended", endsAt: null };
  }

  if (event.status === "paused") {
    return { phase: "paused", label: "Event paused", endsAt: null };
  }

  const protection = parseTime(event.protection_until);
  if (protection && protection.getTime() > nowMs && !attack) {
    return {
      phase: "protected",
      label: "Territory protected",
      endsAt: protection.toISOString(),
    };
  }

  if (attack?.status === "warning") {
    const starts = parseTime(attack.starts_at);
    return {
      phase: "attack-warning",
      label: "Attack begins",
      endsAt: starts?.toISOString() || null,
    };
  }

  if (attack?.status === "active") {
    const contestStarted = parseTime(attack.contest_started_at);
    if (!contestStarted) {
      return {
        phase: "waiting-claim",
        label: "Claim Zone inactive",
        endsAt: null,
      };
    }
    const claimAt = new Date(contestStarted.getTime() + CLAIM_ARM_MS);
    if (claimAt.getTime() > nowMs) {
      return {
        phase: "claim-arming",
        label: "Claim Zone activates",
        endsAt: claimAt.toISOString(),
      };
    }
    return {
      phase: "control-live",
      label: "Claim Zone active",
      endsAt: null,
    };
  }

  const eventStarts = parseTime(event.starts_at);
  if (event.status === "scheduled" && eventStarts && eventStarts.getTime() > nowMs) {
    return {
      phase: "event-start",
      label: "Event starts",
      endsAt: eventStarts.toISOString(),
    };
  }

  return { phase: "live-idle", label: "Territory secure", endsAt: null };
}

function radarPoint(coords, geometry) {
  if (!coords || !geometry?.center) return null;
  const radius = Number(geometry.battlefieldRadius);
  if (!Number.isFinite(radius) || radius <= 0) return null;
  const lat = Number(coords.lat);
  const long = Number(coords.long);
  if (!Number.isFinite(lat) || !Number.isFinite(long)) return null;
  const x = (long - Number(geometry.center.long)) / radius;
  const y = (lat - Number(geometry.center.lat)) / radius;
  const magnitude = Math.hypot(x, y);
  const scale = magnitude > 1 ? 1 / magnitude : 1;
  return {
    x: Math.round(x * scale * 1000) / 1000,
    y: Math.round(y * scale * 1000) / 1000,
    outsideBattlefield: magnitude > 1,
  };
}

function maximumViewMode(user, group) {
  if (Number(user?.is_admin) === 1 || user?.is_admin === true) return "admin";
  const role = String(group?.role || "").toLowerCase();
  if (role === "leader" || role === "officer") return "leader";
  return "player";
}

function resolveViewMode(user, group, requestedMode) {
  const maximum = maximumViewMode(user, group);
  const rank = { player: 0, leader: 1, admin: 2 };
  const requested = String(requestedMode || "").toLowerCase();
  if (!(requested in rank)) return maximum;
  return rank[requested] <= rank[maximum] ? requested : maximum;
}

module.exports = {
  COMPASS,
  CLAIM_ARM_MS,
  parseTime,
  direction8,
  timerState,
  radarPoint,
  maximumViewMode,
  resolveViewMode,
};
