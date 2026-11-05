const {randomUUID}=require('node:crypto');
function failure(code,message,status=400){return Object.assign(new Error(message),{code,status});}
function createGroupTreasury(db,groups,client,{now=()=>new Date().toISOString(),writesEnabled=()=>process.env.GROUP_TREASURY_ENABLED==='1'}={}){
  db.exec(`CREATE TABLE IF NOT EXISTS hv_group_treasury_intents (
    id TEXT PRIMARY KEY,steam_id TEXT NOT NULL,client_key TEXT NOT NULL,group_id INTEGER NOT NULL,group_name TEXT NOT NULL,
    amount INTEGER NOT NULL,state TEXT NOT NULL CHECK(state IN('draft','submitted','confirmed','cancelled')),
    created_at TEXT NOT NULL,authorized_at TEXT,resolved_at TEXT,receipt_json TEXT,last_error_code TEXT,
    UNIQUE(steam_id,client_key));
    CREATE UNIQUE INDEX IF NOT EXISTS hv_group_treasury_active_donor ON hv_group_treasury_intents(steam_id) WHERE state IN('draft','submitted');
    CREATE TABLE IF NOT EXISTS hv_group_treasury_intent_events (
    id INTEGER PRIMARY KEY,intent_id TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL);`);
  const atomic=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
  function steamId(steam){if(typeof steam!=='string'||!/^\d{17}$/.test(steam))throw failure('INVALID_STEAM','A linked Steam account is required',403);return steam;}
  function key(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(value))throw failure('INVALID_REQUEST','A valid donation request ID is required');return value;}
  function requireEnabled(){if(!writesEnabled())throw failure('GROUP_TREASURY_DISABLED','Group Treasury donations are not enabled',503);}
  function membership(steam,id){const group=groups.getState(steam).current;if(!group||group.id!==id)throw failure('GROUP_MEMBERSHIP_CHANGED','Group membership changed; refresh before donating',409);return group;}
  function own(steam,id){steamId(steam);key(id);const row=db.prepare('SELECT * FROM hv_group_treasury_intents WHERE id=? AND steam_id=?').get(id,steam);if(!row)throw failure('DONATION_UNAVAILABLE','Donation request unavailable',404);return row;}
  function project(row){return {id:row.id,groupId:row.group_id,groupName:row.group_name,amount:row.amount,state:row.state,createdAt:row.created_at,
    authorizedAt:row.authorized_at,resolvedAt:row.resolved_at,lastErrorCode:row.last_error_code,receipt:row.receipt_json?JSON.parse(row.receipt_json):null};}
  function event(id,state,at){db.prepare('INSERT INTO hv_group_treasury_intent_events(intent_id,state,created_at) VALUES(?,?,?)').run(id,state,at);}
  function prepare(steam,{expectedGroupId,amount,requestId}={}){
    requireEnabled();steamId(steam);key(requestId);
    if(!Number.isSafeInteger(expectedGroupId)||expectedGroupId<1||!Number.isSafeInteger(amount)||amount<1)throw failure('INVALID_DONATION','A group and a positive whole coin amount are required');
    return atomic(()=>{
      const previous=db.prepare('SELECT * FROM hv_group_treasury_intents WHERE steam_id=? AND client_key=?').get(steam,requestId);
      if(previous){if(previous.group_id!==expectedGroupId||previous.amount!==amount)throw failure('DONATION_CONFLICT','Donation request already has different details',409);return project(previous);}
      const group=membership(steam,expectedGroupId);
      if(db.prepare("SELECT id FROM hv_group_treasury_intents WHERE steam_id=? AND state IN('draft','submitted')").get(steam))throw failure('DONATION_PENDING','Review your existing donation before starting another',409);
      const id=randomUUID(),at=now();
      db.prepare("INSERT INTO hv_group_treasury_intents(id,steam_id,client_key,group_id,group_name,amount,state,created_at) VALUES(?,?,?,?,?,?,'draft',?)").run(id,steam,requestId,group.id,group.name,amount,at);
      event(id,'draft',at);return project(own(steam,id));
    });
  }
  const payload=row=>({steamId:row.steam_id,groupId:row.group_id,amount:row.amount,requestId:row.id});
  function settle(steam,id,result){
    return atomic(()=>{
      const row=own(steam,id);let receipt=null;
      if(result?.state==='confirmed'){
        const r=result.donation;
        if(!r||r.groupId!==row.group_id||r.amount!==row.amount||r.requestId!==row.id||typeof r.createdAt!=='string'||typeof r.id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(r.id))throw failure('TREASURY_RESPONSE_MISMATCH','Donation receipt requires review',502);
        receipt=JSON.stringify({id:r.id,requestId:r.requestId,groupId:r.groupId,amount:r.amount,createdAt:r.createdAt});
      }else if(result?.state==='cancelled'){
        if(result.requestId!==row.id||result.groupId!==row.group_id||result.amount!==row.amount)throw failure('TREASURY_RESPONSE_MISMATCH','Cancellation receipt requires review',502);
      }else throw failure('TREASURY_RESPONSE_MISMATCH','Donation outcome is not confirmed',502);
      if(['confirmed','cancelled'].includes(row.state)){
        if(row.state!==result.state||(row.state==='confirmed'&&row.receipt_json!==receipt))throw failure('TREASURY_RESPONSE_MISMATCH','Donation outcomes disagree',502);
        return project(row);
      }
      if(row.state!=='submitted')throw failure('DONATION_CONFLICT','Donation has not been authorized',409);
      const at=now();db.prepare('UPDATE hv_group_treasury_intents SET state=?,resolved_at=?,receipt_json=?,last_error_code=NULL WHERE id=?').run(result.state,at,receipt,id);
      event(id,result.state,at);return project(own(steam,id));
    });
  }
  function pendingError(steam,id,error){
    const allowed=['INSUFFICIENT_FUNDS','TREASURY_LIMIT','GROUP_TREASURY_DISABLED','TREASURY_INTEGRITY_ERROR','TREASURY_RESPONSE_MISMATCH','GROUP_MEMBERSHIP_CHANGED'];
    db.prepare("UPDATE hv_group_treasury_intents SET last_error_code=? WHERE id=? AND steam_id=? AND state='submitted'").run(allowed.includes(error.code)?error.code:'AUTOMATION_UNAVAILABLE',id,steam);
    return project(own(steam,id));
  }
  async function confirm(steam,id,{confirmed,expectedGroupId}={}){
    if(confirmed!==true)throw failure('DONATION_CONFIRMATION_REQUIRED','Confirm the displayed group and coin amount before donating');
    const row=atomic(()=>{
      const current=own(steam,id);
      if(current.group_id!==expectedGroupId)throw failure('GROUP_MEMBERSHIP_CHANGED','Donation group changed; review the saved request',409);
      if(current.state==='draft'){
        requireEnabled();membership(steam,current.group_id);const at=now();
        db.prepare("UPDATE hv_group_treasury_intents SET state='submitted',authorized_at=? WHERE id=?").run(at,id);event(id,'submitted',at);
      }
      return own(steam,id);
    });
    if(row.state!=='submitted')return project(row);
    try{
      const known=await client.outcome({steamId:steam,requestId:id});if(known)return settle(steam,id,known);
      requireEnabled();membership(steam,row.group_id);
      const result=await client.donate(payload(row));return settle(steam,id,{state:'confirmed',donation:result?.donation});
    }catch(error){return pendingError(steam,id,error);}
  }
  async function reconcile(steam,id){
    const row=own(steam,id);if(row.state!=='submitted')return project(row);
    try{const known=await client.outcome({steamId:steam,requestId:id});return known?settle(steam,id,known):project(own(steam,id));}
    catch(error){return pendingError(steam,id,error);}
  }
  async function cancel(steam,id){
    const row=atomic(()=>{
      const current=own(steam,id);
      if(current.state==='draft'){const at=now();db.prepare("UPDATE hv_group_treasury_intents SET state='cancelled',resolved_at=? WHERE id=?").run(at,id);event(id,'cancelled',at);}
      return own(steam,id);
    });
    if(row.state!=='submitted')return project(row);
    try{return settle(steam,id,await client.cancel(payload(row)));}catch(error){return pendingError(steam,id,error);}
  }
  async function current(steam){
    steamId(steam);const group=groups.getState(steam).current;
    const donations=db.prepare('SELECT * FROM hv_group_treasury_intents WHERE steam_id=? ORDER BY rowid DESC LIMIT 20').all(steam).map(project);
    if(!group)return {group:null,treasury:null,donations};
    const treasury=await client.get({groupId:group.id});membership(steam,group.id);
    if(treasury?.groupId!==group.id||!Number.isSafeInteger(treasury.balance)||treasury.balance<0||!Array.isArray(treasury.transactions)||treasury.transactions.length>50)throw failure('TREASURY_RESPONSE_MISMATCH','Group Treasury balance requires review',502);
    return {group:{id:group.id,name:group.name},treasury:{groupId:group.id,balance:treasury.balance,transactions:treasury.transactions.map(row=>({id:row.id,amount:row.amount,kind:row.kind,createdAt:row.createdAt}))},donations};
  }
  return {prepare,confirm,cancel,reconcile,current,read:(steam,id)=>project(own(steam,id))};
}
module.exports={createGroupTreasury};
