const fs = require('node:fs');
const path = require('node:path');
const { validateCatalog, createDiscoveryCatalogStore } = require('../automation-platform/src/services/discoveryCatalog');

function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--write') {
      if (options.write) throw new Error('Duplicate --write option');
      options.write = true;
      continue;
    }
    if (!['--catalog', '--database'].includes(flag) || options[flag] || !args[index + 1] || args[index + 1].startsWith('--')) {
      throw new Error('Use --catalog FILE, with --database FILE --write for registration');
    }
    options[flag] = args[++index];
  }
  if (!options['--catalog']) throw new Error('A reviewed catalog file is required');
  const catalog = validateCatalog(JSON.parse(fs.readFileSync(path.resolve(options['--catalog']), 'utf8')));
  const summary = { version: catalog.version, mapVersion: catalog.mapVersion, points: catalog.points.length, enabled: catalog.points.filter(point => point.enabled).length };
  if (!options.write) {
    console.log(JSON.stringify({ ...summary, checked: true, registered: false }));
    return;
  }
  if (!options['--database']) throw new Error('Registration requires an explicit database path');
  // Open an existing database only. A mistyped path must not create a second
  // empty database while the runtime continues to use its original file.
  const database = path.resolve(options['--database']);
  if (!fs.statSync(database).isFile()) throw new Error('Database path must identify an existing file');
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(database);
  try {
    db.exec('PRAGMA busy_timeout=5000');
    const result = createDiscoveryCatalogStore(db).register(catalog);
    console.log(JSON.stringify({ ...summary, ...result, registered: true }));
  } finally { db.close(); }
}

if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { main };
