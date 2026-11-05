"use strict";
const {randomUUID}=require('node:crypto');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
function createChallengeAttendanceHost(db,client,{now=Date.now,writable=()=>{}}={}) {
  db.exec(`CREATE TABLE IF NOT EXISTS hv_challenge_attendance_reviews(id TEXT PRIMARY KEY,actor TEXT NOT NULL,body_json TEXT NOT NULL,
    event_json TEXT NOT NULL,current_json TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS hv_attendance_review_actor ON hv_challenge_attendance_reviews(actor,created_at);`);
  function admin(user) {
    if(!user)fail('Sign in to continue',401);
    if(!Number.isSafeInteger(user.id)||typeof user.steam_id!=='string'||!/^\d{17}$/.test(user.steam_id)||
      !db.prepare('SELECT 1 FROM users WHERE id=? AND steam_id=? AND is_admin=1').get(user.id,user.steam_id))fail('Current staff access is required',403);
    return user.steam_id;
  }
  function target(input) {
    if(typeof input?.eventId!=='string'||!/^\d{10,24}$/.test(input.eventId)||typeof input?.steamId!=='string'||!/^\d{17}$/.test(input.steamId))fail('Choose an official event and linked Steam player');
    return {eventId:input.eventId,steamId:input.steamId};
  }
  function read(user,id) {
    const actor=admin(user);
    if(typeof id!=='string'||!/^[-a-zA-Z0-9_]{16,80}$/.test(id))fail('Invalid review ID');
    const row=db.prepare('SELECT * FROM hv_challenge_attendance_reviews WHERE id=? AND actor=?').get(id,actor);
    if(!row)fail('The saved attendance review was not found',404);
    return {id:row.id,body:JSON.parse(row.body_json),event:JSON.parse(row.event_json),current:JSON.parse(row.current_json),createdAt:row.created_at};
  }
  async function inspect(user,input){admin(user);const result=await client('current',target(input));admin(user);return result;}
  async function review(user,input) {
    const actor=admin(user);writable();const selected=target(input);
    const requestKey=randomUUID();
    const result=await client('review',{...selected,actorSteamId:actor,action:input.action,occurredAt:input.occurredAt,evidenceUrl:input.evidenceUrl,reason:input.reason,requestKey});
    admin(user);writable();
    const body=result?.body;
    if(body?.actorSteamId!==actor||body?.eventId!==selected.eventId||body?.steamId!==selected.steamId||body?.requestKey!==requestKey||body?.action!==input.action||result?.event?.eventId!==selected.eventId)
      fail('The reviewed attendance identity could not be verified',502);
    const id=randomUUID();db.exec('BEGIN IMMEDIATE');
    try {
      admin(user);writable();
      if(db.prepare('SELECT count(*) n FROM hv_challenge_attendance_reviews WHERE actor=? AND created_at>?').get(actor,now()-60000).n>=20)fail('Too many reviews. Try again shortly.',429);
      db.prepare('INSERT INTO hv_challenge_attendance_reviews VALUES (?,?,?,?,?,?)').run(id,actor,JSON.stringify(body),JSON.stringify(result.event),JSON.stringify(result.current),now());
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    return read(user,id);
  }
  async function confirm(user,id) {
    const saved=read(user,id);writable();
    // No network wait occurs between this permission check and dispatch. The
    // saved actor, player, event, time, proof and request key cannot be replaced.
    admin(user);const result=await client('change',saved.body);admin(user);return result;
  }
  return {admin,inspect,review,read,confirm};
}
module.exports={createChallengeAttendanceHost};
