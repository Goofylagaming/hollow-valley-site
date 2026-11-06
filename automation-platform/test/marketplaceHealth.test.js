'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {readMarketplaceHealth,MAX_ITEMS,MAX_PAYLOAD_BYTES,MAX_TOTAL_BYTES}=require('../src/services/marketplaceHealthService');
const AT=Date.parse('2026-11-06T01:02:03.123Z');
function fixture(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE economy_marketplace_catalog(id TEXT,item_type TEXT,name TEXT,price INTEGER,payload_json TEXT,active INTEGER)');return db;}
function insert(db,{id='private-id',name='PRIVATE NAME',type='dino',price=100,payload='{"species":"PRIVATE SPECIES"}',active=1}={}){db.prepare('INSERT INTO economy_marketplace_catalog VALUES(?,?,?,?,?,?)').run(id,type,name,price,payload,active);}
const read=db=>readMarketplaceHealth(db,{now:()=>AT});
test('an active catalog read contains only scoped observation metadata and performs no writes',t=>{
 const db=fixture(t);insert(db);const before=db.prepare('SELECT total_changes() n').get().n;db.exec('PRAGMA query_only=ON');assert.deepEqual(read(db),{version:1,scope:'official-catalog-read',code:'readable',observedAt:new Date(AT).toISOString(),checkoutVerified:false,fulfillmentVerified:false});assert.equal(db.prepare('SELECT total_changes() n').get().n,before);assert.doesNotMatch(JSON.stringify(read(db)),/PRIVATE|private-id|species|price/);
});
test('empty active catalogs remain distinct; inactive malformed records do not affect active reads',t=>{
 const db=fixture(t);assert.equal(read(db).code,'empty-catalog');insert(db,{active:0,payload:'bad'});assert.equal(read(db).code,'empty-catalog');insert(db,{id:'valid'});assert.equal(read(db).code,'readable');
});
test('malformed identity/price/payload records are never counted as readable',t=>{
 const db=fixture(t);for(const patch of [{id:''},{name:''},{type:''},{price:0},{price:-1},{price:1.5},{payload:'bad'},{payload:'[]'},{payload:'null'},{payload:'1'},{payload:'"text"'},{payload:''}]){db.exec('DELETE FROM economy_marketplace_catalog');insert(db,patch);assert.equal(read(db).code,'invalid-catalog',JSON.stringify(patch));}
});
test('missing tables and DB failures return no raw errors and never initialize schema',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());assert.equal(read(db).code,'unavailable');assert.equal(db.prepare("SELECT count(*) n FROM sqlite_master").get().n,0);assert.equal(read({prepare(){throw Error('PRIVATE token');}}).code,'unavailable');assert.doesNotMatch(JSON.stringify(read({prepare(){throw Error('PRIVATE token');}})),/PRIVATE|token/);
});
test('item, per-record and total payload limits bound source validation including multi-byte strings',t=>{
 const db=fixture(t);for(let i=0;i<=MAX_ITEMS;i++)insert(db,{id:String(i)});assert.equal(read(db).code,'catalog-too-large');db.exec('DELETE FROM economy_marketplace_catalog');insert(db,{payload:JSON.stringify({x:'ü'.repeat(MAX_PAYLOAD_BYTES/2)})});assert.equal(read(db).code,'catalog-too-large');db.exec('DELETE FROM economy_marketplace_catalog');const payload=JSON.stringify({x:'a'.repeat(MAX_PAYLOAD_BYTES-20)});for(let i=0;i<Math.ceil(MAX_TOTAL_BYTES/Buffer.byteLength(payload));i++)insert(db,{id:String(i),payload});assert.equal(read(db).code,'catalog-too-large');
});
test('invalid source clocks never acquire a guessed date or query the catalog',()=>{
 for(const at of [NaN,-1,1.1,Infinity,8640000000000001]){let queried=false;const value=readMarketplaceHealth({prepare(){queried=true;}},{now:()=>at});assert.equal(value.code,'unverified-clock');assert.equal(value.observedAt,null);assert.equal(queried,false);}
});
