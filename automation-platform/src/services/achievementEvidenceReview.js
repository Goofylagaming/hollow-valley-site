function createAchievementEvidenceReview(db,{now=Date.now}={}) {
  db.exec(`CREATE TABLE IF NOT EXISTS progression_achievement_evidence_reviews (
    steam_id TEXT NOT NULL,achievement_id TEXT NOT NULL,evidence_kind TEXT NOT NULL,
    evidence_id TEXT NOT NULL,detected_at INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
    PRIMARY KEY(steam_id,achievement_id,evidence_kind,evidence_id)
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS progression_achievement_review_state (
    steam_id TEXT NOT NULL,achievement_id TEXT NOT NULL,revision INTEGER NOT NULL,status TEXT NOT NULL,
    PRIMARY KEY(steam_id,achievement_id)
  );
  CREATE TABLE IF NOT EXISTS progression_achievement_review_actions (
    request_id TEXT PRIMARY KEY,payload_json TEXT NOT NULL,created_at INTEGER NOT NULL
  )`);
  const exists=name=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  function inspect(steam) {
    const flag=db.prepare('INSERT OR IGNORE INTO progression_achievement_evidence_reviews(steam_id,achievement_id,evidence_kind,evidence_id,detected_at) VALUES (?,?,?,?,?)');
    const recordFlag=(...args)=>{
      const result=flag.run(...args);
      if(result.changes) db.prepare(`INSERT INTO progression_achievement_review_state VALUES (?,?,1,'active')
        ON CONFLICT(steam_id,achievement_id) DO UPDATE SET revision=revision+1`).run(args[0],args[1]);
    };
    const rows=db.prepare("SELECT achievement_id,metadata_json FROM progression_achievements WHERE steam_id=? AND achievement_id IN ('nested-adult','life-survival-10h')").all(steam);
    for(const row of rows) {
      let evidence;try{evidence=JSON.parse(row.metadata_json).evidence;}catch{}
      if(!evidence?.lifeId || !exists('vl_lives')) continue;
      const life=db.prepare('SELECT steam_id,started_at,ended_at FROM vl_lives WHERE id=?').get(evidence.lifeId);
      if(!life || life.steam_id!==steam) {
        recordFlag(steam,row.achievement_id,'life-identity',String(evidence.lifeId),now());continue;
      }
      const start=row.achievement_id==='nested-adult'?evidence.juvenileAt:life.started_at;
      const end=row.achievement_id==='nested-adult'?evidence.adultAt:evidence.observedThrough;
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<=start) continue;
      if(life.ended_at!==null && life.ended_at<end) recordFlag(steam,row.achievement_id,'life-ended-early',String(evidence.lifeId),now());
      if(exists('vl_events')) {
        const deaths=db.prepare(`SELECT id FROM vl_events WHERE json_extract(payload,'$.type')='combat_death'
          AND json_extract(payload,'$.steamId')=? AND occurred_at BETWEEN ? AND ?`).all(steam,start,end);
        for(const death of deaths) recordFlag(steam,row.achievement_id,'legacy-death',death.id,now());
      }
      if(exists('combat_events')) {
        const deaths=db.prepare(`SELECT id FROM combat_events WHERE victim_steam_id=?
          AND (CAST(strftime('%s',occurred_at) AS INTEGER)*1000 + CAST(substr(strftime('%f',occurred_at),4,3) AS INTEGER)) BETWEEN ? AND ?`).all(steam,start,end);
        for(const death of deaths) recordFlag(steam,row.achievement_id,'combat-death',death.id,now());
      }
    }
    return new Set(db.prepare("SELECT DISTINCT achievement_id FROM progression_achievement_evidence_reviews WHERE steam_id=? AND status='pending'").all(steam).map(r=>r.achievement_id));
  }
  const withdrawn=steam=>new Set(db.prepare("SELECT achievement_id FROM progression_achievement_review_state WHERE steam_id=? AND status='withdrawn'").all(steam).map(r=>r.achievement_id));
  function decide(input={}) {
    if(!input || typeof input!=='object' || Array.isArray(input)) throw Object.assign(new Error('Review object is required'),{status:400});
    const {requestId,steamId,achievementId,actorSteamId,decision,reason,expectedRevision}=input;
    const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
    if(!/^[A-Za-z0-9_-]{8,128}$/.test(requestId||'') || !/^\d{17}$/.test(steamId||'') || !/^\d{17}$/.test(actorSteamId||'')
      || !['nested-adult','life-survival-10h'].includes(achievementId) || !['uphold','withdraw'].includes(decision)
      || typeof reason!=='string' || reason.trim().length<10 || reason.length>500 || !Number.isSafeInteger(expectedRevision) || expectedRevision<0) fail('Valid identities, decision, revision and review reason are required');
    const payload=JSON.stringify({requestId,steamId,achievementId,actorSteamId,decision,reason:reason.trim(),expectedRevision});
    // Check newly ingested evidence even when the player has not reopened their profile.
    inspect(steamId);
    db.exec('BEGIN IMMEDIATE');
    try {
      const old=db.prepare('SELECT payload_json FROM progression_achievement_review_actions WHERE request_id=?').get(requestId);
      if(old) {
        if(old.payload_json!==payload) fail('Review request conflicts with the recorded decision',409);
        db.exec('COMMIT');return {duplicate:true,revision:expectedRevision+1};
      }
      const award=db.prepare('SELECT 1 FROM progression_achievements WHERE steam_id=? AND achievement_id=?').get(steamId,achievementId);
      const review=db.prepare('SELECT 1 FROM progression_achievement_evidence_reviews WHERE steam_id=? AND achievement_id=?').get(steamId,achievementId);
      if(!award||!review) fail('Flagged achievement not found',404);
      const state=db.prepare('SELECT revision FROM progression_achievement_review_state WHERE steam_id=? AND achievement_id=?').get(steamId,achievementId);
      if((state?.revision||0)!==expectedRevision) fail('This achievement was reviewed by another request; reload before deciding',409);
      db.prepare(`INSERT INTO progression_achievement_review_state VALUES (?,?,?,?)
        ON CONFLICT(steam_id,achievement_id) DO UPDATE SET revision=excluded.revision,status=excluded.status`)
        .run(steamId,achievementId,expectedRevision+1,decision==='withdraw'?'withdrawn':'active');
      db.prepare("UPDATE progression_achievement_evidence_reviews SET status='resolved' WHERE steam_id=? AND achievement_id=? AND status='pending'").run(steamId,achievementId);
      db.prepare('INSERT INTO progression_achievement_review_actions VALUES (?,?,?)').run(requestId,payload,now());
      db.exec('COMMIT');return {duplicate:false,revision:expectedRevision+1};
    } catch(error) {db.exec('ROLLBACK');throw error;}
  }
  function list() {
    return db.prepare(`SELECT r.steam_id AS steamId,r.achievement_id AS achievementId,
      COALESCE(s.revision,0) AS revision,COALESCE(s.status,'active') AS awardStatus,
      SUM(CASE WHEN r.status='pending' THEN 1 ELSE 0 END) AS pendingCount,
      MAX(r.detected_at) AS detectedAt
      FROM progression_achievement_evidence_reviews r
      LEFT JOIN progression_achievement_review_state s
        ON s.steam_id=r.steam_id AND s.achievement_id=r.achievement_id
      GROUP BY r.steam_id,r.achievement_id
      ORDER BY pendingCount DESC,detectedAt DESC LIMIT 100`).all().map(row=>({...row,
        award:db.prepare('SELECT unlocked_at AS unlockedAt,metadata_json AS metadata FROM progression_achievements WHERE steam_id=? AND achievement_id=?').get(row.steamId,row.achievementId),
        evidence:db.prepare('SELECT evidence_kind AS kind,evidence_id AS id,detected_at AS detectedAt,status FROM progression_achievement_evidence_reviews WHERE steam_id=? AND achievement_id=? ORDER BY detected_at,evidence_kind,evidence_id').all(row.steamId,row.achievementId).map(item=>{
          let occurredAt=null;
          if(item.kind==='combat-death'&&exists('combat_events')) occurredAt=db.prepare('SELECT occurred_at FROM combat_events WHERE id=? AND victim_steam_id=?').get(item.id,row.steamId)?.occurred_at??null;
          if(item.kind==='legacy-death'&&exists('vl_events')) occurredAt=db.prepare('SELECT occurred_at FROM vl_events WHERE id=?').get(item.id)?.occurred_at??null;
          if(item.kind==='life-ended-early'&&exists('vl_lives')) occurredAt=db.prepare('SELECT ended_at FROM vl_lives WHERE id=? AND steam_id=?').get(item.id,row.steamId)?.ended_at??null;
          return {...item,occurredAt};
        }),
        decisions:db.prepare("SELECT payload_json,created_at AS createdAt FROM progression_achievement_review_actions WHERE json_extract(payload_json,'$.steamId')=? AND json_extract(payload_json,'$.achievementId')=? ORDER BY created_at,request_id").all(row.steamId,row.achievementId).map(action=>({...JSON.parse(action.payload_json),createdAt:action.createdAt}))
      }));
  }
  return {inspect,withdrawn,decide,list};
}
module.exports={createAchievementEvidenceReview};
