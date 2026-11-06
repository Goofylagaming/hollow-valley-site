// Import only immutable results accepted by the authenticated Territory receiver.
// Each participant gets one capture contribution; repeated delivery/imports are safe.
function reconcileTerritoryCaptures(legacy) {
  const {db}=legacy;
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='progression_territory_results'").get()) return;
  const source='progression_territory_results';
  const rows=db.prepare(`SELECT r.attack_id,r.payload_json FROM progression_territory_results r
    WHERE json_extract(r.payload_json,'$.resolvedAt')>=?
      AND NOT EXISTS (SELECT 1 FROM vl_imports i WHERE i.source=? AND i.id=CAST(r.attack_id AS TEXT))
    ORDER BY json_extract(r.payload_json,'$.resolvedAt'),r.attack_id LIMIT 100`).all(legacy.started,source);
  for(const row of rows) {
    const result=JSON.parse(row.payload_json);
    let error=null;
    // The receiver validates this shape before persistence. Fail closed if an
    // incompatible producer/schema is ever added instead of inventing records.
    if(result.version!==1 || result.provenance!=='recorded-live' || result.outcome!=='capture'
      || result.attackId!==row.attack_id || !Number.isSafeInteger(result.resolvedAt)
      || !Array.isArray(result.winners) || !result.winners.length
      || result.winners.some(id=>typeof id!=='string'||!/^\d{17}$/.test(id))
      || new Set(result.winners).size!==result.winners.length) error='Unsupported recorded capture evidence';
    if(!error) {
      try {
        for(const steamId of result.winners) {
          const name=db.prepare('SELECT name FROM vl_lives WHERE steam_id=? ORDER BY last_at DESC,id LIMIT 1').get(steamId)?.name||'Survivor';
          // Freeze the name on first import as well as the contribution; a later
          // display-name change must not make a retry conflict with its own event.
          const id=`territory:${row.attack_id}:${steamId}`;
          const previous=db.prepare('SELECT payload FROM vl_events WHERE id=?').get(id);
          const recordedName=previous?JSON.parse(previous.payload).name:name;
          legacy.ingest({id,type:'territory_capture',steamId,name:recordedName,value:1,at:result.resolvedAt});
        }
      } catch(e) {
        if(e.status!==400&&e.status!==409) throw e;
        error=e.message;
      }
    }
    // Closed-season evidence stays in both source and import audit for explicit
    // reconciliation; importing it never silently rewrites Hall of Fame results.
    db.prepare('INSERT OR IGNORE INTO vl_imports VALUES (?,?,?)').run(source,String(row.attack_id),error);
  }
}
module.exports={reconcileTerritoryCaptures};
