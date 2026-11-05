const { createDiscoveryCatalogStore } = require('./discoveryCatalog');

function createDiscoveryVisitStore(db, { now = Date.now, enabled = () => process.env.POI_DISCOVERY_ENABLED === '1' } = {}) {
  const catalogs = createDiscoveryCatalogStore(db);
  db.exec(`CREATE TABLE IF NOT EXISTS discovery_last_samples (
    steam_id TEXT PRIMARY KEY, version TEXT NOT NULL, life_id TEXT NOT NULL,
    at INTEGER NOT NULL, x REAL, y REAL);
    CREATE TABLE IF NOT EXISTS discovery_visits (
    steam_id TEXT NOT NULL, version TEXT NOT NULL, point_id TEXT NOT NULL,
    discovered_at INTEGER NOT NULL, PRIMARY KEY(steam_id,version,point_id));`);
  function player(value) {
    if (typeof value !== 'string' || !/^\d{17}$/.test(value)) throw Object.assign(new Error('Linked Steam account required'), { status: 400 });
    return value;
  }
  function catalog(version) {
    const result = catalogs.get(version);
    if (!result) throw Object.assign(new Error('Discovery catalog unavailable'), { status: 404 });
    return result;
  }
  // Internal trusted-snapshot entry point. Two nearby, consecutive observations
  // inside a visit area are required. No route interpolation is performed.
  function observe({ steamId, version, lifeId, at, location }) {
    if (!enabled()) return { recorded: false };
    player(steamId);
    const rules = catalog(version);
    if (typeof lifeId !== 'string' || !lifeId || lifeId.length > 160 || !Number.isSafeInteger(at) || at > now() || at < now() - 30000) return { recorded: false };
    const valid = location && [location.x, location.y].every(value => typeof value === 'number' && Number.isFinite(value)) &&
      location.x >= rules.bounds.minX && location.x <= rules.bounds.maxX && location.y >= rules.bounds.minY && location.y <= rules.bounds.maxY;
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = db.prepare('SELECT * FROM discovery_last_samples WHERE steam_id=?').get(steamId);
      if (previous && at <= previous.at) { db.exec('COMMIT'); return { recorded: false }; }
      const seconds = previous ? (at - previous.at) / 1000 : 0;
      const continuous = valid && previous && previous.x !== null && previous.version === version && previous.life_id === lifeId && seconds >= 5 && seconds <= 120 &&
        Math.hypot(location.x - previous.x, location.y - previous.y) / 100 / seconds <= 40;
      let discovered = 0;
      if (continuous) {
        for (const point of rules.points) {
          const inside = sample => Math.hypot(sample.x - point.x, sample.y - point.y) <= point.radiusMetres * 100;
          if (point.enabled && inside(previous) && inside(location)) {
            discovered += db.prepare('INSERT OR IGNORE INTO discovery_visits VALUES (?,?,?,?)').run(steamId, version, point.id, at).changes;
          }
        }
      }
      db.prepare(`INSERT INTO discovery_last_samples VALUES (?,?,?,?,?,?) ON CONFLICT(steam_id)
        DO UPDATE SET version=excluded.version,life_id=excluded.life_id,at=excluded.at,x=excluded.x,y=excluded.y`)
        .run(steamId, version, lifeId, at, valid ? location.x : null, valid ? location.y : null);
      db.exec('COMMIT');
      return { recorded: true, discovered };
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function discovered(steamId, version) {
    player(steamId);
    const rules = catalog(version);
    const receipts = new Map(db.prepare('SELECT point_id,discovered_at FROM discovery_visits WHERE steam_id=? AND version=?').all(steamId, version).map(row => [row.point_id, row.discovered_at]));
    const active = rules.points.filter(point => point.enabled);
    return { version, total: active.length, points: active.filter(point => receipts.has(point.id)).map(point => ({ ...point, discoveredAt: receipts.get(point.id) })) };
  }
  function prune() { db.prepare('DELETE FROM discovery_last_samples WHERE at<?').run(now() - 120000); }
  return { observe, discovered, prune };
}
module.exports = { createDiscoveryVisitStore };
