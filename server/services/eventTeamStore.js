"use strict";
const {roster,planState}=require('./eventTeamEvidence');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const identifier=id=>{if(typeof id!=='string'||!/^[-a-zA-Z0-9_]{16,80}$/.test(id))fail('Invalid event or request identity');return id;};
function createEventTeamStore(db,{now=Date.now,enabled=()=>true,writable=()=>{}}={}){
 require('./eventRegistrationStore').createEventRegistrationStore(db);
 const {admin}=require('./eventTemplateStore').createEventTemplateStore(db);
 db.exec(`CREATE TABLE IF NOT EXISTS hv_event_team_plans(event_id TEXT PRIMARY KEY,revision INTEGER NOT NULL,event_revision INTEGER NOT NULL,
   roster_digest TEXT NOT NULL,assignments_json TEXT NOT NULL,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS hv_event_team_history(event_id TEXT NOT NULL,revision INTEGER NOT NULL,actor_id INTEGER NOT NULL,actor_steam TEXT NOT NULL,
   event_json TEXT NOT NULL,roster_json TEXT NOT NULL,assignments_json TEXT NOT NULL,reason TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(event_id,revision));
 CREATE TABLE IF NOT EXISTS hv_event_team_requests(actor_id INTEGER NOT NULL,request_key TEXT NOT NULL,payload_json TEXT NOT NULL,
   result_json TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(actor_id,request_key));
 CREATE INDEX IF NOT EXISTS hv_event_team_rate ON hv_event_team_requests(actor_id,at);`);
 function snapshot(fn){db.exec('SAVEPOINT event_team_read');try{const result=fn();db.exec('RELEASE event_team_read');return result;}catch(e){db.exec('ROLLBACK TO event_team_read; RELEASE event_team_read');throw e;}}
 function inspectView(user,id){admin(user);identifier(id);const current=roster(db,id),plan=planState(db,id,current),eligible=current.members.filter(p=>p.eligible);
  return {...current,plan,canAssign:Boolean(enabled()&&current.event.state==='scheduled'&&current.event.startsAt>now()&&eligible.length),
   proposal:eligible.map((p,index)=>({steamId:p.steamId,team:index%current.event.teamCount+1})),attendanceConfirmed:false,rewardsEnabled:false};
 }
 function inspect(user,id){return snapshot(()=>inspectView(user,id));}
 const cursor=value=>{if(value!==null&&(!Number.isSafeInteger(value)||value<1))fail('Invalid event team page');};
 function list(user,{before=null}={}){admin(user);cursor(before);const rows=db.prepare("SELECT row_id,id,definition_json,starts_at,state FROM hv_event_schedules WHERE state<>'draft' AND (? IS NULL OR row_id<?) ORDER BY row_id DESC LIMIT 26").all(before,before),items=rows.slice(0,25);return {items:items.map(r=>({id:r.id,title:JSON.parse(r.definition_json).title,startsAt:r.starts_at,state:r.state})),next:rows.length>25?items.at(-1).row_id:null};}
 function history(user,id,{before=null}={}){admin(user);identifier(id);cursor(before);const rows=db.prepare('SELECT * FROM hv_event_team_history WHERE event_id=? AND (? IS NULL OR revision<?) ORDER BY revision DESC LIMIT 26').all(id,before,before),items=rows.slice(0,25);return {items:items.map(r=>({revision:r.revision,actorSteamId:r.actor_steam,event:JSON.parse(r.event_json),roster:JSON.parse(r.roster_json),assignments:JSON.parse(r.assignments_json),reason:r.reason,at:r.at})),next:rows.length>25?items.at(-1).revision:null};}
 function change(user,input={}){
  admin(user);writable();const fields=['eventId','expectedRevision','eventRevision','rosterDigest','assignments','reason','requestKey'];
  if(Object.keys(input).length!==fields.length||Object.keys(input).some(k=>!fields.includes(k)))fail('Complete reviewed team fields are required');
  const {eventId,expectedRevision,eventRevision,rosterDigest,reason,requestKey}=input;identifier(eventId);identifier(requestKey);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER||!Number.isSafeInteger(eventRevision)||eventRevision<1||typeof rosterDigest!=='string'||! /^[a-f0-9]{64}$/.test(rosterDigest)||typeof reason!=='string'||reason.trim().length<10||reason.length>1000||/[\x00-\x1f\x7f]/.test(reason)||!Array.isArray(input.assignments)||!input.assignments.length||input.assignments.length>500)fail('Review the roster, reason and team assignments');
  const assignments=input.assignments.map(p=>{if(!p||typeof p.steamId!=='string'||!/^\d{17}$/.test(p.steamId)||!Number.isSafeInteger(p.team)||p.team<1||p.team>16||Object.keys(p).length!==2)fail('Invalid team member or number');return {steamId:p.steamId,team:p.team};}).sort((a,b)=>a.steamId.localeCompare(b.steamId));
  if(new Set(assignments.map(p=>p.steamId)).size!==assignments.length)fail('A player cannot be assigned twice');
  const payload=JSON.stringify({eventId,expectedRevision,eventRevision,rosterDigest,assignments,reason:reason.trim(),actorSteamId:user.steam_id});
  db.exec('BEGIN IMMEDIATE');try{
   admin(user);writable();const receipt=db.prepare('SELECT * FROM hv_event_team_requests WHERE actor_id=? AND request_key=?').get(user.id,requestKey);
   if(receipt){if(receipt.payload_json!==payload)fail('Team request key conflicts with its saved review',409);const result={saved:JSON.parse(receipt.result_json),current:inspectView(user,eventId),duplicate:true};db.exec('COMMIT');return result;}
   if(!enabled())fail('Team assignments are paused',503);const current=inspectView(user,eventId);
   if(!current.canAssign)fail('This roster is not open for team assignments',409);
   if((current.plan?.revision||0)!==expectedRevision||current.event.revision!==eventRevision||current.digest!==rosterDigest)fail('The schedule, roster or team plan changed. Review it again.',409);
   const eligible=current.members.filter(p=>p.eligible).map(p=>p.steamId).sort();
   if(JSON.stringify(assignments.map(p=>p.steamId))!==JSON.stringify(eligible))fail('Assign every currently confirmed registrant exactly once',409);
   const counts=new Map(),maxSize=Math.ceil(current.event.capacity/current.event.teamCount);
   for(const p of assignments){if(p.team>current.event.teamCount)fail('A team number exceeds the frozen event plan');counts.set(p.team,(counts.get(p.team)||0)+1);if(counts.get(p.team)>maxSize)fail('A team exceeds the planned per-team capacity');}
   if(db.prepare('SELECT count(*) n FROM hv_event_team_requests WHERE actor_id=? AND at>?').get(user.id,now()-60000).n>=30)fail('Too many team changes. Try again shortly.',429);
   const revision=expectedRevision+1,at=now(),saved={revision,eventRevision,rosterDigest,assignments,updatedAt:at};
   db.prepare('INSERT INTO hv_event_team_plans VALUES(?,?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET revision=excluded.revision,event_revision=excluded.event_revision,roster_digest=excluded.roster_digest,assignments_json=excluded.assignments_json,updated_at=excluded.updated_at').run(eventId,revision,eventRevision,rosterDigest,JSON.stringify(assignments),at);
   db.prepare('INSERT INTO hv_event_team_history VALUES(?,?,?,?,?,?,?,?,?)').run(eventId,revision,user.id,user.steam_id,JSON.stringify(current.event),JSON.stringify(current.members),JSON.stringify(assignments),reason.trim(),at);
   db.prepare('INSERT INTO hv_event_team_requests VALUES(?,?,?,?,?)').run(user.id,requestKey,payload,JSON.stringify(saved),at);const result={saved,current:inspectView(user,eventId),duplicate:false};db.exec('COMMIT');return result;
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 return {admin,inspect,list,history,change};
}
module.exports={createEventTeamStore};
