'use strict';
// Diagnostics only. No reset, cancellation, refund or schema preparation.
function createTerritorySeasonResetInspection(db,{plans,now=Date.now}={}){
 const exists=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
 const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
 const label=value=>typeof value==='string'&&value.trim()&&value.length<=160&&!/[\x00-\x1f\x7f]/.test(value)?value:null;
 function read(actor,seasonId,targetEventIds){
  if(typeof seasonId!=='string'||!/^season-[a-z0-9][a-z0-9-]{0,56}$/.test(seasonId)||!Array.isArray(targetEventIds)||targetEventIds.length>64||targetEventIds.some(id=>!Number.isSafeInteger(id)||id<1)||new Set(targetEventIds).size!==targetEventIds.length)fail(400,'Select explicit, distinct event references for a saved season');
  db.exec('SAVEPOINT season_reset_inspection');try{
   const saved=plans.list(actor);if(!saved.available)fail(503,'Season planning history is unavailable');const plan=saved.seasons.find(row=>row.seasonId===seasonId);if(!plan)fail(404,'Season plan not found');
   const at=now();if(!Number.isSafeInteger(at)||at<plan.updatedAt||at>8640000000000000-120000)fail(503,'The reset inspection clock is unavailable');
   const base={kind:'reset-inspection',seasonId,planRevision:plan.revision,readAt:at,expiresAt:at+120000,executionAvailable:false,canReset:false,reviewToken:null};
   const blockers=['reset-execution-unavailable','archive-write-protection-unverified','ownership-history-unverified'];if(plan.state==='cancelled')blockers.push('plan-cancelled');if(at<plan.startsAt)blockers.push('boundary-not-reached');if(at>=plan.endsAt)blockers.push('planned-window-ended');
   const finish=value=>{db.exec('RELEASE season_reset_inspection');return {...base,blockers:[...new Set(blockers)],...value};};
   if(!exists('territory_events')||!exists('territory_attacks')){blockers.push('control-source-unavailable');return finish({available:false,candidates:null,targets:null});}
   const candidates=db.prepare("SELECT id,territory_key,territory_name,status FROM territory_events WHERE status<>'ended' OR status IS NULL ORDER BY id LIMIT 65").all();if(candidates.length>64)fail(503,'Reset inspection capacity requires review');
   const project=row=>{if(!Number.isSafeInteger(row.id)||row.id<1)fail(503,'Event identity requires review');const value={eventId:row.id,territoryKey:typeof row.territory_key==='string'&&/^[a-z0-9][a-z0-9-]{0,79}$/.test(row.territory_key)?row.territory_key:null,territoryName:label(row.territory_name),status:['scheduled','live','paused','ended'].includes(row.status)?row.status:'unknown'};if(!value.territoryKey||!value.territoryName||value.status==='unknown')blockers.push('target-control-unverified');return value;};const projected=candidates.map(project);
   if(!targetEventIds.length){blockers.push('explicit-targets-required');return finish({available:true,candidates:projected,targets:[]});}
   const targets=[],keys=new Set();for(const eventId of [...targetEventIds].sort((a,b)=>a-b)){
    const event=db.prepare('SELECT id,territory_key,territory_name,status,owner_name,frozen_owner_name,challenger_name,control_score,owner_control,challenger_control,starts_at,ends_at,protection_until,live_test_mode FROM territory_events WHERE id=?').get(eventId);
    if(!event){blockers.push('target-event-missing');targets.push({eventId,available:false});continue;}
    if(typeof event.territory_key!=='string'||!/^[a-z0-9][a-z0-9-]{0,79}$/.test(event.territory_key)||!['scheduled','live','paused','ended'].includes(event.status)||typeof event.owner_name!=='string'||!event.owner_name.trim()||event.owner_name.length>160||!Number.isFinite(event.control_score)||event.control_score<-100||event.control_score>100||![event.owner_control,event.challenger_control].every(value=>Number.isInteger(value)&&value>=0&&value<=100))blockers.push('target-control-unverified');
    if(keys.has(event.territory_key))blockers.push('duplicate-territory-targets');keys.add(event.territory_key);if(event.live_test_mode!==0)blockers.push('test-mode-target');
    const competing=db.prepare("SELECT COUNT(*) n FROM territory_events WHERE territory_key=? AND status<>'ended' AND id<>?").get(event.territory_key,eventId).n;if(competing)blockers.push('ambiguous-current-control');
    const attacks=db.prepare("SELECT id,status FROM territory_attacks WHERE event_id=? AND (status NOT IN('resolved','cancelled') OR status IS NULL) ORDER BY id LIMIT 257").all(eventId);if(attacks.length>256)fail(503,'Reset inspection capacity requires review');const active=attacks.filter(row=>['warning','active'].includes(row.status)).length,unknown=attacks.length-active;if(active)blockers.push('active-attacks');if(unknown)blockers.push('attack-state-unverified');
    let registrations=null,lineups=null,treasury=null;
    if(exists('territory_event_registrations'))registrations=db.prepare('SELECT COUNT(*) n FROM territory_event_registrations WHERE event_id=?').get(eventId).n;else blockers.push('registration-history-unavailable');
    if(exists('territory_event_lineups'))lineups=db.prepare('SELECT COUNT(*) n FROM territory_event_lineups WHERE event_id=?').get(eventId).n;else blockers.push('lineup-history-unavailable');
    if(exists('hv_treasury_territory_delivery')){const counts=db.prepare('SELECT outcome,COUNT(*) n FROM hv_treasury_territory_delivery WHERE event_id=? GROUP BY outcome').all(eventId);treasury={pending:0,delivered:0,notDelivered:0,unknown:0};for(const row of counts){if(!Number.isSafeInteger(row.n)||row.n<0)fail(503,'Treasury entry counts require review');if(row.outcome==='pending')treasury.pending=row.n;else if(row.outcome==='delivered')treasury.delivered=row.n;else if(row.outcome==='not_delivered')treasury.notDelivered=row.n;else{treasury.unknown+=row.n;blockers.push('treasury-entry-history-unverified');}}if(treasury.pending)blockers.push('pending-treasury-entries');if(treasury.delivered)blockers.push('paid-entry-policy-required');}else blockers.push('treasury-entry-history-unavailable');
    if(![registrations,lineups,competing].every(value=>value===null||Number.isSafeInteger(value)&&value>=0))fail(503,'Reset inspection counts require review');
    targets.push({...project(event),available:true,currentOwnerLabel:label(event.owner_name),verifiedHistoricalWinner:null,controlScore:Number.isFinite(event.control_score)&&event.control_score>=-100&&event.control_score<=100?event.control_score:null,activeAttacks:active,unknownAttackStates:unknown,registrations,lineups,treasury,neutralResetApplied:false});
   }
   if(candidates.some(row=>!targetEventIds.includes(row.id)))blockers.push('current-events-not-selected');
   return finish({available:true,candidates:projected,targets});
  }catch(error){db.exec('ROLLBACK TO season_reset_inspection;RELEASE season_reset_inspection');throw error;}
 }
 return {read};
}
module.exports={createTerritorySeasonResetInspection};
