"use strict";
const { parseSourceTimestamp } = require('./progressionSourceTime');
const { createHash } = require('node:crypto');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const CONTRACTS = Object.freeze({
  'quest-1': { type: 'quests', threshold: 1, basis: 'quest-threshold' },
  'quest-25': { type: 'quests', threshold: 25, basis: 'quest-threshold' },
  'quest-100': { type: 'quests', threshold: 100, basis: 'quest-threshold' },
  'event-1': { type: 'events', threshold: 1, basis: 'paid-confirmation-threshold' },
  'event-10': { type: 'events', threshold: 10, basis: 'paid-confirmation-threshold' },
  'event-25': { type: 'events', threshold: 25, basis: 'paid-confirmation-threshold' },
});
function createAchievementSourceTimeStore(db, { now = Date.now, initialize = true } = {}) {
  if (initialize) db.exec(`CREATE TABLE IF NOT EXISTS progression_achievement_sources (
    position INTEGER PRIMARY KEY AUTOINCREMENT,steam_id TEXT NOT NULL,achievement_id TEXT NOT NULL,
    award_digest TEXT NOT NULL,source_at INTEGER NOT NULL,basis TEXT NOT NULL,evidence_digest TEXT NOT NULL,
    recorded_at INTEGER NOT NULL,UNIQUE(steam_id,achievement_id));
    CREATE INDEX IF NOT EXISTS progression_achievement_source_account ON progression_achievement_sources(steam_id,position);
    CREATE TRIGGER IF NOT EXISTS progression_achievement_source_delete AFTER DELETE ON progression_achievements BEGIN
      DELETE FROM progression_achievement_sources WHERE steam_id=OLD.steam_id AND achievement_id=OLD.achievement_id;
    END;`);
  const award = (steamId, achievementId) => db.prepare('SELECT metadata_json,unlocked_at FROM progression_achievements WHERE steam_id=? AND achievement_id=?').get(steamId, achievementId);
  function derive(steamId, achievementId) {
    const contract = Object.hasOwn(CONTRACTS, achievementId) ? CONTRACTS[achievementId] : null;
    if (!contract) return null;
    const saved = award(steamId, achievementId);
    if (!saved) return null;
    let meta; try { meta = JSON.parse(saved.metadata_json); } catch { return null; }
    if (meta?.type !== contract.type || meta.threshold !== contract.threshold || !Number.isSafeInteger(meta.value) || meta.value < contract.threshold) return null;
    const quest = contract.type === 'quests';
    const table = quest ? 'economy_quest_achievements' : 'event_attendance';
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name));
    const needed = quest ? ['steam_id','quest_id','period_key','achieved_at'] : ['steam_id','event_id','status','confirmed_at'];
    if (!needed.every(name => columns.has(name))) return null;
    const rows = quest ? db.prepare('SELECT quest_id,period_key,achieved_at FROM economy_quest_achievements WHERE steam_id=? LIMIT 10001').all(steamId) :
      db.prepare("SELECT event_id,confirmed_at FROM event_attendance WHERE steam_id=? AND status='paid' LIMIT 10001").all(steamId);
    // An unknown clock could precede the apparent threshold. Never substitute a
    // later known completion, the unlock date or the collector's receiving time.
    if (rows.length < contract.threshold || rows.length > 10000) return null;
    const entries = rows.map(row => ({ key: quest ?
      (typeof row.quest_id === 'string' && row.quest_id.trim() && row.quest_id.length <= 256 && typeof row.period_key === 'string' && row.period_key.trim() && row.period_key.length <= 128 ? JSON.stringify([row.quest_id,row.period_key]) : null) : row.event_id,
      raw: quest ? row.achieved_at : row.confirmed_at, at: parseSourceTimestamp(quest ? row.achieved_at : row.confirmed_at) }));
    if (entries.some(row => typeof row.key !== 'string' || !row.key.trim() || row.key.length > 512 || row.at === null)) return null;
    if (new Set(entries.map(row => row.key)).size !== entries.length) return null;
    entries.sort((a, b) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const selected = entries.slice(0, contract.threshold);
    return { awardDigest: digest(saved), basis: contract.basis, sourceAt: selected.at(-1).at, evidenceDigest: digest(selected) };
  }
  function recordNewAward(steamId, achievementId) {
    if (!db.isTransaction) throw new Error('Achievement timing requires its unlock transaction');
    const existing = db.prepare('SELECT 1 FROM progression_achievement_sources WHERE steam_id=? AND achievement_id=?').get(steamId, achievementId);
    if (existing) return false;
    const value = derive(steamId, achievementId), at = now();
    if (!value || value.sourceAt > at + 120000) return false;
    const saved = award(steamId, achievementId), unlockedAt = parseSourceTimestamp(saved.unlocked_at);
    if (unlockedAt === null || value.sourceAt > unlockedAt + 120000) return false;
    db.prepare('INSERT INTO progression_achievement_sources(steam_id,achievement_id,award_digest,source_at,basis,evidence_digest,recorded_at) VALUES(?,?,?,?,?,?,?)')
      .run(steamId, achievementId, value.awardDigest, value.sourceAt, value.basis, value.evidenceDigest, at);
    return true;
  }
  function read(steamId, achievementId) {
    const saved = db.prepare('SELECT * FROM progression_achievement_sources WHERE steam_id=? AND achievement_id=?').get(steamId, achievementId);
    if (!saved) return null;
    const value = derive(steamId, achievementId);
    if (!value || saved.award_digest !== value.awardDigest || saved.source_at !== value.sourceAt || saved.basis !== value.basis || saved.evidence_digest !== value.evidenceDigest ||
        !Number.isSafeInteger(saved.recorded_at) || saved.recorded_at > now() || saved.recorded_at < saved.source_at - 120000) return { available: false };
    // Inspection never creates reviews or repairs an award. Any existing pending
    // review/withdrawal independently withholds this timing from future consumers.
    for (const [table, condition] of [['progression_achievement_review_state',"status='withdrawn'"], ['progression_achievement_evidence_reviews',"status='pending'"]]) {
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table) &&
          db.prepare(`SELECT 1 FROM ${table} WHERE steam_id=? AND achievement_id=? AND ${condition} LIMIT 1`).get(steamId, achievementId)) return { available: false };
    }
    if (saved.source_at > now()) return { available: false };
    return { available: true, sourceAt: saved.source_at, basis: saved.basis, recordedAt: saved.recorded_at, position: saved.position,
      awardDigest: saved.award_digest, evidenceDigest: saved.evidence_digest };
  }
  return { recordNewAward, read };
}
module.exports = { createAchievementSourceTimeStore, CONTRACTS };
