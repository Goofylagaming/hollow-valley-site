"use strict";
const { parseSourceTimestamp } = require('./progressionSourceTime');
const validTime = value => Number.isSafeInteger(value) && value >= 0;
const table = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
function deriveLifeSource(db, steamId, achievementId, meta, { capture = false, asOf = Date.now() } = {}) {
  const nested = achievementId === 'nested-adult';
  const evidence = meta.evidence;
  if (!evidence || typeof evidence.lifeId !== 'string' || !evidence.lifeId || !['vl_lives','vl_events'].every(name => table(db, name))) return null;
  const life = db.prepare('SELECT id,steam_id,species,started_at,last_at,ended_at FROM vl_lives WHERE id=? AND steam_id=?').get(evidence.lifeId, steamId);
  if (!life || typeof life.species !== 'string' || !life.species.trim() || life.species.length > 200 || !validTime(life.started_at) || !validTime(life.last_at) || life.last_at < life.started_at ||
      (life.ended_at !== null && (!validTime(life.ended_at) || life.ended_at < life.started_at))) return null;
  const from = nested ? evidence.juvenileAt : life.started_at, through = nested ? evidence.adultAt : evidence.observedThrough;
  if (!validTime(from) || !validTime(through) || from < life.started_at || through <= from || through > life.last_at ||
      (life.ended_at !== null && life.ended_at < through)) return null;
  // Read known death evidence directly. This helper never creates a review or
  // waits for the Legacy importer/profile reconciliation to notice a death.
  const deaths = db.prepare("SELECT occurred_at FROM vl_events WHERE json_valid(payload) AND json_extract(payload,'$.type')='combat_death' AND json_extract(payload,'$.steamId')=? LIMIT 10001").all(steamId);
  if (deaths.length > 10000 || deaths.some(row => !validTime(row.occurred_at) || (row.occurred_at >= from && row.occurred_at <= through))) return null;
  if (table(db, 'combat_events')) {
    const combat = db.prepare('SELECT occurred_at FROM combat_events WHERE victim_steam_id=? LIMIT 10001').all(steamId);
    if (combat.length > 10000 || combat.some(row => { const at = parseSourceTimestamp(row.occurred_at); return at === null || (at >= from && at <= through); })) return null;
  }
  if (nested && meta.value !== 1) return null;
  const identity = { id: life.id, steamId: life.steam_id, species: life.species, startedAt: life.started_at };
  if (!nested) {
    if (!table(db, 'vl_records') || !Number.isFinite(meta.value) || meta.value < 36000 || meta.value * 1000 > through - from) return null;
    const record = db.prepare("SELECT value,achieved_at FROM vl_records WHERE scope='all' AND metric='survival_seconds' AND subject=?").get(life.id);
    if (!record || !Number.isFinite(record.value) || !validTime(record.achieved_at) || record.value < meta.value || record.achieved_at < through ||
        record.achieved_at > life.last_at || record.value * 1000 > record.achieved_at - from ||
        (capture && (record.value !== meta.value || record.achieved_at !== through))) return null;
    // Bind the originally captured observation. Later legitimate record growth
    // does not move its source clock or invalidate that earlier observation.
    return { sourceAt: through, evidence: { life: identity, value: meta.value, observedThrough: through } };
  }
  if (!['vl_growth_milestones','vl_parents'].every(name => table(db, name))) return null;
  const growth = db.prepare('SELECT juvenile_at,adult_at FROM vl_growth_milestones WHERE life_id=?').get(life.id);
  if (!growth || growth.juvenile_at !== from || growth.adult_at !== through) return null;
  const parents = db.prepare('SELECT p.parent,l.steam_id,l.species,l.started_at FROM vl_parents p LEFT JOIN vl_lives l ON l.id=p.parent WHERE p.child=? ORDER BY p.parent LIMIT 3').all(life.id);
  if (parents.length < 1 || parents.length > 2 || parents.some(parent => parent.parent === life.id || typeof parent.steam_id !== 'string' || !/^\d{17}$/.test(parent.steam_id) ||
      parent.species !== life.species || !validTime(parent.started_at) || parent.started_at >= life.started_at)) return null;
  const hatch = db.prepare('SELECT payload,occurred_at FROM vl_events WHERE id=?').get('hatch:' + life.id);
  let payload; try { payload = JSON.parse(hatch?.payload); } catch { return null; }
  if (payload?.type !== 'hatch' || payload.child !== life.id || typeof payload.evidence !== 'string' || !payload.evidence.trim() || payload.evidence.length > 300 ||
      !Array.isArray(payload.parents) || JSON.stringify([...payload.parents].sort()) !== JSON.stringify(parents.map(parent => parent.parent)) ||
      !validTime(hatch.occurred_at) || hatch.occurred_at < life.started_at || hatch.occurred_at > asOf) return null;
  return { sourceAt: through, evidence: { life: identity, juvenileAt: from, adultAt: through, parents, hatch: { payload, at: hatch.occurred_at } } };
}
module.exports = { deriveLifeSource };
