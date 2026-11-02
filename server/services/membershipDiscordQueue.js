"use strict";

const { randomUUID } = require("node:crypto");
const { db, getSupporterStatus } = require("../db");
const roles = require("./discordMembership");
const { getSkinStudioSafety } = require("../middleware/skinStudioSafety");

const MAX_ATTEMPTS = 6;
const LEASE_MS = 180000;
const MESSAGES = Object.freeze({
  DISCORD_SYNC_FAILED: "Discord membership roles could not be updated. Please retry.",
  DISCORD_RATE_LIMITED: "Discord is busy. Your membership role update will be retried.",
  DISCORD_PERMISSION_REQUIRED: "Discord role permissions need an administrator's attention.",
  DISCORD_MEMBER_UNAVAILABLE: "Join the Hollow Valley Discord server with your linked account, then retry.",
});
let running = false;
let sweepCursor = 0;

function ensureSchema() {
  db.exec(`CREATE TABLE IF NOT EXISTS membership_discord_sync (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    desired_signature TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','synced','failed','unlinked')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL DEFAULT 0,
    lock_token TEXT,
    lock_until INTEGER NOT NULL DEFAULT 0,
    last_discord_id TEXT,
    last_synced_at TEXT,
    last_error_code TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_membership_discord_due ON membership_discord_sync(status,next_attempt_at);`);
}

function enabled(env = process.env) {
  return roles.automaticSyncEnabled(env) && !getSkinStudioSafety(env).readOnly;
}

function snapshot(userId, { env = process.env, now = Date.now() } = {}) {
  const user = db.prepare("SELECT id, discord_id FROM users WHERE id = ?").get(userId);
  if (!user) return null;
  const discordId = /^\d{15,22}$/.test(String(user.discord_id || "")) ? String(user.discord_id) : null;
  const tier = roles.targetTierForStatus(getSupporterStatus(userId), { env, now });
  const signature = JSON.stringify([discordId, tier, String(env.DISCORD_GUILD_ID || ""), roles.configuredRoleIds(env)]);
  return { userId: user.id, discordId, tier, signature };
}

function enqueue(userId, { env = process.env, now = Date.now(), force = true } = {}) {
  if (!enabled(env)) return { queued: false, reason: getSkinStudioSafety(env).readOnly ? "preview" : "disabled" };
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0) return { queued: false, reason: "unknown-user" };
  ensureSchema();
  const desired = snapshot(Number(userId), { env, now });
  if (!desired) return { queued: false, reason: "unknown-user" };
  const existing = db.prepare("SELECT * FROM membership_discord_sync WHERE user_id = ?").get(desired.userId);
  if (!force && existing?.desired_signature === desired.signature) return { queued: false, reason: "unchanged" };
  db.prepare(`INSERT INTO membership_discord_sync(user_id,desired_signature,status,next_attempt_at)
    VALUES (?,?,'pending',?) ON CONFLICT(user_id) DO UPDATE SET
    desired_signature=excluded.desired_signature,status='pending',attempts=0,next_attempt_at=excluded.next_attempt_at,
    last_error_code=NULL,updated_at=datetime('now')`).run(desired.userId, desired.signature, now);
  return { queued: true };
}

function sweep({ env = process.env, now = Date.now() } = {}) {
  const users = db.prepare(`SELECT u.id FROM users u
    LEFT JOIN supporter_subscriptions s ON s.user_id=u.id
    LEFT JOIN membership_discord_sync q ON q.user_id=u.id
    WHERE u.id > ? AND (s.user_id IS NOT NULL OR q.user_id IS NOT NULL)
    ORDER BY u.id LIMIT 250`).all(sweepCursor);
  for (const user of users) enqueue(user.id, { env, now, force: false });
  sweepCursor = users.length === 250 ? users[users.length - 1].id : 0;
  return users.length;
}

function safeCode(error) {
  return Object.hasOwn(MESSAGES, error?.code) ? error.code : "DISCORD_SYNC_FAILED";
}

