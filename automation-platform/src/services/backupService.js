const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

let backupRunning = false;

function enabled() {
  return String(process.env.AUTOMATION_BACKUP_ENABLED || '').toLowerCase() === 'true';
}

function databasePath() {
  return String(process.env.AUTOMATION_DB_PATH || path.join(__dirname, '..', '..', 'data', 'automation.sqlite')).trim();
}

function backupDir() {
  const configured = String(process.env.AUTOMATION_BACKUP_DIR || '').trim();
  const dbPath = databasePath();
  return configured || path.join(path.dirname(dbPath), 'backups');
}

function intervalMs() {
  const value = Number(process.env.AUTOMATION_BACKUP_INTERVAL_MS || 6 * 60 * 60 * 1000);
  return Math.max(60 * 60 * 1000, Math.min(7 * 24 * 60 * 60 * 1000, Number.isFinite(value) ? value : 6 * 60 * 60 * 1000));
}

function retentionCount() {
  const value = Number(process.env.AUTOMATION_BACKUP_RETENTION || 20);
  return Math.max(2, Math.min(200, Number.isInteger(value) ? value : 20));
}

function safeDatabasePath() {
  const dbPath = databasePath();
  if (!dbPath || dbPath === ':memory:') throw new Error('Backups require a file-backed AUTOMATION_DB_PATH');
  const resolved = path.resolve(dbPath);
  if (!fs.existsSync(resolved)) throw new Error(`Automation database does not exist at ${resolved}`);
  return resolved;
}

function timestampName(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-');
}

function sqliteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function listBackups() {
  const directory = path.resolve(backupDir());
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^automation-\d{4}-\d{2}-\d{2}T.*\.sqlite$/.test(entry.name))
    .map((entry) => {
      const fullPath = path.join(directory, entry.name);
      const stat = fs.statSync(fullPath);
      return { name: entry.name, path: fullPath, size: stat.size, modifiedAt: stat.mtime.toISOString() };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

function pruneBackups() {
  const backups = listBackups();
  const keep = retentionCount();
  const removed = [];
  for (const item of backups.slice(keep)) {
    fs.unlinkSync(item.path);
    removed.push(item.name);
  }
  return removed;
}

function createBackup({ now = new Date() } = {}) {
  if (backupRunning) return { skipped: true, reason: 'backup-already-running' };
  backupRunning = true;
  try {
    const source = safeDatabasePath();
    const directory = path.resolve(backupDir());
    fs.mkdirSync(directory, { recursive: true });

    const fileName = `automation-${timestampName(now)}.sqlite`;
    const destination = path.join(directory, fileName);
    if (fs.existsSync(destination)) throw new Error(`Backup already exists: ${fileName}`);

    const db = new DatabaseSync(source);
    try {
      db.exec('PRAGMA busy_timeout = 5000;');
      // VACUUM INTO creates a transactionally consistent standalone snapshot,
      // including data that may currently live in the source database's WAL.
      db.exec(`VACUUM INTO ${sqliteLiteral(destination)}`);
    } finally {
      db.close();
    }

    const size = fs.statSync(destination).size;
    const removed = pruneBackups();
    return {
      skipped: false,
      fileName,
      size,
      createdAt: now.toISOString(),
      removed,
      retained: listBackups().length,
    };
  } finally {
    backupRunning = false;
  }
}

function getBackupState() {
  const backups = listBackups();
  return {
    enabled: enabled(),
    configured: databasePath() !== ':memory:',
    directory: backupDir(),
    retention: retentionCount(),
    count: backups.length,
    latest: backups[0] || null,
  };
}

function startBackups() {
  if (!enabled()) return null;
  try {
    createBackup();
  } catch (error) {
    console.warn('[automation-backup]', error.message);
  }
  const timer = setInterval(() => {
    try {
      createBackup();
    } catch (error) {
      console.warn('[automation-backup]', error.message);
    }
  }, intervalMs());
  timer.unref?.();
  return timer;
}

module.exports = {
  enabled,
  databasePath,
  backupDir,
  intervalMs,
  retentionCount,
  sqliteLiteral,
  listBackups,
  pruneBackups,
  createBackup,
  getBackupState,
  startBackups,
};
