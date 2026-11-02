"use strict";

// Owner-only BinaryLane management state. All data is held on the website's
// existing persistent SQLite disk. No RCON or Windows connection is opened here.
const { randomUUID, randomBytes } = require("node:crypto");
const { db } = require("../db");

const TASKS = Object.freeze({
  watchdog: "Hollow Valley Watchdog Handoff",
  scheduled_restart: "Hollow Valley 12 Hour Restart",
  autosave: "Hollow Valley Auto Save",
  scanner: "Hollow Valley Player Scanner",
  command_bridge: "Hollow Valley Command Bridge Agent",
  combat_forwarder: "HollowValleyCombatForwarder",
  legacy_combat_forwarder: "Hollow Valley Chat Combat Forwarder",
});
const ACTION_TARGETS = new Set(["command_bridge", "combat_forwarder"]);
const LOG_KEYS = ["restart", "forwarder", "bridge"];
const HEARTBEAT_MAX_AGE_MS = 90_000;
const JOB_TTL_MS = 90_000;
const LEASE_TIMEOUT_MS = 90_000;

db.exec(`
  CREATE TABLE IF NOT EXISTS hv_management_status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    received_at_ms INTEGER NOT NULL,
    payload_json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS hv_management_jobs (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued'
      CHECK (state IN ('queued','running','succeeded','failed','expired','unknown')),
    owner_steam_id TEXT NOT NULL,
    created_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL,
    claimed_at_ms INTEGER,
    lease_token TEXT,
    finished_at_ms INTEGER,
    result_message TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_hv_management_jobs_state_time
    ON hv_management_jobs (state, created_at_ms);
`);

function enabled() {
  return process.env.HV_MANAGEMENT_ENABLED === "1";
}
function writesEnabled() {
  return enabled() && process.env.HV_MANAGEMENT_WRITES_ENABLED === "1";
}
function tokenConfigured() {
  return enabled() && String(process.env.HV_MANAGEMENT_AGENT_TOKEN || "").length >= 32;
}
function clampText(v, max = 240) {
  return String(v == null ? "" : v).replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "").slice(0, max);
}
function scrubLogLine(value) {
  const line = clampText(value, 300);
  return line
    .replace(/\\bBearer\\s+[^\\s]+/gi, "Bearer [REDACTED]")
    .replace(/\\b(token|password|secret|authorization)\\s*[:=]\\s*.*$/gi, "$1=[REDACTED]");
}
function normalizeHeartbeat(source = {}) {
  const game = source && typeof source.server === "object" ? source.server : {};
  const tasks = source && typeof source.tasks === "object" && !Array.isArray(source.tasks)
    ? source.tasks : {};
  const logs = source && typeof source.logs === "object" ? source.logs : {};
  const pid = Number(game.pid);
  const count = Number(game.processCount);
  const safeTasks = Object.fromEntries(Object.keys(TASKS).map((key) => {
    const state = String(tasks[key] || "Unknown");
    return [key, ["Running", "Ready", "Disabled", "Queued", "Unknown", "Missing"].includes(state) ? state : "Unknown"];
  }));
  return {
    server: {
      pid: Number.isSafeInteger(pid) && pid > 0 ? pid : null,
      processCount: Number.isSafeInteger(count) && count >= 0 && count <= 50 ? count : null,
      startedAt: clampText(game.startedAt, 48),
      rconOwnedByGame: game.rconOwnedByGame === true,
    },
    tasks: safeTasks,
    logs: Object.fromEntries(LOG_KEYS.map((key) =>
      [key, (Array.isArray(logs[key]) ? logs[key] : []).slice(-12).map(scrubLogLine)])),
    agentVersion: clampText(source.agentVersion, 40),
  };
}

function receiveHeartbeat(raw) {
  const snapshot = normalizeHeartbeat(raw);
  db.prepare(`
    INSERT INTO hv_management_status (id, received_at_ms, payload_json)
    VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      received_at_ms = excluded.received_at_ms,
      payload_json = excluded.payload_json
  `).run(Date.now(), JSON.stringify(snapshot));
  return snapshot;
}

