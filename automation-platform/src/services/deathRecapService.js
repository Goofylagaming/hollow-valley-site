const { canonicalCombatSpecies } = require('../config/combatSpecies');
function recordedLocation(raw) {
  if (typeof raw !== 'string' || raw.length > 512) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || Array.isArray(value) || Object.keys(value).some(key => !['x','y'].includes(key)) ||
      ![value.x,value.y].every(number => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 1e7)) return null;
    return { x: value.x, y: value.y };
  } catch { return null; }
}
function createDeathRecapService(db, { now = Date.now, enabled = () => process.env.DEATH_RECAP_ENABLED === '1', combatSource = () => String(process.env.COMBAT_FEED_SOURCE || 'hollow-valley-game').trim() } = {}) {
  function list(steamId) {
    if (!enabled()) throw Object.assign(new Error('Death recaps are not enabled'), { status: 503 });
    if (typeof steamId !== 'string' || !/^\d{17}$/.test(steamId)) throw Object.assign(new Error('Linked Steam account required'), { status: 400 });
    const at = now(), source = combatSource();
    if (!Number.isSafeInteger(at) || at < 30 * 86400000 || at > 8640000000000000 || typeof source !== 'string' || !/^[A-Za-z0-9_.:-]{2,80}$/.test(source)) throw Object.assign(new Error('Death recap evidence is unavailable'), { status: 503 });
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='combat_events'").get()) return { recaps: [] };
    const speciesAvailable = db.prepare('PRAGMA table_info(combat_events)').all().some(column => column.name === 'victim_species');
    const columns = new Set(db.prepare('PRAGMA table_info(combat_events)').all().map(column => column.name));
    if (!columns.has('source')) throw Object.assign(new Error('Historical combat source cannot be verified'), { status: 503 });
    // Delay disclosure and keep reads victim-scoped. Only recorded event fields
    // are returned. Current characters and live position feeds are never queried.
    const rows = db.prepare(`SELECT id,occurred_at,killer_name,killer_steam_id,
      ${speciesAvailable ? 'victim_species' : 'NULL AS victim_species'},
      ${columns.has('killer_species') ? 'killer_species' : 'NULL AS killer_species'},
      ${columns.has('victim_growth') ? 'victim_growth' : 'NULL AS victim_growth'},
      ${columns.has('event_location') ? 'event_location' : 'NULL AS event_location'}
      FROM combat_events WHERE source=? AND victim_steam_id=? AND julianday(occurred_at)<=julianday(?)
      AND julianday(occurred_at)>=julianday(?)
      ORDER BY julianday(occurred_at) DESC,id DESC LIMIT 20`)
      .all(source, steamId, new Date(at - 300000).toISOString(), new Date(at - 30 * 86400000).toISOString());
    return { recaps: rows.map(row => ({
      id: row.id,
      occurredAt: row.occurred_at,
      attackerName: row.killer_steam_id ? String(row.killer_name || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 80) || null : null,
      victimSpecies: canonicalCombatSpecies(row.victim_species),
      attackerSpecies: row.killer_steam_id ? canonicalCombatSpecies(row.killer_species) : null,
      growth: typeof row.victim_growth === 'number' && Number.isFinite(row.victim_growth) && row.victim_growth >= 0 && row.victim_growth <= 1 ? row.victim_growth : null, location: null,
      eventLocation: recordedLocation(row.event_location),
      dinosaurAge: null, survivalSeconds: null,
      recentCombat: db.prepare(`SELECT id,occurred_at,victim_steam_id FROM combat_events
        WHERE source=? AND (victim_steam_id=? OR killer_steam_id=?) AND id<>?
        AND julianday(occurred_at)<=julianday(?) AND julianday(occurred_at)>=julianday(?)
        ORDER BY julianday(occurred_at) DESC,id DESC LIMIT 10`)
        .all(source,steamId,steamId,row.id,row.occurred_at,new Date(Date.parse(row.occurred_at)-600000).toISOString())
        .map(event=>({type:event.victim_steam_id===steamId?'death':'kill',occurredAt:event.occurred_at}))
    })) };
  }
  return { list };
}
module.exports = { createDeathRecapService };