async function processQueue({ env = process.env, now = Date.now(), fetchImpl = globalThis.fetch, limit = 5 } = {}) {
  if (!enabled(env)) return { skipped: true, reason: getSkinStudioSafety(env).readOnly ? "preview" : "disabled" };
  if (!roles.configuration(env)) return { skipped: true, reason: "not-configured" };
  if (running) return { skipped: true, reason: "already-running" };
  ensureSchema();
  running = true;
  const summary = { processed: 0, synced: 0, failed: 0, pending: 0 };
  try {
    sweep({ env, now });
    const jobs = db.prepare(`SELECT * FROM membership_discord_sync
      WHERE status='pending' AND next_attempt_at <= ? AND lock_until <= ?
      ORDER BY next_attempt_at,user_id LIMIT ?`).all(now, now, Math.max(1, Math.min(20, Number(limit) || 5)));
    for (const queuedJob of jobs) {
      const token = randomUUID();
      const lock = db.prepare(`UPDATE membership_discord_sync SET lock_token=?,lock_until=?
        WHERE user_id=? AND status='pending' AND next_attempt_at <= ? AND lock_until <= ?`)
        .run(token, now + LEASE_MS, queuedJob.user_id, now, now);
      if (!lock.changes) continue;
      const job = db.prepare("SELECT * FROM membership_discord_sync WHERE user_id=? AND lock_token=?").get(queuedJob.user_id, token);
      summary.processed += 1;
      let actualDiscordId = null;
      try {
        const current = snapshot(job.user_id, { env, now });
        if (!current) {
          db.prepare("DELETE FROM membership_discord_sync WHERE user_id=? AND lock_token=?").run(job.user_id, token);
          continue;
        }
        if (job.last_discord_id && job.last_discord_id !== current.discordId) {
          await roles.removeMembershipRolesForDiscord(job.last_discord_id, { env, fetchImpl });
        }
        const attempted = snapshot(job.user_id, { env, now });
        // Persist the account we are about to touch even if Discord times out
        // after accepting a role change. A later relink can clean it up safely.
        db.prepare("UPDATE membership_discord_sync SET last_discord_id=? WHERE user_id=? AND lock_token=?")
          .run(attempted?.discordId || null, job.user_id, token);
        // Fetch the user's current subscription and account link inside the role
        // synchronizer, rather than replaying a tier from an old queued event.
        const result = await roles.syncDiscordMembershipForUser(job.user_id, { env, fetchImpl, now });
        if (result.skipped || !result.configured) {
          db.prepare("UPDATE membership_discord_sync SET lock_token=NULL,lock_until=0 WHERE user_id=? AND lock_token=?").run(job.user_id, token);
          summary.pending += 1;
          continue;
        }
        actualDiscordId = result.discordId || (result.linked ? current.discordId : null);
        const latest = snapshot(job.user_id, { env, now });
        const settled = latest && latest.signature === job.desired_signature && latest.discordId === actualDiscordId;
        db.prepare(`UPDATE membership_discord_sync SET status=?,desired_signature=?,attempts=0,next_attempt_at=?,
          lock_token=NULL,lock_until=0,last_discord_id=?,last_synced_at=?,last_error_code=NULL,updated_at=datetime('now')
          WHERE user_id=? AND lock_token=?`)
          .run(settled ? (actualDiscordId ? "synced" : "unlinked") : "pending", latest?.signature || job.desired_signature,
            settled ? 0 : now, actualDiscordId, new Date(now).toISOString(), job.user_id, token);
        if (settled) summary.synced += 1; else summary.pending += 1;
      } catch (error) {
        const row = db.prepare("SELECT * FROM membership_discord_sync WHERE user_id=? AND lock_token=?").get(job.user_id, token);
        if (!row) continue;
        if (row.desired_signature !== job.desired_signature) {
          db.prepare("UPDATE membership_discord_sync SET lock_token=NULL,lock_until=0 WHERE user_id=? AND lock_token=?").run(job.user_id, token);
          summary.pending += 1;
          continue;
        }
        const attempts = row.attempts + 1;
        const backoff = Math.max(Math.min(1800000, 30000 * (2 ** (attempts - 1))), Math.min(3600000, Math.max(0, Number(error?.retryAfterMs) || 0)));
        const status = attempts >= MAX_ATTEMPTS ? "failed" : "pending";
        db.prepare(`UPDATE membership_discord_sync SET status=?,attempts=?,next_attempt_at=?,lock_token=NULL,lock_until=0,
          last_error_code=?,updated_at=datetime('now') WHERE user_id=? AND lock_token=?`)
          .run(status, attempts, now + backoff, safeCode(error), job.user_id, token);
        if (status === "failed") summary.failed += 1; else summary.pending += 1;
      }
    }
  } finally { running = false; }
  return summary;
}

function getSyncState(userId, { env = process.env } = {}) {
  ensureSchema();
  const row = db.prepare("SELECT * FROM membership_discord_sync WHERE user_id=?").get(userId);
  const user = db.prepare("SELECT discord_id FROM users WHERE id=?").get(userId);
  return {
    configured: Boolean(roles.configuration(env)),
    enabled: enabled(env),
    linked: Boolean(user?.discord_id),
    lastSyncedAt: row?.last_synced_at || null,
    pending: row?.status === "pending",
    nextAttemptAt: row?.status === "pending" && row.next_attempt_at ? new Date(row.next_attempt_at).toISOString() : null,
    error: row?.last_error_code ? MESSAGES[row.last_error_code] || MESSAGES.DISCORD_SYNC_FAILED : null,
    needsRetry: row?.status === "failed",
  };
}

function start({ env = process.env, schedule = setInterval } = {}) {
  if (!enabled(env)) return null;
  const run = () => processQueue({ env }).catch(() => { /* durable jobs remain pending for the next pass */ });
  void run();
  const timer = schedule(run, 60000);
  timer.unref?.();
  return timer;
}

module.exports = { enqueue, processQueue, start, getSyncState, enabled, ensureSchema, MAX_ATTEMPTS };
