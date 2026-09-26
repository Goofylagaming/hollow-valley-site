const store = require('./economyStore');

const db = store.db;

function ensurePolicySchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS economy_skin_share_admins (
      steam_id TEXT PRIMARY KEY,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS economy_skin_share_policy_state (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      synced INTEGER NOT NULL DEFAULT 0,
      synced_at TEXT
    );

    INSERT INTO economy_skin_share_policy_state (id, synced)
    VALUES (1, 0)
    ON CONFLICT(id) DO NOTHING;

    CREATE TRIGGER IF NOT EXISTS trg_skin_share_admin_only_insert
    AFTER INSERT ON economy_skin_presets
    WHEN NEW.share_code IS NOT NULL
      AND NEW.owner_steam_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM economy_skin_share_policy_state
        WHERE id = 1 AND synced = 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM economy_skin_share_admins
        WHERE steam_id = NEW.owner_steam_id
      )
    BEGIN
      UPDATE economy_skin_presets
      SET share_code = NULL, updated_at = datetime('now')
      WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_skin_share_admin_only_update
    AFTER UPDATE OF share_code, owner_steam_id ON economy_skin_presets
    WHEN NEW.share_code IS NOT NULL
      AND NEW.owner_steam_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM economy_skin_share_policy_state
        WHERE id = 1 AND synced = 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM economy_skin_share_admins
        WHERE steam_id = NEW.owner_steam_id
      )
    BEGIN
      UPDATE economy_skin_presets
      SET share_code = NULL, updated_at = datetime('now')
      WHERE id = NEW.id;
    END;
  `);
}

function normalizeAdminSteamIds(values) {
  const ids = Array.isArray(values) ? values : [];
  return [...new Set(ids.map((value) => String(value || '').trim()).filter((value) => /^\d{17}$/.test(value)))];
}

function reconcileAdminShareCodes(adminSteamIds = []) {
  ensurePolicySchema();
  const admins = normalizeAdminSteamIds(adminSteamIds);

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM economy_skin_share_admins').run();
    const insertAdmin = db.prepare(`
      INSERT INTO economy_skin_share_admins (steam_id, updated_at)
      VALUES (?, datetime('now'))
    `);
    for (const steamId of admins) insertAdmin.run(steamId);

    db.prepare(`
      UPDATE economy_skin_share_policy_state
      SET synced = 1, synced_at = datetime('now')
      WHERE id = 1
    `).run();

    const removed = db.prepare(`
      UPDATE economy_skin_presets
      SET share_code = NULL, updated_at = datetime('now')
      WHERE share_code LIKE 'HV-%'
        AND owner_steam_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM economy_skin_share_admins a
          WHERE a.steam_id = economy_skin_presets.owner_steam_id
        )
    `).run();

    db.exec('COMMIT');
    return {
      adminCount: admins.length,
      removedShareCodes: Number(removed.changes || 0),
      synced: true,
    };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

function getPolicyState() {
  ensurePolicySchema();
  const state = db.prepare(`
    SELECT synced, synced_at
    FROM economy_skin_share_policy_state
    WHERE id = 1
  `).get() || { synced: 0, synced_at: null };
  const adminCount = Number(db.prepare('SELECT COUNT(*) AS count FROM economy_skin_share_admins').get()?.count || 0);
  const remainingNonAdminShareCodes = Number(db.prepare(`
    SELECT COUNT(*) AS count
    FROM economy_skin_presets p
    WHERE p.share_code LIKE 'HV-%'
      AND p.owner_steam_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM economy_skin_share_admins a
        WHERE a.steam_id = p.owner_steam_id
      )
  `).get()?.count || 0);
  return {
    synced: Boolean(state.synced),
    syncedAt: state.synced_at || null,
    adminCount,
    remainingNonAdminShareCodes,
  };
}

ensurePolicySchema();

module.exports = {
  ensurePolicySchema,
  reconcileAdminShareCodes,
  getPolicyState,
};
