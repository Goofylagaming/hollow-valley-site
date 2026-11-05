function createDeathRecapService(db, { now = Date.now, enabled = () => process.env.DEATH_RECAP_ENABLED === '1' } = {}) {
  function list(steamId) {
    if (!enabled()) throw Object.assign(new Error('Death recaps are not enabled'), { status: 503 });
    if (typeof steamId !== 'string' || !/^\d{17}$/.test(steamId)) throw Object.assign(new Error('Linked Steam account required'), { status: 400 });
    if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='combat_events'").get()) return { recaps: [] };
    const speciesAvailable = db.prepare('PRAGMA table_info(combat_events)').all().some(column => column.name === 'victim_species');
    const columns = new Set(db.prepare('PRAGMA table_info(combat_events)').all().map(column => column.name));
    // Delay disclosure and keep reads victim-scoped. Only recorded event fields
    // are returned. Current characters and live position feeds are never queried.
    const rows = db.prepare(`SELECT id,occurred_at,killer_name,killer_steam_id,
      ${speciesAvailable ? 'victim_species' : 'NULL AS victim_species'},
      ${columns.has('killer_species') ? 'killer_species' : 'NULL AS killer_species'},
      ${columns.has('victim_growth') ? 'victim_growth' : 'NULL AS victim_growth'}
      FROM combat_events WHERE victim_steam_id=? AND julianday(occurred_at)<=julianday(?)
      AND julianday(occurred_at)>=julianday(?)
      ORDER BY julianday(occurred_at) DESC,id DESC LIMIT 20`)
      .all(steamId, new Date(now() - 300000).toISOString(), new Date(now() - 30 * 86400000).toISOString());
    return { recaps: rows.map(row => ({
      id: row.id,
      occurredAt: row.occurred_at,
      attackerName: row.killer_steam_id ? String(row.killer_name || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 80) || null : null,
      victimSpecies: row.victim_species || null,
      attackerSpecies: row.killer_species || null, growth: row.victim_growth ?? null, location: null, dinosaurAge: null, survivalSeconds: null
    })) };
  }
  return { list };
}
module.exports = { createDeathRecapService };
