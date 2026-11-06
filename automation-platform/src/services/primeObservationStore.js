"use strict";
const { parseSourceTimestamp } = require('./progressionSourceTime');
const speciesKey = value => String(value || '').trim().toLowerCase().replace(/^bp_/, '').replace(/_c$/, '').replace(/[^a-z0-9]/g, '');
const integer = value => Number.isSafeInteger(value) && value >= 0;
function createPrimeObservationStore(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS prime_tracker_prime_observations (
    life_id TEXT PRIMARY KEY,steam_id TEXT NOT NULL,life_started_at TEXT NOT NULL,species_key TEXT NOT NULL,
    first_observed_at INTEGER NOT NULL,received_at INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('first-seen-prime','observed-transition')));
    CREATE INDEX IF NOT EXISTS prime_observation_player ON prime_tracker_prime_observations(steam_id,first_observed_at);
    CREATE TRIGGER IF NOT EXISTS prime_observation_delete AFTER DELETE ON prime_tracker_lives BEGIN
      DELETE FROM prime_tracker_prime_observations WHERE life_id=OLD.id;
    END;`);
  function record(life, { observedAt, kind, receivedAt = Date.now() }) {
    if (!db.isTransaction) throw new Error('Prime observation requires its snapshot transaction');
    const start = parseSourceTimestamp(life.started_at), last = parseSourceTimestamp(life.last_seen_at), transition = parseSourceTimestamp(life.prime_started_at);
    const key = speciesKey(life.species);
    if (typeof life.id !== 'string' || !life.id || life.id.length > 128 || typeof life.steam_id !== 'string' || !/^\d{17}$/.test(life.steam_id) || !key || key.length > 100 ||
        !integer(observedAt) || !integer(receivedAt) || observedAt > receivedAt+120000 || start === null || observedAt < start || last !== observedAt || life.is_prime !== 1 || life.ended_at !== null) return false;
    if (kind === 'first-seen-prime' ? life.prime_preexisting !== 1 || start !== observedAt :
        kind === 'observed-transition' ? life.prime_preexisting !== 0 || transition !== observedAt || observedAt <= start : true) return false;
    return Boolean(db.prepare('INSERT OR IGNORE INTO prime_tracker_prime_observations VALUES(?,?,?,?,?,?,?)')
      .run(life.id,life.steam_id,life.started_at,key,observedAt,receivedAt,kind).changes);
  }
  return { record };
}
function primeInfrastructure(db) {
  for (const [name,fields] of [['prime_tracker_lives',['id','steam_id','species','started_at','last_seen_at','ended_at','is_prime','prime_started_at','prime_preexisting']],
    ['prime_tracker_prime_observations',['life_id','steam_id','life_started_at','species_key','first_observed_at','received_at','kind']]]) {
    const columns=new Set(db.prepare(`PRAGMA table_info(${name})`).all().map(row=>row.name));if (!fields.every(field=>columns.has(field))) return false;
  }
  return true;
}
function derivePrimeSource(db, steamId, { asOf = Date.now() } = {}) {
  if (!primeInfrastructure(db)) return null;
  const rows=db.prepare(`SELECT l.id,l.steam_id,l.species,l.started_at,l.last_seen_at,l.ended_at,l.is_prime,l.prime_started_at,l.prime_preexisting,
    o.steam_id AS source_steam,o.life_started_at,o.species_key,o.first_observed_at,o.received_at,o.kind
    FROM prime_tracker_lives l LEFT JOIN prime_tracker_prime_observations o ON o.life_id=l.id
    WHERE l.steam_id=? AND (l.is_prime=1 OR l.prime_started_at IS NOT NULL OR l.prime_preexisting=1) LIMIT 10001`).all(steamId);
  if (!rows.length || rows.length>10000) return null;
  const entries=[];
  for (const row of rows) {
    const start=parseSourceTimestamp(row.started_at),last=parseSourceTimestamp(row.last_seen_at),end=row.ended_at===null?null:parseSourceTimestamp(row.ended_at),transition=row.prime_started_at===null?null:parseSourceTimestamp(row.prime_started_at);
    if (row.source_steam!==steamId || row.life_started_at!==row.started_at || row.species_key!==speciesKey(row.species) || ![0,1].includes(row.is_prime) || ![0,1].includes(row.prime_preexisting) ||
        !integer(row.first_observed_at) || !integer(row.received_at) || start===null || last===null || row.first_observed_at<start || row.first_observed_at>last ||
        row.received_at<row.first_observed_at-120000 || row.received_at>asOf || (row.ended_at!==null && (end===null || end<row.first_observed_at)) ||
        (row.prime_started_at!==null && (transition===null || transition<start || transition>last))) return null;
    if (row.kind==='first-seen-prime' ? row.prime_preexisting!==1 || row.first_observed_at!==start :
        row.kind==='observed-transition' ? row.prime_preexisting!==0 || transition!==row.first_observed_at || row.first_observed_at<=start : true) return null;
    entries.push({lifeId:row.id,steamId,startedAt:row.life_started_at,species:row.species_key,sourceAt:row.first_observed_at,receivedAt:row.received_at,kind:row.kind});
  }
  entries.sort((a,b)=>a.sourceAt-b.sourceAt || (a.lifeId<b.lifeId?-1:a.lifeId>b.lifeId?1:0));
  return {sourceAt:entries[0].sourceAt,evidence:entries[0]};
}
module.exports={speciesKey,createPrimeObservationStore,derivePrimeSource,primeInfrastructure};
