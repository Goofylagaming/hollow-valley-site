"use strict";
const { createHash } = require('node:crypto');
const { levelFromXp, xpToReachLevel, PLAYTIME_XP_PER_5_MINUTES, PLAYTIME_INTERVAL_MINUTES } = require('./progressionRules');
const RULE = 'permanent-xp-v1', LEVELS = [2,10,25,50,100];
const digest = rows => createHash('sha256').update(JSON.stringify(rows)).digest('hex');
const ready = (db, name, fields) => { const columns = new Set(db.prepare(`PRAGMA table_info(${name})`).all().map(row=>row.name)); return fields.every(field=>columns.has(field)); };
function sourceInfrastructure(db,type) {
  if (type==='level') return ready(db,'progression_level_sources',['rule','steam_id','position','old_xp','new_xp','old_level','new_level','prefix_digest','ledger_id']) && ready(db,'progression_xp_order',['position','ledger_id']) && ready(db,'progression_players',['steam_id','xp','level']) && ready(db,'progression_xp_ledger',['id','steam_id','source','reference_type','reference_id','metadata_json','amount','created_at']);
  if (type==='playtime_minutes') return ready(db,'progression_players',['steam_id','playtime_intervals']) && ready(db,'progression_xp_ledger',['id','steam_id','source','reference_type','reference_id','metadata_json','amount','created_at']);
  return true;
}
function prefix(db, steamId, position) {
  const rows = db.prepare(`SELECT p.position,l.id,l.amount,l.source,l.reference_type,l.reference_id,l.metadata_json,l.created_at
    FROM progression_xp_order p JOIN progression_xp_ledger l ON l.id=p.ledger_id WHERE l.steam_id=? AND p.position<=? ORDER BY p.position LIMIT 50001`).all(steamId,position);
  if (!rows.length || rows.length > 50000 || rows.some(row=>!Number.isSafeInteger(row.amount)||row.amount<1)) return null;
  const xp = rows.reduce((sum,row)=>sum+row.amount,0);
  return Number.isSafeInteger(xp) ? { xp, digest: digest(rows) } : null;
}
function createLevelSourceStore(db) {
  db.exec('SAVEPOINT progression_level_schema');
  try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS progression_xp_order(position INTEGER PRIMARY KEY AUTOINCREMENT,ledger_id TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS progression_xp_order_state(id INTEGER PRIMARY KEY CHECK(id=1));
    CREATE TABLE IF NOT EXISTS progression_level_sources(ledger_id TEXT PRIMARY KEY,steam_id TEXT NOT NULL,position INTEGER NOT NULL,
      old_xp INTEGER NOT NULL,new_xp INTEGER NOT NULL,old_level INTEGER NOT NULL,new_level INTEGER NOT NULL,prefix_digest TEXT NOT NULL,rule TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS progression_level_source_player ON progression_level_sources(steam_id,old_level,new_level);
    CREATE INDEX IF NOT EXISTS progression_playtime_interval_source ON progression_xp_ledger(steam_id,CAST(reference_id AS INTEGER))
      WHERE source='playtime' AND reference_type='playtime_interval';
    CREATE TRIGGER IF NOT EXISTS progression_xp_order_insert AFTER INSERT ON progression_xp_ledger BEGIN
      INSERT OR IGNORE INTO progression_xp_order(ledger_id) VALUES(NEW.id);
    END;
    CREATE TRIGGER IF NOT EXISTS progression_level_source_delete AFTER DELETE ON progression_xp_ledger BEGIN
      DELETE FROM progression_level_sources WHERE ledger_id=OLD.id;
    END;`);
    if (db.prepare('INSERT OR IGNORE INTO progression_xp_order_state VALUES(1)').run().changes) {
      // Import identity/order only. This assigns no historical activity clock and
      // never creates a historical level transition or achievement receipt.
      db.exec('INSERT OR IGNORE INTO progression_xp_order(ledger_id) SELECT id FROM progression_xp_ledger ORDER BY rowid');
    }
    db.exec('RELEASE progression_level_schema');
  } catch(error) { db.exec('ROLLBACK TO progression_level_schema; RELEASE progression_level_schema'); throw error; }
  function record(ledgerId, { steamId, oldXp, newXp, oldLevel, newLevel }) {
    if (!db.isTransaction) throw new Error('Level evidence requires its XP transaction');
    if (![oldXp,newXp,oldLevel,newLevel].every(Number.isSafeInteger) || oldXp<0 || newXp<=oldXp || levelFromXp(oldXp)!==oldLevel || levelFromXp(newXp)!==newLevel ||
        !LEVELS.some(level=>oldLevel<level && newLevel>=level)) return false;
    const grant = db.prepare('SELECT l.amount,p.position FROM progression_xp_ledger l JOIN progression_xp_order p ON p.ledger_id=l.id WHERE l.id=? AND l.steam_id=?').get(ledgerId,steamId);
    if (!grant || newXp-oldXp!==grant.amount) return false;
    const proof = prefix(db,steamId,grant.position);
    if (!proof || proof.xp!==newXp) return false;
    db.prepare('INSERT INTO progression_level_sources VALUES(?,?,?,?,?,?,?,?,?)').run(ledgerId,steamId,grant.position,oldXp,newXp,oldLevel,newLevel,proof.digest,RULE);
    return true;
  }
  return { record };
}
function sourceClock(row) {
  const expected = { playtime:['playtime_interval','playtime-observation'], quest:['quest','quest-achievement'], event:['event','event-confirmation'] };
  return Object.hasOwn(expected,row.source) && row.reference_type===expected[row.source][0] && row.basis===expected[row.source][1] && Number.isSafeInteger(row.source_at) && row.source_at>=0;
}
function deriveLevelSource(db, steamId, threshold) {
  if (!ready(db,'progression_level_sources',['rule','steam_id','position','old_xp','new_xp','old_level','new_level','prefix_digest','ledger_id']) ||
      !ready(db,'progression_xp_order',['position','ledger_id']) || !ready(db,'progression_xp_source_times',['ledger_id','source_at','basis']) || !ready(db,'progression_players',['steam_id','xp','level'])) return null;
  const rows=db.prepare('SELECT * FROM progression_level_sources WHERE steam_id=? AND old_level<? AND new_level>=? LIMIT 2').all(steamId,threshold,threshold);
  if (rows.length!==1) return null;
  const row=rows[0];
  if (row.rule!==RULE || ![row.old_xp,row.new_xp,row.old_level,row.new_level,row.position].every(Number.isSafeInteger) || row.old_xp<0 || row.new_xp<=row.old_xp ||
      levelFromXp(row.old_xp)!==row.old_level || levelFromXp(row.new_xp)!==row.new_level || row.old_xp>=xpToReachLevel(threshold) || row.new_xp<xpToReachLevel(threshold)) return null;
  const player=db.prepare('SELECT xp,level FROM progression_players WHERE steam_id=?').get(steamId);
  if (!player || !Number.isSafeInteger(player.xp) || player.xp<row.new_xp || levelFromXp(player.xp)!==player.level) return null;
  const grant=db.prepare(`SELECT l.*,p.position,t.source_at,t.basis FROM progression_xp_ledger l JOIN progression_xp_order p ON p.ledger_id=l.id
    LEFT JOIN progression_xp_source_times t ON t.ledger_id=l.id WHERE l.id=? AND l.steam_id=?`).get(row.ledger_id,steamId);
  if (!grant || grant.position!==row.position || grant.amount!==row.new_xp-row.old_xp || !sourceClock(grant)) return null;
  const proof=prefix(db,steamId,row.position);
  return proof && proof.xp===row.new_xp && proof.digest===row.prefix_digest ? {sourceAt:grant.source_at,evidence:{transition:row,sourceAt:grant.source_at,basis:grant.basis}} : null;
}
function derivePlaytimeSource(db, steamId, threshold) {
  if (!ready(db,'progression_xp_ledger',['id','steam_id','source','reference_type','reference_id','metadata_json','amount','created_at']) ||
      !ready(db,'progression_xp_source_times',['ledger_id','source_at','basis']) || !ready(db,'progression_players',['steam_id','playtime_intervals'])) return null;
  const intervals=threshold/PLAYTIME_INTERVAL_MINUTES;
  if (!Number.isSafeInteger(intervals) || intervals<1 || intervals>6000) return null;
  const player=db.prepare('SELECT playtime_intervals FROM progression_players WHERE steam_id=?').get(steamId);
  if (!player || !Number.isSafeInteger(player.playtime_intervals) || player.playtime_intervals<intervals) return null;
  const rows=db.prepare(`SELECT l.id,l.amount,l.reference_id,l.metadata_json,l.created_at,t.source_at,t.basis FROM progression_xp_ledger l
    LEFT JOIN progression_xp_source_times t ON t.ledger_id=l.id WHERE l.steam_id=? AND l.source='playtime' AND l.reference_type='playtime_interval'
    AND CAST(l.reference_id AS INTEGER) BETWEEN 1 AND ? ORDER BY CAST(l.reference_id AS INTEGER),l.id LIMIT ?`).all(steamId,intervals,intervals+1);
  if (rows.length!==intervals) return null;
  let priorClock=null;
  for (let i=0;i<rows.length;i++) {
    const row=rows[i];let meta;try{meta=JSON.parse(row.metadata_json);}catch{return null;}
    if (row.amount!==PLAYTIME_XP_PER_5_MINUTES || row.reference_id!==String(i+1) || meta?.sequence!==i+1 || meta.intervalMinutes!==PLAYTIME_INTERVAL_MINUTES) return null;
    if (row.source_at!==null) {
      if (!Number.isSafeInteger(row.source_at) || row.source_at<0 || row.basis!=='playtime-observation' || (priorClock!==null && row.source_at<priorClock)) return null;
      priorClock=row.source_at;
    }
  }
  const last=rows.at(-1);
  return Number.isSafeInteger(last.source_at) && last.source_at>=0 && last.basis==='playtime-observation' ? {sourceAt:last.source_at,evidence:{intervals,rows}} : null;
}
module.exports={createLevelSourceStore,deriveLevelSource,derivePlaytimeSource,sourceInfrastructure};
