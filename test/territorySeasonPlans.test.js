'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {createTerritorySeasonPlans}=require('../server/services/territorySeasonPlans');
const A={id:1,steamId:'76561198000000101'},B={id:2,steamId:'76561198000000102'},AT=Date.parse('2026-11-06T00:00:00Z');
function fixture(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT,is_admin INTEGER)');db.prepare('INSERT INTO users VALUES(1,?,1),(2,?,0)').run(A.steamId,B.steamId);let at=AT,enabled=true,readOnly=false;const service=createTerritorySeasonPlans(db,{now:()=>at,enabled:()=>enabled,readOnly:()=>readOnly,initialize:true});return {db,service,clock:value=>at=value,enable:value=>enabled=value,preview:value=>readOnly=value};}
const plan=(seasonId='season-one',startsAt=AT+3600000,endsAt=AT+7200000)=>({action:'save',seasonId,expectedRevision:0,name:'Season One',startsAt,endsAt});
test('disabled planning reads create no tables and require current linked staff',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT,is_admin INTEGER)');db.prepare('INSERT INTO users VALUES(1,?,1),(2,?,0)').run(A.steamId,B.steamId);
 const service=createTerritorySeasonPlans(db,{enabled:()=>false});assert.deepEqual(service.list(A),{available:false,seasons:[]});assert.throws(()=>service.list(B),{status:403});assert.throws(()=>createTerritorySeasonPlans(db,{enabled:()=>false,initialize:true}),{status:503});assert.equal(db.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name LIKE 'territory_season_%'").get().n,0);
});
test('review is non-mutating; exact confirmation, paused receipt recovery and altered retries retain one outcome',t=>{
 const f=fixture(t),offer=f.service.prepare(A,plan());assert.equal(f.db.prepare('SELECT COUNT(*) n FROM territory_season_plans').get().n,0);
 const saved=f.service.confirm(A,offer,'season_request_one');assert.equal(saved.receipt.definition.state,'planned');assert.equal(f.service.list(A).seasons[0].runtimeActivated,false);
 f.clock(AT+180000);f.enable(false);assert.deepEqual(f.service.confirm(A,offer,'season_request_one'),{receipt:saved.receipt,duplicate:true});assert.deepEqual(f.service.receipt(A,'season_request_one').receipt,saved.receipt);assert.equal(f.service.list(A).seasons[0].canEdit,false);
 assert.throws(()=>f.service.confirm(A,{...offer,review:{...offer.review,input:{...offer.review.input,name:'Changed'}}},'season_request_one'),{status:409});
 f.db.prepare('UPDATE users SET is_admin=1 WHERE id=2').run();assert.throws(()=>f.service.receipt(B,'season_request_one'),{status:404});f.db.exec('UPDATE users SET is_admin=0 WHERE id=1');assert.throws(()=>f.service.confirm(A,offer,'season_request_one'),{status:403});
});
test('overlaps, changed revisions, reused cancelled IDs and boundaries cannot rewrite a season',t=>{
 const f=fixture(t),first=f.service.prepare(A,plan()),racing=f.service.prepare(A,plan('season-two',AT+4000000,AT+8000000));f.service.confirm(A,first,'season_request_one');assert.throws(()=>f.service.confirm(A,racing,'season_request_two'),{status:409});
 const adjacent=f.service.prepare(A,plan('season-adjacent',AT+7200000,AT+9000000));f.service.confirm(A,adjacent,'season_request_adjacent');
 const cancel=f.service.prepare(A,{action:'cancel',seasonId:'season-one',expectedRevision:1});f.service.confirm(A,cancel,'season_cancel_one');assert.throws(()=>f.service.prepare(A,{...plan(),expectedRevision:2}),{status:409});
 const replacement=f.service.prepare(A,plan('season-replacement'));f.service.confirm(A,replacement,'season_replacement');f.clock(AT+3600000);
 assert.throws(()=>f.service.prepare(A,{action:'cancel',seasonId:'season-replacement',expectedRevision:1}),{status:409});assert.equal(f.service.list(A).seasons.find(row=>row.seasonId==='season-replacement').canEdit,false);
});
test('expired or revoked reviews cannot save and audit failures roll back definitions',t=>{
 const f=fixture(t),offer=f.service.prepare(A,plan());f.clock(AT+120000);assert.throws(()=>f.service.confirm(A,offer,'expired_review'),{status:409});f.clock(AT);f.db.exec("CREATE TRIGGER fail_season_audit BEFORE INSERT ON territory_season_plan_edits BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END");assert.throws(()=>f.service.confirm(A,offer,'season_request_one'),/fixture audit failure/);assert.equal(f.service.list(A).seasons.length,0);f.db.exec('DROP TRIGGER fail_season_audit');f.service.confirm(A,offer,'season_request_one');
 const update=f.service.prepare(A,{...plan(),name:'Revised name',expectedRevision:1});f.db.exec("CREATE TRIGGER fail_season_audit BEFORE INSERT ON territory_season_plan_edits BEGIN SELECT RAISE(ABORT,'fixture update failure'); END");assert.throws(()=>f.service.confirm(A,update,'season_update_one'),/fixture update failure/);assert.equal(f.service.list(A).seasons[0].name,'Season One');
 f.db.prepare('UPDATE users SET steam_id=? WHERE id=1').run(B.steamId);assert.throws(()=>f.service.confirm(A,update,'season_update_one'),{status:403});
});
test('query-only history and receipts never activate runtime; inconsistent saved state is withheld',t=>{
 const f=fixture(t),offer=f.service.prepare(A,plan());f.service.confirm(A,offer,'season_request_one');f.preview(true);const before=f.db.prepare('SELECT total_changes() n').get().n;f.db.exec('PRAGMA query_only=ON');assert.equal(f.service.list(A).seasons[0].canEdit,false);assert.equal(f.service.receipt(A,'season_request_one').receipt.definition.revision,1);assert.throws(()=>f.service.confirm(A,offer,'season_request_one'),{status:403});assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);f.db.exec("PRAGMA query_only=OFF;UPDATE territory_season_plans SET definition_json='{}'");assert.throws(()=>f.service.list(A),{status:503});
});
