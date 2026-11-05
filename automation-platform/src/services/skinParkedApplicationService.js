function createSkinParkedApplicationService(store,{readOutcome=command=>require('./commandBridgeService').readOutcome(command),now=Date.now}={}) {
  const db=store.db;
  db.exec(`CREATE TABLE IF NOT EXISTS economy_skin_parked_applications (
    id TEXT PRIMARY KEY,steam_id TEXT NOT NULL,preset_id TEXT NOT NULL,slot TEXT NOT NULL,
    command_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',created_at INTEGER NOT NULL,completed_at INTEGER);
    CREATE INDEX IF NOT EXISTS economy_skin_parked_pending ON economy_skin_parked_applications(steam_id,preset_id,status);`);
  const pending=(steam,presetId)=>Boolean(db.prepare("SELECT 1 FROM economy_skin_parked_applications WHERE steam_id=? AND preset_id=? AND status='pending'").get(steam,presetId));
  function reserve({command,steamId,presetId,slot,validate}) {
    const steam=store.validateSteamId(steamId);
    if(!command?.id||command.verb!=='dino_edit'||command.steam!==steam)throw new Error('Invalid parked skin command');
    db.exec('BEGIN IMMEDIATE');
    try{
      validate();
      if(pending(steam,presetId))throw Object.assign(new Error('A parked skin application is still awaiting confirmation. Check its outcome before trying again.'),{code:'SKIN_PARKED_PENDING',status:409});
      db.prepare('INSERT INTO economy_skin_parked_applications(id,steam_id,preset_id,slot,command_json,created_at) VALUES (?,?,?,?,?,?)').run(command.id,steam,presetId,slot,JSON.stringify(command),now());
      db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function complete(id,state) {
    if(!['confirmed','failed','not_published'].includes(state))return false;
    return db.prepare("UPDATE economy_skin_parked_applications SET status=?,completed_at=? WHERE id=? AND status='pending'").run(state,now(),id).changes===1;
  }
  async function reconcile(steamId,{cursor=0}={}) {
    const steam=store.validateSteamId(steamId);
    if(!Number.isSafeInteger(cursor)||cursor<0)throw Object.assign(new Error('Invalid parked application cursor'),{status:400});
    const rows=db.prepare("SELECT rowid AS cursor,id,command_json FROM economy_skin_parked_applications WHERE steam_id=? AND status='pending' AND rowid>? ORDER BY rowid LIMIT 26").all(steam,cursor);
    let resolved=0;
    for(const row of rows.slice(0,25)){
      try{const outcome=await readOutcome(JSON.parse(row.command_json));if(['confirmed','failed'].includes(outcome?.state)&&complete(row.id,outcome.state))resolved++;}
      catch{/* Unreachable or ambiguous outcomes retain the durable hold. */}
    }
    const remaining=db.prepare("SELECT COUNT(*) n FROM economy_skin_parked_applications WHERE steam_id=? AND status='pending'").get(steam).n;
    return {checked:Math.min(rows.length,25),resolved,pending:remaining,nextCursor:rows.length>25?rows[24].cursor:null};
  }
  return {reserve,pending,complete,reconcile};
}
module.exports={createSkinParkedApplicationService};
