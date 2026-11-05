"use strict";
const {createChallengeLocationCatalog,inside}=require('./challengeLocationCatalog');
const DAY=86400000,OFFSET=36000000;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
function createChallengeLocationStore(db,{now=Date.now,enabled=()=>process.env.DYNAMIC_CHALLENGES_ENABLED==='1'&&process.env.DYNAMIC_CHALLENGES_LOCATION_ENABLED==='1',mapVersion=()=>process.env.DYNAMIC_CHALLENGES_LOCATION_MAP_VERSION}={}){
  const catalogs=createChallengeLocationCatalog(db,{now});
  db.exec(`CREATE TABLE IF NOT EXISTS dc_location_preferences(steam_id TEXT PRIMARY KEY,enabled INTEGER NOT NULL,revision INTEGER NOT NULL,collect_after INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS dc_location_choices(steam_id TEXT NOT NULL,request_key TEXT NOT NULL,selected INTEGER NOT NULL,expected_revision INTEGER NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(steam_id,request_key));
    CREATE TABLE IF NOT EXISTS dc_location_last(steam_id TEXT PRIMARY KEY,version TEXT NOT NULL,life_id TEXT NOT NULL,at INTEGER NOT NULL,x REAL,y REAL);
    CREATE TABLE IF NOT EXISTS dc_location_receipts(steam_id TEXT NOT NULL,version TEXT NOT NULL,at INTEGER NOT NULL,from_at INTEGER NOT NULL,metres REAL NOT NULL,highlands INTEGER NOT NULL,valid INTEGER NOT NULL,PRIMARY KEY(steam_id,version,at));
    CREATE INDEX IF NOT EXISTS dc_location_receipt_age ON dc_location_receipts(at);
    CREATE TABLE IF NOT EXISTS dc_location_runtime(id INTEGER PRIMARY KEY CHECK(id=1),signature TEXT NOT NULL,resumed_at INTEGER NOT NULL);`);
  const player=id=>{if(typeof id!=='string'||!/^\d{17}$/.test(id))fail('A linked Steam account is required');return id;};
  const preference=id=>db.prepare('SELECT * FROM dc_location_preferences WHERE steam_id=?').get(player(id))||{enabled:0,revision:0,collect_after:0};
  function policy(){const rules=enabled()&&catalogs.active();return rules&&rules.mapVersion===mapVersion()?rules:null;}
  function synchronize(){
    const rules=policy(),signature=rules?rules.version+':'+rules.digest+':'+rules.mapVersion:'off';
    const old=db.prepare('SELECT signature,resumed_at FROM dc_location_runtime WHERE id=1').get();
    if(!old||old.signature!==signature){db.prepare('DELETE FROM dc_location_last').run();db.prepare('INSERT INTO dc_location_runtime VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET signature=excluded.signature,resumed_at=excluded.resumed_at').run(signature,now());}
    return rules;
  }
  function prune(){db.exec('SAVEPOINT challenge_location_prune');try{synchronize();db.prepare('DELETE FROM dc_location_last WHERE at<?').run(now()-120000);db.prepare('DELETE FROM dc_location_receipts WHERE at<?').run(now()-35*DAY);db.exec('RELEASE challenge_location_prune');}catch(e){db.exec('ROLLBACK TO challenge_location_prune; RELEASE challenge_location_prune');throw e;}}
  prune();
  function erase(id){const p=preference(id);db.prepare('DELETE FROM dc_location_last WHERE steam_id=?').run(id);db.prepare('DELETE FROM dc_location_receipts WHERE steam_id=?').run(id);db.prepare('INSERT INTO dc_location_preferences VALUES (?,0,?,?) ON CONFLICT(steam_id) DO UPDATE SET enabled=0,revision=excluded.revision,collect_after=excluded.collect_after').run(id,p.revision+1,now());}
  function status(id){const p=preference(id),rules=policy();if(!rules)return {available:false,enabled:Boolean(p.enabled),revision:p.revision};
    const start=Math.floor((now()+OFFSET)/DAY)*DAY-OFFSET;
    const progress=p.enabled?db.prepare('SELECT COALESCE(SUM(metres),0) AS metres,COALESCE(MAX(highlands),0) AS highlands FROM dc_location_receipts WHERE steam_id=? AND version=? AND valid=1 AND from_at>=? AND at<?').get(id,rules.version,start,start+DAY):{};
    return {available:true,enabled:Boolean(p.enabled),revision:p.revision,version:rules.version,mapVersion:rules.mapVersion,startsAt:start,endsAt:start+DAY,distanceMetres:Math.min(12000,Math.floor(progress.metres||0)),highlandsVisited:Boolean(progress.highlands)};
  }
  function change(id,{selected,expectedRevision,requestKey}={}){
    player(id);if(typeof selected!=='boolean'||!Number.isSafeInteger(expectedRevision)||expectedRevision<0||typeof requestKey!=='string'||!/^[-a-zA-Z0-9_]{16,80}$/.test(requestKey))fail('Explicit location consent and its revision are required');
    db.exec('BEGIN IMMEDIATE');try{
      const prior=db.prepare('SELECT * FROM dc_location_choices WHERE steam_id=? AND request_key=?').get(id,requestKey);
      if(prior){if(prior.selected!==Number(selected)||prior.expected_revision!==expectedRevision)fail('Location request key conflicts with its saved choice',409);const result={...status(id),duplicate:true};db.exec('COMMIT');return result;}
      const p=preference(id);if(p.revision!==expectedRevision)fail('Location consent changed. Refresh and review again.',409);
      if(p.revision>=Number.MAX_SAFE_INTEGER)fail('Location revision limit reached',409);
      if(selected&&(!policy()||!db.prepare('SELECT 1 FROM dc_participants WHERE steam_id=?').get(id)))fail('Join challenges and wait for reviewed map rules before enabling location tracking',409);
      if((selected||!p.enabled)&&db.prepare('SELECT count(*) n FROM dc_location_choices WHERE steam_id=? AND at>?').get(id,now()-60000).n>=20)fail('Too many location choices. Try again shortly.',429);
      if(selected){db.prepare('INSERT INTO dc_location_preferences VALUES (?,1,?,?) ON CONFLICT(steam_id) DO UPDATE SET enabled=1,revision=excluded.revision,collect_after=CASE WHEN enabled=1 THEN collect_after ELSE excluded.collect_after END').run(id,p.revision+1,now());}
      else erase(id);
      db.prepare('INSERT INTO dc_location_choices VALUES (?,?,?,?,?)').run(id,requestKey,Number(selected),expectedRevision,now());
      const result={...status(id),duplicate:false};db.exec('COMMIT');return result;
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  // Trusted accepted snapshot only. Neither route history nor discovery consent
  // is consulted. Raw coordinates live in the short-lived last-sample table.
  function observe({steamId:id,lifeId,at,location}){
    const rules=synchronize();if(!rules)return;
    const p=preference(id),runtime=db.prepare('SELECT resumed_at FROM dc_location_runtime WHERE id=1').get();
    if(!p.enabled||!db.prepare('SELECT 1 FROM dc_participants WHERE steam_id=?').get(id)||!Number.isSafeInteger(at)||at<=p.collect_after||at<runtime.resumed_at||at>now()||at<now()-30000)return;
    const old=db.prepare('SELECT * FROM dc_location_last WHERE steam_id=?').get(id);if(old&&at<=old.at)return;
    const valid=typeof lifeId==='string'&&lifeId.length>0&&lifeId.length<=160&&location&&[location.x,location.y].every(n=>typeof n==='number'&&Number.isFinite(n))&&location.x>=rules.bounds.minX&&location.x<=rules.bounds.maxX&&location.y>=rules.bounds.minY&&location.y<=rules.bounds.maxY;
    const seconds=old?(at-old.at)/1000:0,metres=valid&&old&&old.x!==null?Math.hypot(location.x-old.x,location.y-old.y)/100:0;
    const connected=valid&&old&&old.x!==null&&old.version===rules.version&&old.life_id===lifeId&&seconds>0&&seconds<=120&&metres/seconds<=40&&
      !db.prepare("SELECT 1 FROM vl_events WHERE json_extract(payload,'$.steamId')=? AND json_extract(payload,'$.type')='combat_death' AND occurred_at>=? AND occurred_at<=? LIMIT 1").get(id,old.at,at);
    if(connected)db.prepare('INSERT INTO dc_location_receipts VALUES (?,?,?,?,?,?,1)').run(id,rules.version,at,old.at,metres,inside(rules.highlands.polygon,{x:old.x,y:old.y})&&inside(rules.highlands.polygon,location)?1:0);
    db.prepare('INSERT INTO dc_location_last VALUES (?,?,?,?,?,?) ON CONFLICT(steam_id) DO UPDATE SET version=excluded.version,life_id=excluded.life_id,at=excluded.at,x=excluded.x,y=excluded.y').run(id,rules.version,typeof lifeId==='string'?lifeId.slice(0,160):'',at,valid?location.x:null,valid?location.y:null);
  }
  function finishSnapshot(at){db.prepare('DELETE FROM dc_location_last WHERE at<>?').run(at);}
  function reconcileDeath({steamId,at}){const changed=db.prepare('UPDATE dc_location_receipts SET valid=0 WHERE steam_id=? AND from_at<=? AND at>=? AND valid=1').run(steamId,at,at).changes;if(changed)db.prepare('DELETE FROM dc_location_last WHERE steam_id=?').run(steamId);}
  return {catalogs,change,status,erase,observe,finishSnapshot,prune,reconcileDeath};
}
module.exports={createChallengeLocationStore};
