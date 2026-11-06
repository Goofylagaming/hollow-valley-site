"use strict";

function migrateGrowth(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS membership_passes (
      grant_key TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      tier TEXT NOT NULL CHECK(tier IN ('supporter','guardian','legend')),
      starts_at INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK(expires_at>starts_at),
      granted_by INTEGER NOT NULL REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS membership_gift_intents (
      request_key TEXT PRIMARY KEY, sender INTEGER NOT NULL REFERENCES users(id),
      recipient INTEGER NOT NULL REFERENCES users(id) CHECK(sender<>recipient),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS membership_referrals (
      recipient INTEGER PRIMARY KEY REFERENCES users(id),
      referrer INTEGER NOT NULL REFERENCES users(id) CHECK(referrer<>recipient),
      qualified_period TEXT UNIQUE, granted_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS membership_bonus_claim_tokens (
      grant_key TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
      granted_by INTEGER NOT NULL REFERENCES users(id), reason TEXT NOT NULL,
      granted_at INTEGER NOT NULL, expires_at INTEGER, redeemed_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS membership_digest_delivery (
      user_id INTEGER NOT NULL REFERENCES users(id), month TEXT NOT NULL,
      delivery_state TEXT NOT NULL CHECK(delivery_state IN ('pending','delivered','review')),
      PRIMARY KEY(user_id,month)
    );
    CREATE TABLE IF NOT EXISTS membership_digest_content (
      user_id INTEGER NOT NULL REFERENCES users(id),month TEXT NOT NULL,body TEXT NOT NULL,
      PRIMARY KEY(user_id,month)
    );
    CREATE TABLE IF NOT EXISTS membership_public_previews (
      id INTEGER PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,approved_by INTEGER NOT NULL REFERENCES users(id),
      visible_at INTEGER NOT NULL,public_at INTEGER NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('preview','shipped'))
    );
    CREATE TABLE IF NOT EXISTS membership_notification_preferences (
      user_id INTEGER PRIMARY KEY REFERENCES users(id), monthly_digest INTEGER NOT NULL DEFAULT 0
      CHECK(monthly_digest IN (0,1))
    );
  `);
}

module.exports = { migrateGrowth };
