"use strict";
const {createHash}=require('node:crypto');
const COMPONENTS=Object.freeze(['website','game','bridge','discord','marketplace','steam','map']);
const STATES=Object.freeze(['investigating','identified','monitoring','resolved']);
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const digest=value=>createHash('sha256').update(value).digest('hex');
const identity=value=>{if(typeof value!=='string'||!/^[-a-zA-Z0-9_]{16,80}$/.test(value))fail('Invalid incident or request identity');return value;};
function text(value,min,max){if(typeof value!=='string'||value.trim().length<min||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))fail('Complete the incident text');return value.trim();}
function details(input,guild,at){
 const fields=['components','severity','status','title','summary','startedAt','endedAt','verifiedAt','evidenceUrls','evidenceNote'];
 if(!input||Array.isArray(input)||Object.keys(input).length!==fields.length||fields.some(k=>!Object.hasOwn(input,k)))fail('Only the complete reviewed incident fields are accepted');
 if(typeof guild!=='string'||!/^\d{10,24}$/.test(guild))fail('Configure the official incident evidence server first',503);
 if(!Array.isArray(input.components)||!input.components.length||input.components.length>COMPONENTS.length||input.components.some(c=>!COMPONENTS.includes(c))||new Set(input.components).size!==input.components.length||
   !['degraded','outage'].includes(input.severity)||!STATES.includes(input.status))fail('Choose incident components, severity and status');
 if(![input.startedAt,input.verifiedAt].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=at)||input.verifiedAt<input.startedAt)fail('Use recorded incident and verification times');
 if(input.status==='resolved'? !Number.isSafeInteger(input.endedAt)||input.endedAt<input.startedAt||input.endedAt>input.verifiedAt : input.endedAt!==null)fail('Only resolved reports have a recorded resolution time');
 const title=text(input.title,3,120),summary=text(input.summary,10,1200);
 if(/https?:\/\/|www\.|\b\d{17}\b|\b(?:\d{1,3}\.){3}\d{1,3}\b|\S+@\S+\.\S+/i.test(title+' '+summary))fail('Keep links, account IDs and server addresses out of the public summary');
 if(!Array.isArray(input.evidenceUrls)||input.evidenceUrls.length<1||input.evidenceUrls.length>5)fail('Add official evidence message links');
 const evidenceUrls=input.evidenceUrls.map(value=>{
  let url;try{url=new URL(value);}catch{fail('Use official Discord message links');}
  if(typeof value!=='string'||value.length>250||url.origin!=='https://discord.com'||url.username||url.password||url.search||url.hash||!new RegExp('^/channels/'+guild+'/\\d{10,24}/\\d{10,24}$').test(url.pathname))fail('Use official Discord message links');return url.href;
 }).sort();
 if(new Set(evidenceUrls).size!==evidenceUrls.length)fail('Evidence message links must be distinct');
 return {components:[...input.components].sort(),severity:input.severity,status:input.status,title,summary,startedAt:input.startedAt,endedAt:input.endedAt,verifiedAt:input.verifiedAt,
   evidenceUrls,evidenceNote:text(input.evidenceNote,20,2000),evidenceGuildId:guild};
}
const publicBody=(id,body)=>({id,components:body.components,severity:body.severity,status:body.status,title:body.title,summary:body.summary,startedAt:body.startedAt,endedAt:body.endedAt,verifiedAt:body.verifiedAt,source:'staff-reviewed'});
function createStatusIncidentStore(db,{now=Date.now,guild=()=>process.env.STATUS_INCIDENTS_EVIDENCE_GUILD_ID||'',writable=()=>{}}={}){
 db.exec(`CREATE TABLE IF NOT EXISTS hv_status_incidents(position INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,revision INTEGER NOT NULL,draft_json TEXT NOT NULL,publication_json TEXT,updated_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS hv_status_incident_history(incident_id TEXT NOT NULL,revision INTEGER NOT NULL,action TEXT NOT NULL,actor_id INTEGER NOT NULL,actor_steam TEXT NOT NULL,
   draft_json TEXT NOT NULL,publication_json TEXT,reason TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(incident_id,revision));
 CREATE TABLE IF NOT EXISTS hv_status_incident_requests(actor_id INTEGER NOT NULL,request_key TEXT NOT NULL,payload_json TEXT NOT NULL,result_json TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(actor_id,request_key));
 CREATE INDEX IF NOT EXISTS hv_status_incident_rate ON hv_status_incident_requests(actor_id,at);`);
 function admin(user){if(!user)fail('Sign in to continue',401);if(!Number.isSafeInteger(user.id)||typeof user.steam_id!=='string'||!/^\d{17}$/.test(user.steam_id)||!db.prepare('SELECT 1 FROM users WHERE id=? AND steam_id=? AND is_admin=1').get(user.id,user.steam_id))fail('Current staff access is required',403);}
 const find=id=>db.prepare('SELECT * FROM hv_status_incidents WHERE id=?').get(identity(id));
 function decoded(raw){const saved=JSON.parse(raw),{evidenceGuildId,...input}=saved;const body=details(input,evidenceGuildId,now());if(JSON.stringify(body)!==raw)fail('Incident evidence is unavailable',503);return body;}
 function checked(row){
  if(!row)return null;
  const latest=db.prepare('SELECT * FROM hv_status_incident_history WHERE incident_id=? AND revision=?').get(row.id,row.revision);
  if(!latest||!['save','publish','withdraw'].includes(latest.action)||!Number.isSafeInteger(row.revision)||row.revision<1||!Number.isSafeInteger(row.updated_at)||row.updated_at<0||row.updated_at>now()||latest.draft_json!==row.draft_json||latest.publication_json!==row.publication_json||latest.at!==row.updated_at)fail('Incident audit is unavailable',503);
  const body=decoded(row.draft_json);let publication=null;
  if(row.publication_json){
   publication=JSON.parse(row.publication_json);
   const original=db.prepare('SELECT * FROM hv_status_incident_history WHERE incident_id=? AND revision=?').get(row.id,publication.revision);
   if(!original||original.action!=='publish'||original.publication_json!==row.publication_json||digest(original.draft_json)!==publication.reviewDigest||
     !Number.isSafeInteger(publication.reportedAt)||publication.reportedAt>now()||publication.reportedAt!==original.at||JSON.stringify(publication.body)!==JSON.stringify(publicBody(row.id,decoded(original.draft_json))))fail('Published incident evidence is unavailable',503);
  }
  return {id:row.id,revision:row.revision,draft:body,reviewDigest:digest(row.draft_json),publication,updatedAt:row.updated_at};
 }
 function snapshot(fn){db.exec('SAVEPOINT status_incident_read');try{const value=fn();db.exec('RELEASE status_incident_read');return value;}catch(e){db.exec('ROLLBACK TO status_incident_read;RELEASE status_incident_read');throw e;}}
 function read(user,id){return snapshot(()=>{admin(user);const row=checked(find(id));if(!row)fail('Incident not found',404);return row;});}
 const page=before=>{if(before!==null&&(!Number.isSafeInteger(before)||before<1))fail('Invalid incident page');};
 function list(user,{before=null}={}){return snapshot(()=>{admin(user);page(before);const rows=db.prepare('SELECT * FROM hv_status_incidents WHERE (? IS NULL OR position<?) ORDER BY position DESC LIMIT 26').all(before,before);return {items:rows.slice(0,25).map(checked),next:rows.length>25?rows[24].position:null};});}
 function history(user,id,{before=null}={}){return snapshot(()=>{admin(user);identity(id);page(before);if(!find(id))fail('Incident not found',404);const rows=db.prepare('SELECT * FROM hv_status_incident_history WHERE incident_id=? AND (? IS NULL OR revision<?) ORDER BY revision DESC LIMIT 26').all(id,before,before);return {items:rows.slice(0,25).map(r=>({revision:r.revision,action:r.action,actorId:r.actor_id,actorSteamId:r.actor_steam,draft:JSON.parse(r.draft_json),publication:r.publication_json?JSON.parse(r.publication_json):null,reason:r.reason,at:r.at})),next:rows.length>25?rows[24].revision:null};});}
 function publicList({before=null}={}){return snapshot(()=>{page(before);const rows=db.prepare('SELECT * FROM hv_status_incidents WHERE publication_json IS NOT NULL AND (? IS NULL OR position<?) ORDER BY position DESC LIMIT 26').all(before,before);let partial=false;const items=[];for(const row of rows.slice(0,25)){try{const value=checked(row);items.push({...value.publication.body,revision:value.publication.revision,reportedAt:value.publication.reportedAt});}catch{partial=true;}}return {items,next:rows.length>25?rows[24].position:null,partial,source:'staff-reviewed',independentMonitoring:false};});}
 function change(user,input={}){
  admin(user);const {id,action,expectedRevision,requestKey}=input;identity(id);identity(requestKey);
  if(!['save','publish','withdraw'].includes(action)||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER)fail('Review the current incident revision');
  const fields=['id','action','expectedRevision','requestKey','reason',...(action==='save'?['details']:action==='publish'?['reviewDigest']:[])];
  if(Object.keys(input).length!==fields.length||fields.some(k=>!Object.hasOwn(input,k)))fail('Only the reviewed incident fields are accepted');
  const reason=text(input.reason,5,1000),body=action==='save'?details(input.details,guild(),now()):null;
  if(action==='publish'&&(typeof input.reviewDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.reviewDigest)))fail('Review the exact incident draft before publishing');
  const payload=JSON.stringify({id,action,expectedRevision,reason,body,reviewDigest:input.reviewDigest||null,actorSteamId:user.steam_id});
  db.exec('BEGIN IMMEDIATE');try{
   admin(user);writable(action);
   const prior=db.prepare('SELECT * FROM hv_status_incident_requests WHERE actor_id=? AND request_key=?').get(user.id,requestKey);
   if(prior){if(prior.payload_json!==payload)fail('Request conflicts with its saved incident review',409);const value={saved:JSON.parse(prior.result_json),current:checked(find(id)),duplicate:true};db.exec('COMMIT');return value;}
   if(db.prepare('SELECT count(*) n FROM hv_status_incident_requests WHERE actor_id=? AND at>?').get(user.id,now()-60000).n>=20)fail('Please wait before changing more incidents',429);
   const old=checked(find(id));if((old?.revision||0)!==expectedRevision)fail('The incident changed; review it again',409);
   if(!old&&action!=='save'||action==='withdraw'&&!old?.publication)fail('Choose an action for the current incident state',409);
   const raw=body?JSON.stringify(body):JSON.stringify(old.draft),revision=expectedRevision+1,at=now();let publication=old?.publication||null;
   if(action==='publish'){
    if(guild()!==old.draft.evidenceGuildId)fail('The official evidence server changed; save and review the evidence again',409);
    if(input.reviewDigest!==digest(raw))fail('The incident draft changed after review',409);
    if(publication?.reviewDigest===input.reviewDigest)fail('This incident draft is already published',409);
    publication={revision,reportedAt:at,reviewDigest:input.reviewDigest,body:publicBody(id,old.draft)};
   }
   if(action==='withdraw')publication=null;
   const published=publication?JSON.stringify(publication):null;
   db.prepare('INSERT INTO hv_status_incidents(id,revision,draft_json,publication_json,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,draft_json=excluded.draft_json,publication_json=excluded.publication_json,updated_at=excluded.updated_at').run(id,revision,raw,published,at);
   db.prepare('INSERT INTO hv_status_incident_history VALUES(?,?,?,?,?,?,?,?,?)').run(id,revision,action,user.id,user.steam_id,raw,published,reason,at);
   const saved={id,revision,action,reviewDigest:digest(raw),published:Boolean(publication)};
   db.prepare('INSERT INTO hv_status_incident_requests VALUES(?,?,?,?,?)').run(user.id,requestKey,payload,JSON.stringify(saved),at);
   const result={saved,current:checked(find(id)),duplicate:false};db.exec('COMMIT');return result;
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 return {admin,read,list,history,change,publicList};
}
module.exports={createStatusIncidentStore,COMPONENTS,STATES};
