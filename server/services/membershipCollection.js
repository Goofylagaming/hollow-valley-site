"use strict";

// This migration only adds private membership data. Run against a staging
// database first. Never infer ownership from a catalogue or a profile choice.
function migrate(db, month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid season month");
  db.exec("SAVEPOINT membership_collection_schema");
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS membership_seasons (
        slug TEXT PRIMARY KEY, name TEXT NOT NULL, brisbane_month TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('draft','preview','live','archived')),
        cosmetic_description TEXT, vote_ref TEXT, public_event_ref TEXT, admin_notes TEXT
      );
      CREATE TABLE IF NOT EXISTS membership_collectibles (
        slug TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
        season_slug TEXT REFERENCES membership_seasons(slug),
        listed INTEGER NOT NULL DEFAULT 0 CHECK(listed IN (0,1))
      );
      CREATE TABLE IF NOT EXISTS membership_user_collectibles (
        user_id INTEGER NOT NULL REFERENCES users(id),
        slug TEXT NOT NULL REFERENCES membership_collectibles(slug),
        earned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(user_id,slug)
      );
      CREATE TABLE IF NOT EXISTS membership_passports (
        user_id INTEGER PRIMARY KEY REFERENCES users(id),
        lifetime_paid_months INTEGER NOT NULL DEFAULT 0 CHECK(lifetime_paid_months >= 0)
      );
      CREATE TABLE IF NOT EXISTS membership_profile_preferences (
        user_id INTEGER PRIMARY KEY REFERENCES users(id), accent TEXT, banner TEXT,
        favourite_dinosaur TEXT, featured_skin TEXT, featured_title TEXT, featured_achievement TEXT,
        beta_opt_in INTEGER NOT NULL DEFAULT 0 CHECK(beta_opt_in IN (0,1)),
        wall_opt_in INTEGER NOT NULL DEFAULT 0 CHECK(wall_opt_in IN (0,1)), display_alias TEXT
      );
      CREATE TABLE IF NOT EXISTS membership_extended_milestones (
        months INTEGER PRIMARY KEY CHECK(months > 12),
        collectible_slug TEXT REFERENCES membership_collectibles(slug)
      );
      INSERT OR IGNORE INTO membership_extended_milestones(months) VALUES (18),(24);
    `);
    db.prepare(`INSERT OR IGNORE INTO membership_seasons(slug,name,brisbane_month,state)
      VALUES ('moonlit-marsh','Moonlit Marsh',?,'draft')`).run(month);
    db.exec("RELEASE membership_collection_schema");
  } catch (error) {
    db.exec("ROLLBACK TO membership_collection_schema; RELEASE membership_collection_schema");
    throw error;
  }
}

function collection(db, userId) {
  return {
    skins: db.prepare("SELECT skin_id FROM membership_skin_claims WHERE user_id=? AND status='fulfilled' ORDER BY skin_id").all(userId),
    loyalty: db.prepare("SELECT months,title,frame_id FROM membership_loyalty_rewards WHERE user_id=? ORDER BY months").all(userId),
    collectibles: db.prepare(`SELECT c.slug,c.name,c.kind,u.earned_at FROM membership_collectibles c
      LEFT JOIN membership_user_collectibles u ON c.slug=u.slug AND u.user_id=?
      WHERE c.listed=1 OR u.earned_at IS NOT NULL ORDER BY c.kind,c.name`).all(userId)
  };
}

module.exports = { migrate, collection };
