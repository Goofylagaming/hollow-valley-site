'use strict';
const { createHash } = require('node:crypto');
const hash = value => createHash('sha256').update(value).digest('hex');
const validId = value => Number.isSafeInteger(value) && value > 0;
const table = 'territory_battle_context';
function createTerritoryBattleContext(db, { enabled = () => process.env.TERRITORY_SEASON_EVIDENCE_ENABLED === '1' } = {}) {
  const exists = name => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  function freeze(attackId,eventId,startedAt) {
    if (!enabled()) return;
    if (!validId(attackId) || !validId(eventId) || !Number.isSafeInteger(startedAt) || startedAt < 0) throw Error('Invalid battle context identity');
    const parent = db.prepare('SELECT event_id,started_at FROM territory_battle_provenance WHERE attack_id=?').get(attackId);
    if (!parent || parent.event_id !== eventId || parent.started_at !== startedAt) throw Error('Battle context does not match its declaration');
    db.exec(`CREATE TABLE IF NOT EXISTS ${table}(attack_id INTEGER PRIMARY KEY REFERENCES territory_battle_provenance(attack_id),snapshot_json TEXT NOT NULL,snapshot_digest TEXT NOT NULL)`);
    if (db.prepare(`SELECT 1 FROM ${table} WHERE attack_id=?`).get(attackId)) return read(attackId);
    // Never infer a territory from a display name, current owner or a later event.
    let territory = null;
    if (exists('territory_events')) {
      const columns = new Set(db.prepare('PRAGMA table_info(territory_events)').all().map(row=>row.name));
      if (columns.has('territory_key') && columns.has('territory_name')) {
        const row = db.prepare('SELECT territory_key,territory_name FROM territory_events WHERE id=?').get(eventId);
        if (row && typeof row.territory_key === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(row.territory_key) && typeof row.territory_name === 'string' && row.territory_name.trim() && row.territory_name.length <= 160 && !/[\x00-\x1f\x7f]/.test(row.territory_name)) territory = {key:row.territory_key,name:row.territory_name};
      }
    }
    const payload = JSON.stringify({version:1,attackId,eventId,startedAt,territory});
    db.prepare(`INSERT INTO ${table} VALUES(?,?,?)`).run(attackId,payload,hash(payload));
    return read(attackId);
  }
  function read(attackId) {
    if (!validId(attackId)) throw Object.assign(Error('A valid battle is required'),{status:400});
    if (!exists(table)) return {available:false,reason:'not-recorded'};
    const row=db.prepare(`SELECT * FROM ${table} WHERE attack_id=?`).get(attackId);
    if (!row) return {available:false,reason:'not-recorded'};
    let value;try { if(typeof row.snapshot_json!=='string'||row.snapshot_json.length>2048||hash(row.snapshot_json)!==row.snapshot_digest)throw Error();value=JSON.parse(row.snapshot_json); } catch { throw Object.assign(Error('Frozen battle context requires review'),{status:503}); }
    const parent=db.prepare('SELECT event_id,started_at FROM territory_battle_provenance WHERE attack_id=?').get(attackId);
    const territory=value?.territory;
    if (!value || Object.keys(value).sort().join(',')!=='attackId,eventId,startedAt,territory,version' || value.version!==1 || value.attackId!==attackId || !validId(value.eventId) || !Number.isSafeInteger(value.startedAt) || value.startedAt<0 || !parent || parent.event_id!==value.eventId || parent.started_at!==value.startedAt || territory!==null && (!territory || Object.keys(territory).sort().join(',')!=='key,name' || typeof territory.key!=='string' || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(territory.key) || typeof territory.name!=='string' || !territory.name.trim() || territory.name.length>160 || /[\x00-\x1f\x7f]/.test(territory.name))) throw Object.assign(Error('Frozen battle context requires review'),{status:503});
    return {...value,available:territory!==null,reason:territory===null?'unknown-territory':null};
  }
  return {freeze,read};
}
module.exports={createTerritoryBattleContext};
