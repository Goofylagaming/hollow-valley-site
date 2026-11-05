"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const {createLegacyStore}=require('../automation-platform/src/services/valleyLegacyStore');
const A='76561198000000001',B='76561198000000002',STAFF='76561198000000003',GUILD='10000000000001',EVENT='10000000000002';
function setup(t){
  const keys=['DYNAMIC_CHALLENGES_ENABLED','DYNAMIC_CHALLENGES_EVENTS_ENABLED','DYNAMIC_CHALLENGES_EVENT_GUILD_ID'];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  process.env.DYNAMIC_CHALLENGES_ENABLED='1';process.env.DYNAMIC_CHALLENGES_EVENTS_ENABLED='1';process.env.DYNAMIC_CHALLENGES_EVENT_GUILD_ID=GUILD;
  let time=Date.parse('2026-11-05T08:00:00+10:00');const db=new DatabaseSync(':memory:');const s=createLegacyStore(db,{now:()=>time}),c=s.challenges,e=c.attendance;
  c.change(A,{selected:true,expectedRevision:0,requestKey:randomUUID()});time+=2*3600000;
  const event={id:EVENT,guildId:GUILD,title:'Reviewed Valley Event',status:'completed',startTime:'2026-11-04T22:30:00.000Z',endTime:'2026-11-04T23:30:00.000Z'};
  db.exec('CREATE TABLE automation_state(key TEXT PRIMARY KEY,value_json TEXT)');
  const feed=(overrides={})=>db.prepare("INSERT INTO automation_state VALUES ('discord:scheduled-events',?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json")
    .run(JSON.stringify({guildId:GUILD,syncedAt:new Date(time).toISOString(),events:[event],hiddenEventIds:[],...overrides}));feed();
  const input=(overrides={})=>({eventId:EVENT,steamId:A,actorSteamId:STAFF,action:'confirm',expectedRevision:0,eventRevision:e.preview(EVENT).revision,occurredAt:Date.parse('2026-11-04T23:00:00.000Z'),evidenceUrl:`https://discord.com/channels/${GUILD}/10000000000003/10000000000004`,reason:'Reviewed host attendance record',requestKey:randomUUID(),...overrides});
  const progress=()=>c.status(A).challenges.find(row=>row.id==='event-confirmed')?.progress;
  t.after(()=>{db.close();for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;});
  return {db,s,c,e,event,feed,input,progress,advance:n=>time+=n};
}
test('only explicit reviewed staff evidence counts; RSVP, registration and reward records alone do not',t=>{
  const x=setup(t);x.db.exec("CREATE TABLE event_attendance(event_id TEXT,steam_id TEXT,status TEXT); INSERT INTO event_attendance VALUES ('10000000000002','76561198000000001','paid'); CREATE TABLE economy_wallet_ledger(kind TEXT,amount INTEGER); INSERT INTO economy_wallet_ledger VALUES ('event_attendance_reward',10000)");
  assert.equal(x.progress(),0);const result=x.e.change(x.input());assert.equal(result.state,'confirmed');assert.equal(result.revision,1);assert.equal(x.progress(),1);
  assert.equal(x.c.status(B).challenges.find(row=>row.id==='event-confirmed').progress,0);
  assert.equal(x.db.prepare('SELECT amount FROM economy_wallet_ledger').get().amount,10000);
  const view=JSON.stringify(x.c.status(A));for(const secret of [A,STAFF,GUILD,'discord.com','attendance record'])assert.equal(view.includes(secret),false);
});
test('exact retries recover current state after revocation; altered and stale requests cannot restore attendance',t=>{
  const x=setup(t),input=x.input();x.e.change(input);assert.equal(x.e.change(input).duplicate,true);
  assert.throws(()=>x.e.change({...input,reason:'A different reason for this request'}),{status:409});
  x.e.change({...input,action:'revoke',expectedRevision:1,requestKey:randomUUID()});assert.equal(x.progress(),0);
  const retry=x.e.change(input);assert.equal(retry.state,'revoked');assert.equal(retry.revision,2);assert.equal(retry.duplicate,true);
  assert.throws(()=>x.e.change({...input,requestKey:randomUUID()}),{status:409});
  assert.equal(x.db.prepare('SELECT count(*) n FROM dc_attendance_audit').get().n,2);
});
test('changed event details require new review; audit retains each frozen descriptor',t=>{
  const x=setup(t),input=x.input();x.feed({events:[{...x.event,title:'Changed Valley Event'}]});
  assert.throws(()=>x.e.change(input),{status:409});assert.equal(x.progress(),0);
  x.e.change({...input,eventRevision:x.e.preview(EVENT).revision});
  assert.equal(JSON.parse(x.db.prepare('SELECT event_json FROM dc_attendance_audit').get().event_json).title,'Changed Valley Event');
});
test('unknown, stale, hidden, cancelled, active, duplicate and wrong-guild events cannot authorize attendance',t=>{
  const x=setup(t),input=x.input();
  for(const overrides of [
    {syncedAt:'2020-01-01T00:00:00.000Z'}, {syncedAt:'2099-01-01T00:00:00.000Z'}, {events:[]},
    {hiddenEventIds:[EVENT]}, {guildId:'10000000000999'},
    ...['unknown','cancelled','active','scheduled'].map(status=>({events:[{...x.event,status}]})),
    {events:[x.event,x.event]}, {events:[{...x.event,guildId:'10000000000999'}]},
    {events:[{...x.event,endTime:null}]}, {events:[{...x.event,endTime:'2099-01-01T00:00:00Z'}]},
  ]){x.feed(overrides);assert.throws(()=>x.e.change(input));assert.equal(x.progress(),0);}
  assert.equal(x.db.prepare('SELECT count(*) n FROM dc_attendance_audit').get().n,0);
});
test('evidence times and links must belong to the reviewed event and official guild',t=>{
  const x=setup(t),input=x.input();
  for(const override of [
    {occurredAt:Date.parse(x.event.startTime)-1},{occurredAt:Date.parse(x.event.endTime)+1},
    {actorSteamId:'bad'},{expectedRevision:'0'},{reason:'short'},
    {evidenceUrl:'https://evil.example/channels/'+GUILD+'/10000000000003/10000000000004'},
    {evidenceUrl:'https://discord.com/channels/10000000000999/10000000000003/10000000000004'},
  ])assert.throws(()=>x.e.change({...input,...override}),{status:400});
  assert.equal(x.progress(),0);
});
test('revocation can remove evidence after the event feed disappears without retargeting its time',t=>{
  const x=setup(t),input=x.input();x.e.change(input);x.feed({events:[]});
  const revoke={...input,action:'revoke',expectedRevision:1,requestKey:randomUUID()};
  assert.throws(()=>x.e.change({...revoke,occurredAt:input.occurredAt+1}),{status:409});
  x.e.change(revoke);assert.equal(x.progress(),0);
});
test('failed audit rolls back attendance state and challenge progress',t=>{
  const x=setup(t),input=x.input();x.db.exec("CREATE TRIGGER fail_attendance BEFORE INSERT ON dc_attendance_audit BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.throws(()=>x.e.change(input),/audit unavailable/);assert.equal(x.progress(),0);assert.equal(x.e.current(EVENT,A).revision,0);
  x.db.exec('DROP TRIGGER fail_attendance');x.e.change(input);assert.equal(x.progress(),1);
});
test('opt-out and rejoining cannot retrospectively count old attendance; separate staff records remain',t=>{
  const x=setup(t);x.e.change(x.input());assert.equal(x.progress(),1);
  x.c.change(A,{selected:false,expectedRevision:1,requestKey:randomUUID()});assert.equal(x.progress(),0);
  x.c.change(A,{selected:true,expectedRevision:2,requestKey:randomUUID()});assert.equal(x.progress(),0);
  assert.equal(x.e.current(EVENT,A).state,'confirmed');assert.equal(x.db.prepare('SELECT count(*) n FROM dc_attendance_audit').get().n,1);
});
test('the attendance connection defaults off and never installs new wallet tables or payout hooks',t=>{
  const x=setup(t);process.env.DYNAMIC_CHALLENGES_EVENTS_ENABLED='0';
  assert.equal(x.progress(),undefined);assert.throws(()=>x.e.preview(EVENT),{status:503});
  assert.equal(x.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='economy_wallets'").get().n,0);
});
