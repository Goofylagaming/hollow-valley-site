const fs = require('node:fs');
const path = require('node:path');
const { validateItem, digest } = require('../automation-platform/src/services/groupTreasuryCatalog');

// Host-operator tool, not an HTTP authorization boundary. Never loads .env or
// guesses a database path. Review/inspect open no writable database.
function main(args) {
  const [command, ...rest] = args;
  const allowed = {
    review: ['file'], stage: ['database', 'file', 'reviewer', 'digest'],
    inspect: ['database', 'id', 'revision'],
    enable: ['database', 'id', 'revision', 'reviewer', 'digest', 'active-revision'],
    disable: ['database', 'id', 'revision', 'reviewer', 'digest', 'active-revision']
  }[command];
  if (!allowed) throw new Error('Choose review, stage, inspect, enable or disable');
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const name = rest[index]?.slice(2), value = rest[index + 1];
    if (!rest[index]?.startsWith('--') || !allowed.includes(name) || Object.hasOwn(options, name) || !value || value.startsWith('--')) throw new Error('Unknown, missing or duplicate catalog option');
    options[name] = value;
  }
  if (allowed.some(name => !Object.hasOwn(options, name))) throw new Error(`Required options: ${allowed.map(name => '--' + name).join(', ')}`);
  if (options.reviewer && !/^\d{17}$/.test(options.reviewer)) throw new Error('A reviewer Steam ID is required for the audit');
  if (options.digest && !/^[a-f0-9]{64}$/.test(options.digest)) throw new Error('Use the exact SHA-256 digest from review or inspect');
  const revision = value => {
    if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('A positive whole revision is required');
    return Number(value);
  };
  let item;
  if (options.file) {
    const file = path.resolve(options.file);
    if (fs.statSync(file).size > 16384) throw new Error('Catalog item file is too large');
    item = validateItem(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (command === 'review') return { item, digest: digest(item), staged: false, enabled: false };
    if (digest(item) !== options.digest) throw new Error('Item changed after review; review the file again');
  }
  const itemRevision = options.revision ? revision(options.revision) : null;
  const activeRevision = options['active-revision'] === 'none' ? null : options['active-revision'] ? revision(options['active-revision']) : null;
  const database = path.resolve(options.database);
  if (!fs.statSync(database).isFile()) throw new Error('Select an existing authoritative automation database');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(database, { readOnly: command === 'inspect' });
  try {
    db.exec('PRAGMA busy_timeout=5000');
    // Prevent a website DB or empty file from becoming a second economy store.
    for (const table of ['economy_wallets', 'economy_wallet_ledger']) {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) throw new Error('This is not an initialized automation economy database');
    }
    if (command !== 'inspect') {
      const service = require('../automation-platform/src/services/groupTreasurySpending').createGroupTreasurySpending({ db });
      if (command === 'stage') service.register(item, options.reviewer);
      else service.setEnabled(options.id, itemRevision, command === 'enable', options.reviewer, { digest: options.digest, activeRevision });
    }
    const id = item?.id ?? options.id, version = item?.revision ?? itemRevision;
    const row = db.prepare('SELECT item_json,enabled,reviewed_by,created_at FROM economy_group_treasury_catalog WHERE item_id=? AND revision=?').get(id, version);
    if (!row) throw new Error('Catalog revision not found');
    const saved = validateItem(JSON.parse(row.item_json));
    const active = db.prepare('SELECT revision FROM economy_group_treasury_catalog WHERE item_id=? AND enabled=1').get(id)?.revision ?? null;
    const audit = db.prepare('SELECT action,actor,created_at AS createdAt FROM economy_group_treasury_catalog_audit WHERE item_id=? AND revision=? ORDER BY id').all(id, version);
    return { item: saved, digest: digest(saved), enabled: Boolean(row.enabled), activeRevision: active, reviewedBy: row.reviewed_by, createdAt: row.created_at, audit };
  } finally { db.close(); }
}

if (require.main === module) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { main };
