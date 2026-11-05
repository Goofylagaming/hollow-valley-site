'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {DatabaseSync} = require('node:sqlite');
const {createHash} = require('node:crypto');
const {createIncidentPlayerContext} = require('../server/services/incidentPlayerContext');
const AT = Date.parse('2026-11-06T00:00:00.000Z'), iso = value => new Date(value).toISOString();
const PLAYER = '76561198000000001', OTHER = '76561198000000002', MOD = '76561198000000003';
function fixture(t) {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT,is_admin INTEGER)');
  db.prepare('INSERT INTO users VALUES(3,?,1),(4,?,1),(1,?,0)').run(MOD,OTHER,PLAYER);
  let user = {id:3,steam_id:MOD}, enabled = true, clock = AT;
  const calls = [], text = 'Recorded <img src=x> statement.';
  const raw = {version:1,scope:'report-participant-context',reportedTime:iso(AT-60000),windowStart:iso(AT-960000),windowEnd:iso(AT),associationOnly:true,complete:false,retainedChatLimit:500,
    combat:{available:true,truncated:false,events:[{id:'combat-one',at:iso(AT-30000),attacker:null,victim:'reporter',otherPlayerIdentityWithheld:true,location:'PRIVATE'}]},
    chat:{available:true,truncated:false,messages:[{id:'chat-one',at:iso(AT-20000),participant:'reporter',channel:'global',text,redacted:false,digest:createHash('sha256').update(text).digest('hex'),otherSteamId:OTHER}]}};
  const audit = {id:'audit-one',created_at:iso(AT-50000),category:'operator',action:'inspect',status:'succeeded',message:'PRIVATE',details:{steamId:PLAYER,actorSteamId:MOD,payload:'PRIVATE'}};
  const request = {id:'request-one',updated_at:iso(AT-40000),steam_id:PLAYER,kind:'stored',status:'completed',rawError:'PRIVATE'};
  const automation = {
    getAdminAudit: async args => {calls.push(['audit',args]);return {audit:[audit]};},
    getAdminRequests: async args => {calls.push(['requests',args]);return {requests:[request]};},
    getAdminReportContext: async args => {calls.push(['context',args]);return raw;},
  };
  const reader = createIncidentPlayerContext({db,automation,enabled:()=>enabled,now:()=>clock});
  const input = {steamId:PLAYER,occurredAt:iso(AT-60000)}, binding = '3:'+MOD;
  return {db,reader,automation,raw,audit,request,calls,input,binding,getUser:()=>user,user:value=>{user=value;},enable:value=>{enabled=value;},time:value=>{clock=value;},read:()=>reader.read(()=>user,binding,input)};
}

test('one player/time window merges four read-only sources without forwarding raw details or third-party game identities',async t=>{
  const f=fixture(t);f.db.exec('PRAGMA query_only=ON');const before=f.db.prepare('SELECT total_changes() n').get().n;
  const result=await f.read();assert.deepEqual(result.events.map(row=>row.source),['chat','combat','request','audit']);
  assert.equal(result.associationOnly,true);assert.equal(result.complete,false);assert.deepEqual(result.partialSources,[]);
  assert.equal(result.events[0].text,'Recorded <img src=x> statement.');assert.equal(result.events[1].playerRole,'victim');
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|location|otherSteamId|payload|rawError/);
  assert.deepEqual(f.calls,[['audit',{limit:200}],['requests',{limit:100}],['context',{reporterSteamId:PLAYER,reportedSteamId:null,occurredAt:f.input.occurredAt}]]);
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table'").get().n,1);
});

