'use strict';

// Display-only cache. Never consulted by wallet, rewards or game commands.
let initialized = false;
function database() {
  const { db } = require('../db');
  if (!initialized) {
    db.exec(`CREATE TABLE IF NOT EXISTS read_snapshots (
      key TEXT PRIMARY KEY, payload TEXT NOT NULL, captured_at INTEGER NOT NULL
    )`);
    initialized = true;
  }
  return db;
}
function save(key, payload) {
  database().prepare(`INSERT INTO read_snapshots VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET payload=excluded.payload, captured_at=excluded.captured_at`)
    .run(key, JSON.stringify(payload), Date.now());
}
function load(key, maxAgeMs) {
  const row = database().prepare('SELECT payload, captured_at FROM read_snapshots WHERE key = ?').get(key);
  if (!row || Date.now() - row.captured_at > maxAgeMs) return null;
  return { value: JSON.parse(row.payload), capturedAt: new Date(row.captured_at).toISOString() };
}
module.exports = { save, load };
