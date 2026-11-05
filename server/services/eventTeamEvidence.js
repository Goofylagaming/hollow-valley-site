"use strict";
const {createHash}=require('node:crypto');
function roster(db,id){
 const event=db.prepare('SELECT * FROM hv_event_schedules WHERE id=?').get(id);if(!event)throw Object.assign(new Error('Event schedule not found'),{status:404});
 const definition=require('./eventTemplateStore').definition(JSON.parse(event.definition_json));
 const people=db.prepare(`SELECT r.steam_id,r.revision,r.event_revision,u.id AS user_id,u.username FROM hv_event_registrations r
 LEFT JOIN users u ON u.steam_id=r.steam_id WHERE r.event_id=? AND r.selected=1 ORDER BY r.steam_id LIMIT 501`).all(id);
 if(people.length>500||people.length>definition.capacity)throw Object.assign(new Error('The event roster exceeds its recorded capacity'),{status:409});
 const members=people.map(p=>({steamId:p.steam_id,registrationRevision:p.revision,eventRevision:p.event_revision,userId:p.user_id??null,name:p.username||'Unavailable account',eligible:p.user_id!==null&&p.event_revision===event.revision}));
 const digest=createHash('sha256').update(JSON.stringify({eventId:id,eventRevision:event.revision,members:members.map(p=>({steamId:p.steamId,registrationRevision:p.registrationRevision,eventRevision:p.eventRevision,userId:p.userId}))})).digest('hex');
 return {event:{id:event.id,revision:event.revision,state:event.state,title:definition.title,startsAt:event.starts_at,endsAt:event.ends_at,capacity:definition.capacity,teamCount:definition.teamCount},members,digest};
}
function planState(db,id,current){
 const row=db.prepare('SELECT * FROM hv_event_team_plans WHERE event_id=?').get(id);if(!row)return null;
 const assignments=JSON.parse(row.assignments_json);
 if(!Array.isArray(assignments)||!assignments.length||assignments.length>500||assignments.some(p=>!p||typeof p.steamId!=='string'||!/^\d{17}$/.test(p.steamId)||!Number.isSafeInteger(p.team)||p.team<1||p.team>current.event.teamCount)||new Set(assignments.map(p=>p.steamId)).size!==assignments.length)throw Object.assign(new Error('Saved team evidence is invalid'),{status:503});
 const active=current.event.state==='scheduled'&&row.event_revision===current.event.revision&&row.roster_digest===current.digest;
 if(active){const eligible=current.members.filter(p=>p.eligible).map(p=>p.steamId).sort(),assigned=assignments.map(p=>p.steamId).sort();if(JSON.stringify(eligible)!==JSON.stringify(assigned))throw Object.assign(new Error('Saved team roster evidence is incomplete'),{status:503});const limit=Math.ceil(current.event.capacity/current.event.teamCount);for(let team=1;team<=current.event.teamCount;team++)if(assignments.filter(p=>p.team===team).length>limit)throw Object.assign(new Error('Saved team capacity evidence is invalid'),{status:503});}
 return {revision:row.revision,eventRevision:row.event_revision,rosterDigest:row.roster_digest,assignments,updatedAt:row.updated_at,
   active};
}
function playerTeam(db,id,steam){
 if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='hv_event_team_plans'").get())return {state:'not-assigned',team:null};
 try{
  if(!db.prepare('SELECT 1 FROM hv_event_team_plans WHERE event_id=?').get(id))return {state:'not-assigned',team:null};
  const current=roster(db,id);if(current.event.state==='cancelled')return {state:'event-cancelled',team:null};
  const saved=planState(db,id,current);if(!saved)return {state:'not-assigned',team:null};if(!saved.active)return {state:'needs-staff-review',team:null};
  const own=saved.assignments.find(p=>p.steamId===steam),member=current.members.find(p=>p.steamId===steam&&p.eligible);
  return own&&member?{state:'planned',team:own.team,revision:saved.revision}:{state:'not-assigned',team:null};
 }catch{return {state:'unavailable',team:null};}
}
module.exports={roster,planState,playerTeam};
