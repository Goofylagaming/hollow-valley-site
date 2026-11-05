const {balances}=require('./groupTreasuryAccounting');
const fail=(code,message,status=409)=>Object.assign(new Error(message),{code,status});
function initialize(db){db.exec(`CREATE TABLE IF NOT EXISTS economy_group_treasury_closures (
  request_id TEXT PRIMARY KEY,group_id INTEGER NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN('frozen','closed','cancelled')),created_at TEXT NOT NULL DEFAULT(datetime('now')));
  CREATE UNIQUE INDEX IF NOT EXISTS group_treasury_closure_active ON economy_group_treasury_closures(group_id) WHERE state IN('frozen','closed');
  CREATE TABLE IF NOT EXISTS economy_group_treasury_closure_audit (
  id INTEGER PRIMARY KEY,request_id TEXT NOT NULL,state TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT(datetime('now')));`);}
function assertOpen(db,groupId){
  if(db.prepare("SELECT request_id FROM economy_group_treasury_closures WHERE group_id=? AND state IN('frozen','closed')").get(groupId))throw fail('GROUP_CLOSING','Group Treasury is frozen for closure');
}
function createGroupTreasuryClosure(store){
  const db=store.db;require('./groupTreasuryService').createGroupTreasury(store);initialize(db);
  const atomic=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  function details(input){if(!Number.isSafeInteger(input?.groupId)||input.groupId<1||typeof input.requestId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(input.requestId)||typeof input.actorSteamId!=='string'||!/^\d{17}$/.test(input.actorSteamId)||!['leave','disband'].includes(input.action))throw fail('INVALID_CLOSURE','A valid group closure ticket is required',400);return input;}
  const project=row=>({groupId:row.group_id,requestId:row.request_id,action:row.action,state:row.state});
  function read(d){const row=db.prepare('SELECT * FROM economy_group_treasury_closures WHERE request_id=?').get(d.requestId);
    if(row&&(row.group_id!==d.groupId||row.actor!==d.actorSteamId||row.action!==d.action))throw fail('CLOSURE_CONFLICT','Closure ticket already has different details');return row;}
  function audit(d,state){db.prepare('INSERT INTO economy_group_treasury_closure_audit(request_id,state,actor) VALUES(?,?,?)').run(d.requestId,state,d.actorSteamId);}
  function insert(d,state){db.prepare('INSERT INTO economy_group_treasury_closures(request_id,group_id,actor,action,state) VALUES(?,?,?,?,?)').run(d.requestId,d.groupId,d.actorSteamId,d.action,state);audit(d,state);return project(read(d));}
  function begin(input){const d=details(input);return atomic(()=>{
    const previous=read(d);if(previous)return project(previous);
    const existing=db.prepare("SELECT request_id FROM economy_group_treasury_closures WHERE group_id=? AND state IN('frozen','closed')").get(d.groupId);
    if(existing)throw fail('CLOSURE_CONFLICT','Another closure ticket already froze this group');
    const state=balances(db,d.groupId);
    if(state.balance!==0||state.held!==0)throw fail('TREASURY_FUNDS_REMAIN','Resolve Treasury funds and reserved spending before closing the group');
    return insert(d,'frozen');
  });}
  function abort(input){const d=details(input);return atomic(()=>{
    const row=read(d);if(!row)return insert(d,'cancelled');
    if(row.state!=='frozen')return project(row);
    db.prepare("UPDATE economy_group_treasury_closures SET state='cancelled' WHERE request_id=?").run(d.requestId);audit(d,'cancelled');return project(read(d));
  });}
  function complete(input){const d=details(input);return atomic(()=>{
    const row=read(d);if(!row)throw fail('CLOSURE_UNAVAILABLE','Closure ticket unavailable',404);
    if(row.state!=='frozen')return project(row);
    db.prepare("UPDATE economy_group_treasury_closures SET state='closed' WHERE request_id=?").run(d.requestId);audit(d,'closed');return project(read(d));
  });}
  return {begin,abort,complete};
}
module.exports={initialize,assertOpen,createGroupTreasuryClosure};