test('disabled, wrong-role/account/binding and invalid queries are rejected before any source read',async t=>{
  const f=fixture(t);f.enable(false);await assert.rejects(f.read(),{status:503});f.enable(true);
  for(const input of [{...f.input,steamId:PLAYER+'x'},{...f.input,occurredAt:'2026-11-06'}, {...f.input,occurredAt:iso(AT-91*86400000)},{...f.input,occurredAt:iso(AT+900001)},{...f.input,steamId:[PLAYER]}, {...f.input,reportedSteamId:OTHER}])await assert.rejects(f.reader.read(f.getUser,f.binding,input),{status:400});
  for(const binding of [undefined,null,'4:'+OTHER])await assert.rejects(f.reader.read(f.getUser,binding,f.input),{status:403});
  f.user({id:1,steam_id:PLAYER,is_admin:1});await assert.rejects(f.read(),{status:403});
  f.user({id:3,steam_id:OTHER,is_admin:1});await assert.rejects(f.read(),{status:403});assert.equal(f.calls.length,0);
});

test('a delayed read rechecks current role, Steam binding, account and rollout even when every source fails',async t=>{
  for(const change of [f=>f.db.exec('UPDATE users SET is_admin=0 WHERE id=3'),f=>f.db.prepare('UPDATE users SET steam_id=? WHERE id=3').run(OTHER),f=>f.user({id:4,steam_id:OTHER}),f=>f.enable(false)]){
    const f=fixture(t);let release;const hold=new Promise(r=>{release=r;});f.automation.getAdminAudit=async()=>{await hold;throw Error('PRIVATE');};f.automation.getAdminRequests=async()=>{throw Error('PRIVATE');};f.automation.getAdminReportContext=async()=>{throw Error('PRIVATE');};
    const pending=f.read();await Promise.resolve();change(f);release();await assert.rejects(pending,error=>[403,503].includes(error.status)&&!error.message.includes('PRIVATE'));
  }
});

test('only exact player matches and event timestamps inside the fixed window are included',async t=>{
  const f=fixture(t);f.automation.getAdminAudit=async()=>({audit:[f.audit,{...f.audit,id:'other',details:{steamId:OTHER,requestId:PLAYER}}, {...f.audit,id:'old',created_at:iso(AT-960001)},{...f.audit,id:'future',created_at:iso(AT+1)},{...f.audit,id:'actor',details:{actorSteamId:PLAYER}}]});
  f.automation.getAdminReportContext=async()=>{f.time(AT+200);return {...f.raw,windowEnd:iso(AT+100),combat:{...f.raw.combat,events:[...f.raw.combat.events,{...f.raw.combat.events[0],id:'late',at:iso(AT+50)}]}};};
  const result=await f.read();assert.equal(result.windowEnd,iso(AT));assert.deepEqual(result.events.filter(e=>e.source==='audit').map(e=>e.id).sort(),['actor','audit-one']);assert.equal(result.events.some(e=>e.id==='late'),false);
});

test('source loss and invalid projections are marked partial; complete source failure is generic',async t=>{
  const f=fixture(t);f.automation.getAdminAudit=async()=>({audit:'PRIVATE'});f.automation.getAdminRequests=async()=>{throw Error('PRIVATE');};f.raw.combat.available=false;f.raw.combat.events=[];
  let result=await f.read();assert.deepEqual(result.partialSources,['audit','requests','combat']);assert.deepEqual(result.events.map(row=>row.source),['chat']);
  f.raw.chat.messages[0].participant='reported';await assert.rejects(f.read(),{status:502});
  f.automation.getAdminAudit=async()=>({audit:[]});result=await f.read();assert.deepEqual(result.partialSources,['requests','combat','chat']);assert.equal(result.events.length,0);
});

test('oversized source arrays and final output stay bounded and disclose unloaded history',async t=>{
  const f=fixture(t);f.automation.getAdminAudit=async()=>({audit:Array.from({length:300},(_,i)=>({...f.audit,id:'audit-'+i}))});
  f.automation.getAdminRequests=async()=>({requests:Array.from({length:200},(_,i)=>({...f.request,id:'request-'+i}))});
  const result=await f.read();assert.equal(result.events.length,200);assert.deepEqual(result.sourceCounts,{audit:200,requests:100});assert.equal(result.hasMoreUnloaded,true);
});
