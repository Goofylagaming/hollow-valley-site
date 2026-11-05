"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {initializeSkinOwnershipSource,skinOwnershipInfrastructure,deriveSkinOwnershipSource}=require('../src/services/skinOwnershipSource');
const A='76561198000000401',B='76561198000000402';
function fixture(t,{initialize=true}={}) {
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(`CREATE TABLE economy_skin_presets(id TEXT PRIMARY KEY,owner_steam_id TEXT,active INTEGER,name TEXT);
    CREATE TABLE economy_skin_unlocks(steam_id TEXT,preset_id TEXT,PRIMARY KEY(steam_id,preset_id));
    CREATE TABLE economy_skin_grants(steam_id TEXT,preset_id TEXT,revoked_at TEXT,PRIMARY KEY(steam_id,preset_id));`);
  if(initialize)initializeSkinOwnershipSource(db);
  const preset=(id,owner=null,active=1)=>db.prepare('INSERT INTO economy_skin_presets VALUES(?,?,?,?)').run(id,owner,active,'Synthetic');
  const unlock=id=>db.prepare('INSERT INTO economy_skin_unlocks VALUES(?,?)').run(A,id);
  const grant=(id,revoked=null)=>db.prepare('INSERT INTO economy_skin_grants VALUES(?,?,?)').run(A,id,revoked);
  return {db,preset,unlock,grant,source:()=>deriveSkinOwnershipSource(db,A)};
}
test('ten distinct active personal entitlements create one original crossing; catalog access, inactive/revoked paths and duplicates do not',t=>{
  const f=fixture(t);assert.equal(skinOwnershipInfrastructure(f.db),true);
  for(let i=0;i<9;i++)f.preset('owned-'+i,A);
  f.preset('inactive',A,0);f.preset('catalog',B);f.preset('revoked',B);f.grant('revoked','old');
  f.unlock('owned-0');f.grant('owned-0');assert.equal(f.source(),null);
  const before=Date.now();f.grant('catalog');const first=f.source();
  assert.ok(first.sourceAt>=before-1000 && first.sourceAt<=Date.now()+1000);assert.equal(first.evidence.before,9);assert.equal(first.evidence.after,10);
  assert.equal(first.evidence.entries.length,10);assert.equal(first.evidence.entries.find(x=>x.id==='owned-0').purchase,1);
  f.db.prepare('UPDATE economy_skin_grants SET revoked_at=? WHERE preset_id=?').run('later','catalog');
  assert.deepEqual(f.source(),first,'legitimate later revocation does not erase historical ownership');
  f.db.prepare('UPDATE economy_skin_grants SET revoked_at=NULL WHERE preset_id=?').run('catalog');
  f.preset('later',A);assert.deepEqual(f.source(),first,'later crossings/skins do not move the first clock');
});
test('initialization never dates legacy qualification or overwrites its baseline when restarted',t=>{
  const f=fixture(t,{initialize:false});for(let i=0;i<10;i++)f.preset('legacy-'+i,A);
  initializeSkinOwnershipSource(f.db);assert.equal(f.source(),null);
  f.db.exec("UPDATE economy_skin_presets SET active=0 WHERE id='legacy-0';UPDATE economy_skin_presets SET active=1 WHERE id='legacy-0'");
  initializeSkinOwnershipSource(f.db);assert.equal(f.source(),null);
  assert.equal(f.db.prepare('SELECT qualified FROM progression_skin_ownership_state WHERE steam_id=?').get(A).qualified,1);
});
test('activation and owner transfer use distinct current entitlement counts; cosmetic edits do not redate evidence',t=>{
  const f=fixture(t);for(let i=0;i<9;i++)f.preset('mine-'+i,A);f.preset('activate',null,0);f.unlock('activate');assert.equal(f.source(),null);
  f.db.exec("UPDATE economy_skin_presets SET active=1 WHERE id='activate'");const first=f.source();assert.ok(first);
  f.db.exec("UPDATE economy_skin_presets SET name='New label';UPDATE economy_skin_presets SET owner_steam_id='76561198000000402' WHERE id='mine-0'");
  assert.deepEqual(f.source(),first);
  assert.equal(f.db.prepare('SELECT owned_count FROM progression_skin_ownership_state WHERE steam_id=?').get(A).owned_count,9);
  f.db.exec("DELETE FROM economy_skin_unlocks WHERE preset_id='activate'");assert.deepEqual(f.source(),first);
});
test('audit failure rolls back the entitlement mutation, and an outer rollback removes the crossing and count changes',t=>{
  const f=fixture(t);for(let i=0;i<9;i++)f.preset('mine-'+i,A);
  f.db.exec("CREATE TRIGGER refuse_crossing BEFORE INSERT ON progression_skin_ownership_sources BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.throws(()=>f.preset('tenth',A),/audit unavailable/);assert.equal(f.db.prepare("SELECT id FROM economy_skin_presets WHERE id='tenth'").get(),undefined);assert.equal(f.source(),null);
  f.db.exec('DROP TRIGGER refuse_crossing;BEGIN IMMEDIATE');f.preset('tenth',A);assert.ok(f.source());f.db.exec('ROLLBACK');assert.equal(f.source(),null);
  f.preset('tenth',A);assert.ok(f.source());
});
test('missing hooks, inconsistent counts and malformed evidence withhold source timing without read-time repair',t=>{
  const f=fixture(t);for(let i=0;i<10;i++)f.preset('mine-'+i,A);assert.ok(f.source());
  const changes=()=>f.db.prepare('SELECT total_changes() n').get().n;
  const original=f.db.prepare('SELECT evidence_json FROM progression_skin_ownership_sources').get().evidence_json;
  for(const evidence of ['{}','[]','x',JSON.stringify(Array(10).fill({id:'duplicate',owner:1,purchase:0,personalGrant:0}))]){
    f.db.prepare('UPDATE progression_skin_ownership_sources SET evidence_json=?').run(evidence);const n=changes();assert.equal(f.source(),null);assert.equal(changes(),n);
  }
  f.db.prepare('UPDATE progression_skin_ownership_sources SET evidence_json=?').run(original);
  f.db.exec('UPDATE progression_skin_ownership_state SET owned_count=11');assert.equal(f.source(),null);
  f.db.exec('UPDATE progression_skin_ownership_state SET owned_count=10;DROP TRIGGER progression_skin_grants_insert');assert.equal(f.source(),null);assert.equal(skinOwnershipInfrastructure(f.db),false);
  assert.throws(()=>initializeSkinOwnershipSource(f.db),/collection gap/,'startup cannot silently repair a gap and invent a later crossing');
});
