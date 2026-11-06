"use strict";

// Audit the first NEW crossing of ten distinct active personal entitlements.
// Initialization records counts only; it cannot date legacy qualification.
const owned = actor => `SELECT p.id,p.owner_steam_id=${actor} AS owner,
  EXISTS(SELECT 1 FROM economy_skin_unlocks u WHERE u.preset_id=p.id AND u.steam_id=${actor}) AS purchase,
  EXISTS(SELECT 1 FROM economy_skin_grants g WHERE g.preset_id=p.id AND g.steam_id=${actor} AND g.revoked_at IS NULL) AS personalGrant
  FROM economy_skin_presets p WHERE p.active=1 AND p.id IN (
    SELECT id FROM economy_skin_presets WHERE owner_steam_id=${actor}
    UNION SELECT preset_id FROM economy_skin_unlocks WHERE steam_id=${actor}
    UNION SELECT preset_id FROM economy_skin_grants WHERE steam_id=${actor} AND revoked_at IS NULL)`;
const count = actor => `(SELECT count(*) FROM (${owned(actor)}))`;
const ACTORS = `SELECT owner_steam_id AS steam_id FROM economy_skin_presets WHERE owner_steam_id IS NOT NULL
  UNION SELECT steam_id FROM economy_skin_unlocks UNION SELECT steam_id FROM economy_skin_grants`;

