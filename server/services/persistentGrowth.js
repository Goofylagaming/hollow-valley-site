"use strict";

const { randomBytes, randomUUID } = require("node:crypto");
const { db } = require("../db");
const management = require("./serverManagement");
const PRESETS = Object.freeze([1, 2, 3, 4, 5, 10]);
const TTL = 90_000;
db.exec(`CREATE TABLE IF NOT EXISTS hv_growth_jobs (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, owner_steam_id TEXT NOT NULL,
  multiplier INTEGER NOT NULL, expected_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('queued','running','written','failed','expired','unknown')),
  created_at_ms INTEGER NOT NULL, claimed_at_ms INTEGER, finished_at_ms INTEGER,
  lease_token TEXT, result_message TEXT
)`);

function fail(message, status = 409) { throw Object.assign(new Error(message), { status }); }
function expire() {
  db.prepare("UPDATE hv_growth_jobs SET state='expired',finished_at_ms=? WHERE state='queued' AND created_at_ms<?").run(Date.now(), Date.now() - TTL);
  db.prepare("UPDATE hv_growth_jobs SET state='unknown',result_message='Result not confirmed. Inspect the host before another change.' WHERE state='running' AND claimed_at_ms<?").run(Date.now() - TTL);
}
function publicJob(row) {
  if (!row) return null;
  return { id: row.id, requestId: row.request_id, multiplier: row.multiplier, state: row.state,
    createdAt: new Date(row.created_at_ms).toISOString(), message: row.result_message || null };
}
function readiness() {
  const live = management.heartbeat();
  const growth = live.snapshot?.growth;
  let reason = null;
  if (!management.writesEnabled() || !management.tokenConfigured()) reason = "Server management writes are disabled.";
  else if (!live.connected) reason = "BinaryLane status is offline or stale.";
  else if (!growth?.supported) reason = "The BinaryLane management agent needs the growth-control update.";
  else if (!live.snapshot.allowTaskWrites || !growth.writesEnabled) reason = "Growth configuration writes are disabled on BinaryLane.";
  else if (live.snapshot.server?.processCount !== 1 || !live.snapshot.server.rconOwnedByGame) reason = "Waiting for one healthy game server.";
  else if (live.snapshot.tasks?.scheduled_restart !== "Ready") reason = "The scheduled restart must be ready and not currently running.";
  else if (!growth.configHash || growth.state === "needs_inspection") reason = "The host configuration needs inspection.";
  else if (growth.state === "pending_restart") reason = "A growth change is already awaiting the scheduled restart.";
  return { live, growth, reason };
}
function overview() {
  expire();
  const { live, growth, reason } = readiness();
  const latest = db.prepare("SELECT * FROM hv_growth_jobs ORDER BY created_at_ms DESC LIMIT 1").get();
  const unresolved = db.prepare("SELECT id FROM hv_growth_jobs WHERE state IN ('queued','running','unknown') LIMIT 1").get();
  const awaitingRestart = latest?.state === "written" && (growth?.jobId !== latest.id || growth?.state !== "restart_observed");
  const blocked = reason || (unresolved ? "A previous request is pending or needs inspection; do not retry." : null) ||
    (awaitingRestart ? "Configuration was written; waiting for a matching host report after the scheduled restart." : null);
  return { canWrite: !blocked, reason: blocked, connected: live.connected, receivedAt: live.receivedAt,
    presets: PRESETS, growth: growth || null, latestJob: publicJob(latest), gameplayVerified: false };
}
function queue({ multiplier, expectedHash, requestId, confirmation, ownerSteamId }) {
  if (String(ownerSteamId) !== String(process.env.OWNER_STEAM_ID || "") || !/^\d{17}$/.test(String(ownerSteamId))) fail("Owner authentication required.", 403);
  if (!PRESETS.includes(multiplier) || !/^[a-f0-9]{64}$/.test(expectedHash || "") || !/^[a-f0-9-]{36}$/.test(requestId || "")) fail("Invalid growth configuration request.", 400);
  if (confirmation !== `SAVE ${multiplier}X GROWTH`) fail("The confirmation text does not match.", 400);
  db.exec("BEGIN IMMEDIATE");
  try {
    const existing = db.prepare("SELECT * FROM hv_growth_jobs WHERE request_id=?").get(requestId);
    if (existing) {
      if (existing.owner_steam_id !== ownerSteamId || existing.multiplier !== multiplier || existing.expected_hash !== expectedHash) fail("Request identity already used for a different change.");
      db.exec("COMMIT");
      return publicJob(existing);
    }
    const state = overview();
    if (!state.canWrite) fail(state.reason);
    if (state.growth.configHash !== expectedHash) fail("Game.ini changed. Refresh and review the current setting.");
    const id = randomUUID();
    db.prepare("INSERT INTO hv_growth_jobs(id,request_id,owner_steam_id,multiplier,expected_hash,state,created_at_ms) VALUES(?,?,?,?,?,'queued',?)")
      .run(id, requestId, ownerSteamId, multiplier, expectedHash, Date.now());
    db.exec("COMMIT");
    return publicJob(db.prepare("SELECT * FROM hv_growth_jobs WHERE id=?").get(id));
  } catch (e) { try { db.exec("ROLLBACK"); } catch (_) {} throw e; }
}
function lease() {
  expire();
  if (readiness().reason) return null;
  db.exec("BEGIN IMMEDIATE");
  try {
    if (db.prepare("SELECT id FROM hv_growth_jobs WHERE state IN ('running','unknown') LIMIT 1").get()) { db.exec("COMMIT"); return null; }
    const row = db.prepare("SELECT * FROM hv_growth_jobs WHERE state='queued' ORDER BY created_at_ms LIMIT 1").get();
    if (!row) { db.exec("COMMIT"); return null; }
    const leaseToken = randomBytes(24).toString("hex");
    db.prepare("UPDATE hv_growth_jobs SET state='running',claimed_at_ms=?,lease_token=? WHERE id=? AND state='queued'").run(Date.now(), leaseToken, row.id);
    db.exec("COMMIT");
    return { id: row.id, action: "set_growth_config", target: "game_ini", multiplier: row.multiplier,
      expectedHash: row.expected_hash, leaseToken };
  } catch (e) { try { db.exec("ROLLBACK"); } catch (_) {} throw e; }
}
function complete({ id, leaseToken, state, message }) {
  if (!/^[a-f0-9-]{36}$/.test(id || "") || !/^[a-f0-9]{48}$/.test(leaseToken || "") || !["written", "failed", "unknown"].includes(state)) fail("Invalid growth result.", 400);
  const result = db.prepare("UPDATE hv_growth_jobs SET state=?,result_message=?,finished_at_ms=?,lease_token=NULL WHERE id=? AND lease_token=? AND state IN ('running','unknown')")
    .run(state, String(message || "").slice(0, 500), Date.now(), id, leaseToken);
  if (result.changes !== 1) fail("Growth lease not found or result already recorded.");
}
module.exports = { overview, queue, lease, complete };
