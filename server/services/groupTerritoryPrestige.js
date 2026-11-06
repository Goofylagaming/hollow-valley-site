'use strict';
const {createHash,randomUUID}=require('node:crypto');
// Draft website-only cosmetic policy. A matching reviewed digest is required
// before any non-default selection; no policy is installed by importing this.
const POLICY=Object.freeze({version:1,metric:'recorded-verified-captures',tiers:Object.freeze([
 Object.freeze({id:'pioneer-standard',label:'Pioneer standard',captures:1}),
 Object.freeze({id:'valley-standard',label:'Valley standard',captures:5}),
 Object.freeze({id:'crown-standard',label:'Crown standard',captures:20})
])});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),POLICY_DIGEST=digest(POLICY);
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const key=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(value))fail('A valid request reference is required');return value;};
const exists=(db,name)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
function createGroupTerritoryPrestige(db,{now=Date.now,enabled=()=>process.env.GROUP_TERRITORY_PRESTIGE_ENABLED==='1',policyDigest=()=>process.env.GROUP_TERRITORY_PRESTIGE_POLICY_DIGEST||'',readOnly=()=>process.env.GROUP_TERRITORY_PRESTIGE_READ_ONLY==='1',initialize=false}={}){
 const ready=()=>policyDigest()===POLICY_DIGEST;
 if(initialize){if(!enabled()||!ready()||readOnly())fail('Prestige storage needs a reviewed writable policy',503);db.exec(`
  CREATE TABLE IF NOT EXISTS hv_group_territory_prestige(group_id INTEGER PRIMARY KEY,choice TEXT NOT NULL,revision INTEGER NOT NULL,proof TEXT,policy TEXT NOT NULL,updated_at INTEGER NOT NULL,operation_id TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS hv_group_territory_prestige_edits(id TEXT PRIMARY KEY,group_id INTEGER NOT NULL,actor TEXT NOT NULL,request_id TEXT NOT NULL,payload_json TEXT NOT NULL,receipt_json TEXT NOT NULL,at INTEGER NOT NULL,UNIQUE(actor,request_id));
  CREATE INDEX IF NOT EXISTS hv_group_territory_prestige_history ON hv_group_territory_prestige_edits(group_id,at DESC,id DESC);`);}
 const clock=()=>{const at=now();if(!Number.isSafeInteger(at)||at<0||at>8640000000000000)fail('The prestige clock cannot be verified',503);return at;};
 const steam=value=>{if(typeof value!=='string'||!/^\d{17}$/.test(value))fail('A current linked account is required',403);return value;};
 const tables=()=>exists(db,'hv_group_territory_prestige')&&exists(db,'hv_group_territory_prestige_edits');
 function checkedEdit(row){
  let receipt,payload;try{receipt=JSON.parse(row?.receipt_json);payload=JSON.parse(row?.payload_json);}catch{}
  if(!row||!/^\d{17}$/.test(row.actor)||typeof row.request_id!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(row.request_id)||!Number.isSafeInteger(row.group_id)||row.group_id<1||!Number.isSafeInteger(row.at)||row.at<0||receipt?.id!==row.id||receipt.groupId!==row.group_id||receipt.at!==row.at||payload?.groupId!==row.group_id||!Number.isSafeInteger(payload.expectedRevision)||payload.expectedRevision<0||!Number.isSafeInteger(receipt.revision)||receipt.revision!==payload.expectedRevision+1||receipt.choice!==payload.choice||!['none',...POLICY.tiers.map(tier=>tier.id)].includes(receipt.choice)||typeof receipt.policy!=='string'||!/^[a-f0-9]{64}$/.test(receipt.policy)||receipt.policy!==payload.expectedPolicy||!(receipt.proof===null||typeof receipt.proof==='string'&&/^[a-f0-9]{64}$/.test(receipt.proof))||receipt.proof!==payload.expectedProof)fail('Prestige audit requires review',503);
  return receipt;
 }
 function group(actor){
  if(!exists(db,'hv_groups')||!exists(db,'hv_group_members'))fail('Group membership is unavailable',503);
  const row=db.prepare("SELECT g.id,g.name,g.owner_steam_id owner FROM hv_groups g JOIN hv_group_members m ON m.group_id=g.id WHERE m.steam_id=? AND g.status='active'").get(actor);
  if(!row)fail('An active group membership is required',404);if(!Number.isSafeInteger(row.id)||row.id<1)fail('Group identity is unavailable',503);
  const closing=exists(db,'hv_group_treasury_closures')&&Boolean(db.prepare("SELECT 1 FROM hv_group_treasury_closures WHERE group_id=? AND state NOT IN ('cancelled','closed')").get(row.id));return {...row,closing};
 }
 function evidence(groupId,at=clock()){
  if(!Number.isSafeInteger(groupId)||groupId<1)fail('A valid group is required');
  if(!['hv_group_battle_identity','territory_battle_provenance','territory_battle_sample_clock','territory_battle_winners'].every(name=>exists(db,name)))return {available:false,totals:null,proof:null};
  try{
   const statement=db.prepare(`SELECT COUNT(*) battles,
    COALESCE(SUM(CASE WHEN b.outcome='capture' AND i.side='attacker' THEN 1 ELSE 0 END),0) captures,
    COALESCE(SUM(CASE WHEN (b.outcome='capture' AND i.side='attacker') OR (b.outcome='defence' AND i.side='defender') THEN 1 ELSE 0 END),0) wins
    FROM hv_group_battle_identity i JOIN territory_battle_provenance b ON b.attack_id=i.attack_id
    JOIN territory_battle_sample_clock c ON c.attack_id=b.attack_id AND c.verified=1
    WHERE i.group_id=? AND i.side IN ('attacker','defender') AND b.live_observed=1 AND b.disqualified_reason IS NULL AND b.outcome IN ('capture','defence')
    AND typeof(b.started_at)='integer' AND typeof(b.closed_at)='integer' AND b.started_at>=0 AND b.closed_at>=b.started_at AND b.closed_at<=?
    AND EXISTS(SELECT 1 FROM territory_battle_winners w WHERE w.attack_id=b.attack_id AND typeof(w.steam_id)='text' AND length(w.steam_id)=17 AND w.steam_id NOT GLOB '*[^0-9]*')
    AND NOT EXISTS(SELECT 1 FROM hv_group_battle_identity other WHERE other.attack_id=i.attack_id AND other.group_id=i.group_id AND other.side<>i.side)`);
   statement.setReadBigInts(true);const row=statement.get(groupId,at),max=BigInt(Number.MAX_SAFE_INTEGER);
   if(Object.values(row).some(value=>typeof value!=='bigint'||value<0n||value>max)||row.wins>row.battles||row.captures>row.wins)throw Error('Invalid totals');
   const totals={battles:Number(row.battles),captures:Number(row.captures),wins:Number(row.wins),losses:Number(row.battles-row.wins)};
   return {available:true,totals,proof:digest({groupId,policy:POLICY_DIGEST,totals})};
  }catch{return {available:false,totals:null,proof:null};}
 }
 function selection(groupId,at){
  if(!tables())return {available:false,choice:null,revision:null};
  const row=db.prepare('SELECT * FROM hv_group_territory_prestige WHERE group_id=?').get(groupId);
  if(!row){if(db.prepare('SELECT 1 FROM hv_group_territory_prestige_edits WHERE group_id=?').get(groupId))fail('Prestige history requires review',503);return {available:true,choice:'none',revision:0,policy:POLICY_DIGEST};}
  const audit=db.prepare('SELECT * FROM hv_group_territory_prestige_edits WHERE id=? AND group_id=?').get(row.operation_id,groupId),latest=db.prepare('SELECT id FROM hv_group_territory_prestige_edits WHERE group_id=? ORDER BY rowid DESC LIMIT 1').get(groupId),receipt=checkedEdit(audit);
  if(latest?.id!==row.operation_id||!Number.isSafeInteger(row.revision)||row.revision<1||!Number.isSafeInteger(row.updated_at)||row.updated_at<0||row.updated_at>at||receipt.id!==row.operation_id||receipt.groupId!==groupId||receipt.choice!==row.choice||receipt.revision!==row.revision||receipt.at!==row.updated_at||receipt.policy!==row.policy||receipt.proof!==row.proof)fail('Prestige history requires review',503);
  return {available:true,choice:row.choice,revision:row.revision,updatedAt:row.updated_at,policy:row.policy};
 }
 function read(rawActor){
  const actor=steam(rawActor),own=group(actor),at=clock(),source=evidence(own.id,at),saved=selection(own.id,at);
  const choices=[{id:'none',label:'No Territory standard',captures:0,eligible:true},...POLICY.tiers.map(tier=>({...tier,eligible:source.available&&source.totals.captures>=tier.captures}))];
  const effective=saved.available&&saved.policy===POLICY_DIGEST&&enabled()&&ready()&&choices.some(tier=>tier.id===saved.choice&&tier.eligible)?saved.choice:'none';
  return {groupId:own.id,name:own.name,canEdit:own.owner===actor&&!own.closing,closing:own.closing,enabled:Boolean(enabled()),readOnly:Boolean(readOnly()),policyReady:ready(),policyDigest:POLICY_DIGEST,metric:POLICY.metric,choices,evidence:source,selection:saved,effectiveChoice:effective,gameplayBenefits:false};
 }
 function receipt(rawActor,{requestId}={}){const actor=steam(rawActor);key(requestId);if(!tables())fail('Prestige history is unavailable',503);const row=db.prepare('SELECT * FROM hv_group_territory_prestige_edits WHERE actor=? AND request_id=?').get(actor,requestId);if(!row)fail('Prestige receipt not found',404);return {receipt:checkedEdit(row)};}
 function select(rawActor,{expectedGroupId,choice,expectedRevision,expectedProof,expectedPolicy,requestId}={}){
  const actor=steam(rawActor);key(requestId);if(!Number.isSafeInteger(expectedGroupId)||expectedGroupId<1||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||!['none',...POLICY.tiers.map(tier=>tier.id)].includes(choice)||typeof expectedPolicy!=='string'||!/^[a-f0-9]{64}$/.test(expectedPolicy)||!(expectedProof===null||typeof expectedProof==='string'&&/^[a-f0-9]{64}$/.test(expectedProof)))fail('Review an exact group, choice, revision and policy');
  if(readOnly())fail('This preview cannot change Territory standards',403);if(!tables())fail('Prestige storage is not initialized',503);
  const payload=JSON.stringify({groupId:expectedGroupId,choice,expectedRevision,expectedProof,expectedPolicy});
  db.exec('BEGIN IMMEDIATE');try{
   const old=db.prepare('SELECT * FROM hv_group_territory_prestige_edits WHERE actor=? AND request_id=?').get(actor,requestId);if(old){if(old.payload_json!==payload)fail('Conflicting prestige request',409);const value={receipt:checkedEdit(old),duplicate:true};db.exec('COMMIT');return value;}
   const own=group(actor);if(own.id!==expectedGroupId)fail('Group membership changed; refresh the review',409);if(own.owner!==actor||own.closing)fail('Only the current owner of an open group can select a standard',403);
   const at=clock(),state=selection(own.id,at);if(state.revision!==expectedRevision)fail('The saved standard changed; refresh before selecting',409);if(expectedPolicy!==POLICY_DIGEST)fail('The cosmetic policy changed; review it again',409);
   if(choice!=='none'){if(!enabled()||!ready())fail('A reviewed Territory prestige policy is not enabled',503);const source=evidence(own.id,at),tier=POLICY.tiers.find(tier=>tier.id===choice);if(!source.available||source.proof!==expectedProof||source.totals.captures<tier.captures)fail('Capture evidence changed or does not qualify this standard',409);}
   if(expectedRevision>=Number.MAX_SAFE_INTEGER)fail('The prestige revision requires review',503);const id=randomUUID(),revision=expectedRevision+1,result={id,groupId:own.id,choice,revision,proof:expectedProof,policy:expectedPolicy,at};
   db.prepare('INSERT INTO hv_group_territory_prestige VALUES(?,?,?,?,?,?,?) ON CONFLICT(group_id) DO UPDATE SET choice=excluded.choice,revision=excluded.revision,proof=excluded.proof,policy=excluded.policy,updated_at=excluded.updated_at,operation_id=excluded.operation_id').run(own.id,choice,revision,expectedProof,expectedPolicy,at,id);
   db.prepare('INSERT INTO hv_group_territory_prestige_edits VALUES(?,?,?,?,?,?,?)').run(id,own.id,actor,requestId,payload,JSON.stringify(result),at);db.exec('COMMIT');return {receipt:result,duplicate:false};
  }catch(error){db.exec('ROLLBACK');throw error;}
 }
 return {read,select,receipt,evidence};
}
module.exports={POLICY,POLICY_DIGEST,createGroupTerritoryPrestige};