function initializeSkinOwnershipSource(db) {
  db.exec('SAVEPOINT skin_ownership_initialize');
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS progression_skin_ownership_version(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS progression_skin_ownership_state(steam_id TEXT PRIMARY KEY,owned_count INTEGER NOT NULL,qualified INTEGER NOT NULL CHECK(qualified IN (0,1)));
      CREATE TABLE IF NOT EXISTS progression_skin_ownership_sources(position INTEGER PRIMARY KEY AUTOINCREMENT,
        steam_id TEXT NOT NULL UNIQUE,source_at INTEGER NOT NULL,owned_before INTEGER NOT NULL,owned_after INTEGER NOT NULL,evidence_json TEXT NOT NULL);`);
    const version=db.prepare('SELECT version FROM progression_skin_ownership_version WHERE id=1').get();
    if (version && version.version!==1) throw new Error('Unsupported skin ownership audit version');
    if (!version) {
      db.exec(`INSERT INTO progression_skin_ownership_state SELECT steam_id,n,n>=10 FROM
        (SELECT a.steam_id,${count('a.steam_id')} AS n FROM (${ACTORS}) a);
        INSERT INTO progression_skin_ownership_version VALUES(1,1);`);
    }
    if (version && !skinOwnershipInfrastructure(db)) throw new Error('Skin ownership audit hooks are incomplete; review the collection gap before recovery');
    for (const spec of triggerSpecs()) db.exec(spec.sql);
    db.exec('RELEASE skin_ownership_initialize');
  } catch (error) { db.exec('ROLLBACK TO skin_ownership_initialize; RELEASE skin_ownership_initialize'); throw error; }
}

function triggerSpecs() {
  const specs=[];
  for (const table of ['presets','unlocks','grants']) {
    for (const action of ['INSERT','UPDATE','DELETE']) {
      const references=action==='INSERT'?['NEW']:action==='DELETE'?['OLD']:['NEW','OLD'];
      const actors=table==='presets' ? references.map(r=>`SELECT ${r}.owner_steam_id AS steam_id UNION SELECT steam_id FROM economy_skin_unlocks WHERE preset_id=${r}.id UNION SELECT steam_id FROM economy_skin_grants WHERE preset_id=${r}.id`).join(' UNION ')
        : references.map(r=>`SELECT ${r}.steam_id AS steam_id`).join(' UNION ');
      // Cosmetic edits cannot change the milestone or introduce new audit work.
      const when=action!=='UPDATE'?'': table==='presets'?' WHEN OLD.active IS NOT NEW.active OR OLD.owner_steam_id IS NOT NEW.owner_steam_id OR OLD.id IS NOT NEW.id'
        : table==='unlocks'?' WHEN OLD.steam_id IS NOT NEW.steam_id OR OLD.preset_id IS NOT NEW.preset_id'
          :' WHEN OLD.steam_id IS NOT NEW.steam_id OR OLD.preset_id IS NOT NEW.preset_id OR (OLD.revoked_at IS NULL) IS NOT (NEW.revoked_at IS NULL)';
      const name=`progression_skin_${table}_${action.toLowerCase()}`;
      const sql=`CREATE TRIGGER IF NOT EXISTS ${name} AFTER ${action} ON economy_skin_${table}${when} BEGIN
        INSERT INTO progression_skin_ownership_state SELECT a.steam_id,0,0 FROM (${actors}) a WHERE a.steam_id IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM progression_skin_ownership_state s WHERE s.steam_id=a.steam_id);
        INSERT INTO progression_skin_ownership_sources(steam_id,source_at,owned_before,owned_after,evidence_json)
          SELECT s.steam_id,CAST(unixepoch('subsec')*1000 AS INTEGER),s.owned_count,${count('s.steam_id')},
            (SELECT json_group_array(json_object('id',id,'owner',coalesce(owner,0),'purchase',purchase,'personalGrant',personalGrant))
              FROM (${owned('s.steam_id')} ORDER BY p.id LIMIT 10))
          FROM progression_skin_ownership_state s WHERE s.steam_id IN (${actors}) AND s.qualified=0 AND s.owned_count<10 AND ${count('s.steam_id')}>=10
            AND NOT EXISTS(SELECT 1 FROM progression_skin_ownership_sources c WHERE c.steam_id=s.steam_id);
        UPDATE progression_skin_ownership_state SET owned_count=${count('progression_skin_ownership_state.steam_id')},
          qualified=max(qualified,${count('progression_skin_ownership_state.steam_id')}>=10) WHERE steam_id IN (${actors});
      END`;
      specs.push({name,sql});
    }
  }
  return specs;
}

function skinOwnershipInfrastructure(db) {
  for (const [table,fields] of [
    ['economy_skin_presets',['id','active','owner_steam_id']],['economy_skin_unlocks',['steam_id','preset_id']],['economy_skin_grants',['steam_id','preset_id','revoked_at']],
    ['progression_skin_ownership_state',['steam_id','owned_count','qualified']],['progression_skin_ownership_sources',['position','steam_id','source_at','owned_before','owned_after','evidence_json']],
    ['progression_skin_ownership_version',['id','version']]]) {
    const columns=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name));if (!fields.every(f=>columns.has(f))) return false;
  }
  if (db.prepare('SELECT version FROM progression_skin_ownership_version WHERE id=1').get()?.version!==1) return false;
  // Missing/replaced write hooks mean future ownership changes are unaudited.
  for (const {name,sql} of triggerSpecs()) {
    const actual=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").get(name)?.sql;
    if (actual?.replace('CREATE TRIGGER ','CREATE TRIGGER IF NOT EXISTS ')!==sql) return false;
  }
  return true;
}

function deriveSkinOwnershipSource(db,steamId,{asOf=Date.now()}={}) {
  if (!skinOwnershipInfrastructure(db)) return null;
  const row=db.prepare('SELECT * FROM progression_skin_ownership_sources WHERE steam_id=?').get(steamId);
  // SQLite and the JS clock can differ slightly; the shared achievement reader
  // still withholds points until this source time has actually arrived.
  if (!row || !Number.isSafeInteger(row.position) || row.position<1 || !Number.isSafeInteger(row.source_at) || row.source_at<0 || row.source_at>asOf+120000 ||
      row.owned_before!==9 || row.owned_after!==10 || typeof row.evidence_json!=='string' || row.evidence_json.length>20000) return null;
  const state=db.prepare(`SELECT owned_count,qualified,${count(':steam')} AS actual FROM progression_skin_ownership_state WHERE steam_id=:steam`).get({':steam':steamId});
  if (!state || state.qualified!==1 || state.owned_count!==state.actual) return null;
  let entries;try { entries=JSON.parse(row.evidence_json); } catch { return null; }
  if (!Array.isArray(entries) || entries.length!==10) return null;
  let previous='';
  for (const entry of entries) {
    if (!entry || Object.keys(entry).sort().join(',')!=='id,owner,personalGrant,purchase' || typeof entry.id!=='string' || !entry.id || entry.id.length>128 || entry.id<=previous ||
        ![0,1].includes(entry.owner) || ![0,1].includes(entry.purchase) || ![0,1].includes(entry.personalGrant) || !(entry.owner||entry.purchase||entry.personalGrant)) return null;
    previous=entry.id;
  }
  return {sourceAt:row.source_at,evidence:{version:1,position:row.position,steamId,sourceAt:row.source_at,before:row.owned_before,after:row.owned_after,entries}};
}

module.exports={initializeSkinOwnershipSource,skinOwnershipInfrastructure,deriveSkinOwnershipSource};
