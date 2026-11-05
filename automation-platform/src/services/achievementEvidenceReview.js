function createAchievementEvidenceReview(db,{now=Date.now}={}) {
  db.exec(`CREATE TABLE IF NOT EXISTS progression_achievement_evidence_reviews (
    steam_id TEXT NOT NULL,achievement_id TEXT NOT NULL,evidence_kind TEXT NOT NULL,
    evidence_id TEXT NOT NULL,detected_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
    PRIMARY KEY(steam_id,achievement_id,evidence_kind,evidence_id)
  )`);
  const exists=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  function inspect(steam) {
    const flag=db.prepare('INSERT OR IGNORE INTO progression_achievement_evidence_reviews(steam_id,achievement_id,evidence_kind,evidence_id,detected_at) VALUES (?,?,?,?,?)');
    const rows=db.prepare("SELECT achievement_id,metadata_json FROM progression_achievements WHERE steam_id=? AND achievement_id IN ('nested-adult','life-survival-10h')").all(steam);
    for(const row of rows) {
      let evidence;try{evidence=JSON.parse(row.metadata_json).evidence;}catch{}
      if(!evidence?.lifeId || !exists('vl_lives')) continue;
      const life=db.prepare('SELECT steam_id,started_at,ended_at FROM vl_lives WHERE id=?').get(evidence.lifeId);
      if(!life || life.steam_id!==steam) {
        flag.run(steam,row.achievement_id,'life-identity',String(evidence.lifeId),now());continue;
      }
      const start=row.achievement_id==='nested-adult'?evidence.juvenileAt:life.started_at;
      const end=row.achievement_id==='nested-adult'?evidence.adultAt:evidence.observedThrough;
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start) continue;
      if(life.ended_at!==null && life.ended_at<end) flag.run(steam,row.achievement_id,'life-ended-early',String(evidence.lifeId),now());
      if(exists('vl_events')) {
        const deaths=db.prepare(`SELECT id FROM vl_events WHERE json_extract(payload,'$.type')='combat_death'
          AND json_extract(payload,'$.steamId')=? AND occurred_at BETWEEN ? AND ?`).all(steam,start,end);
        for(const death of deaths) flag.run(steam,row.achievement_id,'legacy-death',death.id,now());
      }
      if(exists('combat_events')) {
        const deaths=db.prepare(`SELECT id FROM combat_events WHERE victim_steam_id=?
          AND (CAST(strftime('%s',occurred_at) AS INTEGER)*1000 + CAST(substr(strftime('%f',occurred_at),4,3) AS INTEGER)) BETWEEN ? AND ?`).all(steam,start,end);
        for(const death of deaths) flag.run(steam,row.achievement_id,'combat-death',death.id,now());
      }
    }
    return new Set(db.prepare("SELECT DISTINCT achievement_id FROM progression_achievement_evidence_reviews WHERE steam_id=? AND status='pending'").all(steam).map(r=>r.achievement_id));
  }
  return {inspect};
}
module.exports={createAchievementEvidenceReview};
