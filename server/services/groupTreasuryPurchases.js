const {randomUUID}=require('node:crypto');
const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
function createGroupTreasuryPurchases(db,groups,client,{enabled=()=>process.env.GROUP_TREASURY_ENABLED==='1'&&process.env.GROUP_TREASURY_SPEND_ENABLED==='1',territory=null}={}){
  const lifecycle=require('./groupTreasuryLifecycle').createGroupTreasuryLifecycle(db);
  db.exec(`CREATE TABLE IF NOT EXISTS hv_group_treasury_purchases (
    request_id TEXT PRIMARY KEY,group_id INTEGER NOT NULL,client_key TEXT NOT NULL,created_by TEXT NOT NULL,
    item_json TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN('draft','submitted','reserved','committed','released')),
    authorized_at TEXT,resolved_at TEXT,remote_json TEXT,last_error_code TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')),
    UNIQUE(group_id,client_key));
    CREATE UNIQUE INDEX IF NOT EXISTS treasury_purchase_pending ON hv_group_treasury_purchases(group_id) WHERE state IN('draft','submitted','reserved');
    CREATE INDEX IF NOT EXISTS treasury_purchase_history ON hv_group_treasury_purchases(group_id);
    CREATE TABLE IF NOT EXISTS hv_group_treasury_purchase_audit (
    id INTEGER PRIMARY KEY,request_id TEXT NOT NULL,state TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE TABLE IF NOT EXISTS hv_group_cosmetic_selection (
    group_id INTEGER PRIMARY KEY,frame TEXT NOT NULL,revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS hv_group_cosmetic_selection_audit (
    group_id INTEGER NOT NULL,revision INTEGER NOT NULL,frame TEXT NOT NULL,actor TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT(datetime('now')),PRIMARY KEY(group_id,revision));`);
  if(!db.prepare('PRAGMA table_info(hv_group_treasury_purchases)').all().some(column=>column.name==='fulfillment_json'))db.exec('ALTER TABLE hv_group_treasury_purchases ADD COLUMN fulfillment_json TEXT');
  const atomic=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  function positive(value){if(!Number.isSafeInteger(value)||value<1)throw fail('INVALID_PURCHASE','A valid group, revision and price are required');return value;}
  function key(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(value))throw fail('INVALID_REQUEST','A valid purchase request ID is required');return value;}
  function group(actor,expected,owner=false){
    if(typeof actor!=='string'||!/^\d{17}$/.test(actor))throw fail('INVALID_ACTOR','A linked Steam account is required',403);
    const current=groups.getState(actor).current;if(!current||current.id!==expected)throw fail('PURCHASE_UNAVAILABLE','Group purchase unavailable',404);
    if(owner&&current.ownerSteamId!==actor)throw fail('GROUP_OWNER_REQUIRED','Only the current group owner can manage Treasury purchases',403);return current;
  }
  function writable(){if(!enabled())throw fail('TREASURY_SPENDING_DISABLED','New Treasury spending is not enabled',503);}
  function quote(value){
    try{const item=require('../../automation-platform/src/services/groupTreasuryCatalog').validateItem(value);
      if(['group_cosmetic','territory_entry'].includes(item.purpose))return item;
    }catch{}
    throw fail('UNSUPPORTED_FULFILLMENT','This Treasury item does not have an available website fulfillment path',503);
  }
  function row(actor,id,expectedGroupId,owner=false){key(id);const value=db.prepare('SELECT * FROM hv_group_treasury_purchases WHERE request_id=?').get(id);
    if(!value||value.group_id!==expectedGroupId)throw fail('PURCHASE_UNAVAILABLE','Group purchase unavailable',404);group(actor,expectedGroupId,owner);return value;}
  const project=value=>({requestId:value.request_id,groupId:value.group_id,item:JSON.parse(value.item_json),state:value.state,authorizedAt:value.authorized_at,resolvedAt:value.resolved_at,lastErrorCode:value.last_error_code,createdAt:value.created_at,fulfillment:value.fulfillment_json?JSON.parse(value.fulfillment_json):null,receipt:value.remote_json?JSON.parse(value.remote_json):null});
  function audit(id,state,actor){db.prepare('INSERT INTO hv_group_treasury_purchase_audit(request_id,state,actor) VALUES(?,?,?)').run(id,state,actor);}
  const selection=groupId=>db.prepare('SELECT frame,revision FROM hv_group_cosmetic_selection WHERE group_id=?').get(groupId)||{frame:'none',revision:0};
  function overview(actor){
    const current=groups.getState(actor).current;if(!current)return {group:null,canManage:false,purchases:[]};group(actor,current.id);
    return {group:{id:current.id,name:current.name,closing:Boolean(lifecycle.status(current.id))},canManage:current.ownerSteamId===actor,selection:selection(current.id),
      purchases:db.prepare('SELECT * FROM hv_group_treasury_purchases WHERE group_id=? ORDER BY rowid DESC LIMIT 20').all(current.id).map(project)};
  }
  async function catalog(actor){
    const current=groups.getState(actor).current;if(!current)throw fail('PURCHASE_UNAVAILABLE','Active group membership is required',404);group(actor,current.id);
    const result=await client.overview({groupId:current.id});group(actor,current.id);
    if(result?.groupId!==current.id||!Array.isArray(result.catalog)||result.catalog.length>100||!Array.isArray(result.cosmetics)||result.cosmetics.length>3||result.cosmetics.some(value=>!['fern','sandstone','night'].includes(value?.frame)||typeof value.grantedAt!=='string'))throw fail('SPEND_RESPONSE_MISMATCH','Treasury purchase data could not be verified',502);
    return {groupId:current.id,catalog:result.catalog.filter(value=>value.purpose==='group_cosmetic'||(value.purpose==='territory_entry'&&territory?.ready())).map(quote),cosmetics:result.cosmetics.map(value=>({frame:value.frame,grantedAt:value.grantedAt}))};
  }
  async function prepare(actor,{expectedGroupId,itemId,revision,expectedCost,requestId}={}){
    writable();positive(expectedGroupId);positive(revision);positive(expectedCost);key(requestId);group(actor,expectedGroupId,true);
    function existing(){const previous=db.prepare('SELECT * FROM hv_group_treasury_purchases WHERE group_id=? AND client_key=?').get(expectedGroupId,requestId);
      if(previous){const item=JSON.parse(previous.item_json);if(item.id!==itemId||item.revision!==revision||item.cost!==expectedCost)throw fail('PURCHASE_CONFLICT','Purchase request already has different details',409);return project(previous);}return null;}
    const previous=existing();if(previous)return previous;
    const available=await client.overview({groupId:expectedGroupId});
    if(available?.groupId!==expectedGroupId||!Array.isArray(available.catalog))throw fail('SPEND_RESPONSE_MISMATCH','Treasury item group could not be verified',502);
    const selected=available?.catalog?.find(value=>value.id===itemId&&value.revision===revision);
    if(!selected)throw fail('ITEM_UNAVAILABLE','The reviewed Treasury item is no longer available',409);
    const item=quote(selected);if(item.purpose==='territory_entry'&&!territory?.ready())throw fail('UNSUPPORTED_FULFILLMENT','Territory entry is not enabled',503);if(item.cost!==expectedCost)throw fail('PRICE_CHANGED','The listed price changed. Review the current Treasury item.',409);
    return atomic(()=>{
      group(actor,expectedGroupId,true);lifecycle.assertOpen(expectedGroupId);const duplicate=existing();if(duplicate)return duplicate;
      if(db.prepare("SELECT request_id FROM hv_group_treasury_purchases WHERE group_id=? AND state IN('draft','submitted','reserved')").get(expectedGroupId))throw fail('PURCHASE_PENDING','Resolve the existing group purchase before starting another',409);
      const fulfillment=item.purpose==='territory_entry'?territory.preview(actor,{expectedGroupId,item}):null;
      const id=randomUUID();db.prepare("INSERT INTO hv_group_treasury_purchases(request_id,group_id,client_key,created_by,item_json,state,fulfillment_json) VALUES(?,?,?,?,?,'draft',?)").run(id,expectedGroupId,requestId,actor,JSON.stringify(item),fulfillment?JSON.stringify(fulfillment):null);audit(id,'draft',actor);return project(row(actor,id,expectedGroupId,true));
    });
  }
  const payload=(value,actor)=>{const item=JSON.parse(value.item_json);return {groupId:value.group_id,requestId:value.request_id,actorSteamId:actor,itemId:item.id,revision:item.revision,expectedCost:item.cost};};
  function settle(actor,id,expectedGroupId,result){return atomic(()=>{
    const current=row(actor,id,expectedGroupId,true);
    let remoteItem;try{remoteItem=quote(result?.item);}catch{throw fail('SPEND_RESPONSE_MISMATCH','The purchase receipt could not be verified',502);}
    if(!result||result.requestId!==id||result.groupId!==expectedGroupId||!['reserved','fulfilling','committed','released'].includes(result.state)||JSON.stringify(remoteItem)!==current.item_json)throw fail('SPEND_RESPONSE_MISMATCH','The purchase receipt could not be verified',502);
    if(result.state==='fulfilling'&&remoteItem.purpose!=='territory_entry')throw fail('SPEND_RESPONSE_MISMATCH','Unexpected cosmetic dispatch state',502);
    const localState=result.state==='fulfilling'?'reserved':result.state;
    const receipt=JSON.stringify({requestId:id,groupId:expectedGroupId,item:remoteItem,state:result.state,createdAt:result.createdAt,resolvedAt:result.resolvedAt});
    if(['committed','released'].includes(current.state)){
      if(current.state!==result.state||current.remote_json!==receipt)throw fail('SPEND_RESPONSE_MISMATCH','Purchase outcomes disagree',502);return project(current);
    }
    if(current.state==='draft')throw fail('PURCHASE_NOT_AUTHORIZED','Confirm this purchase before reserving coins',409);
    if(current.state!==localState||current.remote_json!==receipt){
      db.prepare("UPDATE hv_group_treasury_purchases SET state=?,remote_json=?,last_error_code=NULL,resolved_at=CASE WHEN ? IN('committed','released') THEN datetime('now') ELSE NULL END WHERE request_id=?").run(localState,receipt,localState,id);audit(id,localState,actor);
    }
    return project(row(actor,id,expectedGroupId,true));
  });}
  function pending(actor,id,expectedGroupId,error){
    // Authority can change while the remote request is in flight. Preserve the
    // group request for its new owner, but return no management data to the old one.
    row(actor,id,expectedGroupId,true);
    const allowed=['INSUFFICIENT_TREASURY','ITEM_UNAVAILABLE','TREASURY_SPENDING_DISABLED','GROUP_CLOSING','SPEND_RESPONSE_MISMATCH','TREASURY_INTEGRITY_ERROR','PRICE_CHANGED','ENTRY_LINK_CHANGED','ENTRY_EVENT_UNAVAILABLE','ENTRY_LEADER_REQUIRED','ENTRY_LINK_REQUIRED','ENTRY_TEST_RESTRICTED','ENTRY_EVIDENCE_INCOMPLETE','ENTRY_PROOF_NOT_CONFIGURED'];
    db.prepare("UPDATE hv_group_treasury_purchases SET last_error_code=? WHERE request_id=? AND group_id=? AND state IN('submitted','reserved')").run(allowed.includes(error.code)?error.code:'SPEND_OUTCOME_UNCERTAIN',id,expectedGroupId);
    return project(row(actor,id,expectedGroupId,true));
  }
  async function confirm(actor,id,{expectedGroupId,confirmed}={}){
    if(confirmed!==true)throw fail('PURCHASE_CONFIRMATION_REQUIRED','Confirm the listed item and group coin cost');positive(expectedGroupId);
    const current=atomic(()=>{
      const value=row(actor,id,expectedGroupId,true);
      if(value.state==='draft'){writable();lifecycle.assertOpen(expectedGroupId);
        if(JSON.parse(value.item_json).purpose==='territory_entry'&&!territory?.ready())throw fail('TREASURY_SPENDING_DISABLED','New Territory entry is not enabled',503);
        db.prepare("UPDATE hv_group_treasury_purchases SET state='submitted',authorized_at=datetime('now') WHERE request_id=?").run(id);audit(id,'submitted',actor);}
      return row(actor,id,expectedGroupId,true);
    });
    if(['committed','released'].includes(current.state))return project(current);
    try{
      let result=await client.status({groupId:expectedGroupId,requestId:id});
      if(result){settle(actor,id,expectedGroupId,result);if(['committed','released'].includes(result.state))return project(row(actor,id,expectedGroupId,true));}
      writable();group(actor,expectedGroupId,true);lifecycle.assertOpen(expectedGroupId);
      if(!result){
        if(JSON.parse(current.item_json).purpose==='territory_entry'&&!territory?.ready())throw fail('TREASURY_SPENDING_DISABLED','New Territory entry is not enabled',503);
        result=await client.reserve(payload(current,actor));settle(actor,id,expectedGroupId,result);if(result.state!=='reserved')return project(row(actor,id,expectedGroupId,true));}
      group(actor,expectedGroupId,true);lifecycle.assertOpen(expectedGroupId);
      if(JSON.parse(current.item_json).purpose==='territory_entry'){
        if(!territory)throw fail('UNSUPPORTED_FULFILLMENT','Territory entry is unavailable',503);
        return settle(actor,id,expectedGroupId,await territory.finish(actor,project(row(actor,id,expectedGroupId,true)),result));
      }
      return settle(actor,id,expectedGroupId,await client.commit({groupId:expectedGroupId,requestId:id,actorSteamId:actor}));
    }catch(error){return pending(actor,id,expectedGroupId,error);}
  }
  async function reconcile(actor,id,{expectedGroupId}={}){
    const value=row(actor,id,positive(expectedGroupId),true);if(['draft','committed','released'].includes(value.state))return project(value);
    try{let result=await client.status({groupId:expectedGroupId,requestId:id});
      if(result){settle(actor,id,expectedGroupId,result);if(JSON.parse(value.item_json).purpose==='territory_entry'&&territory)result=await territory.recover(actor,project(row(actor,id,expectedGroupId,true)),result);}
      return result?settle(actor,id,expectedGroupId,result):project(row(actor,id,expectedGroupId,true));}
    catch(error){return pending(actor,id,expectedGroupId,error);}
  }
  async function release(actor,id,{expectedGroupId}={}){
    const value=atomic(()=>{
      const current=row(actor,id,positive(expectedGroupId),true);
      if(current.state==='draft'){db.prepare("UPDATE hv_group_treasury_purchases SET state='released',resolved_at=datetime('now') WHERE request_id=?").run(id);audit(id,'released',actor);}
      return row(actor,id,expectedGroupId,true);
    });
    if(['committed','released'].includes(value.state))return project(value);
    try{const item=JSON.parse(value.item_json);
      const result=item.purpose==='territory_entry'&&territory?await territory.cancel(actor,project(value),payload(value,actor)):await client.release(payload(value,actor));
      return settle(actor,id,expectedGroupId,result);}
    catch(error){return pending(actor,id,expectedGroupId,error);}
  }
  async function selectFrame(actor,{expectedGroupId,frame,expectedRevision}={}){
    positive(expectedGroupId);group(actor,expectedGroupId,true);
    if(!['none','fern','sandstone','night'].includes(frame)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw fail('INVALID_COSMETIC','Choose an owned group frame and a valid revision');
    if(frame!=='none'){
      const owned=await catalog(actor);if(owned.groupId!==expectedGroupId||!owned.cosmetics.some(value=>value.frame===frame))throw fail('COSMETIC_NOT_OWNED','The group does not own this frame',403);
    }
    return atomic(()=>{
      group(actor,expectedGroupId,true);lifecycle.assertOpen(expectedGroupId);const previous=selection(expectedGroupId);
      if(previous.revision!==expectedRevision)throw fail('COSMETIC_CHANGED','The selected group frame changed. Refresh before saving.',409);
      const revision=expectedRevision+1;
      db.prepare('INSERT INTO hv_group_cosmetic_selection(group_id,frame,revision) VALUES(?,?,?) ON CONFLICT(group_id) DO UPDATE SET frame=excluded.frame,revision=excluded.revision').run(expectedGroupId,frame,revision);
      db.prepare('INSERT INTO hv_group_cosmetic_selection_audit(group_id,revision,frame,actor) VALUES(?,?,?,?)').run(expectedGroupId,revision,frame,actor);
      return {groupId:expectedGroupId,frame,revision};
    });
  }
  return {overview,catalog,prepare,confirm,reconcile,release,selectFrame,read:(actor,id,expectedGroupId)=>project(row(actor,id,positive(expectedGroupId)))};
}
module.exports={createGroupTreasuryPurchases};
