"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const A={id:1,steam_id:'76561198000000001'},B={id:2,steam_id:'76561198000000002'},P={id:3,steam_id:'76561198000000003'},Q={id:4,steam_id:'76561198000000004'},R={id:5,steam_id:'76561198000000005'};
function setup(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,steam_id TEXT UNIQUE,username TEXT,is_admin INTEGER);CREATE TABLE wallets(user_id INTEGER,balance INTEGER);INSERT INTO wallets VALUES(1,1000)');for(const user of [A,B,P,Q,R])db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(user.id,user.steam_id,'Synthetic '+user.id,user.id<=2?1:0);let clock=Date.now(),enabled=true;
 const templateStore=require('../server/services/eventTemplateStore').createEventTemplateStore(db,{now:()=>clock}),schedules=require('../server/services/eventScheduleStore').createEventScheduleStore(db,{now:()=>clock}),registrations=require('../server/services/eventRegistrationStore').createEventRegistrationStore(db,{now:()=>clock}),teams=require('../server/services/eventTeamStore').createEventTeamStore(db,{now:()=>clock,enabled:()=>enabled});
 const template=templateStore.change(A,{id:randomUUID(),expectedRevision:0,requestKey:randomUUID(),action:'save',details:{kind:'fight-night',title:'Staff Team Fixture',description:'A planned event for team review.',rules:'Follow the event and staff rules.',durationMinutes:60,capacity:4,teamCount:2}}).current,eventId=randomUUID();schedules.change(A,{eventId,expectedRevision:0,requestKey:randomUUID(),action:'create',templateId:template.id,templateRevision:1,startsAt:clock+3600000});schedules.change(A,{eventId,expectedRevision:1,requestKey:randomUUID(),action:'publish',reason:'Staff reviewed the event schedule.'});
 const join=(user,revision=0,eventRevision=2)=>registrations.change(user,{eventId,selected:true,expectedRevision:revision,eventRevision,requestKey:randomUUID()});join(P);join(Q);
 return {db,teams,schedules,registrations,eventId,join,now:()=>clock,advance:n=>clock+=n,pause:()=>enabled=false,resume:()=>enabled=true,body:()=>{const view=teams.inspect(A,eventId);return {eventId,expectedRevision:view.plan?.revision||0,eventRevision:view.event.revision,rosterDigest:view.digest,assignments:view.proposal,reason:'Staff reviewed this exact roster and team plan.',requestKey:randomUUID()};}};
}
test('staff roster proposes balanced teams, saves only reviewed confirmed members and reveals only each player own team',t=>{
 const x=setup(t),request=x.body();assert.deepEqual(request.assignments.map(p=>p.team),[1,2]);assert.equal(x.teams.inspect(A,x.eventId).members.length,2);const result=x.teams.change(A,request);assert.equal(result.current.plan.active,true);assert.equal(x.registrations.current(P,x.eventId).plannedTeam.team,1);assert.equal(x.registrations.current(Q,x.eventId).plannedTeam.team,2);assert.equal(JSON.stringify(x.registrations.current(P,x.eventId)).includes(Q.steam_id),false);
 assert.equal(x.teams.inspect(A,x.eventId).attendanceConfirmed,false);assert.equal(x.db.prepare('SELECT balance FROM wallets').get().balance,1000);assert.equal(JSON.stringify(x.schedules.published()).includes(P.steam_id),false);
});
test('schedule and roster changes invalidate active plans without silently shuffling teams or reviving old receipts',t=>{
 const x=setup(t),first=x.body();x.teams.change(A,first);x.join(R);assert.equal(x.teams.inspect(A,x.eventId).plan.active,false);assert.equal(x.registrations.current(P,x.eventId).plannedTeam.state,'needs-staff-review');assert.equal(x.teams.change(A,first).duplicate,true);assert.equal(x.teams.change(A,first).current.plan.active,false);
 const revised=x.body();x.teams.change(B,revised);assert.equal(x.registrations.current(R,x.eventId).plannedTeam.team,1);
 x.registrations.change(Q,{eventId:x.eventId,selected:false,expectedRevision:1,requestKey:randomUUID()});assert.equal(x.teams.inspect(A,x.eventId).plan.active,false);assert.equal(x.registrations.current(Q,x.eventId).plannedTeam.team,null);
 x.schedules.change(A,{eventId:x.eventId,expectedRevision:2,requestKey:randomUUID(),action:'reschedule',startsAt:x.now()+7200000,reason:'Staff reviewed this later start time.'});const pending=x.teams.inspect(A,x.eventId);assert.equal(pending.proposal.length,0);assert.equal(pending.members.length,2);assert.equal(pending.canAssign,false);
 x.join(P,1,3);const partial=x.body();assert.equal(partial.assignments.length,1);x.teams.change(A,partial);assert.equal(x.registrations.current(P,x.eventId).plannedTeam.team,1);assert.equal(x.registrations.current(R,x.eventId).plannedTeam.team,null);
 x.join(R,1,3);assert.equal(x.teams.inspect(A,x.eventId).plan.active,false);assert.equal(x.teams.history(A,x.eventId).items.length,3);
});
test('conflicting staff reviews, stale roster digests, missing/duplicate players and oversized teams cannot overwrite plans',t=>{
 const x=setup(t),request=x.body();x.teams.change(A,request);assert.throws(()=>x.teams.change(B,{...request,requestKey:randomUUID()}),{status:409});
 for(const patch of [{assignments:[request.assignments[0]]},{assignments:[request.assignments[0],request.assignments[0]]},{assignments:[...request.assignments,{steamId:R.steam_id,team:1}]},{assignments:request.assignments.map(p=>({...p,team:3}))},{rosterDigest:'a'.repeat(64)}])assert.throws(()=>x.teams.change(A,{...x.body(),...patch}));
 x.join(R);assert.throws(()=>x.teams.change(A,{...x.body(),assignments:x.body().assignments.map(p=>({...p,team:1}))}),/per-team capacity/);assert.equal(x.teams.inspect(A,x.eventId).plan.revision,1);
});
test('failed history or receipt inserts roll back the entire assignment plan',t=>{
 const x=setup(t),request=x.body();x.db.exec("CREATE TRIGGER refuse_team_history BEFORE INSERT ON hv_event_team_history BEGIN SELECT RAISE(ABORT,'history unavailable'); END");assert.throws(()=>x.teams.change(A,request),/history unavailable/);assert.equal(x.teams.inspect(A,x.eventId).plan,null);x.db.exec('DROP TRIGGER refuse_team_history');x.teams.change(A,request);
 x.db.exec("CREATE TRIGGER refuse_team_receipt BEFORE INSERT ON hv_event_team_requests BEGIN SELECT RAISE(ABORT,'receipt unavailable'); END");assert.throws(()=>x.teams.change(A,x.body()),/receipt unavailable/);assert.equal(x.teams.inspect(A,x.eventId).plan.revision,1);assert.equal(x.teams.history(A,x.eventId).items.length,1);
});
test('current staff permissions protect rosters, history and duplicate receipts; account loss invalidates roster identity',t=>{
 const x=setup(t),request=x.body();x.teams.change(A,request);assert.throws(()=>x.teams.inspect(P,x.eventId),{status:403});assert.throws(()=>x.teams.list(null),{status:401});x.db.exec('UPDATE users SET is_admin=0 WHERE id=1');for(const fn of [()=>x.teams.inspect(A,x.eventId),()=>x.teams.history(A,x.eventId),()=>x.teams.change(A,request)])assert.throws(fn,{status:403});
 x.db.prepare('DELETE FROM users WHERE id=?').run(Q.id);assert.equal(x.teams.inspect(B,x.eventId).plan.active,false);assert.equal(x.teams.inspect(B,x.eventId).members.find(p=>p.steamId===Q.steam_id).eligible,false);
});
test('assignment edits stop at planned start and paused rollout retains existing team reads and receipt recovery',t=>{
 const x=setup(t),request=x.body();x.teams.change(A,request);x.pause();assert.equal(x.teams.inspect(A,x.eventId).plan.active,true);assert.equal(x.teams.change(A,request).duplicate,true);assert.throws(()=>x.teams.change(A,x.body()),{status:503});x.advance(3600000);assert.equal(x.registrations.current(P,x.eventId).plannedTeam.team,1);
 x.resume();assert.equal(x.teams.inspect(A,x.eventId).canAssign,false);assert.throws(()=>x.teams.change(A,x.body()),{status:409});
 x.schedules.change(A,{eventId:x.eventId,expectedRevision:2,requestKey:randomUUID(),action:'cancel',reason:'Staff cancelled this website listing.'});assert.equal(x.teams.inspect(A,x.eventId).plan.active,false);assert.equal(x.registrations.current(P,x.eventId).plannedTeam.state,'event-cancelled');
});
test('damaged saved team evidence stays unavailable without blocking player withdrawal or rewriting history',t=>{
 const x=setup(t);x.teams.change(A,x.body());x.db.prepare('UPDATE hv_event_team_plans SET assignments_json=? WHERE event_id=?').run(JSON.stringify([{steamId:P.steam_id,team:99}]),x.eventId);
 assert.equal(x.registrations.current(P,x.eventId).plannedTeam.state,'unavailable');assert.throws(()=>x.teams.inspect(A,x.eventId),{status:503});
 x.registrations.change(P,{eventId:x.eventId,selected:false,expectedRevision:1,requestKey:randomUUID()});assert.equal(x.registrations.current(P,x.eventId).selected,false);assert.equal(x.teams.history(A,x.eventId).items[0].assignments[0].team,1);
});

test('bounded immutable history and rate limits retain exact retry recovery',t=>{
 const x=setup(t),request=x.body();x.teams.change(A,request);for(let n=1;n<30;n++)x.teams.change(A,x.body());assert.throws(()=>x.teams.change(A,x.body()),{status:429});assert.equal(x.teams.change(A,request).duplicate,true);const first=x.teams.history(A,x.eventId),next=x.teams.history(A,x.eventId,{before:first.next});assert.equal(first.items.length,25);assert.equal(next.items.length,5);assert.equal(new Set([...first.items,...next.items].map(r=>r.revision)).size,30);
});
