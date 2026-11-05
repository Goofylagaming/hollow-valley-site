"use strict";
const {createEventTemplateStore,definition}=require('./eventTemplateStore');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
function id(value){if(typeof value!=='string'||!/^[-a-zA-Z0-9_]{16,80}$/.test(value))fail('Invalid event or request identity');return value;}
function createEventScheduleStore(db,{now=Date.now,writable=()=>{}}={}){
  const templates=createEventTemplateStore(db);
  db.exec(`CREATE TABLE IF NOT EXISTS hv_event_schedules(row_id INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,
    revision INTEGER NOT NULL,state TEXT NOT NULL,template_id TEXT NOT NULL,template_revision INTEGER NOT NULL,
    definition_json TEXT NOT NULL,starts_at INTEGER NOT NULL,ends_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS hv_event_schedule_history(event_id TEXT NOT NULL,revision INTEGER NOT NULL,actor_id INTEGER NOT NULL,
    actor_steam TEXT NOT NULL,action TEXT NOT NULL,snapshot_json TEXT NOT NULL,reason TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(event_id,revision));
    CREATE TABLE IF NOT EXISTS hv_event_schedule_requests(actor_id INTEGER NOT NULL,request_key TEXT NOT NULL,payload_json TEXT NOT NULL,
    result_json TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(actor_id,request_key));
    CREATE INDEX IF NOT EXISTS hv_event_schedule_rate ON hv_event_schedule_requests(actor_id,at);
    CREATE INDEX IF NOT EXISTS hv_event_schedule_public ON hv_event_schedules(state,starts_at,id);`);
  const find=value=>db.prepare('SELECT * FROM hv_event_schedules WHERE id=?').get(value);
  const project=row=>({id:row.id,revision:row.revision,state:row.state,templateId:row.template_id,templateRevision:row.template_revision,definition:JSON.parse(row.definition_json),startsAt:row.starts_at,endsAt:row.ends_at,updatedAt:row.updated_at});
  function read(user,value){templates.admin(user);const row=find(id(value));if(!row)fail('Event schedule not found',404);return project(row);}
  function list(user,{before=null}={}){templates.admin(user);if(before!==null&&(!Number.isSafeInteger(before)||before<1))fail('Invalid schedule page');const rows=db.prepare('SELECT * FROM hv_event_schedules WHERE (? IS NULL OR row_id<?) ORDER BY row_id DESC LIMIT 26').all(before,before),items=rows.slice(0,25);return {items:items.map(project),next:rows.length>25?items.at(-1).row_id:null};}
  function history(user,value,{before=null}={}){read(user,value);if(before!==null&&(!Number.isSafeInteger(before)||before<1))fail('Invalid schedule history page');const rows=db.prepare('SELECT * FROM hv_event_schedule_history WHERE event_id=? AND (? IS NULL OR revision<?) ORDER BY revision DESC LIMIT 26').all(value,before,before),items=rows.slice(0,25);return {items:items.map(r=>({revision:r.revision,actorSteamId:r.actor_steam,action:r.action,reason:r.reason,at:r.at,schedule:JSON.parse(r.snapshot_json)})),next:rows.length>25?items.at(-1).revision:null};}
  function change(user,input={}){
    templates.admin(user);writable();
    const {eventId,expectedRevision,requestKey,action}=input;id(eventId);id(requestKey);
    const fields=action==='create'?['eventId','expectedRevision','requestKey','action','templateId','templateRevision','startsAt']:action==='reschedule'?['eventId','expectedRevision','requestKey','action','startsAt','reason']:['eventId','expectedRevision','requestKey','action','reason'];
    if(Object.keys(input).length!==fields.length||Object.keys(input).some(k=>!fields.includes(k))||!['create','publish','reschedule','cancel'].includes(action)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER)fail('Complete reviewed schedule fields are required');
    let startsAt=null,reason='';
    if(['create','reschedule'].includes(action)){
      startsAt=input.startsAt;if(!Number.isSafeInteger(startsAt)||startsAt<0)fail('A valid planned start time is required');
    }
    if(action!=='create'){if(typeof input.reason!=='string'||input.reason.trim().length<10||input.reason.length>1000||/[\x00-\x1f\x7f]/.test(input.reason))fail('A staff reason of at least ten characters is required');reason=input.reason.trim();}
    if(action==='create'){id(input.templateId);if(!Number.isSafeInteger(input.templateRevision)||input.templateRevision<1||expectedRevision!==0)fail('Choose the reviewed template revision');}
    const payload=JSON.stringify({eventId,expectedRevision,action,startsAt,reason,templateId:action==='create'?input.templateId:null,templateRevision:action==='create'?input.templateRevision:null,actorSteamId:user.steam_id});
    db.exec('BEGIN IMMEDIATE');try{
      templates.admin(user);writable();
      const receipt=db.prepare('SELECT * FROM hv_event_schedule_requests WHERE actor_id=? AND request_key=?').get(user.id,requestKey);
      if(receipt){if(receipt.payload_json!==payload)fail('Schedule request conflicts with its saved change',409);const result={saved:JSON.parse(receipt.result_json),current:read(user,eventId),duplicate:true};db.exec('COMMIT');return result;}
      const old=find(eventId);if((old?.revision||0)!==expectedRevision)fail('Schedule changed. Load its current revision before reviewing again.',409);
      if(!old&&action!=='create')fail('Event schedule not found',404);if(old&&action==='create')fail('This event identity already exists',409);
      if(old?.state==='cancelled')fail('Cancelled schedules remain in history and cannot be changed',409);
      if(action==='publish'&&old.state!=='draft')fail('Only a draft schedule can be published',409);
      let source=old?JSON.parse(old.definition_json):null;
      if(action==='create'){const template=templates.read(user,input.templateId);if(template.revision!==input.templateRevision||template.state!=='draft')fail('Template changed or was archived. Review the current template.',409);source=definition(template.definition);}
      const plannedStart=startsAt??old.starts_at,plannedEnd=plannedStart+source.durationMinutes*60000;
      if(!Number.isSafeInteger(plannedEnd))fail('Invalid planned end time');
      // Exact receipts above remain recoverable after the time or lifecycle
      // changes. Fresh publishing and schedule edits must still be in future.
      if(action!=='cancel'&&(plannedStart<=now()||plannedStart>now()+366*86400000))fail('Choose a start within the next 366 days',409);
      if(action==='reschedule'&&old.starts_at<=now())fail('A schedule whose planned start passed cannot be rescheduled',409);
      if(db.prepare('SELECT count(*) n FROM hv_event_schedule_requests WHERE actor_id=? AND at>?').get(user.id,now()-60000).n>=30)fail('Too many schedule changes. Try again shortly.',429);
      const revision=expectedRevision+1,state=action==='create'?'draft':action==='publish'?'scheduled':action==='cancel'?'cancelled':old.state,at=now();
      db.prepare('INSERT INTO hv_event_schedules(id,revision,state,template_id,template_revision,definition_json,starts_at,ends_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,state=excluded.state,starts_at=excluded.starts_at,ends_at=excluded.ends_at,updated_at=excluded.updated_at')
        .run(eventId,revision,state,action==='create'?input.templateId:old.template_id,action==='create'?input.templateRevision:old.template_revision,JSON.stringify(source),plannedStart,plannedEnd,at);
      const saved=project(find(eventId));db.prepare('INSERT INTO hv_event_schedule_history VALUES(?,?,?,?,?,?,?,?)').run(eventId,revision,user.id,user.steam_id,action,JSON.stringify(saved),reason,at);
      db.prepare('INSERT INTO hv_event_schedule_requests VALUES(?,?,?,?,?)').run(user.id,requestKey,payload,JSON.stringify(saved),at);db.exec('COMMIT');return {saved,current:saved,duplicate:false};
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  function published({after=null}={}){
    if(after!==null&&(!after||!Number.isSafeInteger(after.startsAt)||typeof after.id!=='string'||!/^[-a-zA-Z0-9_]{16,80}$/.test(after.id)))fail('Invalid calendar page');
    const rows=db.prepare("SELECT * FROM hv_event_schedules WHERE state='scheduled' AND ends_at>=? AND (? IS NULL OR starts_at>? OR (starts_at=? AND id>?)) ORDER BY starts_at,id LIMIT 26").all(now()-86400000,after?.startsAt??null,after?.startsAt??null,after?.startsAt??null,after?.id??null),items=rows.slice(0,25);
    return {events:items.map(r=>({id:r.id,revision:r.revision,title:JSON.parse(r.definition_json).title,kind:JSON.parse(r.definition_json).kind,description:JSON.parse(r.definition_json).description,rules:JSON.parse(r.definition_json).rules,capacity:JSON.parse(r.definition_json).capacity,teamCount:JSON.parse(r.definition_json).teamCount,startsAt:r.starts_at,endsAt:r.ends_at,state:'scheduled',source:'website-plan'})),next:rows.length>25?{startsAt:items.at(-1).starts_at,id:items.at(-1).id}:null,checkedAt:now()};
  }
  return {read,list,history,change,published,admin:templates.admin};
}
module.exports={createEventScheduleStore};
