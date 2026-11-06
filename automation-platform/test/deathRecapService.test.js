const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { createDeathRecapService } = require('../src/services/deathRecapService');
test('recaps disclose delayed victim-owned events and preserve unknown historical fields', () => {
  const db = new DatabaseSync(':memory:'), now = Date.now(), steam = '76561198000000801', other = '76561198000000802';
  try {
    const service = createDeathRecapService(db, { now: () => now, enabled: () => true });
    assert.deepEqual(service.list(steam), { recaps: [] });
    db.exec("CREATE TABLE combat_events(id TEXT PRIMARY KEY,occurred_at TEXT,killer_name TEXT,killer_steam_id TEXT,victim_steam_id TEXT,source TEXT DEFAULT 'hollow-valley-game')");
    const insert = db.prepare('INSERT INTO combat_events(id,occurred_at,killer_name,killer_steam_id,victim_steam_id) VALUES (?,?,?,?,?)');
    insert.run('owned', new Date(now - 300001).toISOString(), 'Attacker', other, steam);
    insert.run('recent', new Date(now - 1000).toISOString(), 'Recent', other, steam);
    insert.run('foreign', new Date(now - 300001).toISOString(), 'Foreign', steam, other);
    insert.run('old', new Date(now - 31 * 86400000).toISOString(), 'Expired', other, steam);
    const result = service.list(steam);
    assert.equal(result.recaps.length, 1); assert.equal(result.recaps[0].id, 'owned');
    assert.equal(result.recaps[0].attackerName, 'Attacker'); assert.equal(result.recaps[0].location, null);
    assert.equal(result.recaps[0].attackerSpecies, null); assert.equal(JSON.stringify(result).includes(other), false);
    assert.equal(result.recaps[0].recentCombat.length,1);
    assert.equal(result.recaps[0].recentCombat[0].type,'kill');
    insert.run('unrelated',new Date(now-400000).toISOString(),'Someone',other,'76561198000000803');
    insert.run('too-early',new Date(now-1000000).toISOString(),'Earlier',steam,other);
    insert.run('in-window',new Date(now-400000).toISOString(),'Recorded',steam,other);
    assert.equal(service.list(steam).recaps[0].recentCombat.length,2);
    db.exec('ALTER TABLE combat_events ADD COLUMN victim_species TEXT');
    db.prepare('UPDATE combat_events SET victim_species=? WHERE id=?').run('tyrannosaurus', 'owned');
    assert.equal(service.list(steam).recaps[0].victimSpecies, 'tyrannosaurus');
    db.exec('ALTER TABLE combat_events ADD COLUMN killer_species TEXT; ALTER TABLE combat_events ADD COLUMN victim_growth REAL');
    db.prepare('UPDATE combat_events SET killer_species=?,victim_growth=? WHERE id=?').run('triceratops',0,'owned');
    assert.equal(service.list(steam).recaps[0].attackerSpecies,'triceratops');
    assert.equal(service.list(steam).recaps[0].growth,0);
    db.exec('ALTER TABLE combat_events ADD COLUMN event_location TEXT');
    db.prepare('UPDATE combat_events SET event_location=? WHERE id=?').run(JSON.stringify({x:0,y:-1000}),'owned');
    assert.deepEqual(service.list(steam).recaps[0].eventLocation,{x:0,y:-1000});
    assert.throws(() => service.list('invalid'), { status: 400 });
  } finally { db.close(); }
});

test('recaps and their timeline require the configured source without changing retained evidence', () => {
  const db = new DatabaseSync(':memory:'), now = Date.parse('2026-11-06T12:00:00Z'), steam = '76561198000000801', other = '76561198000000802';
  try {
    db.exec('CREATE TABLE combat_events(id TEXT PRIMARY KEY,occurred_at TEXT,killer_name TEXT,killer_steam_id TEXT,victim_steam_id TEXT,source TEXT)');
    const put = (id,at,killer,victim,source) => db.prepare('INSERT INTO combat_events VALUES(?,?,?,?,?,?)').run(id,new Date(at).toISOString(),id,killer,victim,source);
    put('recorded-death',now-300000,other,steam,'trusted-feed');
    put('recorded-kill',now-400000,steam,other,'trusted-feed');
    put('manual-death',now-300001,other,steam,'manual');
    put('manual-kill',now-400001,steam,other,'manual');
    put('unknown-source',now-400002,other,steam,null);
    put('recent-death',now-299999,other,steam,'trusted-feed');
    put('future-death',now+1,other,steam,'trusted-feed');
    put('old-death',now-30*86400000-1,other,steam,'trusted-feed');
    const service = createDeathRecapService(db,{now:()=>now,enabled:()=>true,combatSource:()=> 'trusted-feed'});
    const before = db.prepare('SELECT total_changes() n').get().n;db.exec('PRAGMA query_only=ON');
    const data = service.list(steam);
    assert.deepEqual(data.recaps.map(row=>row.id),['recorded-death']);
    assert.deepEqual(data.recaps[0].recentCombat,[{type:'kill',occurredAt:new Date(now-400000).toISOString()}]);
    assert.equal(JSON.stringify(data).includes(other),false);
    assert.equal(db.prepare('SELECT total_changes() n').get().n,before);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM combat_events').get().n,8);
    for(const options of [{combatSource:()=>''},{combatSource:()=> 'bad source'},{now:()=>NaN},{now:()=>-1}]) assert.throws(()=>createDeathRecapService(db,{enabled:()=>true,...options}).list(steam),{status:503});
  } finally { db.close(); }
});

test('unknown source schemas are withheld and malformed optional evidence stays unknown', () => {
  const db = new DatabaseSync(':memory:'), now = Date.now(), steam='76561198000000801';
  try {
    db.exec('CREATE TABLE combat_events(id TEXT,occurred_at TEXT,killer_name TEXT,killer_steam_id TEXT,victim_steam_id TEXT,victim_species TEXT,killer_species TEXT,victim_growth REAL,event_location TEXT)');
    const service=createDeathRecapService(db,{now:()=>now,enabled:()=>true});
    assert.throws(()=>service.list(steam),{status:503});
    db.exec("ALTER TABLE combat_events ADD COLUMN source TEXT DEFAULT 'hollow-valley-game'");
    db.prepare('INSERT INTO combat_events VALUES(?,?,?,?,?,?,?,?,?,?)').run('malformed',new Date(now-600000).toISOString(),'Stored','76561198000000802',steam,'unrecognized','unknown',2,'{broken','hollow-valley-game');
    let row=service.list(steam).recaps[0];assert.equal(row.eventLocation,null);assert.equal(row.growth,null);assert.equal(row.victimSpecies,null);assert.equal(row.attackerSpecies,null);
    for(const raw of ['null','[]','{"x":0,"y":0,"steamId":"private"}','{"x":1e99,"y":0}','{"x":"0","y":0}']){
      db.prepare('UPDATE combat_events SET event_location=?').run(raw);assert.equal(service.list(steam).recaps[0].eventLocation,null);
    }
    db.prepare('UPDATE combat_events SET event_location=?,victim_growth=0').run('{"x":0,"y":-10000000}');row=service.list(steam).recaps[0];assert.deepEqual(row.eventLocation,{x:0,y:-10000000});assert.equal(row.growth,0);
  } finally { db.close(); }
});
