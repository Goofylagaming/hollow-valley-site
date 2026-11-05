function createTerritoryVictoryStore(db,{now=Date.now}={}) {
  db.exec(`CREATE TABLE IF NOT EXISTS progression_territory_results (
    attack_id INTEGER PRIMARY KEY,event_id INTEGER NOT NULL,payload_json TEXT NOT NULL,
    received_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS progression_territory_winners (
    attack_id INTEGER NOT NULL,steam_id TEXT NOT NULL,PRIMARY KEY(attack_id,steam_id)
  );
  CREATE INDEX IF NOT EXISTS progression_territory_winners_player ON progression_territory_winners(steam_id)`);
  function invalid(message,status=400) {throw Object.assign(new Error(message),{status});}
  function ingest(input={}) {
    if(!input || typeof input!=='object' || Array.isArray(input)) invalid('Invalid Territory result');
    if(input.version!==1 || input.provenance!=='recorded-live' || input.outcome!=='capture') invalid('Unsupported or unverified Territory result');
    if(![input.attackId,input.eventId,input.startedAt,input.resolvedAt].every(Number.isSafeInteger)
      || input.attackId<=0 || input.eventId<=0 || input.startedAt<0
      || input.resolvedAt<=input.startedAt || input.resolvedAt>now()+120000) invalid('Invalid battle identity or timestamps');
    if(!Array.isArray(input.winners) || !input.winners.length || input.winners.length>256
      || input.winners.some(id=>typeof id!=='string' || !/^\d{17}$/.test(id))) invalid('Invalid frozen winner roster');
    const winners=[...new Set(input.winners)].sort();
    if(winners.length!==input.winners.length) invalid('Duplicate winner identity');
    const payload=JSON.stringify({version:1,attackId:input.attackId,eventId:input.eventId,
      startedAt:input.startedAt,resolvedAt:input.resolvedAt,outcome:'capture',provenance:'recorded-live',winners});
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous=db.prepare('SELECT payload_json FROM progression_territory_results WHERE attack_id=?').get(input.attackId);
      if(previous && previous.payload_json!==payload) invalid('Battle result conflicts with stored evidence',409);
      if(!previous) {
        db.prepare('INSERT INTO progression_territory_results VALUES (?,?,?,?)').run(input.attackId,input.eventId,payload,now());
        const insert=db.prepare('INSERT INTO progression_territory_winners VALUES (?,?)');
        for(const steam of winners) insert.run(input.attackId,steam);
      }
      db.exec('COMMIT');return {accepted:true,duplicate:Boolean(previous),attackId:input.attackId};
    } catch(error) {db.exec('ROLLBACK');throw error;}
  }
  return {ingest};
}
module.exports={createTerritoryVictoryStore};
