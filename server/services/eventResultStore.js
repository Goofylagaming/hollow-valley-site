"use strict";
const {createHash}=require('node:crypto'),{validateEventResult}=require('./eventResultValidation');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const identifier=value=>{if(typeof value!=='string'||!/^[-a-zA-Z0-9_]{16,80}$/.test(value))fail('Invalid event or request identity');return value;};
const note=(value,min,max)=>{if(typeof value!=='string'||value.trim().length<min||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))fail('Complete staff evidence and reason are required');return value.trim();};
function createEventResultStore(db,{now=Date.now,enabled=()=>true,guild=()=>process.env.EVENT_ENGINE_RESULT_GUILD_ID,writable=()=>{}}={}){
 require('./eventScheduleStore').createEventScheduleStore(db);const {admin}=require('./eventTemplateStore').createEventTemplateStore(db),publications=require('./eventResultPublicStore').createPublicResultStore(db);
 db.exec(`CREATE TABLE IF NOT EXISTS hv_engine_event_results(event_id TEXT PRIMARY KEY,event_key TEXT UNIQUE NOT NULL,revision INTEGER NOT NULL,
  state TEXT NOT NULL,event_revision INTEGER NOT NULL,body_json TEXT NOT NULL,actor_steam TEXT NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS hv_engine_event_result_history(event_id TEXT NOT NULL,revision INTEGER NOT NULL,action TEXT NOT NULL,actor_id INTEGER NOT NULL,
  actor_steam TEXT NOT NULL,body_json TEXT NOT NULL,reason TEXT NOT NULL,publication_before_json TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(event_id,revision));
 CREATE TABLE IF NOT EXISTS hv_engine_event_result_requests(actor_id INTEGER NOT NULL,request_key TEXT NOT NULL,payload_json TEXT NOT NULL,
  result_json TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(actor_id,request_key));
 CREATE INDEX IF NOT EXISTS hv_engine_event_result_rate ON hv_engine_event_result_requests(actor_id,at);`);
 const configured=()=>typeof guild()==='string'&&/^\d{10,24}$/.test(guild());
 const key=id=>'engine-'+createHash('sha256').update(id).digest('base64url');
 const find=id=>db.prepare('SELECT * FROM hv_engine_event_results WHERE event_id=?').get(id);
 const publication=id=>db.prepare('SELECT * FROM hv_event_results_public WHERE event_key=?').get(key(id));
 function source(id){const row=db.prepare('SELECT * FROM hv_event_schedules WHERE id=?').get(id);if(!row)return null;const d=JSON.parse(row.definition_json);return {id:row.id,revision:row.revision,state:row.state,title:d.title,kind:d.kind,startsAt:row.starts_at,endsAt:row.ends_at,updatedAt:row.updated_at};}
 function view(user,id){admin(user);identifier(id);const event=source(id),row=find(id);if(!event&&!row)fail('Event report not found',404);return {event: event||JSON.parse(row.body_json).event,sourceAvailable:Boolean(event),result:row?{revision:row.revision,state:row.state,body:JSON.parse(row.body_json),updatedAt:row.updated_at,publicationState:row.state==='withdrawn'?'withdrawn':publications.matches(publication(id),row)?'published':'needs-review'}:null,
  canReport:Boolean(enabled()&&configured()&&event?.state==='scheduled'&&event.startsAt<=now()),canWithdraw:row?.state==='published',automaticallyVerified:false,rewardsEnabled:false};}
 function snapshot(fn){db.exec('SAVEPOINT event_result_read');try{const result=fn();db.exec('RELEASE event_result_read');return result;}catch(e){db.exec('ROLLBACK TO event_result_read; RELEASE event_result_read');throw e;}}
 function inspect(user,id){return snapshot(()=>view(user,id));}
 function list(user,{before=null}={}){admin(user);if(before!==null)identifier(before);const rows=db.prepare("SELECT id FROM (SELECT id FROM hv_event_schedules WHERE state<>'draft' UNION SELECT event_id AS id FROM hv_engine_event_results) WHERE (? IS NULL OR id<?) ORDER BY id DESC LIMIT 26").all(before,before),items=rows.slice(0,25);return {items:items.map(r=>{const v=view(user,r.id);return {id:r.id,title:v.event.title,startsAt:v.event.startsAt,state:v.result?.publicationState||'not-reported'};}),next:rows.length>25?items.at(-1).id:null};}
 function history(user,id,{before=null}={}){admin(user);identifier(id);if(before!==null&&(!Number.isSafeInteger(before)||before<1))fail('Invalid result history page');const rows=db.prepare('SELECT * FROM hv_engine_event_result_history WHERE event_id=? AND (? IS NULL OR revision<?) ORDER BY revision DESC LIMIT 26').all(id,before,before),items=rows.slice(0,25);return {items:items.map(r=>({revision:r.revision,action:r.action,actorSteamId:r.actor_steam,body:JSON.parse(r.body_json),reason:r.reason,publicationBefore:JSON.parse(r.publication_before_json),at:r.at})),next:rows.length>25?items.at(-1).revision:null};}
 function change(user,input={}){
  admin(user);writable();const {eventId,action,expectedRevision,requestKey}=input;identifier(eventId);identifier(requestKey);
  if(!['publish','correct','withdraw','restore'].includes(action)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER)fail('Review the current event report revision');
  const full=action!=='withdraw',fields=['eventId','action','expectedRevision','requestKey','reason',...(full?['eventRevision','actualStart','actualEnd','publicSummary','winners','evidenceUrls','evidenceSummary']:[])];
  if(Object.keys(input).length!==fields.length||Object.keys(input).some(k=>!fields.includes(k)))fail('Only the reviewed report fields are accepted');
  const reason=note(input.reason,10,1000);let normalized=null;
  if(full){
   if(!Number.isSafeInteger(input.eventRevision)||input.eventRevision<1||![input.actualStart,input.actualEnd].every(n=>Number.isSafeInteger(n)&&n>=0&&Number.isFinite(new Date(n).getTime()))||input.actualEnd<=input.actualStart||!Array.isArray(input.evidenceUrls)||input.evidenceUrls.length<1||input.evidenceUrls.length>10)fail('Complete actual event times and evidence messages are required');
   const evidenceUrls=input.evidenceUrls.map(value=>{let url;try{url=new URL(value);}catch{fail('Use official Discord evidence message links');}if(typeof value!=='string'||url.origin!=='https://discord.com'||url.username||url.password||url.search||url.hash||!/^\/channels\/\d{10,24}\/\d{10,24}\/\d{10,24}$/.test(url.pathname))fail('Use official Discord evidence message links');return url.href;}).sort();
   if(new Set(evidenceUrls).size!==evidenceUrls.length)fail('Evidence message links must be distinct');
   const publicBody=validateEventResult({eventKey:key(eventId),title:'Website event report',eventAt:new Date(input.actualEnd).toISOString(),summary:input.publicSummary,winners:input.winners},input.actualEnd,{allowEngine:true,minTitle:3});
   normalized={eventRevision:input.eventRevision,actualStart:input.actualStart,actualEnd:input.actualEnd,publicSummary:publicBody.summary,winners:publicBody.winners,evidenceUrls,evidenceSummary:note(input.evidenceSummary,20,2000)};
  }
  const payload=JSON.stringify({eventId,action,expectedRevision,reason,report:normalized,actorSteamId:user.steam_id});
  db.exec('BEGIN IMMEDIATE');try{
   admin(user);writable();const receipt=db.prepare('SELECT * FROM hv_engine_event_result_requests WHERE actor_id=? AND request_key=?').get(user.id,requestKey);
   if(receipt){if(receipt.payload_json!==payload)fail('Report request conflicts with its saved review',409);const result={saved:JSON.parse(receipt.result_json),current:view(user,eventId),duplicate:true};db.exec('COMMIT');return result;}
   const old=find(eventId);if((old?.revision||0)!==expectedRevision)fail('The event report changed. Review it again.',409);
   if(action==='publish'&&old||action==='restore'&&old?.state!=='withdrawn'||['correct','withdraw'].includes(action)&&old?.state!=='published')fail('Choose the action for the current report state',409);
   const before=publication(eventId)||null;let body=old?JSON.parse(old.body_json):null;
   if(full){
    if(!enabled())fail('New event report publication is paused',503);if(!configured())fail('Official event evidence configuration is unavailable',503);
    if(normalized.evidenceUrls.some(url=>new URL(url).pathname.split('/')[2]!==guild()))fail('Evidence must belong to the configured official Discord server');
    const event=source(eventId);if(!event||event.state!=='scheduled'||event.revision!==normalized.eventRevision)fail('The source event changed or is unavailable. Review its history.',409);
    if(normalized.actualStart<event.startsAt||normalized.actualStart<event.updatedAt||normalized.actualEnd>now()||normalized.actualEnd<now()-366*86400000)fail('Reported times must follow the published plan and describe an ended event within the past year',409);
    if(action==='correct'&&!publications.matches(before,old))fail('The source or publication evidence changed. Withdraw it before reviewing a replacement.',409);
    if(action!=='correct'&&before)fail('This reserved event result key already has a publication',409);
    body={event,actualStart:normalized.actualStart,actualEnd:normalized.actualEnd,evidenceUrls:normalized.evidenceUrls,evidenceSummary:normalized.evidenceSummary,
     publication:validateEventResult({eventKey:key(eventId),title:event.title,eventAt:new Date(normalized.actualEnd).toISOString(),summary:normalized.publicSummary,winners:normalized.winners},now(),{allowEngine:true,minTitle:3})};
   }
   if(action!=='withdraw'&&db.prepare('SELECT count(*) n FROM hv_engine_event_result_requests WHERE actor_id=? AND at>?').get(user.id,now()-60000).n>=30)fail('Too many result changes. Try again shortly.',429);
   const revision=expectedRevision+1,state=full?'published':'withdrawn',at=now();
   if(full){const p=body.publication;db.prepare('INSERT INTO hv_event_results_public(event_key,title,event_at,summary,winners_json,published_at,published_by_steam_id) VALUES(?,?,?,?,?,?,?) ON CONFLICT(event_key) DO UPDATE SET title=excluded.title,event_at=excluded.event_at,summary=excluded.summary,winners_json=excluded.winners_json,published_at=excluded.published_at,published_by_steam_id=excluded.published_by_steam_id').run(p.key,p.title,p.time,p.summary,JSON.stringify(p.winners),new Date(at).toISOString(),user.steam_id);}else db.prepare('DELETE FROM hv_event_results_public WHERE event_key=?').run(key(eventId));
   db.prepare('INSERT INTO hv_engine_event_results VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET revision=excluded.revision,state=excluded.state,event_revision=excluded.event_revision,body_json=excluded.body_json,actor_steam=excluded.actor_steam,updated_at=excluded.updated_at').run(eventId,key(eventId),revision,state,body.event.revision,JSON.stringify(body),user.steam_id,at);
   db.prepare('INSERT INTO hv_engine_event_result_history VALUES(?,?,?,?,?,?,?,?,?)').run(eventId,revision,action,user.id,user.steam_id,JSON.stringify(body),reason,JSON.stringify(before),at);
   const saved={revision,state,eventId,body};db.prepare('INSERT INTO hv_engine_event_result_requests VALUES(?,?,?,?,?)').run(user.id,requestKey,payload,JSON.stringify(saved),at);const result={saved,current:view(user,eventId),duplicate:false};db.exec('COMMIT');return result;
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 return {admin,configured,inspect,list,history,change,publicResults:()=>publications.list(25,{engineOnly:true})};
}
module.exports={createEventResultStore};
