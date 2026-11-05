"use strict";
const {createSeasonTrackStore,collectionReady}=require('./seasonTrackStore');
const {CONTRACTS,checkAchievementInfrastructure}=require('./achievementSourceTime');
const {parseSourceTimestamp}=require('./progressionSourceTime');
const has=(db,name,fields)=>{const columns=new Set(db.prepare(`PRAGMA table_info(${name})`).all().map(c=>c.name));return fields.every(f=>columns.has(f));};
const CORE={
 progression_seasons:['id','definition_json','digest','state','revision'],progression_season_audit:['season_id','revision','action','digest'],
 progression_season_retention:['season_id','digest','retain_until','cleaned_at'],progression_season_enrollments:['season_id','steam_id','enrolled_at','cursor'],
 progression_season_choices:['season_id','steam_id','revision'],progression_season_requests:['season_id','steam_id'],
 progression_season_maintenance:['id','source_cursor'],progression_season_evidence:['season_id','steam_id','ledger_id','amount','source','reference_type','source_at','basis','ledger_created_at','accepted_at'],
 progression_season_source_positions:['position','ledger_id','steam_id'],progression_season_achievement_cursors:['season_id','steam_id','source_floor'],
 progression_season_achievement_evidence:['season_id','steam_id','achievement_id','xp','source_position','source_at','recorded_at','basis','award_digest','evidence_digest'],
 progression_xp_ledger:['id','steam_id','amount','source','reference_type','created_at'],progression_xp_source_times:['ledger_id','source_at','basis'],
};
const ACHIEVEMENT_SCHEMA={
 quests:{economy_quest_achievements:['steam_id','quest_id','period_key','achieved_at']},
 events:{event_attendance:['steam_id','event_id','status','confirmed_at']},
 combat_species:{combat_events:['id','occurred_at','killer_steam_id','victim_steam_id','victim_species','source']},
 territory_victories:{progression_territory_winners:['attack_id','steam_id'],progression_territory_results:['attack_id','event_id','payload_json','received_at']},
 nested_adult:{vl_lives:['id','steam_id','species','started_at','last_at','ended_at'],vl_events:['id','payload','occurred_at'],vl_growth_milestones:['life_id','juvenile_at','adult_at'],vl_parents:['child','parent']},
 life_survival_seconds:{vl_lives:['id','steam_id','species','started_at','last_at','ended_at'],vl_events:['id','payload','occurred_at'],vl_records:['scope','metric','subject','value','achieved_at']},
};
function achievementReady(db,award) {
 try {
  if (!has(db,'progression_achievements',['steam_id','achievement_id','metadata_json','unlocked_at']) ||
      !has(db,'progression_achievement_sources',['position','steam_id','achievement_id','award_digest','source_at','basis','evidence_digest','recorded_at'])) return false;
  checkAchievementInfrastructure(db,[award]);
  if (['nested_adult','life_survival_seconds'].includes(CONTRACTS[award.id].type) &&
      db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='combat_events'").get() && !has(db,'combat_events',['victim_steam_id','occurred_at'])) return false;
  return Object.entries(ACHIEVEMENT_SCHEMA[CONTRACTS[award.id].type]||{}).every(([name,fields])=>has(db,name,fields));
 }catch{return false;}
}
function sourceIndexReady(db) {
 const actual=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='progression_season_source_insert'").get()?.sql;
 const expected=`CREATE TRIGGER progression_season_source_insert AFTER INSERT ON progression_xp_ledger BEGIN
   INSERT OR IGNORE INTO progression_season_source_positions(ledger_id,steam_id) VALUES(NEW.id,NEW.steam_id); END`;
 const canonical=sql=>sql.replace('IF NOT EXISTS ','').replace(/\s+/g,' ').trim();
 return Boolean(actual && canonical(actual)===canonical(expected));
}

// The host CLI opens an explicitly selected existing database read-only. All
// probes share one SQLite snapshot; no runtime service or schema writer is loaded.
function inspectSeasonTrack(db,id,{limit=5,after=0,now=Date.now()}={}) {
 if (typeof id!=='string' || !/^[a-z0-9][a-z0-9-]{2,63}$/.test(id)) throw new Error('Choose a valid season identity');
 if (!Number.isSafeInteger(limit)||limit<1||limit>10||!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(now)||now<0) throw new Error('Choose a bounded inspection page');
 if (db.isTransaction) throw new Error('Begin inspection outside another transaction');
 db.exec('BEGIN');
 try {
  const missingTables=Object.entries(CORE).filter(([name,fields])=>!has(db,name,fields)).map(([name])=>name);
  const report={version:1,observedAt:now,mode:'read-only',checks:{coreSchema:!missingTables.length,missingTables,reviewVerified:false,sourceIndex:false,collectionQueue:false,achievementSources:[]},
    season:null,sample:null,scope:{participantLimit:limit,xpCandidatesPerParticipant:100,afterPosition:after,doesNotEstablishProductionReadiness:true}};
  if (missingTables.length) return report;
  const store=createSeasonTrackStore(db,{initialize:false,now:()=>now});let season;
  try {season=store.read(id);}catch{return report;}
  report.checks.reviewVerified=true;report.checks.sourceIndex=sourceIndexReady(db);report.checks.collectionQueue=collectionReady(db);
  const definition=season.definition,expired=Boolean(definition.retainUntil && now>=Date.parse(definition.retainUntil));
  report.season={id:definition.id,digest:season.digest,state:season.state,revision:season.revision,retentionExpired:expired};
  const awards=definition.achievementPoints?.awards||[];
  report.checks.achievementSources=awards.map(award=>({id:award.id,basis:CONTRACTS[award.id].basis,schemaReady:achievementReady(db,award)}));
  if (has(db,'progression_season_collection_queue',['position','season_id','steam_id'])) {
    const missing=db.prepare(`SELECT 1 FROM progression_season_enrollments e WHERE e.season_id=? AND NOT EXISTS(
      SELECT 1 FROM progression_season_collection_queue q WHERE q.season_id=e.season_id AND q.steam_id=e.steam_id) LIMIT 101`).all(id);
    const orphan=db.prepare(`SELECT 1 FROM progression_season_collection_queue q WHERE q.season_id=? AND NOT EXISTS(
      SELECT 1 FROM progression_season_enrollments e WHERE e.season_id=q.season_id AND e.steam_id=q.steam_id) LIMIT 101`).all(id);
    const cursor=has(db,'progression_season_collection_cursor',['id','after_position'])?db.prepare('SELECT after_position FROM progression_season_collection_cursor WHERE id=1').get()?.after_position??0:null;
    report.checks.queueConsistency={enrollmentsWithoutJobs:Math.min(missing.length,100),moreEnrollmentsWithoutJobs:missing.length>100,jobsWithoutEnrollment:Math.min(orphan.length,100),moreJobsWithoutEnrollment:orphan.length>100,cursorValid:Number.isSafeInteger(cursor)&&cursor>=0};
  }
  if (after && !report.checks.collectionQueue) throw new Error('Prepare the collection queue before paging an inspection');
  // Expired queues are cleanup work, not a reason to probe retained private data.
  if (expired) {
    const rows=db.prepare('SELECT 1 FROM progression_season_enrollments WHERE season_id=? LIMIT ?').all(id,limit+1);
    report.sample={participantsProbed:0,expiredEnrollments:Math.min(rows.length,limit),moreExpiredEnrollments:rows.length>limit,nextPosition:null};return report;
  }
  const rows=report.checks.collectionQueue?db.prepare(`SELECT q.position,q.steam_id,e.cursor FROM progression_season_collection_queue q
    JOIN progression_season_enrollments e ON e.season_id=q.season_id AND e.steam_id=q.steam_id WHERE q.season_id=? AND q.position>? ORDER BY q.position LIMIT ?`).all(id,after,limit+1)
    :db.prepare('SELECT steam_id,cursor FROM progression_season_enrollments WHERE season_id=? ORDER BY steam_id LIMIT ?').all(id,limit+1);
  const selected=rows.slice(0,limit);
  const sample={participantsProbed:selected.length,moreParticipants:rows.length>limit,nextPosition:report.checks.collectionQueue&&rows.length>limit?selected.at(-1).position:null,
    pendingProgressParticipants:0,invalidCopiedParticipants:0,unavailableParticipants:0,unprocessedXpCandidates:0,moreXpCandidatesParticipants:0,unknownXpClockCandidates:0,
    futureReceivedCandidates:0,oldestSampledPendingReceiptAt:null,undatedSelectedBadges:0};
  for (const participant of selected) {
    try {
      if (!/^\d{17}$/.test(participant.steam_id)||!Number.isSafeInteger(participant.cursor)||participant.cursor<0) throw new Error('Unavailable');
      const value=store.progress(id,participant.steam_id);
      let candidates=[],undated=0;
      if (definition.sources.length) {
        candidates=db.prepare(`SELECT l.created_at,t.source_at FROM progression_season_source_positions p
          LEFT JOIN progression_xp_ledger l ON l.id=p.ledger_id AND l.steam_id=p.steam_id LEFT JOIN progression_xp_source_times t ON t.ledger_id=l.id
          WHERE p.steam_id=? AND p.position>? ORDER BY p.position LIMIT 101`).all(participant.steam_id,participant.cursor);
      }
      if (awards.length && has(db,'progression_achievements',['steam_id','achievement_id']) && has(db,'progression_achievement_sources',['steam_id','achievement_id'])) {
        undated=db.prepare(`SELECT count(*) n FROM progression_achievements a WHERE a.steam_id=? AND a.achievement_id IN (${awards.map(()=>'?').join(',')})
          AND NOT EXISTS(SELECT 1 FROM progression_achievement_sources s WHERE s.steam_id=a.steam_id AND s.achievement_id=a.achievement_id)`).get(participant.steam_id,...awards.map(a=>a.id)).n;
      }
      sample.pendingProgressParticipants+=Number(value.pending);sample.invalidCopiedParticipants+=Number(value.evidenceUnavailable);
      sample.moreXpCandidatesParticipants+=Number(candidates.length>100);sample.undatedSelectedBadges+=undated;
      for (const candidate of candidates.slice(0,100)) {
          sample.unprocessedXpCandidates++;
          if (!Number.isSafeInteger(candidate.source_at)||candidate.source_at<0) sample.unknownXpClockCandidates++;
          const received=parseSourceTimestamp(candidate.created_at);
          if (received!==null && received>now) sample.futureReceivedCandidates++;
          if (received!==null && received<=now && (sample.oldestSampledPendingReceiptAt===null||received<sample.oldestSampledPendingReceiptAt)) sample.oldestSampledPendingReceiptAt=received;
      }
    }catch{sample.unavailableParticipants++;}
  }
  report.sample=sample;return report;
 }finally{db.exec('ROLLBACK');}
}
module.exports={inspectSeasonTrack};
