const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function fixture({ retention = 2 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-backup-'));
  const dbPath = path.join(dir, 'automation.sqlite');
  const backupDir = path.join(dir, 'backups');
  const previous = {
    AUTOMATION_DB_PATH: process.env.AUTOMATION_DB_PATH,
    AUTOMATION_BACKUP_DIR: process.env.AUTOMATION_BACKUP_DIR,
    AUTOMATION_BACKUP_RETENTION: process.env.AUTOMATION_BACKUP_RETENTION,
    AUTOMATION_BACKUP_ENABLED: process.env.AUTOMATION_BACKUP_ENABLED,
  };
  process.env.AUTOMATION_DB_PATH = dbPath;
  process.env.AUTOMATION_BACKUP_DIR = backupDir;
  process.env.AUTOMATION_BACKUP_RETENTION = String(retention);
  process.env.AUTOMATION_BACKUP_ENABLED = 'true';

  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE example (id INTEGER PRIMARY KEY, value TEXT NOT NULL)');
  db.prepare('INSERT INTO example (value) VALUES (?)').run('first');
  db.close();

  const modulePath = require.resolve('../src/services/backupService');
  delete require.cache[modulePath];
  const service = require(modulePath);

  return {
    service,
    dbPath,
    backupDir,
    cleanup() {
      delete require.cache[modulePath];
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('backup creates a consistent SQLite database containing source data', (t) => {
  const f = fixture();
  t.after(f.cleanup);

  const result = f.service.createBackup({ now: new Date('2026-09-18T00:00:00.000Z') });
  assert.equal(result.skipped, false);
  assert.ok(result.size > 0);
  assert.equal(f.service.listBackups().length, 1);

  const snapshot = new DatabaseSync(path.join(f.backupDir, result.fileName), { readOnly: true });
  const row = snapshot.prepare('SELECT value FROM example WHERE id = 1').get();
  snapshot.close();
  assert.equal(row.value, 'first');
});

test('backup retention removes oldest snapshots beyond configured count', (t) => {
  const f = fixture({ retention: 2 });
  t.after(f.cleanup);

  f.service.createBackup({ now: new Date('2026-09-18T00:00:00.000Z') });
  f.service.createBackup({ now: new Date('2026-09-18T01:00:00.000Z') });
  const last = f.service.createBackup({ now: new Date('2026-09-18T02:00:00.000Z') });

  const backups = f.service.listBackups();
  const names = backups.map((item) => item.name).sort();
  assert.deepEqual(names, [
    'automation-2026-09-18T01-00-00-000Z.sqlite',
    'automation-2026-09-18T02-00-00-000Z.sqlite',
  ]);
  assert.deepEqual(last.removed, [
    'automation-2026-09-18T00-00-00-000Z.sqlite',
  ]);
});

test('backups fail closed for in-memory databases', (t) => {
  const f = fixture();
  t.after(f.cleanup);
  process.env.AUTOMATION_DB_PATH = ':memory:';
  assert.throws(() => f.service.createBackup(), /file-backed/);
});
