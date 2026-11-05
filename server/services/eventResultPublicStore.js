"use strict";
function createPublicResultStore(db){
 db.exec(`CREATE TABLE IF NOT EXISTS hv_event_results_public(event_key TEXT PRIMARY KEY,title TEXT NOT NULL,event_at TEXT NOT NULL,
 summary TEXT NOT NULL,winners_json TEXT NOT NULL DEFAULT '[]',published_at TEXT NOT NULL,published_by_steam_id TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS hv_event_results_latest ON hv_event_results_public(published_at DESC);`);
 function matches(row,record){
  try{const publication=JSON.parse(record.body_json).publication,schedule=db.prepare('SELECT revision,state FROM hv_event_schedules WHERE id=?').get(record.event_id),audit=db.prepare('SELECT body_json,actor_steam,action,at FROM hv_engine_event_result_history WHERE event_id=? AND revision=?').get(record.event_id,record.revision);return audit&&['publish','correct','restore'].includes(audit.action)&&audit.body_json===record.body_json&&audit.actor_steam===record.actor_steam&&audit.at===record.updated_at&&schedule?.state==='scheduled'&&schedule.revision===record.event_revision&&record.state==='published'&&row.event_key===publication.key&&row.title===publication.title&&row.event_at===publication.time&&row.summary===publication.summary&&JSON.stringify(JSON.parse(row.winners_json))===JSON.stringify(publication.winners)&&Date.parse(row.published_at)===record.updated_at&&row.published_by_steam_id===record.actor_steam;}catch{return false;}
 }
 function list(limit=12,{engineOnly=false}={}){
  const cap=Number.isSafeInteger(Number(limit))?Math.max(1,Math.min(25,Number(limit))):12;
  const hasEngine=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='hv_engine_event_results'").get());
  const rows=hasEngine&&engineOnly?db.prepare("SELECT p.* FROM hv_event_results_public p JOIN hv_engine_event_results e ON p.event_key=e.event_key WHERE e.state='published' ORDER BY p.event_at DESC,p.published_at DESC LIMIT ?").all(cap):engineOnly?[]:db.prepare('SELECT * FROM hv_event_results_public ORDER BY event_at DESC,published_at DESC LIMIT ?').all(cap);
  return rows.map(row=>project(row,hasEngine)).filter(Boolean);
 }
 function project(row,hasEngine){
  if(!row)return null;
  const record=hasEngine?db.prepare('SELECT * FROM hv_engine_event_results WHERE event_key=?').get(row.event_key):null;
  if(record&&!matches(row,record))return null;
  return {eventKey:row.event_key,title:row.title,eventAt:row.event_at,summary:row.summary,winners:JSON.parse(row.winners_json||'[]'),publishedAt:row.published_at,
   source:record?'staff-reviewed-website-event':'staff-published',automaticallyVerified:false,automaticPayout:false,...(record?{eventId:record.event_id,resultRevision:record.revision,evidenceReviewed:true}:{})};
 }
 function get(key){return project(db.prepare('SELECT * FROM hv_event_results_public WHERE event_key=?').get(key),Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='hv_engine_event_results'").get()));}
 return {list,matches,get};
}
module.exports={createPublicResultStore};
