"use strict";
const KINDS=Object.freeze({
  'fight-night':'Fight Night',migration:'Migration','hide-and-seek':'Hide & Seek',
  'last-dino-standing':'Last Dino Standing','king-of-the-hill':'King of the Hill',
  'herbivore-migration':'Herbivore Migration','territory-tournament':'Territory Tournament','scavenger-hunt':'Scavenger Hunt',
});
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
function identifier(id){if(typeof id!=='string'||!/^[-a-zA-Z0-9_]{16,80}$/.test(id))fail('Invalid template or request identity');return id;}
function definition(input){
  const fields=['kind','title','description','rules','durationMinutes','capacity','teamCount'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==fields.length||Object.keys(input).some(k=>!fields.includes(k)))fail('Complete template details are required');
  if(typeof input.kind!=='string'||!Object.hasOwn(KINDS,input.kind))fail('Choose a supported event type');
  const value={kind:input.kind};
  for(const [field,min,max] of [['title',3,120],['description',10,2000],['rules',10,4000]]){
    if(typeof input[field]!=='string'||input[field].trim().length<min||input[field].length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input[field]))fail('Invalid template '+field);
    value[field]=input[field].trim();
  }
  for(const [field,min,max] of [['durationMinutes',5,1440],['capacity',2,500],['teamCount',1,16]]){
    if(!Number.isSafeInteger(input[field])||input[field]<min||input[field]>max)fail('Invalid template '+field);
    value[field]=input[field];
  }
  if(value.teamCount>value.capacity)fail('Team count cannot exceed participant capacity');
  return value;
}
function createEventTemplateStore(db,{now=Date.now,writable=()=>{}}={}){
  db.exec(`CREATE TABLE IF NOT EXISTS hv_event_templates(row_id INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,
    revision INTEGER NOT NULL,state TEXT NOT NULL,definition_json TEXT NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS hv_event_template_history(template_id TEXT NOT NULL,revision INTEGER NOT NULL,actor_id INTEGER NOT NULL,
    actor_steam TEXT NOT NULL,action TEXT NOT NULL,state TEXT NOT NULL,definition_json TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(template_id,revision));
    CREATE TABLE IF NOT EXISTS hv_event_template_requests(actor_id INTEGER NOT NULL,request_key TEXT NOT NULL,payload_json TEXT NOT NULL,
    result_json TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(actor_id,request_key));
    CREATE INDEX IF NOT EXISTS hv_event_template_rate ON hv_event_template_requests(actor_id,at);`);
  function admin(user){
    if(!user)fail('Sign in to continue',401);
    if(!Number.isSafeInteger(user.id)||typeof user.steam_id!=='string'||!/^\d{17}$/.test(user.steam_id)||!db.prepare('SELECT 1 FROM users WHERE id=? AND steam_id=? AND is_admin=1').get(user.id,user.steam_id))fail('Current staff access is required',403);
    return user;
  }
  const project=row=>({id:row.id,revision:row.revision,state:row.state,definition:JSON.parse(row.definition_json),updatedAt:row.updated_at});
  const find=id=>db.prepare('SELECT * FROM hv_event_templates WHERE id=?').get(id);
  function read(user,id){admin(user);const row=find(identifier(id));if(!row)fail('Template not found',404);return project(row);}
  function list(user,{before=null,includeArchived=false}={}){
    admin(user);if((before!==null&&(!Number.isSafeInteger(before)||before<1))||typeof includeArchived!=='boolean')fail('Invalid template page');
    const rows=db.prepare('SELECT * FROM hv_event_templates WHERE (? IS NULL OR row_id<?) AND (?=1 OR state=\'draft\') ORDER BY row_id DESC LIMIT 26').all(before,before,Number(includeArchived));
    const items=rows.slice(0,25);return {items:items.map(project),next:rows.length>25?items.at(-1).row_id:null};
  }
  function history(user,id,{before=null}={}){
    read(user,id);if(before!==null&&(!Number.isSafeInteger(before)||before<1))fail('Invalid history page');
    const rows=db.prepare('SELECT * FROM hv_event_template_history WHERE template_id=? AND (? IS NULL OR revision<?) ORDER BY revision DESC LIMIT 26').all(id,before,before);
    const items=rows.slice(0,25);return {items:items.map(r=>({revision:r.revision,action:r.action,state:r.state,actorSteamId:r.actor_steam,at:r.at,definition:JSON.parse(r.definition_json)})),next:rows.length>25?items.at(-1).revision:null};
  }
  function change(user,{id,expectedRevision,requestKey,action,details}={}){
    admin(user);writable();identifier(id);identifier(requestKey);
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||expectedRevision>=Number.MAX_SAFE_INTEGER||!['save','archive'].includes(action))fail('Invalid template revision or action');
    if(action==='archive'&&details!==undefined)fail('Archive the saved template without replacement details');
    const canonical=action==='save'?definition(details):null;
    const payload=JSON.stringify({id,expectedRevision,action,definition:canonical,actorSteamId:user.steam_id});
    db.exec('BEGIN IMMEDIATE');
    try{
      admin(user);writable();
      const receipt=db.prepare('SELECT * FROM hv_event_template_requests WHERE actor_id=? AND request_key=?').get(user.id,requestKey);
      if(receipt){if(receipt.payload_json!==payload)fail('Request key conflicts with its saved template change',409);const result={saved:JSON.parse(receipt.result_json),current:read(user,id),duplicate:true};db.exec('COMMIT');return result;}
      const old=find(id);if((old?.revision||0)!==expectedRevision)fail('Template changed. Load the current revision before reviewing again.',409);
      if(action==='archive'&&!old)fail('Template not found',404);
      if(old?.state==='archived')fail('Archived templates are retained for history and cannot be changed',409);
      if(db.prepare('SELECT count(*) n FROM hv_event_template_requests WHERE actor_id=? AND at>?').get(user.id,now()-60000).n>=30)fail('Too many template changes. Try again shortly.',429);
      const revision=expectedRevision+1,state=action==='save'?'draft':'archived',json=action==='save'?JSON.stringify(canonical):old.definition_json,at=now();
      db.prepare('INSERT INTO hv_event_templates(id,revision,state,definition_json,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,state=excluded.state,definition_json=excluded.definition_json,updated_at=excluded.updated_at').run(id,revision,state,json,at);
      db.prepare('INSERT INTO hv_event_template_history VALUES (?,?,?,?,?,?,?,?)').run(id,revision,user.id,user.steam_id,action,state,json,at);
      const saved=project(find(id));db.prepare('INSERT INTO hv_event_template_requests VALUES (?,?,?,?,?)').run(user.id,requestKey,payload,JSON.stringify(saved),at);
      db.exec('COMMIT');return {saved,current:saved,duplicate:false};
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  return {admin,read,list,history,change};
}
module.exports={createEventTemplateStore,KINDS,definition};