function heartbeat() {
  const row = db.prepare("SELECT received_at_ms, payload_json FROM hv_management_status WHERE id = 1").get();
  if (!row) return { connected: false, receivedAt: null, snapshot: null };
  const ageMs = Math.max(0, Date.now() - row.received_at_ms);
  return {
    connected: tokenConfigured() && ageMs <= HEARTBEAT_MAX_AGE_MS,
    receivedAt: new Date(row.received_at_ms).toISOString(),
    ageSeconds: Math.floor(ageMs / 1000),
    snapshot: JSON.parse(row.payload_json),
  };
}
function expireStaleJobs() {
  const now = Date.now();
  db.prepare("UPDATE hv_management_jobs SET state='expired', finished_at_ms=? WHERE state='queued' AND expires_at_ms <= ?").run(now, now);
  // Fail closed: never automatically retry a job whose result was lost.
  db.prepare("UPDATE hv_management_jobs SET state='unknown', finished_at_ms=?, result_message='Agent result was not confirmed; manual inspection required.' WHERE state='running' AND claimed_at_ms < ?")
    .run(now, now - LEASE_TIMEOUT_MS);
}
function publicJob(row) {
  if (!row) return null;
  return {
    id: row.id, action: row.action, target: row.target, state: row.state,
    requestedBy: row.owner_steam_id,
    createdAt: new Date(row.created_at_ms).toISOString(),
    expiresAt: new Date(row.expires_at_ms).toISOString(),
    finishedAt: row.finished_at_ms ? new Date(row.finished_at_ms).toISOString() : null,
    result: row.result_message || null,
  };
}
function ownerOverview() {
  expireStaleJobs();
  const jobs = db.prepare("SELECT * FROM hv_management_jobs ORDER BY created_at_ms DESC LIMIT 30").all().map(publicJob);
  return {
    featureEnabled: enabled(),
    agentConfigured: tokenConfigured(),
    writesEnabled: writesEnabled() && tokenConfigured(),
    ...heartbeat(),
    taskNames: TASKS,
    writableTargets: [...ACTION_TARGETS],
    jobs,
  };
}
function reject(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  throw error;
}
function queueAction({ action, target, ownerSteamId, confirmation }) {
  if (!writesEnabled() || !tokenConfigured()) reject("Management writes are not enabled.", 503);
  if (action !== "enable_start" || !ACTION_TARGETS.has(target)) reject("Unsupported management action.");
  if (confirmation !== `ENABLE ${target}`) reject("The confirmation text does not match.");
  if (!/^\d{17}$/.test(String(ownerSteamId || ""))) reject("Owner authentication required.", 403);

  const health = heartbeat();
  if (!health.connected) reject("BinaryLane agent is offline or its heartbeat is stale.", 409);
  if (health.snapshot?.server?.processCount !== 1) reject("Expected exactly one running game server.", 409);
  if (target === "combat_forwarder"
    && health.snapshot?.tasks?.legacy_combat_forwarder !== "Disabled"
    && health.snapshot?.tasks?.legacy_combat_forwarder !== "Missing") {
    reject("Legacy chat forwarder must be disabled before starting this forwarder.", 409);
  }

  expireStaleJobs();
  const pending = db.prepare("SELECT id FROM hv_management_jobs WHERE target=? AND state IN ('queued','running') LIMIT 1").get(target);
  if (pending) reject("A management request for this task is still pending.", 409);
  const recent = db.prepare("SELECT id FROM hv_management_jobs WHERE target=? AND created_at_ms >= ? LIMIT 1")
    .get(target, Date.now() - 60_000);
  if (recent) reject("This task was requested recently; check its result before retrying.", 429);

  const now = Date.now();
  const id = randomUUID();
  db.prepare(`INSERT INTO hv_management_jobs
    (id, action, target, state, owner_steam_id, created_at_ms, expires_at_ms)
    VALUES (?,?,?,'queued',?,?,?)`)
    .run(id, action, target, ownerSteamId, now, now + JOB_TTL_MS);
  return publicJob(db.prepare("SELECT * FROM hv_management_jobs WHERE id=?").get(id));
}
function leaseNextJob() {
  if (!writesEnabled() || !tokenConfigured()) return null;
  expireStaleJobs();
  db.exec("BEGIN IMMEDIATE");
  try {
    const row = db.prepare("SELECT * FROM hv_management_jobs WHERE state='queued' ORDER BY created_at_ms ASC LIMIT 1").get();
    if (!row) {
      db.exec("COMMIT");
      return null;
    }
    const leaseToken = randomBytes(24).toString("hex");
    const result = db.prepare("UPDATE hv_management_jobs SET state='running', claimed_at_ms=?, lease_token=? WHERE id=? AND state='queued'")
      .run(Date.now(), leaseToken, row.id);
    db.exec("COMMIT");
    if (!result.changes) return null;
    return { id: row.id, action: row.action, target: row.target, leaseToken };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function completeJob({ id, leaseToken, state, message }) {
  if (!/^[0-9a-f-]{36}$/i.test(String(id || ""))
    || !/^[0-9a-f]{48}$/i.test(String(leaseToken || ""))
    || !["succeeded", "failed"].includes(state)) reject("Invalid result submission.");
  const result = db.prepare(`UPDATE hv_management_jobs SET
    state=?, result_message=?, finished_at_ms=?, lease_token=NULL
    WHERE id=? AND lease_token=? AND state='running'`)
    .run(state, clampText(message, 500), Date.now(), id, leaseToken);
  if (result.changes !== 1) reject("Job lease not found or already completed.", 409);
  return true;
}

module.exports = {
  TASKS, ACTION_TARGETS, enabled, tokenConfigured, writesEnabled,
  receiveHeartbeat, ownerOverview, queueAction, leaseNextJob, completeJob,
  normalizeHeartbeat,
};
