'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {createBattleProvenance}=require('../server/services/territoryBattleProvenance');
const {createTerritoryBattleContext}=require('../server/services/territoryBattleContext');
function fixture(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec("CREATE TABLE territory_events(id INTEGER PRIMARY KEY,territory_key TEXT,territory_name TEXT);INSERT INTO territory_events VALUES(1,'south-plains','South Plains')");let enabled=false;return {db,battle:createBattleProvenance(db,{seasonEvidenceEnabled:()=>enabled}),context:createTerritoryBattleContext(db,{enabled:()=>enabled}),enable:()=>enabled=true};}
test('disabled declarations create no season table; enabling never backfills old battles',t=>{
 const f=fixture(t);f.battle.begin(1,1,100);assert.equal(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='territory_battle_context'").get(),undefined);
 f.enable();f.battle.begin(1,1,100);assert.deepEqual(f.context.read(1),{available:false,reason:'not-recorded'});
 f.battle.begin(2,1,200);assert.equal(f.context.read(2).territory.key,'south-plains');
 f.db.exec("UPDATE territory_events SET territory_key='highlands',territory_name='Highlands'");
 f.battle.begin(2,1,200);assert.equal(f.context.read(2).territory.key,'south-plains');f.battle.begin(3,1,300);assert.equal(f.context.read(3).territory.key,'highlands');
 f.db.exec('DELETE FROM territory_events');assert.equal(f.context.read(2).territory.name,'South Plains');assert.deepEqual(f.context.read(1),{available:false,reason:'not-recorded'});
});
test('missing or invalid event metadata remains explicitly unknown across later repairs',t=>{
 const f=fixture(t);f.enable();f.battle.begin(1,9,100);assert.equal(f.context.read(1).reason,'unknown-territory');
 f.db.exec("INSERT INTO territory_events VALUES(9,'known-later','Later');UPDATE territory_events SET territory_key='invalid key' WHERE id=1");f.battle.begin(1,9,100);assert.equal(f.context.read(1).territory,null);
 f.battle.begin(2,1,200);assert.equal(f.context.read(2).reason,'unknown-territory');f.db.exec("UPDATE territory_events SET territory_key='south-plains' WHERE id=1");assert.equal(f.context.read(2).territory,null);
});
test('context and declaration share rollback, including first-time schema creation',t=>{
 const f=fixture(t);f.enable();f.db.exec('BEGIN');f.battle.begin(1,1,100);assert.equal(f.context.read(1).available,true);f.db.exec('ROLLBACK');assert.equal(f.battle.read(1),null);assert.deepEqual(f.context.read(1),{available:false,reason:'not-recorded'});
 f.battle.begin(1,1,100);f.db.exec("CREATE TRIGGER fail_context BEFORE INSERT ON territory_battle_context BEGIN SELECT RAISE(ABORT,'fixture context failure'); END");assert.throws(()=>f.battle.begin(2,1,200),/fixture context failure/);assert.equal(f.battle.read(2),null);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM hv_group_battle_identity WHERE attack_id=2').get().n,0);f.db.exec('DROP TRIGGER fail_context');f.battle.begin(2,1,200);assert.equal(f.context.read(2).available,true);
});
test('read-only snapshots survive restarts and contradictory stored context is withheld',t=>{
 const f=fixture(t);f.enable();f.battle.begin(1,1,100);const before=f.db.prepare('SELECT total_changes() n').get().n;f.db.exec('PRAGMA query_only=ON');assert.equal(createTerritoryBattleContext(f.db).read(1).territory.name,'South Plains');assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);f.db.exec('PRAGMA query_only=OFF');
 f.db.exec("UPDATE territory_battle_context SET snapshot_json='{}'");assert.throws(()=>f.context.read(1),{status:503});assert.throws(()=>f.context.read('1'),{status:400});
});
