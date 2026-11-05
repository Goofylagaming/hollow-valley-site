'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const {createIncidentMarketplaceSource}=require('../src/services/incidentMarketplaceService');
const AT=Date.parse('2026-11-06T00:00:00.000Z'),iso=value=>new Date(value).toISOString(),PLAYER='76561198000000001',OTHER='76561198000000002';
function fixture(t){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE economy_marketplace_orders(id TEXT,steam_id TEXT,created_at TEXT,updated_at TEXT,fulfilled_at TEXT,status TEXT,fulfillment_json TEXT,error TEXT);CREATE TABLE economy_wallets(steam_id TEXT,balance INTEGER);INSERT INTO economy_wallets VALUES(\'76561198000000001\',123)');
 const insert=(values={})=>{const row={id:randomUUID(),steam_id:PLAYER,created_at:iso(AT-60000),updated_at:iso(AT-30000),fulfilled_at:iso(AT-10000),status:'fulfilled',fulfillment_json:'PRIVATE command and restore JSON',error:'PRIVATE credential',...values};db.prepare('INSERT INTO economy_marketplace_orders VALUES(?,?,?,?,?,?,?,?)').run(...Object.values(row));return row;};
 let enabled=true;const source=createIncidentMarketplaceSource({db,now:()=>AT,enabled:()=>enabled}),input={steamId:PLAYER,occurredAt:iso(AT-60000)};
 return {db,insert,input,source,enable:value=>{enabled=value;}};
}
test('official order timestamp reads are exact-player scoped, UTC-normalized and read-only, without payloads or wallet changes',t=>{
 const f=fixture(t),row=f.insert({created_at:'2026-11-05 23:59:00',updated_at:'2026-11-05 23:59:30',fulfilled_at:'2026-11-05 23:59:50'});f.insert({steam_id:OTHER});f.insert({created_at:iso(AT-1000000),updated_at:iso(AT-1000000),fulfilled_at:null});
 const before=f.db.prepare('SELECT total_changes() n').get().n;f.db.exec('PRAGMA query_only=ON');const result=f.source.read(f.input);
 assert.equal(result.events.length,3);assert.deepEqual(result.events.map(row=>row.kind),['fulfillment-timestamp','latest-update','created']);assert.equal(result.events.every(event=>event.orderId===row.id),true);assert.equal(result.events[0].at,iso(AT-10000));assert.equal(result.events[0].status,'recorded');assert.equal(result.events[1].status,'fulfilled');assert.equal(result.events[2].status,'recorded');assert.equal(result.gameDeliveryVerified,false);assert.equal(result.complete,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|fulfillment_json|credential|balance/);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.db.prepare('SELECT balance FROM economy_wallets').get().balance,123);
});
test('creation timestamps do not retroactively claim a later stored status or fulfillment',t=>{
 const f=fixture(t);f.insert({updated_at:iso(AT+1),fulfilled_at:iso(AT+1),status:'fulfilled'});const result=f.source.read(f.input);assert.deepEqual(result.events.map(row=>[row.kind,row.status]),[['created','recorded']]);
});
test('invalid or disabled queries never initialize schema, and missing storage cannot manufacture an empty success',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let enabled=false;const source=createIncidentMarketplaceSource({db,now:()=>AT,enabled:()=>enabled}),input={steamId:PLAYER,occurredAt:iso(AT)};
 assert.throws(()=>source.read(input),{status:503});enabled=true;
 for(const bad of [{...input,steamId:[PLAYER]},{...input,occurredAt:'2026-11-06 00:00:00'},{...input,occurredAt:iso(AT-91*86400000)},{...input,occurredAt:iso(AT+900001)},{...input,limit:500},{...input,steamId:PLAYER+"' OR 1=1"}])assert.throws(()=>source.read(bad),{status:400});
 assert.throws(()=>source.read(input));assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n,0);
});
test('order events are bounded and malformed timestamps are withheld; unknown stored statuses are explicit',t=>{
 const f=fixture(t);for(let i=0;i<30;i++)f.insert();let result=f.source.read(f.input);assert.equal(result.events.length,50);assert.equal(result.truncated,true);
 f.db.exec('DELETE FROM economy_marketplace_orders');f.insert({status:'PRIVATE unexpected'});result=f.source.read(f.input);assert.equal(result.events.find(row=>row.kind==='latest-update').status,'unknown');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 f.db.exec('DELETE FROM economy_marketplace_orders');f.insert({id:'bad-private-id'});result=f.source.read(f.input);assert.deepEqual(result.events,[]);assert.equal(result.truncated,true);
});
