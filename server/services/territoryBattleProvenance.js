// Internal evidence only. No player endpoint, badge, currency or game command.
function createBattleProvenance(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS territory_battle_provenance (
    attack_id INTEGER PRIMARY KEY,event_id INTEGER NOT NULL,started_at INTEGER NOT NULL,
    live_observed INTEGER NOT NULL DEFAULT 0,disqualified_reason TEXT,
    closed_at INTEGER,outcome TEXT
  )`);
  const read = id => db.prepare('SELECT * FROM territory_battle_provenance WHERE attack_id=?').get(id) || null;
  function begin(attackId,eventId,at,{initialScore=-100,testing=false}={}) {
    if (![attackId,eventId,at].every(Number.isSafeInteger) || attackId<=0 || eventId<=0 || at<0) throw new Error('Invalid battle identity');
    const previous=read(attackId);
    if(previous) {
      if(previous.event_id!==eventId || previous.started_at!==at) throw new Error('Battle provenance conflict');
      return previous;
    }
    db.prepare('INSERT INTO territory_battle_provenance(attack_id,event_id,started_at,disqualified_reason) VALUES (?,?,?,?)')
      .run(attackId,eventId,at,testing?'testing':initialScore!==-100?'nonstandard-start':null);
    return read(attackId);
  }
  function disqualify(id,reason) {
    if(!['manual','simulated','testing','unavailable'].includes(reason)) throw new Error('Invalid evidence reason');
    db.prepare('UPDATE territory_battle_provenance SET disqualified_reason=COALESCE(disqualified_reason,?) WHERE attack_id=? AND closed_at IS NULL').run(reason,id);
  }
  function observe(id,presence) {
    if(!presence?.usable) return; // A pause alone is not a forged result.
    if(presence.simulated) return disqualify(id,'simulated');
    db.prepare('UPDATE territory_battle_provenance SET live_observed=1 WHERE attack_id=? AND closed_at IS NULL').run(id);
  }
  function finish(id,at,outcome,{manual=false}={}) {
    if(!Number.isSafeInteger(at) || !['capture','defence'].includes(outcome)) throw new Error('Invalid battle result');
    const row=read(id);
    if(!row) return {eligible:false,reason:'unknown-history'};
    if(row.closed_at!==null && (row.closed_at!==at || row.outcome!==outcome)) throw new Error('Battle result conflict');
    if(at<row.started_at) throw new Error('Battle result predates declaration');
    if(manual) disqualify(id,'manual');
    db.prepare('UPDATE territory_battle_provenance SET closed_at=?,outcome=? WHERE attack_id=? AND closed_at IS NULL').run(at,outcome,id);
    const result=read(id);
    return {eligible:!result.disqualified_reason && result.live_observed===1,
      reason:result.disqualified_reason || (result.live_observed?'recorded-live':'no-live-evidence')};
  }
  return {begin,observe,disqualify,finish,read};
}
module.exports={createBattleProvenance};
