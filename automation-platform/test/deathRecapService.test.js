const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createDeathRecapService } = require('../src/services/deathRecapService');
test('recaps disclose delayed victim-owned events and preserve unknown historical fields', () => {
  const db = new DatabaseSync(':memory:'), now = Date.now(), steam = '76561198000000801', other = '76561198000000802';
  try {
    const service = createDeathRecapService(db, { now: () => now, enabled: () => true });
    assert.deepEqual(service.list(steam), { recaps: [] });
    db.exec('CREATE TABLE combat_events(id TEXT PRIMARY KEY,occurred_at TEXT,killer_name TEXT,killer_steam_id TEXT,victim_steam_id TEXT)');
    const insert = db.prepare('INSERT INTO combat_events VALUES (?,?,?,?,?)');
    insert.run('owned', new Date(now - 300001).toISOString(), 'Attacker', other, steam);
    insert.run('recent', new Date(now - 1000).toISOString(), 'Recent', other, steam);
    insert.run('foreign', new Date(now - 300001).toISOString(), 'Foreign', steam, other);
    insert.run('old', new Date(now - 31 * 86400000).toISOString(), 'Expired', other, steam);
    const result = service.list(steam);
    assert.equal(result.recaps.length, 1); assert.equal(result.recaps[0].id, 'owned');
    assert.equal(result.recaps[0].attackerName, 'Attacker'); assert.equal(result.recaps[0].location, null);
    assert.equal(result.recaps[0].attackerSpecies, null); assert.equal(JSON.stringify(result).includes(other), false);
    db.exec('ALTER TABLE combat_events ADD COLUMN victim_species TEXT');
    db.prepare('UPDATE combat_events SET victim_species=? WHERE id=?').run('rex', 'owned');
    assert.equal(service.list(steam).recaps[0].victimSpecies, 'rex');
    assert.throws(() => service.list('invalid'), { status: 400 });
  } finally { db.close(); }
});
