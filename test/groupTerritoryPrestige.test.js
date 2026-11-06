'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const {createGroupTerritoryPrestige,POLICY_DIGEST}=require('../server/services/groupTerritoryPrestige');
const AT=Date.parse('2026-11-06T00:00:00Z'),A='76561198000000101',B='76561198000000102',C='76561198000000103';
function fixture(t,{initialize=true}={}){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(`CREATE TABLE hv_groups(id INTEGER PRIMARY KEY,name TEXT,owner_steam_id TEXT,status TEXT);CREATE TABLE hv_group_members(group_id INTEGER,steam_id TEXT);CREATE TABLE hv_group_treasury_closures(group_id INTEGER,state TEXT);
 CREATE TABLE hv_group_battle_identity(attack_id INTEGER,side TEXT,territory_group_id INTEGER,group_id INTEGER,link_revision INTEGER,PRIMARY KEY(attack_id,side));CREATE TABLE territory_battle_provenance(attack_id INTEGER PRIMARY KEY,event_id INTEGER,started_at INTEGER,live_observed INTEGER,disqualified_reason TEXT,closed_at INTEGER,outcome TEXT);CREATE TABLE territory_battle_sample_clock(attack_id INTEGER PRIMARY KEY,verified INTEGER);CREATE TABLE territory_battle_winners(attack_id INTEGER,steam_id TEXT,PRIMARY KEY(attack_id,steam_id));`);
 db.prepare('INSERT INTO hv_groups VALUES(1,?,?,?),(2,?,?,?)').run('Group A',A,'active','Group B',C,'active');db.prepare('INSERT INTO hv_group_members VALUES(1,?),(1,?),(2,?)').run(A,B,C);
 let enabled=true,reviewed=true,preview=false,now=AT;
 const service=createGroupTerritoryPrestige(db,{initialize,now:()=>now,enabled:()=>enabled,policyDigest:()=>reviewed?POLICY_DIGEST:'',readOnly:()=>preview});
 function battle(id,{group=1,side='attacker',outcome='capture',live=1,clock=1,reason=null,resolved=AT-1000,winner=true}={}){db.prepare('INSERT INTO territory_battle_provenance VALUES(?,1,?, ?,?,?,?)').run(id,AT-2000,live,reason,resolved,outcome);db.prepare('INSERT INTO hv_group_battle_identity VALUES(?,?,10,?,1)').run(id,side,group);if(clock!==null)db.prepare('INSERT INTO territory_battle_sample_clock VALUES(?,?)').run(id,clock);if(winner)db.prepare('INSERT INTO territory_battle_winners VALUES(?,?)').run(id,A);}
 const input=(choice='pioneer-standard')=>{const state=service.read(A);return {expectedGroupId:1,choice,expectedRevision:state.selection.revision,expectedProof:state.evidence.proof,expectedPolicy:state.policyDigest,requestId:randomUUID()};};
 return {db,service,battle,input,pause:()=>{enabled=false;},policy:value=>{reviewed=value;},preview:value=>{preview=value;},clock:value=>{now=value;}};
}
test('prestige eligibility uses all timestamp-verified frozen captures, excluding untrusted and future results',t=>{
 const f=fixture(t);for(let i=1;i<=55;i++)f.battle(i);f.battle(56,{clock:0});f.battle(57,{clock:null});f.battle(58,{reason:'testing'});f.battle(59,{live:0});f.battle(60,{reason:'manual'});f.battle(61,{resolved:AT+1});f.battle(62,{outcome:'defence'});f.battle(63,{side:'defender',outcome:'defence'});f.battle(64);f.db.exec("INSERT INTO hv_group_battle_identity VALUES(64,'defender',11,1,1)");f.battle(65,{winner:false});
 const before=f.db.prepare('SELECT total_changes() n').get().n;f.db.exec('PRAGMA query_only=ON');const result=f.service.read(A);
 assert.deepEqual(result.evidence.totals,{battles:57,captures:55,wins:56,losses:1});assert.equal(result.choices.find(row=>row.id==='crown-standard').eligible,true);assert.equal(result.gameplayBenefits,false);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);assert.doesNotMatch(JSON.stringify(result),new RegExp(A+'|'+B+'|steam|location|coordinates'));
});
test('owner selection is atomic, group/revision/proof bound and exactly retryable without coins or game actions',t=>{
 const f=fixture(t);f.battle(1);const request=f.input();assert.throws(()=>f.service.select(B,request),{status:403});assert.throws(()=>f.service.select(C,request),{status:409});assert.throws(()=>f.service.select(A,{...request,choice:'crown-standard'}),{status:409});
 const saved=f.service.select(A,request);assert.equal(saved.receipt.choice,'pioneer-standard');assert.equal(f.service.select(A,request).duplicate,true);assert.deepEqual(f.service.receipt(A,{requestId:request.requestId}).receipt,saved.receipt);assert.throws(()=>f.service.receipt(B,{requestId:request.requestId}),{status:404});assert.equal(f.service.read(A).effectiveChoice,'pioneer-standard');assert.throws(()=>f.service.select(A,{...request,choice:'none'}),{status:409});
 const stale=f.input('none');f.battle(2);assert.throws(()=>f.service.select(A,{...f.input(),expectedProof:request.expectedProof}),{status:409});assert.equal(f.service.select(A,stale).receipt.choice,'none');
});
test('source withdrawals and policy pause withhold appearance without deleting the saved cosmetic choice',t=>{
 const f=fixture(t);f.battle(1);f.service.select(A,f.input());f.db.exec("UPDATE territory_battle_provenance SET disqualified_reason='manual' WHERE attack_id=1");let state=f.service.read(A);assert.equal(state.selection.choice,'pioneer-standard');assert.equal(state.effectiveChoice,'none');
 f.db.exec('UPDATE territory_battle_provenance SET disqualified_reason=NULL WHERE attack_id=1');f.policy(false);assert.equal(f.service.read(A).effectiveChoice,'none');assert.throws(()=>f.service.select(A,f.input()),{status:503});f.policy(true);f.pause();assert.equal(f.service.read(A).effectiveChoice,'none');assert.equal(f.service.select(A,f.input('none')).receipt.choice,'none');
});
test('missing evidence is unknown, while known zero and uninitialized preview remain distinct without schema writes',t=>{
 const f=fixture(t,{initialize:false});const before=f.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n;f.db.exec('PRAGMA query_only=ON');let state=f.service.read(A);assert.equal(state.selection.available,false);assert.equal(state.evidence.available,true);assert.equal(state.evidence.totals.captures,0);assert.equal(f.db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='table'").get().n,before);f.db.exec('PRAGMA query_only=OFF;DROP TABLE territory_battle_sample_clock');state=f.service.read(A);assert.equal(state.evidence.available,false);assert.equal(state.evidence.totals,null);
});
test('failed audit rolls back choices, and ownership/closure changes block stale group edits',t=>{
 const f=fixture(t);f.battle(1);const request=f.input();f.db.exec("CREATE TRIGGER reject_prestige BEFORE INSERT ON hv_group_territory_prestige_edits BEGIN SELECT RAISE(ABORT,'synthetic prestige audit failure'); END");assert.throws(()=>f.service.select(A,request),/synthetic prestige audit failure/);assert.equal(f.service.read(A).selection.revision,0);f.db.exec('DROP TRIGGER reject_prestige');f.db.prepare('UPDATE hv_groups SET owner_steam_id=? WHERE id=1').run(B);assert.throws(()=>f.service.select(A,request),{status:403});f.db.exec("INSERT INTO hv_group_treasury_closures VALUES(1,'checking')");assert.throws(()=>f.service.select(B,request),{status:403});f.db.exec('DELETE FROM hv_group_treasury_closures');assert.equal(f.service.select(B,request).duplicate,false);
});
test('read-only and policy gates cannot prepare storage, and corrupted saved evidence fails closed',t=>{
 const f=fixture(t);f.battle(1);const request=f.input();f.preview(true);assert.throws(()=>f.service.select(A,request),{status:403});f.preview(false);f.service.select(A,request);f.db.exec('UPDATE hv_group_territory_prestige SET revision=5 WHERE group_id=1');assert.throws(()=>f.service.read(A),{status:503});assert.throws(()=>createGroupTerritoryPrestige(f.db,{initialize:true,enabled:()=>false}),{status:503});
});

test('actual battle provenance supplies frozen group and winning-participant evidence without backfilling later links',t=>{
 const f=fixture(t);f.db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT);CREATE TABLE territory_groups(id INTEGER PRIMARY KEY,leader_user_id INTEGER);CREATE TABLE hv_group_territory_links(group_id INTEGER,territory_group_id INTEGER,revision INTEGER)');f.db.prepare('INSERT INTO users VALUES(1,?)').run(A);f.db.exec('INSERT INTO territory_groups VALUES(10,1);INSERT INTO hv_group_territory_links VALUES(1,10,1)');
 const battle=require('../server/services/territoryBattleProvenance').createBattleProvenance(f.db);battle.begin(1,9,AT-2000,{attackerGroupId:10});battle.observe(1,{usable:true,sampledAt:AT-1000,participants:[{steamId:A,side:'attacker'}]},AT-1000);battle.finish(1,AT-500,'capture');
 assert.equal(f.service.read(A).evidence.totals.captures,1);f.service.select(A,f.input());f.db.exec('UPDATE hv_group_territory_links SET group_id=2,revision=2');assert.equal(f.service.read(A).effectiveChoice,'pioneer-standard');assert.equal(f.service.read(C).evidence.totals.captures,0);
 f.db.exec('UPDATE territory_battle_sample_clock SET verified=0 WHERE attack_id=1');assert.equal(f.service.read(A).effectiveChoice,'none');
});

test('public-boundary authorization runs inside the choice transaction and rolls back on rejection',t=>{
 const f=fixture(t);f.battle(1);const request=f.input();assert.throws(()=>f.service.select(A,request,{authorize:()=>{f.db.prepare('UPDATE hv_groups SET owner_steam_id=? WHERE id=1').run(B);throw Object.assign(Error('Synthetic account rejection'),{status:403});}}),{status:403});assert.equal(f.db.prepare('SELECT owner_steam_id FROM hv_groups WHERE id=1').get().owner_steam_id,A);assert.equal(f.service.read(A).selection.revision,0);
});
