const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

test('catalog CLI checks without database writes and registers immutable reviewed versions explicitly', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-discovery-registration-'));
  const catalogFile = path.join(directory, 'catalog.json'), database = path.join(directory, 'automation.sqlite');
  const catalog = { version:'v1',mapVersion:'Gateway_v0.21',bounds:{minX:-100,maxX:100,minY:-100,maxY:100},regions:[{id:'north',name:'North'}],points:[{id:'cave',name:'Cave',category:'cave',regionId:'north',enabled:false,x:0,y:0,radiusMetres:50}] };
  const run = args => spawnSync(process.execPath, [path.join(__dirname, '../scripts/register-discovery-catalog.cjs'), '--catalog', catalogFile, ...args], { encoding:'utf8' });
  try {
    fs.writeFileSync(catalogFile, JSON.stringify(catalog));
    const checked = run(['--database', database]);
    assert.equal(checked.status, 0); assert.equal(JSON.parse(checked.stdout).registered, false); assert.equal(fs.existsSync(database), false);
    assert.notEqual(run(['--write']).status, 0);
    new DatabaseSync(database).close();
    const registered = run(['--database', database, '--write']);
    assert.equal(registered.status, 0); assert.equal(JSON.parse(registered.stdout).duplicate, false);
    assert.equal(JSON.parse(run(['--database', database, '--write']).stdout).duplicate, true);
    catalog.points[0].radiusMetres = 75; fs.writeFileSync(catalogFile, JSON.stringify(catalog));
    assert.notEqual(run(['--database', database, '--write']).status, 0);
    const db = new DatabaseSync(database);
    assert.equal(JSON.parse(db.prepare('SELECT payload FROM discovery_catalogs').get().payload).points[0].radiusMetres, 50); db.close();
  } finally {
    const resolved = path.resolve(directory), temporaryRoot = path.resolve(os.tmpdir()) + path.sep;
    assert.ok(resolved.startsWith(temporaryRoot)); fs.rmSync(resolved, { recursive:true, force:true });
  }
});
