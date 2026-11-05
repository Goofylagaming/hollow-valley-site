"use strict";
const {createHash}=require('node:crypto');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const steam=id=>{if(typeof id!=='string'||!/^\d{17}$/.test(id))fail('A linked Steam identity is required');return id;};
const eventId=id=>{if(typeof id!=='string'||!/^\d{10,24}$/.test(id))fail('An official event ID is required');return id;};
// The staff host authenticates and authorizes actors before using this service.
// No player write route is installed.
function createChallengeAttendanceEvidence(db,{now=Date.now,enabled=()=>process.env.DYNAMIC_CHALLENGES_EVENTS_ENABLED==='1',guild=()=>process.env.DYNAMIC_CHALLENGES_EVENT_GUILD_ID}={}) {
  db.exec(`CREATE TABLE IF NOT EXISTS dc_attendance_evidence(event_id TEXT NOT NULL,steam_id TEXT NOT NULL,revision INTEGER NOT NULL,
    state TEXT NOT NULL,occurred_at INTEGER NOT NULL,event_json TEXT NOT NULL,evidence_url TEXT NOT NULL,reason TEXT NOT NULL,
    actor TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(event_id,steam_id));
    CREATE TABLE IF NOT EXISTS dc_attendance_audit(request_key TEXT PRIMARY KEY,payload TEXT NOT NULL,event_json TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS dc_attendance_player_time ON dc_attendance_evidence(steam_id,occurred_at,state);`);
  function writable(){if(!enabled())fail('Event challenge evidence is disabled',503);}
  function preview(id) {
    writable();eventId(id);const configured=guild();
    if(typeof configured!=='string'||!/^\d{10,24}$/.test(configured))fail('An official event guild must be configured',503);
    const exists=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='automation_state'").get();
    const row=exists&&db.prepare("SELECT value_json FROM automation_state WHERE key='discord:scheduled-events'").get();
    let snapshot;try{snapshot=JSON.parse(row?.value_json);}catch{/* Unverified feeds cannot authorize evidence. */}
    const stamp=Date.parse(snapshot?.syncedAt);
    if(!Number.isFinite(stamp)||stamp>now()+60000||now()-stamp>300000||!Array.isArray(snapshot?.events)||snapshot.events.length>250)fail('A fresh official event snapshot is required',503);
    const matches=snapshot.events.filter(e=>e?.id===id),e=matches[0];
    if(snapshot.guildId!==configured||matches.length!==1||e.guildId!==configured||e.status!=='completed'||snapshot.hiddenEventIds?.includes(id))fail('A completed official event is required',409);
    const starts=Date.parse(e.startTime),ends=Date.parse(e.endTime);
    if(typeof e.title!=='string'||!e.title.trim()||e.title.length>120||/[\x00-\x1f\x7f]/.test(e.title)||!Number.isFinite(starts)||!Number.isFinite(ends)||starts>=ends||ends>now())fail('The completed event schedule could not be verified',409);
    const value={eventId:id,guildId:configured,title:e.title,startTime:new Date(starts).toISOString(),endTime:new Date(ends).toISOString()};
    return {...value,revision:createHash('sha256').update(JSON.stringify(value)).digest('hex')};
  }
  function current(id,player){eventId(id);steam(player);const row=db.prepare('SELECT * FROM dc_attendance_evidence WHERE event_id=? AND steam_id=?').get(id,player);return row?{revision:row.revision,state:row.state,event:JSON.parse(row.event_json),occurredAt:row.occurred_at,evidenceUrl:row.evidence_url,reason:row.reason,actorSteamId:row.actor,updatedAt:row.updated_at}:{revision:0,state:'unconfirmed'};}
  function normalize(input) {
    writable();
    const {eventId:id,steamId:player,actorSteamId:actor,action,expectedRevision,eventRevision,occurredAt,evidenceUrl,reason,requestKey}=input||{};
    eventId(id);steam(player);steam(actor);
    const officialGuild=guild();
    if(typeof officialGuild!=='string'||!/^\d{10,24}$/.test(officialGuild))fail('An official event guild must be configured',503);
    if(!['confirm','revoke'].includes(action)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER||
      typeof eventRevision!=='string'||! /^[a-f0-9]{64}$/.test(eventRevision)||typeof requestKey!=='string'||!/^[-a-zA-Z0-9_]{16,80}$/.test(requestKey)||
      !Number.isSafeInteger(occurredAt)||occurredAt>now()||typeof reason!=='string'||reason.trim().length<10||reason.length>1000||/[\x00-\x1f\x7f]/.test(reason))fail('Complete reviewed attendance evidence is required');
    let proof;try{proof=new URL(evidenceUrl);}catch{fail('An official Discord evidence message is required');}
    if(proof.origin!=='https://discord.com'||proof.username||proof.password||proof.search||proof.hash||!new RegExp('^/channels/'+officialGuild+'/[0-9]{10,24}/[0-9]{10,24}$').test(proof.pathname))fail('An official Discord evidence message is required');
    return {eventId:id,steamId:player,actorSteamId:actor,action,expectedRevision,eventRevision,occurredAt,evidenceUrl:proof.href,reason,requestKey};
  }
  function validateReview(value) {
    const {eventId:id,steamId:player,action,expectedRevision,eventRevision,occurredAt}=value;
    const old=current(id,player);
    if(old.revision!==expectedRevision)fail('Attendance changed. Review its current state.',409);
    const descriptor=action==='confirm'?preview(id):old.event;
    if(!descriptor||descriptor.revision!==eventRevision)fail('Event details changed. Review the official event again.',409);
    if(action==='revoke'&&occurredAt!==old.occurredAt)fail('Revocation must retain the recorded attendance time',409);
    if(occurredAt<Date.parse(descriptor.startTime)||occurredAt>Date.parse(descriptor.endTime))fail('Attendance time must be inside the reviewed event');
    return {old,descriptor};
  }
  function review(input) {
    writable();db.exec('SAVEPOINT attendance_review');
    try {
      const old=current(input?.eventId,input?.steamId);
      const event=input?.action==='confirm'?preview(input.eventId):old.event;
      const body=normalize({...input,expectedRevision:old.revision,eventRevision:event?.revision,occurredAt:input?.action==='revoke'?old.occurredAt:input?.occurredAt});
      const verified=validateReview(body);
      db.exec('RELEASE attendance_review');return {body,event:verified.descriptor,current:verified.old};
    }catch(error){db.exec('ROLLBACK TO attendance_review; RELEASE attendance_review');throw error;}
  }
  function change(input) {
    const value=normalize(input),{eventId:id,steamId:player,actorSteamId:actor,action,occurredAt,evidenceUrl,reason,requestKey}=value;
    const payload=JSON.stringify(value);
    db.exec('BEGIN IMMEDIATE');
    try {
      const receipt=db.prepare('SELECT payload FROM dc_attendance_audit WHERE request_key=?').get(requestKey);
      if(receipt){if(receipt.payload!==payload)fail('Attendance request key conflicts with its saved evidence',409);const result={...current(id,player),duplicate:true};db.exec('COMMIT');return result;}
      const {old,descriptor}=validateReview(value);
      db.prepare(`INSERT INTO dc_attendance_evidence VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id,steam_id) DO UPDATE SET revision=excluded.revision,state=excluded.state,
        occurred_at=excluded.occurred_at,event_json=excluded.event_json,evidence_url=excluded.evidence_url,reason=excluded.reason,actor=excluded.actor,updated_at=excluded.updated_at`)
        .run(id,player,old.revision+1,action==='confirm'?'confirmed':'revoked',occurredAt,JSON.stringify(descriptor),evidenceUrl,reason,actor,now());
      db.prepare('INSERT INTO dc_attendance_audit VALUES (?,?,?,?)').run(requestKey,payload,JSON.stringify(descriptor),now());
      const result={...current(id,player),duplicate:false};db.exec('COMMIT');return result;
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  function count(player,{start,end,joinedAt}) {
    steam(player);if(!enabled())return 0;
    return Number(db.prepare("SELECT count(*) n FROM dc_attendance_evidence WHERE steam_id=? AND state='confirmed' AND occurred_at>=? AND occurred_at<? AND occurred_at>?").get(player,start,end,joinedAt).n);
  }
  return {preview,current,review,change,count,enabled};
}
module.exports={createChallengeAttendanceEvidence};
