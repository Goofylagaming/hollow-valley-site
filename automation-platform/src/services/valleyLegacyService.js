"use strict";
const { createLegacyStore } = require("./valleyLegacyStore");
let store;
function enabled() {
  return process.env.VALLEY_LEGACY_ENABLED === "1";
}
function get() {
  if (!enabled())
    throw Object.assign(new Error("Valley Legacy is not enabled"), {
      status: 503,
    });
  if (!store) {
    const { DatabaseSync } = require("node:sqlite");
    const path = require("node:path");
    const fs = require("node:fs");
    const file =
      process.env.AUTOMATION_DB_PATH ||
      path.join(__dirname, "../../data/automation.sqlite");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;");
    store = createLegacyStore(db);
  }
  return store;
}
function timestamp(raw) {
  return Date.parse(
    String(raw).includes("T") ? raw : String(raw).replace(" ", "T") + "Z",
  );
}
function reconcile() {
  if (!enabled()) return;
  const s = get(),
    db = s.db;
  for (const table of ["combat_events", "economy_wallet_ledger"]) {
    if (
      !db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(table)
    )
      continue;
    const dateColumn = table === "combat_events" ? "occurred_at" : "created_at";
    // Durable IDs survive source pruning and rowid reuse. Only post-activation
    // evidence is eligible; startup never backfills historical economy rewards.
    for (const row of db
      .prepare(
        `SELECT t.* FROM ${table} t WHERE julianday(t.${dateColumn})>=julianday(?) AND NOT EXISTS (SELECT 1 FROM vl_imports i WHERE i.source=? AND i.id=t.id) ORDER BY t.${dateColumn},t.id LIMIT 500`,
      )
      .all(new Date(s.started).toISOString(), table)) {
      const at = timestamp(row.occurred_at || row.created_at);
      let error = null;
      try {
        if (at >= s.started) {
          if (table === "combat_events") {
            if (
              row.killer_steam_id &&
              row.killer_steam_id !== row.victim_steam_id
            )
              s.ingest({
                id: `combat:${row.id}:kill`,
                type: "combat_kill",
                steamId: row.killer_steam_id,
                name: row.killer_name,
                at,
              });
            s.ingest({
              id: `combat:${row.id}:death`,
              type: "combat_death",
              steamId: row.victim_steam_id,
              name: row.victim_name,
              at,
            });
          } else if (
            ["playtime_reward", "event_reward"].includes(row.kind) &&
            row.amount > 0
          ) {
            s.ingest({
              id: `coins:${row.id}`,
              type: "gameplay_coins",
              steamId: row.steam_id,
              name: "Survivor",
              value: row.amount,
              at,
            });
          }
        }
      } catch (e) {
        if (e.status !== 409) throw e;
        error = e.message;
        console.warn(
          "[valley-legacy] rejected delayed/conflicting evidence:",
          table,
          row.id,
        );
      }
      db.prepare("INSERT OR IGNORE INTO vl_imports VALUES (?,?,?)").run(
        table,
        row.id,
        error,
      );
    }
  }
}
function recordSnapshot(players, at) {
  if (!enabled()) return;
  try {
    reconcile();
    return get().snapshot(players, at);
  } catch (e) {
    console.error("[valley-legacy] snapshot failed:", e.message);
  }
}
function start() {
  if (!enabled()) return;
  get();
  const timer = setInterval(() => {
    try {
      reconcile();
    } catch (e) {
      console.error("[valley-legacy] reconciliation failed:", e.message);
    }
  }, 15000);
  timer.unref();
}
module.exports = { enabled, get, reconcile, recordSnapshot, start };
