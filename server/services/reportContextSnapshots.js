'use strict';
const {createHash,createHmac,timingSafeEqual,randomUUID}=require('node:crypto');
const {project}=require('./reportContext');
const REVIEW_MS=600000,DAY_MS=86400000,MAX_BYTES=131072;
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function createReportContextSnapshots({db,env=process.env,now=Date.now}={}){
 function clock(){const at=now();if(!Number.isSafeInteger(at)||at<0||at>8640000000000000-366*DAY_MS)fail(503,'Snapshot time is unavailable.');return at;}
 function policy(){const days=Number(env.PLAYER_REPORT_CONTEXT_RETENTION_DAYS||0),secret=String(env.PLAYER_REPORT_CONTEXT_REVIEW_SECRET||'');return {enabled:env.PLAYER_REPORT_CONTEXT_ENABLED==='1'&&env.PLAYER_REPORT_CONTEXT_SNAPSHOTS_ENABLED==='1',configured:[30,90,365].includes(days)&&Buffer.byteLength(secret)>=32,days,secret};}
 function actor(getUser,binding){const user=getUser();if(!Number.isSafeInteger(user?.id)||user.id<=0||!/^\d{17}$/.test(String(user?.steam_id||'')))fail(403,'Current linked moderator access is required.');const row=db.prepare('SELECT id,steam_id,is_admin FROM users WHERE id=?').get(user.id);if(!row?.is_admin||row.steam_id!==user.steam_id||binding!==row.id+':'+row.steam_id)fail(403,'The moderator account or permission changed.');return row;}
 function report(id){if(!uuid(id))fail(400,'Invalid report reference.');const row=db.prepare('SELECT id,reporter_steam_id,reported_steam_id,occurred_at FROM player_reports WHERE id=?').get(id);if(!row)fail(404,'Report not found.');const at=typeof row.occurred_at==='string'?Date.parse(row.occurred_at):NaN;if(!/^\d{17}$/.test(row.reporter_steam_id)||(row.reported_steam_id!==null&&(!/^\d{17}$/.test(row.reported_steam_id)||row.reported_steam_id===row.reporter_steam_id))||!Number.isSafeInteger(at)||at<0||new Date(at).toISOString()!==row.occurred_at)fail(409,'The report participants or time cannot be verified.');return row;}
 function exists(){return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='player_report_context_snapshots'").get());}
 function schema(){db.exec(`CREATE TABLE IF NOT EXISTS player_report_context_snapshots(id TEXT PRIMARY KEY,report_id TEXT NOT NULL,actor_id INTEGER NOT NULL,actor_steam TEXT NOT NULL,context_json TEXT NOT NULL,context_digest TEXT NOT NULL,report_fingerprint TEXT NOT NULL,captured_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,retention_days INTEGER NOT NULL,request_key TEXT NOT NULL,request_hash TEXT NOT NULL,UNIQUE(actor_id,request_key));CREATE INDEX IF NOT EXISTS idx_report_context_snapshot_report ON player_report_context_snapshots(report_id,captured_at DESC);CREATE INDEX IF NOT EXISTS idx_report_context_snapshot_expiry ON player_report_context_snapshots(expires_at);`);}
 function metadata(row){if(!uuid(row.id)||!uuid(row.report_id)||!Number.isSafeInteger(row.actor_id)||row.actor_id<=0||!/^\d{17}$/.test(row.actor_steam)||!Number.isSafeInteger(row.captured_at)||row.captured_at<0||![30,90,365].includes(row.retention_days)||row.expires_at!==row.captured_at+row.retention_days*DAY_MS||!(/^[a-f0-9]{64}$/).test(row.context_digest))fail(503,'Saved context metadata failed its integrity check.');return {id:row.id,reportId:row.report_id,capturedAt:new Date(row.captured_at).toISOString(),expiresAt:new Date(row.expires_at).toISOString(),retentionDays:row.retention_days,capturedByUserId:row.actor_id,contextDigest:row.context_digest};}
 function capabilities(getUser,binding){actor(getUser,binding);const p=policy();return {saveEnabled:p.enabled&&p.configured,savedReadEnabled:exists(),retentionDays:p.configured?p.days:null,reviewLifetimeSeconds:REVIEW_MS/1000};}
 function offer(getUser,id,binding,context){
  const user=actor(getUser,binding),p=policy();if(!p.enabled||!p.configured)return null;const saved=report(id),at=clock(),clean=project(context,saved,at);
  if(!clean.combat.events.length&&!clean.chat.messages.length)return null;
  if(Buffer.byteLength(canonical(clean))>MAX_BYTES)fail(400,'Context is too large to preserve.');
  const review={version:1,reportId:id,reviewerBinding:user.id+':'+user.steam_id,reportFingerprint:digest(saved),contextDigest:digest(clean),issuedAt:at,expiresAt:at+REVIEW_MS,retentionDays:p.days};
  return {...review,signature:createHmac('sha256',p.secret).update(canonical(review)).digest('hex')};
 }
 function save(getUser,id,binding,body){
  if(!body||Object.keys(body).some(key=>!['context','review','requestKey'].includes(key))||!uuid(body.requestKey))fail(400,'A prepared context review and request key are required.');
  db.exec('BEGIN IMMEDIATE');try{
   const user=actor(getUser,binding),saved=report(id),at=clock(),review=body.review;
   if(!review||Object.keys(review).sort().join(',')!=='contextDigest,expiresAt,issuedAt,reportFingerprint,reportId,retentionDays,reviewerBinding,signature,version')fail(400,'Invalid context review.');
   if(review.reportId!==id||review.reviewerBinding!==binding)fail(403,'The prepared reviewer binding changed.');
   if(review.reportFingerprint!==digest(saved))fail(409,'The saved report changed. Load and review context again.');const clean=project(body.context,saved,at);
   const requestHash=digest({reportId:id,context:clean,review});
   if(exists()){
    const previous=db.prepare('SELECT * FROM player_report_context_snapshots WHERE actor_id=? AND request_key=?').get(user.id,body.requestKey);
    if(previous){if(previous.request_hash!==requestHash||previous.report_id!==id)fail(409,'That saved request belongs to a different review.');if(previous.expires_at<=at)fail(410,'The saved context has expired.');if(previous.actor_steam!==user.steam_id||previous.report_fingerprint!==digest(saved))fail(409,'The saved context belongs to an earlier report or account binding.');if(previous.context_digest!==digest(clean)||previous.context_json!==canonical(clean))fail(503,'Saved context failed its integrity check.');const result=metadata(previous);db.exec('COMMIT');return {...result,replayed:true};}
   }
   const p=policy();if(!p.enabled||!p.configured)fail(503,'Context saving requires an enabled retention policy and review key.');
   if(review.version!==1||review.reportId!==id||review.reviewerBinding!==binding||review.reportFingerprint!==digest(saved)||review.contextDigest!==digest(clean)||review.retentionDays!==p.days)fail(409,'The context, report or retention policy changed. Load and review again.');
   if(!Number.isSafeInteger(review.issuedAt)||review.issuedAt>at||review.expiresAt!==review.issuedAt+REVIEW_MS||review.expiresAt<=at)fail(410,'The prepared context review has expired.');
   const {signature,...unsigned}=review,expected=createHmac('sha256',p.secret).update(canonical(unsigned)).digest('hex');
   if(typeof signature!=='string'||!/^[a-f0-9]{64}$/.test(signature)||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))fail(409,'The prepared context review cannot be verified. Load and review again.');
   if(!clean.combat.events.length&&!clean.chat.messages.length||Buffer.byteLength(canonical(clean))>MAX_BYTES)fail(400,'No preservable bounded context was reviewed.');
   schema();if(db.prepare('SELECT COUNT(*) n FROM player_report_context_snapshots WHERE report_id=? AND expires_at>?').get(id,at).n>=50)fail(429,'The report already has the maximum saved context snapshots.');
   const row={id:randomUUID(),report_id:id,actor_id:user.id,actor_steam:user.steam_id,context_json:canonical(clean),context_digest:digest(clean),report_fingerprint:digest(saved),captured_at:at,expires_at:at+p.days*DAY_MS,retention_days:p.days,request_key:body.requestKey,request_hash:requestHash};
   const result=metadata(row);db.prepare('INSERT INTO player_report_context_snapshots VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(row));db.exec('COMMIT');return {...result,replayed:false};
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 function list(getUser,id,binding){actor(getUser,binding);report(id);const at=clock();if(!exists())return {items:[]};return {items:db.prepare('SELECT * FROM player_report_context_snapshots WHERE report_id=? AND expires_at>? ORDER BY captured_at DESC,id DESC LIMIT 50').all(id,at).map(metadata)};}
 function read(getUser,id,binding,snapshotId){
  actor(getUser,binding);const saved=report(id),at=clock();if(!uuid(snapshotId)||!exists())fail(404,'Saved context not found.');const row=db.prepare('SELECT * FROM player_report_context_snapshots WHERE id=? AND report_id=?').get(snapshotId,id);if(!row)fail(404,'Saved context not found.');if(row.expires_at<=at)fail(410,'The saved context has expired.');if(row.report_fingerprint!==digest(saved))fail(409,'Report participants or time changed after capture.');
  let context;try{context=project(JSON.parse(row.context_json),saved,at);if(digest(context)!==row.context_digest||canonical(context)!==row.context_json)fail(503,'Saved context failed its integrity check.');}catch{fail(503,'Saved context failed its integrity check.');}
  return {...metadata(row),context,reviewerBinding:binding};
 }
 function purgeExpired(){if(env.PLAYER_REPORT_CONTEXT_RETENTION_CLEANUP_ENABLED!=='1'||!exists())return {deleted:0};const at=clock();return {deleted:db.prepare('DELETE FROM player_report_context_snapshots WHERE id IN (SELECT id FROM player_report_context_snapshots WHERE expires_at<=? ORDER BY expires_at,id LIMIT 500)').run(at).changes};}
 return {capabilities,offer,save,list,read,purgeExpired};
}
let store;function getDefaultStore(){return store||(store=createReportContextSnapshots({db:require('../db').db}));}
module.exports={createReportContextSnapshots,getDefaultStore,canonical,digest,REVIEW_MS};
