'use strict';
const {createHash,randomUUID}=require('node:crypto');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const timestamp=value=>Number.isSafeInteger(value)&&value>=0&&value<=8640000000000000;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
function createTerritorySeasonPlans(db,{enabled=()=>process.env.TERRITORY_SEASON_PLANS_ENABLED==='1',readOnly=()=>false,now=Date.now,initialize=false}={}){
 const exists=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
 const storage=()=>exists('territory_season_plans')&&exists('territory_season_plan_edits');
 if(initialize){if(!enabled()||readOnly())fail(503,'Season planning storage is not enabled');db.exec(`CREATE TABLE IF NOT EXISTS territory_season_plans(season_id TEXT PRIMARY KEY,definition_json TEXT NOT NULL,operation_id TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS territory_season_plan_edits(id TEXT PRIMARY KEY,season_id TEXT NOT NULL,actor_binding TEXT NOT NULL,request_id TEXT NOT NULL,review_json TEXT NOT NULL,receipt_json TEXT NOT NULL,UNIQUE(actor_binding,request_id));
 CREATE INDEX IF NOT EXISTS territory_season_plan_history ON territory_season_plan_edits(season_id);`);}
 function clock(){const at=now();if(!timestamp(at)||at>8640000000000000-120000)fail(503,'The season planning clock is unavailable');return at;}
 function actor(input){if(!input||!Number.isSafeInteger(input.id)||input.id<1||typeof input.steamId!=='string'||!/^\d{17}$/.test(input.steamId))fail(403,'A current linked administrator is required');const row=db.prepare('SELECT steam_id,is_admin FROM users WHERE id=?').get(input.id);if(!row||row.steam_id!==input.steamId||row.is_admin!==1)fail(403,'A current linked administrator is required');return input.id+':'+input.steamId;}
 function input(value){
  if(!value||!['save','cancel'].includes(value.action)||!exact(value,value.action==='save'?['action','seasonId','expectedRevision','name','startsAt','endsAt']:['action','seasonId','expectedRevision']))fail(400,'Review an exact season change');
  if(typeof value.seasonId!=='string'||!/^season-[a-z0-9][a-z0-9-]{0,56}$/.test(value.seasonId)||!Number.isSafeInteger(value.expectedRevision)||value.expectedRevision<0||value.expectedRevision>=Number.MAX_SAFE_INTEGER)fail(400,'Invalid season reference or revision');
  if(value.action==='save'&&(typeof value.name!=='string'||!value.name.trim()||value.name!==value.name.trim()||value.name.length>120||/[\x00-\x1f\x7f]/.test(value.name)||!timestamp(value.startsAt)||!timestamp(value.endsAt)||value.endsAt<=value.startsAt))fail(400,'A season needs a name and explicit ordered dates');
  return value.action==='save'?{action:value.action,seasonId:value.seasonId,expectedRevision:value.expectedRevision,name:value.name,startsAt:value.startsAt,endsAt:value.endsAt}:{action:value.action,seasonId:value.seasonId,expectedRevision:value.expectedRevision};
 }
 function checkedEdit(row){
  let review,receipt;try{if(!row||typeof row.review_json!=='string'||typeof row.receipt_json!=='string'||row.review_json.length>8192||row.receipt_json.length>8192)throw Error();review=JSON.parse(row.review_json);receipt=JSON.parse(row.receipt_json);if(!review||typeof review!=='object'||Array.isArray(review)||!receipt||typeof receipt!=='object'||Array.isArray(receipt))throw Error();}catch{fail(503,'Season planning history requires review');}
  let action;try{action=input(review.input);}catch{fail(503,'Season planning history requires review');}
  const definition=receipt.definition;
  if(!definition||!exact(definition,['seasonId','name','startsAt','endsAt','state','revision','updatedAt'])||typeof definition.name!=='string'||!definition.name.trim()||definition.name.length>120||/[\x00-\x1f\x7f]/.test(definition.name)||!timestamp(definition.startsAt)||!timestamp(definition.endsAt)||definition.endsAt<=definition.startsAt||review.version!==1||!timestamp(review.preparedAt)||review.expiresAt-review.preparedAt!==120000||!timestamp(review.expiresAt)||receipt.id!==row.id||receipt.requestId!==row.request_id||review.actorBinding!==row.actor_binding||action.seasonId!==row.season_id||definition.seasonId!==row.season_id||definition.revision!==action.expectedRevision+1||!timestamp(receipt.at)||receipt.at<review.preparedAt||receipt.at>=review.expiresAt||definition.updatedAt!==receipt.at||definition.state!==(action.action==='cancel'?'cancelled':'planned')||action.action==='save'&&(definition.name!==action.name||definition.startsAt!==action.startsAt||definition.endsAt!==action.endsAt)||receipt.reviewDigest!==hash(review))fail(503,'Season planning history requires review');
  return {review,receipt};
 }
 function current(id){
  if(!storage())fail(503,'Season planning storage is unavailable');
  const row=db.prepare('SELECT * FROM territory_season_plans WHERE season_id=?').get(id),latest=db.prepare('SELECT * FROM territory_season_plan_edits WHERE season_id=? ORDER BY rowid DESC LIMIT 1').get(id);
  if(!row){if(latest)fail(503,'Season planning history requires review');return null;}
  const {receipt}=checkedEdit(latest);if(row.operation_id!==latest.id||row.definition_json!==JSON.stringify(receipt.definition))fail(503,'Season planning history requires review');return receipt.definition;
 }
 function definitions(){if(db.prepare('SELECT 1 FROM territory_season_plan_edits e LEFT JOIN territory_season_plans p ON p.season_id=e.season_id WHERE p.season_id IS NULL LIMIT 1').get())fail(503,'Season planning history requires review');const rows=db.prepare('SELECT season_id FROM territory_season_plans ORDER BY season_id LIMIT 501').all();if(rows.length>500)fail(503,'Season planning capacity requires review');return rows.map(row=>current(row.season_id));}
 function validate(action,saved,at){
  if((saved?.revision||0)!==action.expectedRevision)fail(409,'The season changed; review it again');
  if(saved&&(saved.state==='cancelled'||at>=saved.startsAt))fail(409,'Cancelled or started season plans cannot be rewritten');
  if(action.action==='cancel'){if(!saved)fail(404,'Season plan not found');return;}
  if(action.startsAt<=at)fail(409,'Season plans must start in the future');
  if(saved&&saved.name===action.name&&saved.startsAt===action.startsAt&&saved.endsAt===action.endsAt)fail(409,'This season definition is already saved');
  const rows=definitions();if(!saved&&rows.length>=500)fail(503,'Season planning capacity requires review');
  if(rows.some(row=>row.seasonId!==action.seasonId&&row.state!=='cancelled'&&action.startsAt<row.endsAt&&action.endsAt>row.startsAt))fail(409,'Season dates overlap another saved plan');
 }
 function list(rawActor){actor(rawActor);if(!storage())return {available:false,seasons:[]};db.exec('SAVEPOINT season_plan_read');try{actor(rawActor);const at=clock(),seasons=definitions().map(row=>({...row,canEdit:enabled()&&!readOnly()&&row.state==='planned'&&at<row.startsAt,runtimeActivated:false}));db.exec('RELEASE season_plan_read');return {available:true,seasons};}catch(error){db.exec('ROLLBACK TO season_plan_read;RELEASE season_plan_read');throw error;}}
 function receipt(rawActor,requestId){const binding=actor(rawActor);if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(requestId))fail(400,'A valid request reference is required');if(!storage())fail(503,'Season planning storage is unavailable');const row=db.prepare('SELECT * FROM territory_season_plan_edits WHERE actor_binding=? AND request_id=?').get(binding,requestId);if(!row)fail(404,'Season planning receipt not found');return {receipt:checkedEdit(row).receipt};}
 function prepare(rawActor,rawInput){const binding=actor(rawActor);if(!enabled()||readOnly())fail(503,'Season planning changes are unavailable');const action=input(rawInput),at=clock(),saved=current(action.seasonId);validate(action,saved,at);const review={version:1,actorBinding:binding,input:action,expectedDigest:hash(saved),preparedAt:at,expiresAt:at+120000};return {review,digest:hash(review)};}
 function confirm(rawActor,offer,requestId){
  const binding=actor(rawActor);if(readOnly())fail(403,'This preview cannot change season plans');if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(requestId)||!exact(offer,['review','digest'])||!exact(offer.review,['version','actorBinding','input','expectedDigest','preparedAt','expiresAt']))fail(400,'An exact season review and request reference are required');
  const review=offer.review,action=input(review.input);if(review.version!==1||review.actorBinding!==binding||!timestamp(review.preparedAt)||!timestamp(review.expiresAt)||review.expiresAt-review.preparedAt!==120000||typeof review.expectedDigest!=='string'||!/^[a-f0-9]{64}$/.test(review.expectedDigest)||offer.digest!==hash(review))fail(409,'The season review changed');
  if(!storage())fail(503,'Season planning storage is unavailable');const serialized=JSON.stringify(review);db.exec('BEGIN IMMEDIATE');try{
   actor(rawActor);const old=db.prepare('SELECT * FROM territory_season_plan_edits WHERE actor_binding=? AND request_id=?').get(binding,requestId);
   if(old){if(old.review_json!==serialized)fail(409,'Conflicting season request');const result=checkedEdit(old).receipt;db.exec('COMMIT');return {receipt:result,duplicate:true};}
   if(!enabled())fail(503,'Season planning changes are unavailable');const at=clock();if(at<review.preparedAt||at>=review.expiresAt)fail(409,'The season review expired');
   const saved=current(action.seasonId);if(saved&&at<saved.updatedAt)fail(503,'Season planning clock requires review');if(hash(saved)!==review.expectedDigest)fail(409,'The season changed; review it again');validate(action,saved,at);
   const definition={seasonId:action.seasonId,name:action.action==='save'?action.name:saved.name,startsAt:action.action==='save'?action.startsAt:saved.startsAt,endsAt:action.action==='save'?action.endsAt:saved.endsAt,state:action.action==='cancel'?'cancelled':'planned',revision:action.expectedRevision+1,updatedAt:at};
   const id=randomUUID(),receipt={id,requestId,at,reviewDigest:offer.digest,definition};db.prepare('INSERT INTO territory_season_plans VALUES(?,?,?) ON CONFLICT(season_id) DO UPDATE SET definition_json=excluded.definition_json,operation_id=excluded.operation_id').run(action.seasonId,JSON.stringify(definition),id);
   db.prepare('INSERT INTO territory_season_plan_edits VALUES(?,?,?,?,?,?)').run(id,action.seasonId,binding,requestId,serialized,JSON.stringify(receipt));db.exec('COMMIT');return {receipt,duplicate:false};
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 return {list,prepare,confirm,receipt};
}
module.exports={createTerritorySeasonPlans};
