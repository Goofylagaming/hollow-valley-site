"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { migrate, collection } = require("../server/services/membershipCollection");

test("migration preserves season edits, milestone configuration and private ownership", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY);
    INSERT INTO users VALUES (1),(2);
    CREATE TABLE membership_skin_claims(user_id,skin_id,status);
    INSERT INTO membership_skin_claims VALUES (1,'claimed','fulfilled'),(1,'pending','pending'),(2,'other','fulfilled');
    CREATE TABLE membership_loyalty_rewards(user_id,months,title,frame_id);`);
  migrate(db, "2026-11");
  assert.equal(db.prepare("SELECT state FROM membership_seasons").get().state,"draft");
  db.exec(`UPDATE membership_seasons SET admin_notes='retain';
    INSERT INTO membership_collectibles(slug,name,kind,listed) VALUES ('public','Public','badge',1),('private','Private','badge',0);
    INSERT INTO membership_user_collectibles(user_id,slug) VALUES (2,'private');
    UPDATE membership_extended_milestones SET collectible_slug='private' WHERE months=18;`);
  migrate(db, "2026-12");
  const season = db.prepare("SELECT * FROM membership_seasons").get();
  assert.equal(season.admin_notes,"retain");
  assert.equal(season.brisbane_month,"2026-11");
  assert.equal(db.prepare("SELECT collectible_slug FROM membership_extended_milestones WHERE months=18").get().collectible_slug,"private");
  const book = collection(db,1);
  assert.deepEqual(book.skins.map(s => s.skin_id),["claimed"]);
  assert.deepEqual(book.collectibles.map(c => [c.slug,c.earned_at]),[["public",null]]);
  assert.ok(collection(db,2).collectibles.find(c => c.slug==="private").earned_at);
  db.close();
});
