'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{createHash,randomUUID}=require('node:crypto');
const {createReportContextReader}=require('../server/services/reportContext');
const AT=Date.parse('2026-11-06T01:00:00.000Z'),iso=at=>new Date(at).toISOString(),A='76561198000000001',B='76561198000000002',MOD='76561198000000003';
function context(at=AT-60000){return {version:1,scope:'report-participant-context',reportedTime:iso(at),windowStart:iso(at-900000),windowEnd:iso(AT),associationOnly:true,complete:false,retainedChatLimit:500,combat:{available:true,truncated:false,events:[{id:'event-1',at:iso(at),attacker:'reported',victim:'reporter',otherPlayerIdentityWithheld:true,location:'PRIVATE'}]},chat:{available:true,truncated:false,messages:[{id:'chat-1',at:iso(at),participant:'reporter',channel:'global',text:'literal <script>',redacted:false,digest:createHash('sha256').update('literal <script>').digest('hex'),steamId:'PRIVATE'}]},rawSecret:'PRIVATE'};}
function fixture(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT,is_admin INTEGER);CREATE TABLE player_reports(id TEXT PRIMARY KEY,reporter_steam_id TEXT,reported_steam_id TEXT,occurred_at TEXT)');db.prepare('INSERT INTO users VALUES(3,?,1),(4,?,1),(5,?,0)').run(MOD,'76561198000000004','76561198000000005');const id=randomUUID();db.prepare('INSERT INTO player_reports VALUES(?,?,?,?)').run(id,A,B,iso(AT-60000));let user={id:3,steam_id:MOD,is_admin:true},calls=0,fetcher=async()=>context(),enabled=true;const reader=createReportContextReader({db,now:()=>AT,enabled:()=>enabled,fetchContext:async args=>{calls++;return fetcher(args);}});return {db,id,reader,getUser:()=>user,user:value=>{user=value;},fetch:value=>{fetcher=value;},enable:value=>{enabled=value;},calls:()=>calls,binding:'3:'+MOD};}
test('current DB permission and exact reviewer binding are required before any private source query',async t=>{
 const f=fixture(t);assert.equal(f.reader.capabilities(f.getUser).enabled,true);await assert.rejects(f.reader.read(f.getUser,f.id,'other'),e=>e.status===403);f.db.exec('UPDATE users SET is_admin=0 WHERE id=3');await assert.rejects(f.reader.read(f.getUser,f.id,f.binding),e=>e.status===403);assert.equal(f.calls(),0);
});
test('only saved participants/time reach the source; privacy projection is read-only and report-bound',async t=>{
 const f=fixture(t);let args;f.fetch(async input=>{args=input;return context();});const before=f.db.prepare('SELECT total_changes() n').get().n;f.db.exec('PRAGMA query_only=ON');const value=await f.reader.read(f.getUser,f.id,f.binding);assert.deepEqual(args,{reporterSteamId:A,reportedSteamId:B,occurredAt:iso(AT-60000)});assert.equal(value.reportId,f.id);assert.equal(value.reviewerBinding,f.binding);assert.equal(value.context.associationOnly,true);assert.equal(value.context.complete,false);assert.equal(value.context.chat.messages[0].text,'literal <script>');assert.doesNotMatch(JSON.stringify(value),/PRIVATE|location|rawSecret/);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);
});
test('missing/old report times and disabled rollout never fall back to creation or current times',async t=>{
 const f=fixture(t);f.db.prepare('UPDATE player_reports SET occurred_at=NULL WHERE id=?').run(f.id);assert.equal((await f.reader.read(f.getUser,f.id,f.binding)).reason,'time-required');f.db.prepare('UPDATE player_reports SET occurred_at=? WHERE id=?').run(iso(AT-91*86400000),f.id);assert.equal((await f.reader.read(f.getUser,f.id,f.binding)).reason,'time-outside-source-window');f.enable(false);await assert.rejects(f.reader.read(f.getUser,f.id,f.binding),e=>e.status===503);assert.equal(f.calls(),0);
});
test('role revocation, switched accounts, changed reports and paused rollout suppress held source replies',async t=>{
 for(const change of [f=>f.db.exec('UPDATE users SET is_admin=0 WHERE id=3'),f=>f.user({id:4,steam_id:'76561198000000004',is_admin:true}),f=>f.db.prepare('UPDATE player_reports SET reported_steam_id=NULL WHERE id=?').run(f.id),f=>f.enable(false)]){
  const f=fixture(t);let resolve;f.fetch(()=>new Promise(r=>{resolve=r;}));const pending=f.reader.read(f.getUser,f.id,f.binding);change(f);resolve(context());await assert.rejects(pending,e=>[403,409,503].includes(e.status));
 }
});
test('malformed, enlarged, future, duplicate or overclaimed source results fail closed',async t=>{
 for(const patch of [raw=>{raw.complete=true;},raw=>{raw.associationOnly=false;},raw=>{raw.reportedTime=iso(AT);},raw=>{raw.windowStart=iso(AT-86400000);},raw=>{raw.windowEnd=iso(AT+1);},raw=>{raw.combat.events[0].attacker='outsider';},raw=>{raw.combat.events.push({...raw.combat.events[0]});},raw=>{raw.chat.messages[0].digest='0'.repeat(64);},raw=>{raw.chat.messages[0].participant='outsider';},raw=>{raw.chat.messages[0].at=iso(AT+1);},raw=>{raw.chat.messages=Array(51).fill(raw.chat.messages[0]);}]){const f=fixture(t);f.fetch(async()=>{const raw=context();patch(raw);return raw;});await assert.rejects(f.reader.read(f.getUser,f.id,f.binding),e=>e.status===502);}
});
test('transport errors never expose raw details and permissions are rechecked after failure',async t=>{
 const f=fixture(t);f.fetch(async()=>{throw Error('PRIVATE token');});await assert.rejects(f.reader.read(f.getUser,f.id,f.binding),e=>e.status===502&&!/PRIVATE/.test(e.message));f.fetch(async()=>{f.db.exec('UPDATE users SET is_admin=0 WHERE id=3');throw Error('PRIVATE');});await assert.rejects(f.reader.read(f.getUser,f.id,f.binding),e=>e.status===403);
});
test('a report without an accused player cannot acquire reported-player source roles',async t=>{
 const f=fixture(t);f.db.prepare('UPDATE player_reports SET reported_steam_id=NULL WHERE id=?').run(f.id);await assert.rejects(f.reader.read(f.getUser,f.id,f.binding),e=>e.status===502);
});

test('website projection marks its own credential masking without inventing a clean-source digest',async t=>{
 const f=fixture(t),text='literal <b> token=PRIVATE_SECRET';const digest=createHash('sha256').update(text).digest('hex');f.fetch(async()=>{const raw=context();raw.chat.messages[0]={...raw.chat.messages[0],text,digest,redacted:false};return raw;});const value=await f.reader.read(f.getUser,f.id,f.binding);const message=value.context.chat.messages[0];assert.equal(message.redacted,true);assert.equal(message.digest,digest);assert.match(message.text,/literal <b>/);assert.doesNotMatch(message.text,/PRIVATE_SECRET/);
});
