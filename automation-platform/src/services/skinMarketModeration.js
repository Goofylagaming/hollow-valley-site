'use strict';
const {randomUUID}=require('node:crypto');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const key=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(value))fail('A valid reference is required');return value;};
const exists=(db,name)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
function reviewRecord(row){
 let payload,receipt;try{payload=JSON.parse(row?.payload_json);receipt=JSON.parse(row?.receipt_json);}catch{}
 if(!row||!/^\d{17}$/.test(row.reviewer)||typeof row.request_id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(row.request_id)||!Number.isSafeInteger(row.at)||row.at<0||row.at>8640000000000000||!['hold','withdraw'].includes(row.action)||payload?.action!==row.action||payload.target!==row.target||typeof payload.reason!=='string'||payload.reason.trim()!==payload.reason||payload.reason.length<5||payload.reason.length>500||receipt?.version!==1||receipt.scope!=='skin-market-review'||receipt.id!==row.id||receipt.action!==row.action||receipt.target!==row.target||receipt.at!==row.at||!Number.isSafeInteger(payload.expectedRevision)||payload.expectedRevision<0||receipt.revision!==payload.expectedRevision+1||row.action==='hold'&&(typeof payload.active!=='boolean'||receipt.active!==payload.active)||row.action==='withdraw'&&(payload.expectedRevision!==0||payload.active!==null||receipt.state!=='withdrawn'))fail('Skin market review audit requires inspection',503);
 return {payload,receipt};
}
function prepareSkinMarketModeration(db){db.exec(`
 CREATE TABLE IF NOT EXISTS economy_skin_market_holds(
 preset_id TEXT PRIMARY KEY,active INTEGER NOT NULL CHECK(active IN(0,1)),revision INTEGER NOT NULL,
 operation_id TEXT NOT NULL,at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS economy_skin_market_reviews(
 id TEXT PRIMARY KEY,reviewer TEXT NOT NULL,request_id TEXT NOT NULL,action TEXT NOT NULL,target TEXT NOT NULL,
 payload_json TEXT NOT NULL,receipt_json TEXT NOT NULL,at INTEGER NOT NULL,UNIQUE(reviewer,request_id));
 CREATE INDEX IF NOT EXISTS economy_skin_market_review_target ON economy_skin_market_reviews(target,at DESC,id DESC);
`);}
function readSkinMarketHold(db,presetId){
 const holds=exists(db,'economy_skin_market_holds'),reviews=exists(db,'economy_skin_market_reviews');
 if(!holds&&!reviews)return {active:false,revision:0,at:null};
 if(!holds||!reviews)fail('Skin market moderation history requires review',503);
 const row=db.prepare('SELECT * FROM economy_skin_market_holds WHERE preset_id=?').get(presetId);
 if(!row){if(db.prepare("SELECT 1 FROM economy_skin_market_reviews WHERE target=? AND action='hold'").get(presetId))fail('Skin market moderation history requires review',503);return {active:false,revision:0,at:null};}
 const audit=db.prepare("SELECT * FROM economy_skin_market_reviews WHERE id=? AND target=? AND action='hold'").get(row.operation_id,presetId),{receipt}=reviewRecord(audit);
 const latest=db.prepare("SELECT id FROM economy_skin_market_reviews WHERE target=? AND action='hold' ORDER BY rowid DESC LIMIT 1").get(presetId);
 if(!audit||latest?.id!==row.operation_id||!Number.isSafeInteger(row.at)||row.at<0||!Number.isSafeInteger(row.revision)||row.revision<1||![0,1].includes(row.active)||receipt?.revision!==row.revision||receipt.active!==Boolean(row.active)||receipt.at!==row.at||receipt.id!==row.operation_id||receipt.target!==presetId||receipt.action!=='hold')fail('Skin market moderation history requires review',503);
 return {active:Boolean(row.active),revision:row.revision,at:row.at};
}
function createSkinMarketModeration(store,{now=Date.now,enabled=()=>process.env.SKIN_TRADING_MANAGEMENT_ENABLED==='1',readOnly=()=>/^(1|true)$/i.test(process.env.SKIN_TRADING_READ_ONLY||''),initialize=false}={}){
 const db=store.db;if(initialize){if(!enabled()||readOnly())fail('Skin market management initialization is unavailable',503);prepareSkinMarketModeration(db);}
 const gate=()=>{if(!enabled())fail('Skin market management is disabled',503);if(!exists(db,'economy_skin_market_reviews')||!exists(db,'economy_skin_market_holds')||!exists(db,'economy_skin_listings'))fail('Skin market management history is unavailable',503);};
 const actor=user=>store.validateSteamId(user?.steam_id);
 const at=()=>{const value=now();if(!Number.isSafeInteger(value)||value<0||value>8640000000000000)fail('The review clock cannot be verified',503);return value;};
 const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
 const project=row=>{const {payload,receipt}=reviewRecord(row);return {id:row.id,action:row.action,target:row.target,reviewer:row.reviewer,reason:payload.reason,at:row.at,receipt};};
 const history=target=>db.prepare('SELECT * FROM economy_skin_market_reviews WHERE target=? ORDER BY at DESC,id DESC LIMIT 20').all(target).map(project);
 function read(user,{id}={}){
  gate();actor(user);key(id);const row=db.prepare('SELECT * FROM economy_skin_listings WHERE id=?').get(id);if(!row)fail('Listing not found',404);
  const hold=readSkinMarketHold(db,row.preset_id),value=JSON.parse(row.summary_json),trade=db.prepare('SELECT buyer,price,created_at FROM economy_skin_trades WHERE listing_id=?').get(id);
  const edits=history(id);if(row.state==='withdrawn'&&!edits.some(edit=>edit.action==='withdraw'&&edit.receipt.state==='withdrawn'&&edit.at===row.decided_at))fail('Listing withdrawal history requires review',503);
  return {listing:{id:row.id,presetId:row.preset_id,name:value.name,species:value.species,price:row.price,sellerSteamId:row.seller,state:row.state==='active'&&row.expires_at<=at()?'expired':row.state,revision:row.state==='active'?0:1,createdAt:row.created_at,expiresAt:row.expires_at},trade:trade?{buyerSteamId:trade.buyer,price:trade.price,purchasedAt:trade.created_at}:null,hold,listingHistory:edits,holdHistory:history(row.preset_id)};
 }
 function receipt(user,{requestId}={}){gate();const reviewer=actor(user);key(requestId);const row=db.prepare('SELECT * FROM economy_skin_market_reviews WHERE reviewer=? AND request_id=?').get(reviewer,requestId);if(!row)fail('Review receipt not found',404);return {receipt:reviewRecord(row).receipt};}
 function change(user,{action,target,expectedRevision,active,reason,requestId}={}){
  gate();if(readOnly())fail('This preview cannot change the skin market',403);const reviewer=actor(user),clock=at();key(target);key(requestId);
  if(!['withdraw','hold'].includes(action)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||typeof reason!=='string'||reason.trim().length<5||reason.length>500||action==='hold'&&typeof active!=='boolean'||action==='withdraw'&&(expectedRevision!==0||active!==undefined))fail('Review an exact action, revision and reason');
  const payload=JSON.stringify({action,target,expectedRevision,active:action==='hold'?active:null,reason:reason.trim()});
  return tx(()=>{
   const old=db.prepare('SELECT * FROM economy_skin_market_reviews WHERE reviewer=? AND request_id=?').get(reviewer,requestId);
   if(old){if(old.payload_json!==payload)fail('Conflicting review request',409);return {receipt:reviewRecord(old).receipt,duplicate:true};}
   const id=randomUUID();let result;
   if(action==='withdraw'){
    const row=db.prepare('SELECT * FROM economy_skin_listings WHERE id=?').get(target);if(!row)fail('Listing not found',404);
    if(!Number.isSafeInteger(row.created_at)||row.created_at>clock)fail('The listing clock cannot be verified',503);
    if(row.state!=='active'||row.expires_at<=clock)fail('This listing is already closed',409);
    db.prepare("UPDATE economy_skin_listings SET state='withdrawn',decided_at=? WHERE id=? AND state='active'").run(clock,target);
    result={version:1,scope:'skin-market-review',id,action,target,revision:1,state:'withdrawn',at:clock};
   }else{
    if(!store.getSkinPreset(target))fail('Skin not found',404);const previous=readSkinMarketHold(db,target);
    if(previous.at!==null&&clock<previous.at)fail('The review clock cannot be verified',503);
    if(previous.revision!==expectedRevision||previous.active===active)fail('The skin hold changed; refresh before a new review',409);
    if(previous.revision>=Number.MAX_SAFE_INTEGER)fail('The hold revision requires staff review',503);
    const revision=previous.revision+1;
    db.prepare('INSERT INTO economy_skin_market_holds(preset_id,active,revision,operation_id,at) VALUES(?,?,?,?,?) ON CONFLICT(preset_id) DO UPDATE SET active=excluded.active,revision=excluded.revision,operation_id=excluded.operation_id,at=excluded.at').run(target,Number(active),revision,id,clock);
    result={version:1,scope:'skin-market-review',id,action,target,revision,active,at:clock};
   }
   db.prepare('INSERT INTO economy_skin_market_reviews VALUES(?,?,?,?,?,?,?,?)').run(id,reviewer,requestId,action,target,payload,JSON.stringify(result),clock);
   return {receipt:result,duplicate:false};
  });
 }
 return {read,receipt,change};
}
module.exports={prepareSkinMarketModeration,readSkinMarketHold,createSkinMarketModeration};
