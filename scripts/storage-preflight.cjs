'use strict';
// Read-only inventory of a verified SQLite backup, never a migration runner.
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const crypto = require('node:crypto');

function inventory(filename) {
  if (!filename || !fs.statSync(filename).isFile()) throw new Error('An existing SQLite backup is required');
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    db.exec('BEGIN');
    const integrity = db.prepare('PRAGMA quick_check').all();
    if (integrity.some(row => Object.values(row)[0] !== 'ok')) throw new Error('SQLite integrity check failed');
    const tables = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
    const result = tables.map(table => {
      const quoted = '"' + table.name.replaceAll('"', '""') + '"';
      return { name: table.name, rows: db.prepare(`SELECT COUNT(*) AS count FROM ${quoted}`).get().count,
        schemaSha256: crypto.createHash('sha256').update(table.sql || '').digest('hex') };
    });
    db.exec('ROLLBACK');
    return { integrity: 'ok', tables: result };
  } finally { db.close(); }
}
if (require.main === module) {
  try { console.log(JSON.stringify(inventory(process.argv[2]), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { inventory };
