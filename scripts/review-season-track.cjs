"use strict";
const fs = require('node:fs'), path = require('node:path');
const { describe, createSeasonTrackStore } = require('../automation-platform/src/services/seasonTrackStore');

// Host-operator tool. A supplied reviewer is an audit identity, not remote auth.
// No environment loading, automatic database selection or implicit mutations.
function main(args) {
  const [command, ...rest] = args;
  const required = {
    review: ['file'], inspect: ['database', 'id'],
    stage: ['database', 'file', 'reviewer', 'digest'],
    publish: ['database', 'id', 'reviewer', 'digest', 'revision'],
    close: ['database', 'id', 'reviewer', 'digest', 'revision'],
  }[command];
  if (!required) throw new Error('Choose review, inspect, stage, publish or close');
  const options = {}; let write = false;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--write') {
      if (write || !['stage', 'publish', 'close'].includes(command)) throw new Error('--write is allowed once for a catalog change');
      write = true; continue;
    }
    const name = rest[i].startsWith('--') ? rest[i].slice(2) : '';
    if (!required.includes(name) || Object.hasOwn(options, name) || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error('Unknown, duplicate or missing season option');
    options[name] = rest[++i];
  }
  if (required.some(key => !Object.hasOwn(options, key))) throw new Error('Required options: ' + required.map(key => '--' + key).join(', '));
  if (options.reviewer && !/^\d{17}$/.test(options.reviewer)) throw new Error('A reviewing operator Steam ID is required');
  if (options.digest && !/^[a-f0-9]{64}$/.test(options.digest)) throw new Error('Use the exact reviewed SHA-256 digest');
  if (options.revision && (!/^[1-9]\d*$/.test(options.revision) || !Number.isSafeInteger(Number(options.revision)))) throw new Error('Use the current whole revision');
  let reviewed;
  if (options.file) {
    const file = path.resolve(options.file), stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > 65536) throw new Error('Choose a JSON season artifact no larger than 64 KiB');
    reviewed = describe(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
    if (!reviewed.definition.retainUntil) throw new Error('Review an explicit season retention date');
    if (options.digest && options.digest !== reviewed.digest) throw new Error('Season file changed after review');
  }
  if (command === 'review') return { ...reviewed, databaseOpened: false, written: false };
  const database = fs.realpathSync(path.resolve(options.database));
  if (!fs.statSync(database).isFile()) throw new Error('Select an existing automation database');
  const { DatabaseSync } = require('node:sqlite'), db = new DatabaseSync(database, { readOnly: !write });
  try {
    db.exec('PRAGMA busy_timeout=5000');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    if (!['economy_wallets', 'progression_xp_ledger', 'progression_xp_source_times'].every(name => tables.has(name))) throw new Error('Choose an initialized progression/source-time automation database');
    const ready = ['progression_seasons', 'progression_season_audit', 'progression_season_enrollments', 'progression_season_evidence', 'progression_season_source_positions', 'progression_season_choices', 'progression_season_requests', 'progression_season_retention', 'progression_season_maintenance'].every(name => tables.has(name));
    if (!ready && command !== 'stage') {
      if (command === 'inspect') return { database, schemaReady: false, season: null, written: false };
      throw new Error('Stage a reviewed season first');
    }
    const store = ready || write ? createSeasonTrackStore(db, { initialize: write }) : null;
    if (command === 'inspect') return { database, schemaReady: true, season: store.read(options.id),
      audit: db.prepare('SELECT revision,action,actor,digest,at FROM progression_season_audit WHERE season_id=? ORDER BY revision DESC LIMIT 10').all(options.id), written: false };
    if (command === 'stage') {
      const old = ready ? db.prepare('SELECT digest FROM progression_seasons WHERE id=?').get(reviewed.definition.id) : null;
      if (old && (store.read(reviewed.definition.id).digest !== reviewed.digest)) throw new Error('Season already has different immutable rules');
      if (!old && Date.parse(reviewed.definition.startsAt) <= Date.now()) throw new Error('Stage a future season');
      if (!write) return { database, ...reviewed, wouldStage: !old, written: false };
      return { database, season: store.stage(reviewed.definition, { reviewer: options.reviewer, digest: options.digest }), written: true, rolloutSettingsChanged: false };
    }
    const request = { reviewer: options.reviewer, digest: options.digest, expectedRevision: Number(options.revision), action: command };
    if (!write) return { database, ...store.reviewStateChange(options.id, request), written: false };
    return { database, season: store.changeState(options.id, request), written: true, rolloutSettingsChanged: false };
  } finally { db.close(); }
}
if (require.main === module) {
  try { console.log(JSON.stringify(main(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { main };
