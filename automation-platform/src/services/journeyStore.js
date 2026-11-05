const DAY=86400000;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
function createJourneyStore(db,{now=Date.now,enabled=()=>process.env.JOURNEY_HISTORY_ENABLED==='1',describeLife=()=>null}={}) {
  db.exec(`CREATE TABLE IF NOT EXISTS journey_preferences(
    steam_id TEXT PRIMARY KEY,enabled INTEGER NOT NULL,revision INTEGER NOT NULL,
    collect_after INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS journey_points(
    steam_id TEXT NOT NULL,life_id TEXT NOT NULL,at INTEGER NOT NULL,x REAL NOT NULL,y REAL NOT NULL,
    break_before INTEGER NOT NULL,PRIMARY KEY(steam_id,at));
    CREATE INDEX IF NOT EXISTS journey_points_age ON journey_points(at);
    CREATE INDEX IF NOT EXISTS journey_points_life ON journey_points(steam_id,life_id,at);
    CREATE TABLE IF NOT EXISTS journey_gaps(steam_id TEXT PRIMARY KEY,at INTEGER NOT NULL);`);
  const steam=value=>{if(typeof value!=='string'||!/^\d{17}$/.test(value))fail('Linked Steam account required');return value;};
  const gate=()=>{if(!enabled())fail('Journey history is not enabled',503);};
  const preference=id=>db.prepare('SELECT * FROM journey_preferences WHERE steam_id=?').get(steam(id))||{steam_id:id,enabled:0,revision:0,collect_after:0};
  function settings(id){const p=preference(id);return {enabled:Boolean(p.enabled),revision:p.revision};}
  function change(id,{enabled:optIn,expectedRevision,erase=false}={}) {
    gate();steam(id);
    if(typeof optIn!=='boolean'||typeof erase!=='boolean'||!Number.isSafeInteger(expectedRevision)||expectedRevision<0)fail('Valid preference and revision required');
    if(erase&&optIn)fail('Deleting history must also stop collection');
    db.exec('BEGIN IMMEDIATE');
    try {
      const p=preference(id);if(p.revision!==expectedRevision)fail('Preferences changed; refresh before trying again',409);
      // A new consent epoch prevents delayed or replayed observations from
      // recreating deleted history, including after opt-in is renewed.
      const after=Math.max(p.collect_after,now());
      db.prepare(`INSERT INTO journey_preferences VALUES (?,?,?,?) ON CONFLICT(steam_id)
        DO UPDATE SET enabled=excluded.enabled,revision=excluded.revision,collect_after=excluded.collect_after`)
        .run(id,optIn?1:0,p.revision+1,after);
      if(erase){db.prepare('DELETE FROM journey_points WHERE steam_id=?').run(id);db.prepare('DELETE FROM journey_gaps WHERE steam_id=?').run(id);}
      db.exec('COMMIT');return settings(id);
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function prune(){db.prepare('DELETE FROM journey_points WHERE at<?').run(now()-30*DAY);db.prepare('DELETE FROM journey_gaps WHERE at<?').run(now()-30*DAY);}
  // Called within the accepted Legacy snapshot transaction. No browser-supplied
  // route or location is accepted by this integration.
  function record({steamId,lifeId,at,location}) {
    if(!enabled())return false;
    const p=preference(steamId);
    if(!p.enabled||!Number.isSafeInteger(at)||at<=p.collect_after||at>now()||at<now()-30*DAY)return false;
    const previous=db.prepare('SELECT * FROM journey_points WHERE steam_id=? ORDER BY at DESC LIMIT 1').get(steamId);
    if(previous&&at<=previous.at)return false;
    const gapMarker=db.prepare('SELECT at FROM journey_gaps WHERE steam_id=?').get(steamId);
    if(gapMarker&&at<=gapMarker.at)return false;
    if(typeof lifeId!=='string'||!lifeId||lifeId.length>160||!location||
      ![location.x,location.y].every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e7)){
      db.prepare('INSERT INTO journey_gaps VALUES (?,?) ON CONFLICT(steam_id) DO UPDATE SET at=excluded.at').run(steamId,at);
      return false;
    }
    const same=previous&&previous.life_id===lifeId&&previous.at>p.collect_after;
    if(same&&at-previous.at<15000)return false;
    const gap=same?(at-previous.at)/1000:Infinity;
    const metres=same?Math.hypot(location.x-previous.x,location.y-previous.y)/100:0;
    const broken=Boolean(gapMarker)||!same||gap>120||metres/gap>40;
    db.prepare('INSERT INTO journey_points VALUES (?,?,?,?,?,?)').run(steamId,lifeId,at,location.x,location.y,broken?1:0);
    db.prepare('DELETE FROM journey_gaps WHERE steam_id=?').run(steamId);
    db.prepare(`DELETE FROM journey_points WHERE steam_id=? AND at NOT IN
      (SELECT at FROM journey_points WHERE steam_id=? ORDER BY at DESC LIMIT 10000)`).run(steamId,steamId);
    return true;
  }
  function points(id,{before=Number.MAX_SAFE_INTEGER}={}) {
    gate();steam(id);if(!Number.isSafeInteger(before)||before<1)fail('Invalid history cursor');
    const rows=db.prepare(`SELECT life_id AS lifeId,at,x,y,break_before AS breakBefore FROM journey_points
      WHERE steam_id=? AND at<? AND at>=? ORDER BY at DESC LIMIT 501`).all(id,before,now()-30*DAY);
    const page=rows.slice(0,500);
    const lives=[...new Set(page.map(p=>p.lifeId))].map(lifeId=>describeLife(id,lifeId)).filter(Boolean);
    return {points:page,nextBefore:rows.length>500?rows[499].at:null,lives};
  }
  return {settings,change,record,points,prune};
}
module.exports={createJourneyStore};
