"use strict";
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const validId=value=>{if(typeof value!=='string'||!/^[-a-zA-Z0-9_]{16,80}$/.test(value))fail('Invalid event or request identity');return value;};
function createEventRegistrationStore(db,{now=Date.now,enabled=()=>true,writable=()=>{}}={}){
  require('./eventScheduleStore').createEventScheduleStore(db);
  db.exec(`CREATE TABLE IF NOT EXISTS hv_event_registrations(row_id INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL,steam_id TEXT NOT NULL,
    revision INTEGER NOT NULL,selected INTEGER NOT NULL,event_revision INTEGER NOT NULL,accepted_json TEXT NOT NULL,updated_at INTEGER NOT NULL,UNIQUE(event_id,steam_id));
    CREATE TABLE IF NOT EXISTS hv_event_registration_history(event_id TEXT NOT NULL,steam_id TEXT NOT NULL,revision INTEGER NOT NULL,
    actor_id INTEGER NOT NULL,selected INTEGER NOT NULL,event_revision INTEGER NOT NULL,accepted_json TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(event_id,steam_id,revision));
    CREATE TABLE IF NOT EXISTS hv_event_registration_requests(steam_id TEXT NOT NULL,request_key TEXT NOT NULL,payload_json TEXT NOT NULL,
    result_json TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(steam_id,request_key));
    CREATE INDEX IF NOT EXISTS hv_event_registration_capacity ON hv_event_registrations(event_id,selected);
    CREATE INDEX IF NOT EXISTS hv_event_registration_player ON hv_event_registrations(steam_id,row_id);
    CREATE INDEX IF NOT EXISTS hv_event_registration_rate ON hv_event_registration_requests(steam_id,at);`);
  function player(user){if(!user)fail('Sign in with Steam to manage event registration',401);if(!Number.isSafeInteger(user.id)||typeof user.steam_id!=='string'||!/^\d{17}$/.test(user.steam_id)||!db.prepare('SELECT 1 FROM users WHERE id=? AND steam_id=?').get(user.id,user.steam_id))fail('A current linked Steam account is required',403);return user.steam_id;}
  const source=id=>db.prepare('SELECT * FROM hv_event_schedules WHERE id=?').get(id);
  const row=(id,steam)=>db.prepare('SELECT * FROM hv_event_registrations WHERE event_id=? AND steam_id=?').get(id,steam);
  function event(record){const d=JSON.parse(record.definition_json);return {id:record.id,revision:record.revision,state:record.state,title:d.title,description:d.description,rules:d.rules,capacity:d.capacity,teamCount:d.teamCount,startsAt:record.starts_at,endsAt:record.ends_at};}
  function view(user,id){const steam=player(user);validId(id);const registration=row(id,steam),schedule=source(id);
    if(!registration&&(!enabled()||schedule?.state!=='scheduled'))fail('Published event or personal registration not found',404);
    const current=schedule&&event(schedule),accepted=registration?JSON.parse(registration.accepted_json):null,selected=Boolean(registration?.selected);
    const reserved=schedule?Number(db.prepare('SELECT count(*) n FROM hv_event_registrations WHERE event_id=? AND selected=1').get(id).n):null;
    return {event:current||accepted,sourceAvailable:Boolean(schedule),acceptedEvent:accepted,revision:registration?.revision||0,selected,
      state:!registration?'not-registered':!selected?'withdrawn':!schedule?'unavailable':schedule.state==='cancelled'?'event-cancelled':registration.event_revision!==schedule.revision?'review-new-time':'registered',
      canJoin:Boolean(enabled()&&schedule?.state==='scheduled'&&schedule.starts_at>now()),reservedPlaces:reserved,
      placesAvailable:schedule?Math.max(0,JSON.parse(schedule.definition_json).capacity-reserved):null,rewardsEnabled:false,attendanceConfirmed:false};
  }
  function snapshot(fn){db.exec('SAVEPOINT event_registration_read');try{const result=fn();db.exec('RELEASE event_registration_read');return result;}catch(e){db.exec('ROLLBACK TO event_registration_read; RELEASE event_registration_read');throw e;}}
  function current(user,id){return snapshot(()=>view(user,id));}
  const cursor=before=>{if(before!==null&&(!Number.isSafeInteger(before)||before<1))fail('Invalid registration page');};
  function mine(user,{before=null}={}){const steam=player(user);cursor(before);return snapshot(()=>{const rows=db.prepare('SELECT event_id,row_id FROM hv_event_registrations WHERE steam_id=? AND (? IS NULL OR row_id<?) ORDER BY row_id DESC LIMIT 26').all(steam,before,before),items=rows.slice(0,25);return {items:items.map(r=>view(user,r.event_id)),next:rows.length>25?items.at(-1).row_id:null};});}
  function history(user,id,{before=null}={}){const steam=player(user);validId(id);cursor(before);if(!row(id,steam))fail('Personal registration not found',404);const rows=db.prepare('SELECT * FROM hv_event_registration_history WHERE event_id=? AND steam_id=? AND (? IS NULL OR revision<?) ORDER BY revision DESC LIMIT 26').all(id,steam,before,before),items=rows.slice(0,25);return {items:items.map(r=>({revision:r.revision,selected:Boolean(r.selected),eventRevision:r.event_revision,acceptedEvent:JSON.parse(r.accepted_json),at:r.at})),next:rows.length>25?items.at(-1).revision:null};}
  function change(user,input={}){
    const steam=player(user),{eventId,selected,expectedRevision,requestKey}=input;validId(eventId);validId(requestKey);writable(selected);
    const fields=['eventId','selected','expectedRevision','requestKey',...(selected===true?['eventRevision']:[])];
    if(typeof selected!=='boolean'||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER||Object.keys(input).length!==fields.length||Object.keys(input).some(k=>!fields.includes(k))||(selected&&(!Number.isSafeInteger(input.eventRevision)||input.eventRevision<1)))fail('Review the current registration choice and schedule revision');
    const payload=JSON.stringify({eventId,selected,expectedRevision,eventRevision:selected?input.eventRevision:null,actorId:user.id});
    db.exec('BEGIN IMMEDIATE');try{
      player(user);writable(selected);
      const receipt=db.prepare('SELECT * FROM hv_event_registration_requests WHERE steam_id=? AND request_key=?').get(steam,requestKey);
      if(receipt){if(receipt.payload_json!==payload)fail('Request key conflicts with its saved registration choice',409);const result={saved:JSON.parse(receipt.result_json),current:view(user,eventId),duplicate:true};db.exec('COMMIT');return result;}
      const old=row(eventId,steam);if((old?.revision||0)!==expectedRevision)fail('Your registration changed. Review the current choice.',409);
      let accepted=old?.accepted_json,eventRevision=old?.event_revision;
      if(selected){if(!enabled())fail('New event registration is paused',503);const schedule=source(eventId);if(!schedule||schedule.state!=='scheduled'||schedule.starts_at<=now())fail('This event is not open for registration',409);if(schedule.revision!==input.eventRevision)fail('The schedule changed. Review its new time and rules.',409);
        if(!old?.selected&&db.prepare('SELECT count(*) n FROM hv_event_registrations WHERE event_id=? AND selected=1').get(eventId).n>=JSON.parse(schedule.definition_json).capacity)fail('This event is full. No waitlist or automatic enrollment is enabled.',409);
        accepted=JSON.stringify(event(schedule));eventRevision=schedule.revision;
      }else if(!old)fail('No personal registration to withdraw',404);
      if((selected||!old?.selected)&&db.prepare('SELECT count(*) n FROM hv_event_registration_requests WHERE steam_id=? AND at>?').get(steam,now()-60000).n>=20)fail('Too many registration changes. Try again shortly.',429);
      const revision=expectedRevision+1,at=now();
      db.prepare('INSERT INTO hv_event_registrations(event_id,steam_id,revision,selected,event_revision,accepted_json,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(event_id,steam_id) DO UPDATE SET revision=excluded.revision,selected=excluded.selected,event_revision=excluded.event_revision,accepted_json=excluded.accepted_json,updated_at=excluded.updated_at').run(eventId,steam,revision,Number(selected),eventRevision,accepted,at);
      db.prepare('INSERT INTO hv_event_registration_history VALUES(?,?,?,?,?,?,?,?)').run(eventId,steam,revision,user.id,Number(selected),eventRevision,accepted,at);
      const saved={revision,selected,eventRevision,acceptedEvent:JSON.parse(accepted)};db.prepare('INSERT INTO hv_event_registration_requests VALUES(?,?,?,?,?)').run(steam,requestKey,payload,JSON.stringify(saved),at);
      const result={saved,current:view(user,eventId),duplicate:false};db.exec('COMMIT');return result;
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  return {player,current,mine,history,change};
}
module.exports={createEventRegistrationStore};
