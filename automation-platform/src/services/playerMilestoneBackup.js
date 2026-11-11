'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
// A named, immutable rollback snapshot. Never copy a live SQLite main file
// without its WAL, never replace a backup, and never restore automatically.
function backupBeforeMilestones(db, file) {
  if (file === ':memory:' || db.prepare("SELECT 1 FROM sqlite_master WHERE name='player_milestone_state'").get()) return;
  const destination = path.join(path.dirname(path.resolve(file)), 'backups', 'before-player-milestones-v1.sqlite');
  if (fs.existsSync(destination)) {
    const check = new DatabaseSync(destination, { readOnly: true });
    try { if (check.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Milestone backup integrity check failed'); }
    finally { check.close(); }
    return;
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const stat = fs.statfsSync(path.dirname(destination));
  const bytes = Number(db.prepare('PRAGMA page_count').get().page_count) * Number(db.prepare('PRAGMA page_size').get().page_size);
  if (stat.bavail * stat.bsize < bytes + 16 * 1024 * 1024) throw new Error('Insufficient space for milestone backup');
  db.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
  const check = new DatabaseSync(destination, { readOnly: true });
  try { if (check.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Milestone backup integrity check failed'); }
  finally { check.close(); }
  console.info('[player-milestones] verified pre-migration backup');
}
module.exports = { backupBeforeMilestones };
