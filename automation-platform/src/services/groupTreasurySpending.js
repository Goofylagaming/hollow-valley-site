const {randomUUID}=require('node:crypto');
const {balances}=require('./groupTreasuryAccounting');
const error=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const FRAMES=['fern','sandstone','night'];
// Internal accounting only. Callers must establish trusted catalog-review and
// current website-group owner authority. No runtime spending route is mounted.
function createGroupTreasurySpending(store,{enabled=()=>process.env.GROUP_TREASURY_ENABLED==='1'&&process.env.GROUP_TREASURY_SPEND_ENABLED==='1',verifyFulfillment=null}={}){
  require('./groupTreasuryService').createGroupTreasury(store);
  const db=store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS economy_group_treasury_catalog (
    item_id TEXT NOT NULL,revision INTEGER NOT NULL,item_json TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,
    reviewed_by TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT(datetime('now')),PRIMARY KEY(item_id,revision));
    CREATE UNIQUE INDEX IF NOT EXISTS group_treasury_catalog_active ON economy_group_treasury_catalog(item_id) WHERE enabled=1;
    CREATE TABLE IF NOT EXISTS economy_group_treasury_catalog_audit (
    id INTEGER PRIMARY KEY,item_id TEXT NOT NULL,revision INTEGER NOT NULL,action TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE TABLE IF NOT EXISTS economy_group_treasury_spends (
    request_key TEXT PRIMARY KEY,group_id INTEGER NOT NULL,item_id TEXT NOT NULL,item_revision INTEGER NOT NULL,cost INTEGER NOT NULL,
    purpose TEXT NOT NULL,target_key TEXT NOT NULL,item_json TEXT NOT NULL,authorized_by TEXT NOT NULL,
    state TEXT NOT NULL CHECK(state IN('reserved','fulfilling','committed','released')),proof_json TEXT,fulfillment_proof_id TEXT,
    created_at TEXT NOT NULL DEFAULT(datetime('now')),resolved_at TEXT);
    CREATE INDEX IF NOT EXISTS group_treasury_spend_group ON economy_group_treasury_spends(group_id,state);
    CREATE UNIQUE INDEX IF NOT EXISTS group_treasury_spend_benefit ON economy_group_treasury_spends(group_id,purpose,target_key) WHERE state IN('reserved','fulfilling','committed');
    CREATE TABLE IF NOT EXISTS economy_group_treasury_spend_audit (
    id INTEGER PRIMARY KEY,request_key TEXT NOT NULL,state TEXT NOT NULL,actor TEXT NOT NULL,proof_id TEXT,created_at TEXT NOT NULL DEFAULT(datetime('now')));
    CREATE TABLE IF NOT EXISTS economy_group_treasury_cosmetics (
    group_id INTEGER NOT NULL,frame TEXT NOT NULL,request_key TEXT NOT NULL UNIQUE,
    granted_at TEXT NOT NULL DEFAULT(datetime('now')),PRIMARY KEY(group_id,frame));`);
  if(!db.prepare('PRAGMA table_info(economy_group_treasury_ledger)').all().some(row=>row.name==='spend_request_id'))db.exec('ALTER TABLE economy_group_treasury_ledger ADD COLUMN spend_request_id TEXT');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS group_treasury_spend_ledger ON economy_group_treasury_ledger(spend_request_id) WHERE spend_request_id IS NOT NULL');
  if(!db.prepare('PRAGMA table_info(economy_group_treasury_spends)').all().some(row=>row.name==='fulfillment_proof_id'))db.exec('ALTER TABLE economy_group_treasury_spends ADD COLUMN fulfillment_proof_id TEXT');
  for(const row of db.prepare('SELECT request_key,proof_json FROM economy_group_treasury_spends WHERE proof_json IS NOT NULL AND fulfillment_proof_id IS NULL').all())db.prepare('UPDATE economy_group_treasury_spends SET fulfillment_proof_id=? WHERE request_key=?').run(JSON.parse(row.proof_json).id,row.request_key);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS group_treasury_fulfillment_proof ON economy_group_treasury_spends(fulfillment_proof_id) WHERE fulfillment_proof_id IS NOT NULL');
  const atomic=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}};
  function steam(value){if(typeof value!=='string'||!/^\d{17}$/.test(value))throw error('INVALID_ACTOR','A linked acting account is required');return value;}
  function positive(value){if(!Number.isSafeInteger(value)||value<1)throw error('INVALID_SPEND','Positive whole values are required');return value;}
  function key(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(value))throw error('INVALID_REQUEST','A valid spending request ID is required');return value;}
  function exact(object,keys){if(!object||typeof object!=='object'||Array.isArray(object)||Object.keys(object).some(name=>!keys.includes(name)))throw error('INVALID_CATALOG','Unsupported Treasury item fields');}
  function item(input){
    exact(input,['id','revision','title','description','cost','purpose','target']);
    if(typeof input.id!=='string'||!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(input.id)||typeof input.title!=='string'||!input.title.trim()||input.title.length>100||typeof input.description!=='string'||input.description.length>500||/[\x00-\x1f\x7f]/.test(input.title+input.description))throw error('INVALID_CATALOG','Valid item identity and text are required');
    positive(input.revision);positive(input.cost);
    let target;
    if(input.purpose==='group_cosmetic'){
      exact(input.target,['kind','value']);if(input.target.kind!=='profile_frame'||!FRAMES.includes(input.target.value))throw error('INVALID_CATALOG','Choose an available cosmetic profile frame');
      target={kind:'profile_frame',value:input.target.value};
    }else if(input.purpose==='territory_entry'){
      exact(input.target,['eventId']);positive(input.target.eventId);target={eventId:input.target.eventId};
    }else if(input.purpose==='event_registration'){
      exact(input.target,['eventId']);if(typeof input.target.eventId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(input.target.eventId))throw error('INVALID_CATALOG','A reviewed event identity is required');target={eventId:input.target.eventId};
    }else throw error('INVALID_CATALOG','Treasury purchases support cosmetics and reviewed event entry only');
    return {id:input.id,revision:input.revision,title:input.title.trim(),description:input.description,cost:input.cost,purpose:input.purpose,target};
  }
  const targetKey=value=>value.purpose==='group_cosmetic'?`profile_frame:${value.target.value}`:String(value.target.eventId);
  function catalogRow(id,revision){const row=db.prepare('SELECT * FROM economy_group_treasury_catalog WHERE item_id=? AND revision=?').get(id,revision);if(!row)throw error('ITEM_UNAVAILABLE','Reviewed Treasury item unavailable',404);return row;}
  function register(input,reviewerSteamId){
    const value=item(input),actor=steam(reviewerSteamId),json=JSON.stringify(value);
    return atomic(()=>{const previous=db.prepare('SELECT item_json FROM economy_group_treasury_catalog WHERE item_id=? AND revision=?').get(value.id,value.revision);
      if(previous){if(previous.item_json!==json)throw error('CATALOG_CONFLICT','A reviewed item revision cannot change',409);return value;}
      db.prepare('INSERT INTO economy_group_treasury_catalog(item_id,revision,item_json,reviewed_by) VALUES(?,?,?,?)').run(value.id,value.revision,json,actor);
      db.prepare("INSERT INTO economy_group_treasury_catalog_audit(item_id,revision,action,actor) VALUES(?,?,'register',?)").run(value.id,value.revision,actor);return value;
    });
  }
  function setEnabled(id,revision,value,reviewerSteamId){
    if(typeof value!=='boolean')throw error('INVALID_CATALOG','An explicit item availability is required');const actor=steam(reviewerSteamId);
    return atomic(()=>{
      const row=catalogRow(id,positive(revision));if(Boolean(row.enabled)===value)return;
      if(value){for(const previous of db.prepare('SELECT revision FROM economy_group_treasury_catalog WHERE item_id=? AND enabled=1').all(id)){
        db.prepare('UPDATE economy_group_treasury_catalog SET enabled=0 WHERE item_id=? AND revision=?').run(id,previous.revision);
        db.prepare("INSERT INTO economy_group_treasury_catalog_audit(item_id,revision,action,actor) VALUES(?,?,'disable',?)").run(id,previous.revision,actor);
      }}
      db.prepare('UPDATE economy_group_treasury_catalog SET enabled=? WHERE item_id=? AND revision=?').run(Number(value),id,revision);
      db.prepare('INSERT INTO economy_group_treasury_catalog_audit(item_id,revision,action,actor) VALUES(?,?,?,?)').run(id,revision,value?'enable':'disable',actor);
    });
  }
  const list=()=>db.prepare('SELECT item_json FROM economy_group_treasury_catalog WHERE enabled=1 ORDER BY item_id LIMIT 100').all().map(row=>JSON.parse(row.item_json));
  function details(input){const actor=steam(input?.actorSteamId),groupId=positive(input?.groupId),requestId=key(input?.requestId),revision=positive(input?.revision),cost=positive(input?.expectedCost);
    const value=JSON.parse(catalogRow(input.itemId,revision).item_json);if(value.cost!==cost)throw error('PRICE_CHANGED','Review the listed Treasury cost before spending',409);
    return {actor,groupId,requestId,value};
  }
  function verify(row){
    const ledger=db.prepare('SELECT group_id,amount,kind FROM economy_group_treasury_ledger WHERE spend_request_id=?').get(row.request_key);
    const cosmetic=db.prepare('SELECT group_id,frame FROM economy_group_treasury_cosmetics WHERE request_key=?').get(row.request_key);
    if(row.state==='committed'){
      const target=JSON.parse(row.item_json).target;
      if(!ledger||ledger.group_id!==row.group_id||ledger.amount!==-row.cost||ledger.kind!=='purchase'||
        (row.purpose==='group_cosmetic'&&(!cosmetic||cosmetic.group_id!==row.group_id||cosmetic.frame!==target.value))||
        (row.purpose!=='group_cosmetic'&&!row.proof_json))throw error('TREASURY_INTEGRITY_ERROR','Spending receipt requires review',500);
    }else if(ledger||cosmetic)throw error('TREASURY_INTEGRITY_ERROR','Unresolved spending evidence requires review',500);
    if(row.proof_json){const p=JSON.parse(row.proof_json);
      if(p.id!==row.fulfillment_proof_id||p.requestId!==row.request_key||p.groupId!==row.group_id||p.cost!==row.cost||p.purpose!==row.purpose||p.targetKey!==row.target_key||p.outcome!==(row.state==='committed'?'delivered':'not_delivered'))throw error('TREASURY_INTEGRITY_ERROR','Fulfillment receipt requires review',500);
    }
  }
  function read(groupId,requestId){const row=db.prepare('SELECT * FROM economy_group_treasury_spends WHERE group_id=? AND request_key=?').get(positive(groupId),key(requestId));if(!row)throw error('SPEND_UNAVAILABLE','Spending request unavailable',404);verify(row);return row;}
  function project(row){return {requestId:row.request_key,groupId:row.group_id,item:JSON.parse(row.item_json),state:row.state,createdAt:row.created_at,resolvedAt:row.resolved_at,fulfillment:row.proof_json?JSON.parse(row.proof_json):null};}
  function matching(row,d){if(row&&(row.group_id!==d.groupId||row.item_id!==d.value.id||row.item_revision!==d.value.revision||row.cost!==d.value.cost))throw error('SPEND_CONFLICT','Spending request already has different details',409);}
  function audit(id,state,actor,proofId=null){db.prepare('INSERT INTO economy_group_treasury_spend_audit(request_key,state,actor,proof_id) VALUES(?,?,?,?)').run(id,state,actor,proofId);}
  function insert(d,state){db.prepare('INSERT INTO economy_group_treasury_spends(request_key,group_id,item_id,item_revision,cost,purpose,target_key,item_json,authorized_by,state,resolved_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(d.requestId,d.groupId,d.value.id,d.value.revision,d.value.cost,d.value.purpose,targetKey(d.value),JSON.stringify(d.value),d.actor,state,state==='released'?new Date().toISOString():null);audit(d.requestId,state,d.actor);}
  function assertEnabled(){if(!enabled())throw error('TREASURY_SPENDING_DISABLED','New Treasury spending is not enabled',503);}
  function reserve(input){
    assertEnabled();const d=details(input);
    return atomic(()=>{
      const previous=db.prepare('SELECT * FROM economy_group_treasury_spends WHERE request_key=?').get(d.requestId);matching(previous,d);
      if(previous){verify(previous);return project(previous);}
      if(!catalogRow(d.value.id,d.value.revision).enabled)throw error('ITEM_UNAVAILABLE','Treasury item is not available',409);
      if(db.prepare("SELECT request_key FROM economy_group_treasury_spends WHERE group_id=? AND purpose=? AND target_key=? AND state IN('reserved','fulfilling','committed')").get(d.groupId,d.value.purpose,targetKey(d.value)))throw error('BENEFIT_ALREADY_RESERVED','This group benefit is already reserved or owned',409);
      if(balances(db,d.groupId).available<d.value.cost)throw error('INSUFFICIENT_TREASURY','Not enough available group coins',409);
      insert(d,'reserved');return project(read(d.groupId,d.requestId));
    });
  }
  function beginFulfillment({groupId,requestId,actorSteamId}={}){
    assertEnabled();const actor=steam(actorSteamId);
    return atomic(()=>{
      const row=read(groupId,requestId);if(row.purpose==='group_cosmetic')throw error('INVALID_SPEND','Cosmetics are fulfilled atomically');
      if(row.state==='released')throw error('SPEND_RELEASED','This spending request was released',409);
      if(row.state!=='reserved')return project(row);
      if(typeof verifyFulfillment!=='function')throw error('FULFILLMENT_NOT_CONFIGURED','Reviewed fulfillment evidence is not configured',503);
      db.prepare("UPDATE economy_group_treasury_spends SET state='fulfilling' WHERE request_key=?").run(requestId);audit(requestId,'fulfilling',actor);return project(read(groupId,requestId));
    });
  }
  function proof(row,value,outcome){
    if(!value||typeof value.id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(value.id)||value.requestId!==row.request_key||value.groupId!==row.group_id||value.cost!==row.cost||value.purpose!==row.purpose||value.targetKey!==row.target_key||value.outcome!==outcome||typeof verifyFulfillment!=='function'||verifyFulfillment(value,project(row))!==true)
      throw error('FULFILLMENT_UNVERIFIED','A verified final delivery outcome is required',409);
    if(db.prepare('SELECT request_key FROM economy_group_treasury_spends WHERE fulfillment_proof_id=? AND request_key<>?').get(value.id,row.request_key))throw error('FULFILLMENT_CONFLICT','Delivery evidence already belongs to another purchase',409);
    return {id:value.id,requestId:value.requestId,groupId:value.groupId,cost:value.cost,purpose:value.purpose,targetKey:value.targetKey,outcome};
  }
  function spend(row,actor,evidence=null){
    if(balances(db,row.group_id).balance<row.cost)throw error('TREASURY_INTEGRITY_ERROR','Reserved Treasury funds require review',500);
    db.prepare("UPDATE economy_group_treasuries SET balance=balance-?,updated_at=datetime('now') WHERE group_id=?").run(row.cost,row.group_id);
    db.prepare("INSERT INTO economy_group_treasury_ledger(id,group_id,amount,kind,spend_request_id) VALUES(?,?,?,'purchase',?)").run(randomUUID(),row.group_id,-row.cost,row.request_key);
    db.prepare("UPDATE economy_group_treasury_spends SET state='committed',resolved_at=datetime('now'),proof_json=?,fulfillment_proof_id=? WHERE request_key=?").run(evidence?JSON.stringify(evidence):null,evidence?.id??null,row.request_key);
    audit(row.request_key,'committed',actor,evidence?.id);return project(read(row.group_id,row.request_key));
  }
  function commit({groupId,requestId,actorSteamId,fulfillmentProof}={}){
    const actor=steam(actorSteamId);
    return atomic(()=>{
      const row=read(groupId,requestId);if(row.state==='committed')return project(row);
      if(row.state==='released')throw error('SPEND_RELEASED','This spending request was released',409);
      if(row.purpose==='group_cosmetic'){
        assertEnabled();if(row.state!=='reserved')throw error('INVALID_SPEND','Unexpected cosmetic hold state',409);
        const frame=JSON.parse(row.item_json).target.value;
        db.prepare('INSERT INTO economy_group_treasury_cosmetics(group_id,frame,request_key) VALUES(?,?,?)').run(groupId,frame,requestId);
        return spend(row,actor);
      }
      if(row.state!=='fulfilling')throw error('FULFILLMENT_UNVERIFIED','Dispatch must be recorded before accepting fulfillment',409);
      return spend(row,actor,proof(row,fulfillmentProof,'delivered'));
    });
  }
  function release(input){
    const d=details(input);
    return atomic(()=>{
      const row=db.prepare('SELECT * FROM economy_group_treasury_spends WHERE request_key=?').get(d.requestId);matching(row,d);
      if(!row){insert(d,'released');return project(read(d.groupId,d.requestId));}
      verify(row);if(['committed','released'].includes(row.state))return project(row);
      const evidence=row.state==='fulfilling'?proof(row,input.fulfillmentProof,'not_delivered'):null;
      db.prepare("UPDATE economy_group_treasury_spends SET state='released',resolved_at=datetime('now'),proof_json=?,fulfillment_proof_id=? WHERE request_key=?").run(evidence?JSON.stringify(evidence):null,evidence?.id??null,d.requestId);
      audit(d.requestId,'released',d.actor,evidence?.id);return project(read(d.groupId,d.requestId));
    });
  }
  const orders=groupId=>db.prepare('SELECT * FROM economy_group_treasury_spends WHERE group_id=? ORDER BY rowid DESC LIMIT 50').all(positive(groupId)).map(row=>{verify(row);return project(row);});
  const cosmetics=groupId=>db.prepare('SELECT frame,granted_at AS grantedAt,request_key FROM economy_group_treasury_cosmetics WHERE group_id=? ORDER BY frame').all(positive(groupId)).map(row=>{read(groupId,row.request_key);return {frame:row.frame,grantedAt:row.grantedAt};});
  return {register,setEnabled,list,reserve,beginFulfillment,commit,release,orders,cosmetics,read:(groupId,requestId)=>project(read(groupId,requestId))};
}
module.exports={createGroupTreasurySpending};
