const crypto = require("node:crypto");
const { db } = require("../db");

const AUTH_DOMAIN = "hds-commandbridge-http-v1\0";
const MAX_BATCH = 10;

db.exec(`
  CREATE TABLE IF NOT EXISTS command_bridge_http_requests (
    id TEXT PRIMARY KEY,
    verb TEXT NOT NULL,
    steam TEXT NOT NULL,
    expected_source TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result_json TEXT,
    created_at INTEGER NOT NULL,
    dispatched_at INTEGER,
    acknowledged_at INTEGER,
    completed_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_command_bridge_http_status_created
    ON command_bridge_http_requests(status, created_at);
`);

function getAuthToken() {
  const password = process.env.SFTP_PASSWORD;
  if (!password) throw new Error("CommandBridge HTTP transport requires SFTP_PASSWORD");
  return crypto.createHash("sha256").update(AUTH_DOMAIN).update(password).digest("hex");
}

function isAuthorized(header) {
  const expected = `Bearer ${getAuthToken()}`;
  const actual = String(header || "");
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function cleanupOldRows() {
  const cutoff = Math.floor(Date.now() / 1000) - (7 * 24 * 60 * 60);
  db.prepare("DELETE FROM command_bridge_http_requests WHERE created_at < ? AND status IN ('completed','expired')").run(cutoff);
}

function enqueue(command, expectedSource) {
  cleanupOldRows();
  const payload = JSON.stringify(command);
  db.prepare(`
    INSERT INTO command_bridge_http_requests
      (id, verb, steam, expected_source, payload, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(command.id, command.verb, command.steam, expectedSource, payload, Math.floor(Date.now() / 1000));
  return command.id;
}

function claimPending(limit = MAX_BATCH) {
  const n = Math.max(1, Math.min(MAX_BATCH, Number(limit) || MAX_BATCH));
  const now = Math.floor(Date.now() / 1000);
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = db.prepare(`
      SELECT id, payload
      FROM command_bridge_http_requests
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?
    `).all(n);
    const mark = db.prepare(`
      UPDATE command_bridge_http_requests
      SET status = 'dispatched', dispatched_at = ?
      WHERE id = ? AND status = 'pending'
    `);
    const claimed = [];
    for (const row of rows) {
      const changed = mark.run(now, row.id);
      if (Number(changed.changes || 0) === 1) claimed.push(row.payload);
    }
    db.exec("COMMIT");
    return claimed;
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch {}
    throw err;
  }
}

function acceptResult(result) {
  if (!result || typeof result !== "object") return { accepted: false, reason: "invalid_result" };
  const id = String(result.id || "");
  if (!id) return { accepted: false, reason: "missing_id" };
  const row = db.prepare(`
    SELECT id, verb, steam, expected_source, status
    FROM command_bridge_http_requests WHERE id = ?
  `).get(id);
  if (!row) return { accepted: false, reason: "unknown_id" };
  if (String(result.steam || "") !== row.steam) return { accepted: false, reason: "steam_mismatch" };
  if (typeof result.ok !== "boolean" || typeof result.msg !== "string") {
    return { accepted: false, reason: "invalid_schema" };
  }

  const now = Math.floor(Date.now() / 1000);
  const source = result.source == null ? null : String(result.source);
  if (source === row.expected_source) {
    db.prepare(`
      UPDATE command_bridge_http_requests
      SET status = 'completed', result_json = ?, completed_at = ?
      WHERE id = ?
    `).run(JSON.stringify(result), now, id);
    return { accepted: true, final: true };
  }

  if (source == null) {
    if (result.verb != null && String(result.verb) !== row.verb) {
      return { accepted: false, reason: "verb_mismatch" };
    }
    if (result.ok === false) {
      db.prepare(`
        UPDATE command_bridge_http_requests
        SET status = 'completed', result_json = ?, completed_at = ?
        WHERE id = ?
      `).run(JSON.stringify(result), now, id);
      return { accepted: true, final: true };
    }
    db.prepare(`
      UPDATE command_bridge_http_requests
      SET status = 'acknowledged', result_json = ?, acknowledged_at = ?
      WHERE id = ? AND status != 'completed'
    `).run(JSON.stringify(result), now, id);
    return { accepted: true, final: false };
  }

  return { accepted: true, final: false, ignoredSource: source };
}

function getRequest(id) {
  return db.prepare(`
    SELECT id, verb, steam, expected_source, status, result_json,
           created_at, dispatched_at, acknowledged_at, completed_at
    FROM command_bridge_http_requests WHERE id = ?
  `).get(id);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function execute(command, expectedSource, { resultMode = "submod", timeoutMs = 20000 } = {}) {
  enqueue(command, expectedSource);
  console.info("[CommandBridge HTTP] queued", { requestId: command.id, verb: command.verb });
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const row = getRequest(command.id);
    if (!row) throw new Error("CommandBridge HTTP request disappeared from the queue");

    if (row.status === "completed" && row.result_json) {
      const result = JSON.parse(row.result_json);
      const confirmed = result.source === expectedSource;
      return {
        ok: result.ok,
        queued: false,
        confirmed,
        requestId: command.id,
        acknowledged: true,
        source: result.source || "CommandBridge",
        message: result.msg,
        error: result.ok ? undefined : result.msg,
      };
    }

    if (row.status === "acknowledged" && resultMode === "bridge_ack") {
      const ack = row.result_json ? JSON.parse(row.result_json) : null;
      return {
        ok: false,
        accepted: true,
        queued: true,
        confirmed: false,
        acknowledged: true,
        requestId: command.id,
        source: "CommandBridge",
        message: ack?.msg || `CommandBridge accepted request ${command.id}; DinoStorage outcome is not yet confirmed.`,
      };
    }

    await sleep(250);
  }

  const row = getRequest(command.id);
  if (row && row.status !== "completed") {
    db.prepare("UPDATE command_bridge_http_requests SET status = 'expired' WHERE id = ? AND status != 'completed'").run(command.id);
  }
  return {
    ok: false,
    queued: Boolean(row && row.status !== "pending"),
    confirmed: false,
    acknowledged: Boolean(row && ["acknowledged", "completed"].includes(row.status)),
    requestId: command.id,
    message: `Outcome unknown (HTTP bridge timeout). Do not retry until request ${command.id} is reconciled.`,
  };
}

module.exports = {
  getAuthToken,
  isAuthorized,
  enqueue,
  claimPending,
  acceptResult,
  getRequest,
  execute,
};
