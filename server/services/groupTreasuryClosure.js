const {randomUUID}=require('node:crypto');
const fail=(code,message,status=409)=>Object.assign(new Error(message),{code,status});
function createGroupTreasuryClosure(db,groups,client,{writable=()=>process.env.GROUP_TREASURY_READ_ONLY!=='1'&&!require('../middleware/skinStudioSafety').getSkinStudioSafety().readOnly}={}){
  const lifecycle=require('./groupTreasuryLifecycle').createGroupTreasuryLifecycle(db);
  const atomic=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  function writes(){if(!writable())throw fail('CLOSURE_READ_ONLY','This preview cannot change Treasury closure checks',403);}
  function id(value){if(!Number.isSafeInteger(value)||value<1)throw fail('INVALID_GROUP','Refresh Groups before closing this group',400);return value;}
  function groupFor(actor,expected){const group=groups.getState(actor).current;if(!group||group.id!==expected)throw fail('GROUP_MEMBERSHIP_CHANGED','Group membership changed; refresh Groups');return group;}
  const payload=row=>({groupId:row.group_id,requestId:row.request_id,actorSteamId:row.actor,action:row.action});
  function matches(row,response,state){if(response?.groupId!==row.group_id||response.requestId!==row.request_id||response.action!==row.action||response.state!==state)throw fail('CLOSURE_RESPONSE_MISMATCH','Treasury closure clearance could not be verified',502);}
  async function complete(row){
    if(row.remote_complete)return;
    matches(row,await client.complete(payload(row)),'closed');
    atomic(()=>{const current=lifecycle.read(row.group_id);if(current?.request_id!==row.request_id||current.state!=='closed')throw fail('CLOSURE_CONFLICT','Closure state changed');
      if(!current.remote_complete){db.prepare('UPDATE hv_group_treasury_closures SET remote_complete=1 WHERE group_id=?').run(row.group_id);lifecycle.event(current,'remote_complete');}});
  }
  async function reconcile(actor,{expectedGroupId}={}){
    writes();const row=lifecycle.read(id(expectedGroupId));
    if(!row||row.actor!==actor||row.state!=='closed')throw fail('CLOSURE_UNAVAILABLE','Your completed closure check is unavailable',404);
    try{await complete(row);}catch{throw fail('CLOSURE_COMPLETION_PENDING','The group is closed. Retry finishing its Treasury closure check.',502);}
    return groups.getState(actor);
  }
  async function cancel(actor,{expectedGroupId,requestId}={}){
    writes();id(expectedGroupId);
    const row=atomic(()=>{
      const group=groupFor(actor,expectedGroupId);if(group.ownerSteamId!==actor)throw fail('CLOSURE_OWNER_REQUIRED','Only the current owner can cancel a closure check',403);
      const current=lifecycle.read(group.id);if(!current||current.state==='closed')throw fail('CLOSURE_UNAVAILABLE','Active closure check unavailable',404);
      if(current.request_id!==requestId)throw fail('CLOSURE_CONFLICT','Closure check changed; refresh Groups');
      if(current.state==='cancelled')return current;
      if(current.state!=='cancelling'){db.prepare("UPDATE hv_group_treasury_closures SET state='cancelling' WHERE group_id=?").run(group.id);lifecycle.event({...current,actor},'cancelling');}
      return lifecycle.read(group.id);
    });
    if(row.state==='cancelled')return groups.getState(actor);
    try{
      matches(row,await client.abort(payload(row)),'cancelled');
      atomic(()=>{
        groupFor(actor,row.group_id);const current=lifecycle.read(row.group_id);
        if(current?.request_id!==row.request_id||!['cancelling','cancelled'].includes(current.state))throw fail('CLOSURE_CONFLICT','Closure state changed');
        if(current.state!=='cancelled'){db.prepare("UPDATE hv_group_treasury_closures SET state='cancelled' WHERE group_id=?").run(row.group_id);lifecycle.event({...current,actor},'cancelled');}
      });
    }catch{throw fail('CLOSURE_CANCELLATION_PENDING','Closure cancellation is pending. Retry cancelling the closure check.',502);}
    return groups.getState(actor);
  }
  async function close(actor,action,{expectedGroupId}={}){
    id(expectedGroupId);if(!['leave','disband'].includes(action))throw fail('INVALID_CLOSURE','Unknown group closure action',400);
    const previous=lifecycle.read(expectedGroupId);
    if(previous?.state==='closed'&&previous.actor===actor&&previous.action===action)return reconcile(actor,{expectedGroupId});
    const initial=groupFor(actor,expectedGroupId);
    if(action==='disband'&&initial.ownerSteamId!==actor)throw fail('CLOSURE_OWNER_REQUIRED','Only the owner can disband this group',403);
    if(action==='leave'&&initial.members.length>1)return groups.exitGroup(actor,null,{expectedGroupId});
    const ticket=atomic(()=>{
      const group=groupFor(actor,expectedGroupId);
      if(action==='disband'&&group.ownerSteamId!==actor)throw fail('CLOSURE_OWNER_REQUIRED','Only the owner can disband this group',403);
      // Another process may have added a member since the first read.
      if(action==='leave'&&group.members.length>1)return null;
      lifecycle.assertNoPending(group.id);const row=lifecycle.read(group.id);
      if(lifecycle.active(row)){
        writes();if(row.actor!==actor||row.action!==action||!['checking','cleared'].includes(row.state))throw fail('CLOSURE_CONFLICT','Retry or cancel the saved closure check');return row;
      }
      if(!lifecycle.needsRemote(group.id))return null;
      writes();const requestId=randomUUID();
      db.prepare("INSERT INTO hv_group_treasury_closures(group_id,request_id,actor,action,state) VALUES(?,?,?,?,'checking') ON CONFLICT(group_id) DO UPDATE SET request_id=excluded.request_id,actor=excluded.actor,action=excluded.action,state='checking',remote_complete=0").run(group.id,requestId,actor,action);
      const created=lifecycle.read(group.id);lifecycle.event(created,'checking');return created;
    });
    if(!ticket)return action==='leave'?groups.exitGroup(actor,null,{expectedGroupId}):groups.disband(actor,{expectedGroupId});
    if(ticket.state==='checking'){
      try{
        matches(ticket,await client.begin(payload(ticket)),'frozen');
        atomic(()=>{const row=lifecycle.read(ticket.group_id);
          if(row?.request_id!==ticket.request_id||!['checking','cleared','closed'].includes(row.state))throw fail('CLOSURE_CONFLICT','Closure check was cancelled or changed');
          if(row.state==='checking'){db.prepare("UPDATE hv_group_treasury_closures SET state='cleared' WHERE group_id=?").run(ticket.group_id);lifecycle.event(row,'cleared');}
        });
      }catch(error){
        const latest=lifecycle.read(ticket.group_id);
        if(latest?.request_id===ticket.request_id&&['cancelling','cancelled'].includes(latest.state))throw fail('CLOSURE_CHECK_CANCELLED','This closure check was cancelled');
        if(error.code==='TREASURY_FUNDS_REMAIN'){
          await cancel(actor,{expectedGroupId,requestId:ticket.request_id});throw error;
        }
        throw fail('CLOSURE_CHECK_UNCERTAIN','Treasury clearance could not be verified. Retry or cancel the closure check.',502);
      }
    }
    const current=lifecycle.read(ticket.group_id);
    if(current?.request_id!==ticket.request_id)throw fail('CLOSURE_CONFLICT','Closure ticket changed; refresh Groups');
    if(current?.state!=='closed'){
      const options={expectedGroupId,closureRequestId:ticket.request_id};
      if(action==='leave')groups.exitGroup(actor,null,options);else groups.disband(actor,options);
    }
    const closed=lifecycle.read(ticket.group_id);
    try{await complete(closed);}catch{/* Frozen accounting gate stays closed to funding; actor can retry completion. */}
    return groups.getState(actor);
  }
  return {close,cancel,reconcile};
}
module.exports={createGroupTreasuryClosure};
