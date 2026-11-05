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
    if(!['confirmed','failed'].includes(state))return false;
    return db.prepare("UPDATE economy_skin_parked_applications SET status=?,completed_at=? WHERE id=? AND status='pending'").run(state,now(),id).changes===1;
  }
  async function reconcile(steamId) {
    const steam=store.validateSteamId(steamId);
    const rows=db.prepare("SELECT id,command_json FROM economy_skin_parked_applications WHERE steam_id=? AND status='pending' ORDER BY created_at LIMIT 25").all(steam);
    let resolved=0;
    for(const row of rows){
      try{const outcome=await readOutcome(JSON.parse(row.command_json));if(complete(row.id,outcome?.state))resolved++;}
      catch{/* Unreachable or ambiguous outcomes retain the durable hold. */}
    }
    const remaining=db.prepare("SELECT COUNT(*) n FROM economy_skin_parked_applications WHERE steam_id=? AND status='pending'").get(steam).n;
    return {checked:rows.length,resolved,pending:remaining};
  }
  return {reserve,pending,complete,reconcile};
}
module.exports={createSkinParkedApplicationService};
