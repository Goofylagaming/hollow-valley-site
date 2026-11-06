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
  let user = {id:3,steam_id:MOD}, enabled = true, clock = AT, marketplace = false, peerMarketplace = false;
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
  const reader = createIncidentPlayerContext({db,automation,enabled:()=>enabled,marketplaceEnabled:()=>marketplace,peerMarketplaceEnabled:()=>peerMarketplace,now:()=>clock});
  const input = {steamId:PLAYER,occurredAt:iso(AT-60000)}, binding = '3:'+MOD;
  return {db,reader,automation,raw,audit,request,calls,input,binding,getUser:()=>user,user:value=>{user=value;},enable:value=>{enabled=value;},enableMarketplace:value=>{marketplace=value;},enablePeer:value=>{peerMarketplace=value;},time:value=>{clock=value;},read:()=>reader.read(()=>user,binding,input)};
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

const REPORT = '10000000-0000-4000-8000-000000000001';
function reportFixture(t) {
  const f=fixture(t);f.db.exec('CREATE TABLE player_reports(id TEXT PRIMARY KEY,reporter_steam_id TEXT,reported_steam_id TEXT,occurred_at TEXT,description TEXT)');
  f.db.prepare('INSERT INTO player_reports VALUES(?,?,?,?,?)').run(REPORT,PLAYER,OTHER,f.input.occurredAt,'PRIVATE explanation and evidence');
  f.details=()=>f.reader.reportDetails(f.getUser,f.binding,REPORT);
  f.reportRead=input=>f.reader.readReport(f.getUser,f.binding,REPORT,input);
  return f;
}
test('saved-report details are read-only and bind exact participants/time without loading sources or exposing the explanation',async t=>{
  const f=reportFixture(t);f.db.exec('PRAGMA query_only=ON');const before=f.db.prepare('SELECT total_changes() n').get().n;
  const details=f.details();assert.deepEqual(details.report.participants,[{role:'reporter',steamId:PLAYER},{role:'reported',steamId:OTHER}]);
  assert.equal(details.report.canInvestigate,true);assert.equal(details.report.occurredAt,f.input.occurredAt);assert.match(details.report.fingerprint,/^[a-f0-9]{64}$/);assert.equal(f.calls.length,0);
  const result=await f.reportRead({role:'reported',fingerprint:details.report.fingerprint});assert.equal(result.query.steamId,OTHER);assert.deepEqual(result.report,{id:REPORT,role:'reported',fingerprint:details.report.fingerprint});
  assert.deepEqual(f.calls[2][1],{reporterSteamId:OTHER,reportedSteamId:null,occurredAt:f.input.occurredAt});assert.doesNotMatch(JSON.stringify(details),/PRIVATE|explanation|evidence/);assert.equal(f.db.prepare('SELECT total_changes() n').get().n,before);
});
test('saved reports reject overrides, stale details, missing participants and missing/unsupported times without source reads',async t=>{
  const f=reportFixture(t),fingerprint=f.details().report.fingerprint;
  for(const input of [{role:'someone',fingerprint},{role:'reporter',fingerprint,steamId:OTHER},{role:'reporter',fingerprint,occurredAt:f.input.occurredAt},{role:'reported',fingerprint:'a'.repeat(64)},{role:'reporter'}])await assert.rejects(f.reportRead(input),e=>[400,409].includes(e.status));
  f.db.exec('UPDATE player_reports SET reported_steam_id=NULL');let details=f.details();assert.equal(details.report.participants.length,1);await assert.rejects(f.reportRead({role:'reported',fingerprint:details.report.fingerprint}),{status:409});
  f.db.exec('UPDATE player_reports SET occurred_at=NULL');details=f.details();assert.equal(details.report.canInvestigate,false);assert.equal(details.report.reason,'time-required');await assert.rejects(f.reportRead({role:'reporter',fingerprint:details.report.fingerprint}),{status:409});
  f.db.prepare('UPDATE player_reports SET occurred_at=?').run(iso(AT-91*86400000));details=f.details();assert.equal(details.report.reason,'time-outside-source-window');await assert.rejects(f.reportRead({role:'reporter',fingerprint:details.report.fingerprint}),{status:409});
  assert.equal(f.calls.length,0);
});
test('report investigation suppresses changed participants/time or deleted reports after delayed source success and failure',async t=>{
  for(const change of [f=>f.db.prepare('UPDATE player_reports SET reported_steam_id=?').run(MOD),f=>f.db.prepare('UPDATE player_reports SET occurred_at=?').run(iso(AT-30000)),f=>f.db.exec('DELETE FROM player_reports')])for(const sourceFails of [false,true]){
    const f=reportFixture(t),fingerprint=f.details().report.fingerprint;let release;const hold=new Promise(r=>{release=r;});f.automation.getAdminReportContext=async()=>{await hold;if(sourceFails)throw Error('PRIVATE');return f.raw;};
    const pending=f.reportRead({role:'reporter',fingerprint});await Promise.resolve();change(f);release();await assert.rejects(pending,error=>[404,409].includes(error.status));
  }
});
test('report detail reads require current linked admin binding and enabled rollout, and corrupt saved identities are withheld',t=>{
  const f=reportFixture(t);f.enable(false);assert.throws(f.details,{status:503});f.enable(true);
  assert.throws(()=>f.reader.reportDetails(f.getUser,undefined,REPORT),{status:403});assert.throws(()=>f.reader.reportDetails(f.getUser,f.binding,'bad'),{status:400});
  assert.throws(()=>f.reader.reportDetails(f.getUser,f.binding,'20000000-0000-4000-8000-000000000002'),{status:404});
  f.db.prepare('UPDATE player_reports SET reported_steam_id=?').run(PLAYER);assert.throws(f.details,{status:409});
  f.user({id:1,steam_id:PLAYER,is_admin:1});assert.throws(f.details,{status:403});assert.equal(f.calls.length,0);
});

