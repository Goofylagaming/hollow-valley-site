const error=(code,message,status=409)=>Object.assign(new Error(message),{code,status});
function createGroupTreasuryLifecycle(db){
  db.exec(`CREATE TABLE IF NOT EXISTS hv_group_treasury_closures (
    group_id INTEGER PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,actor TEXT NOT NULL,action TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN('checking','cleared','cancelling','cancelled','closed')),remote_complete INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS hv_group_treasury_closure_events (
    id INTEGER PRIMARY KEY,group_id INTEGER NOT NULL,request_id TEXT NOT NULL,state TEXT NOT NULL,actor TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT(datetime('now')));`);
  const read=groupId=>db.prepare('SELECT * FROM hv_group_treasury_closures WHERE group_id=?').get(groupId);
  const active=row=>row&&!['cancelled'].includes(row.state);
  function inspect(groupId){
    const exists=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hv_group_treasury_intents'").get();
    const purchases=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hv_group_treasury_purchases'").get();
    return {pending:Boolean((exists&&db.prepare("SELECT id FROM hv_group_treasury_intents WHERE group_id=? AND state IN('draft','submitted') LIMIT 1").get(groupId))||
      (purchases&&db.prepare("SELECT request_id FROM hv_group_treasury_purchases WHERE group_id=? AND state IN('draft','submitted','reserved') LIMIT 1").get(groupId))),
      financialActivity:Boolean((exists&&db.prepare("SELECT id FROM hv_group_treasury_intents WHERE group_id=? AND authorized_at IS NOT NULL LIMIT 1").get(groupId))||
      (purchases&&db.prepare('SELECT request_id FROM hv_group_treasury_purchases WHERE group_id=? AND authorized_at IS NOT NULL LIMIT 1').get(groupId)))};
  }
  function assertNoPending(groupId){if(inspect(groupId).pending)throw error('TREASURY_REQUESTS_PENDING','Resolve pending Treasury donation or purchase requests before closing this group');}
  const needsRemote=groupId=>process.env.GROUP_TREASURY_ENABLED==='1'||inspect(groupId).financialActivity;
  function assertOpen(groupId){if(active(read(groupId)))throw error('GROUP_CLOSURE_PENDING','Group closure is being checked. Retry or cancel the closure check.');}
  function event(row,state){db.prepare('INSERT INTO hv_group_treasury_closure_events(group_id,request_id,state,actor) VALUES(?,?,?,?)').run(row.group_id,row.request_id,state,row.actor);}
  function assertMayClose(groupId,actor,action,requestId){
    assertNoPending(groupId);const row=read(groupId);
    if(requestId!==undefined){
      if(row?.state!=='cleared'||row.request_id!==requestId||row.actor!==actor||row.action!==action)throw error('GROUP_CLOSURE_PENDING','Retry or cancel the saved Treasury closure check.');
      return;
    }
    if(active(row))throw error('GROUP_CLOSURE_PENDING','Retry or cancel the saved Treasury closure check.');
    if(needsRemote(groupId))throw error('TREASURY_CLOSURE_REQUIRED','Verify Treasury clearance before closing the group');
  }
  function markClosed(groupId){const row=read(groupId);if(!active(row))return;db.prepare("UPDATE hv_group_treasury_closures SET state='closed' WHERE group_id=?").run(groupId);event(row,'closed');}
  function status(groupId){const row=read(groupId);return row&&!['cancelled','closed'].includes(row.state)?{requestId:row.request_id,state:row.state,action:row.action}:null;}
  return {read,active,inspect,assertOpen,assertNoPending,needsRemote,event,assertMayClose,markClosed,status};
}
module.exports={createGroupTreasuryLifecycle};