function marketplaceFixture(t){
 const f=fixture(t),orderId='10000000-0000-4000-8000-000000000004';
 f.marketplace={version:1,scope:'official-order-records',steamId:PLAYER,occurredAt:f.input.occurredAt,windowStart:iso(AT-960000),windowEnd:iso(AT),complete:false,gameDeliveryVerified:false,truncated:false,events:[{id:orderId+':latest-update',orderId,at:iso(AT-5000),kind:'latest-update',status:'failed',payload:'PRIVATE'}],error:'PRIVATE'};
 f.automation.getAdminIncidentMarketplaceContext=async input=>{f.calls.push(['marketplace',input]);return f.marketplace;};return f;
}
test('marketplace reads require their separate flag and project only bounded order facts without claiming game delivery',async t=>{
 const f=marketplaceFixture(t);let result=await f.read();assert.deepEqual(result.disabledSources,['marketplace','peer-marketplace']);assert.equal(f.calls.some(([name])=>name==='marketplace'),false);
 f.enableMarketplace(true);result=await f.read();assert.deepEqual(result.disabledSources,['peer-marketplace']);const event=result.events.find(row=>row.source==='marketplace');assert.equal(event.status,'failed');assert.equal(event.action,'Latest recorded order update');assert.equal(event.gameDeliveryVerified,false);assert.deepEqual(f.calls.at(-1),['marketplace',f.input]);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|payload|error/);
});
test('wrong-player/time, duplicate, excessive or invalid marketplace payloads are withheld and marked partial',async t=>{
 for(const change of [f=>{f.marketplace.steamId=OTHER;},f=>{f.marketplace.occurredAt=iso(AT);},f=>{f.marketplace.gameDeliveryVerified=true;},f=>{f.marketplace.events.push(f.marketplace.events[0]);},f=>{f.marketplace.events=Array(51).fill(f.marketplace.events[0]);},f=>{f.marketplace.events[0].status='PRIVATE';},f=>{f.marketplace.events[0].kind=['latest-update'];},f=>{f.marketplace.events[0].at=iso(AT+1);},f=>{f.automation.getAdminIncidentMarketplaceContext=async()=>{throw Error('PRIVATE');};}]){
  const f=marketplaceFixture(t);f.enableMarketplace(true);change(f);const result=await f.read();assert.deepEqual(result.partialSources,['marketplace']);assert.equal(result.events.some(row=>row.source==='marketplace'),false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 }
});
test('disabling marketplace collection while its reply is pending withholds that reply while retaining other sources',async t=>{
 const f=marketplaceFixture(t);f.enableMarketplace(true);let release;const hold=new Promise(r=>{release=r;});f.automation.getAdminIncidentMarketplaceContext=async()=>{await hold;return f.marketplace;};const pending=f.read();await Promise.resolve();f.enableMarketplace(false);release();const result=await pending;assert.deepEqual(result.disabledSources,['marketplace','peer-marketplace']);assert.equal(result.events.some(row=>row.source==='marketplace'),false);assert.equal(result.events.length,4);
});

function peerPayload(f){
 const listingId='10000000-0000-4000-8000-000000000005';
 return {version:1,scope:'peer-listing-records',steamId:PLAYER,occurredAt:f.input.occurredAt,windowStart:iso(AT-960000),windowEnd:iso(AT),complete:false,gameDeliveryVerified:false,currentBuyerAssociationOnly:true,truncated:false,events:[{id:listingId+':latest-update',listingId,at:iso(AT-5000),kind:'latest-update',role:'buyer',status:'reserved',counterpartyIdentityWithheld:true,buyerSlot:'PRIVATE',sellerSteamId:OTHER}]};
}
function peerFixture(t){
 const f=fixture(t);f.peer=peerPayload(f);f.automation.getAdminIncidentPeerMarketplaceContext=async input=>{f.calls.push(['peer',input]);return f.peer;};return f;
}
test('peer context requires a separate flag and preserves the selected role without forwarding counterparty identities or slots',async t=>{
 const f=peerFixture(t);let result=await f.read();assert.equal(f.calls.some(([name])=>name==='peer'),false);assert.deepEqual(result.disabledSources,['marketplace','peer-marketplace']);f.enablePeer(true);result=await f.read();const event=result.events.find(row=>row.source==='peer-marketplace');assert.equal(event.participantRole,'buyer');assert.equal(event.status,'reserved');assert.equal(event.counterpartyIdentityWithheld,true);assert.equal(event.gameDeliveryVerified,false);assert.equal(event.currentBuyerAssociationOnly,true);assert.deepEqual(result.disabledSources,['marketplace']);assert.deepEqual(f.calls.at(-1),['peer',f.input]);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|sellerSteamId|buyerSlot/);
});
test('peer projection withholds wrong-player/time, duplicate, oversized, unknown-kind and wrongly attributed seller markers',async t=>{
 for(const change of [f=>{f.peer.steamId=OTHER;},f=>{f.peer.occurredAt=iso(AT);},f=>{f.peer.gameDeliveryVerified=true;},f=>{f.peer.currentBuyerAssociationOnly=false;},f=>{f.peer.events.push(f.peer.events[0]);},f=>{f.peer.events=Array(51).fill(f.peer.events[0]);},f=>{f.peer.events[0].counterpartyIdentityWithheld=false;},f=>{f.peer.events[0].role='other';},f=>{f.peer.events[0].kind='created';f.peer.events[0].id=f.peer.events[0].listingId+':created';f.peer.events[0].status='recorded';},f=>{f.peer.events[0].at=iso(AT+1);},f=>{f.automation.getAdminIncidentPeerMarketplaceContext=async()=>{throw Error('PRIVATE');};}]){
  const f=peerFixture(t);f.enablePeer(true);change(f);const result=await f.read();assert.deepEqual(result.partialSources,['peer-marketplace']);assert.equal(result.events.some(row=>row.source==='peer-marketplace'),false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 }
});
test('a pending peer reply is withheld after source disabling, admin revocation or saved-report rebinding',async t=>{
 for(const mode of ['disable','revoke','report']){
  const f=mode==='report'?reportFixture(t):peerFixture(t);f.enablePeer(true);const payload=peerPayload(f);let release;const hold=new Promise(r=>{release=r;});f.automation.getAdminIncidentPeerMarketplaceContext=async()=>{await hold;return payload;};const pending=mode==='report'?f.reportRead({role:'reporter',fingerprint:f.details().report.fingerprint}):f.read();await Promise.resolve();
  if(mode==='disable')f.enablePeer(false);else if(mode==='revoke')f.db.exec('UPDATE users SET is_admin=0 WHERE id=3');else f.db.prepare('UPDATE player_reports SET occurred_at=?').run(iso(AT-30000));release();
  if(mode==='disable'){const result=await pending;assert.deepEqual(result.disabledSources,['marketplace','peer-marketplace']);assert.equal(result.events.length,4);}else await assert.rejects(pending,{status:mode==='revoke'?403:409});
 }
});
