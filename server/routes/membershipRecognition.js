"use strict";

const { db } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/requireAuth");
const { migrate } = require("../services/membershipCollection");
const rewards = require("../services/membershipRewards");
const router = require("express").Router();

router.use((req,res,next) => {
  if (process.env.MEMBERSHIP_RECOGNITION_ENABLED !== "1") return res.sendStatus(404);
  if (req.method !== "GET") {
    try { if (new URL(req.get("origin")).host !== req.get("host")) return res.sendStatus(403); }
    catch { return res.sendStatus(403); }
  }
  res.set("Cache-Control","no-store");
  rewards.ensureSchema();
  migrate(db,new Date(Date.now()+36000000).toISOString().slice(0,7));
  db.exec(`CREATE TABLE IF NOT EXISTS membership_showcase (
    user_id INTEGER PRIMARY KEY REFERENCES users(id), alias TEXT NOT NULL,
    dinosaur TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1)`);
  const columns=db.prepare("PRAGMA table_info(membership_showcase)").all().map(c=>c.name);
  for(const column of ["screenshot","skin"]) if(!columns.includes(column)) db.exec("ALTER TABLE membership_showcase ADD COLUMN "+column+" TEXT");
  next();
});

router.get("/wall", (_req,res) => {
  const entries = db.prepare(`SELECT alias,dinosaur,screenshot,skin FROM membership_showcase
    WHERE approved=1 ORDER BY alias COLLATE NOCASE`).all();
  const supporters=db.prepare(`SELECT p.display_alias AS alias FROM membership_profile_preferences p
    WHERE p.wall_opt_in=1 AND p.display_alias IS NOT NULL AND EXISTS
      (SELECT 1 FROM membership_paid_invoices i WHERE i.user_id=p.user_id AND i.counts_month=1 AND i.revoked=0)
    ORDER BY p.display_alias COLLATE NOCASE`).all();
  res.json({entries,supporters});
});

function safeLabel(value) {
  return typeof value === "string" && /^[a-zA-Z][a-zA-Z '-]{0,31}$/.test(value);
}

router.post("/showcase", requireAuth, (req,res) => {
  if (req.body?.optIn === false) {
    db.prepare("DELETE FROM membership_showcase WHERE user_id=?").run(req.user.id);
    return res.json({visible:false});
  }
  const { alias, dinosaur, optIn, screenshot=null, skin=null } = req.body || {};
  if (optIn !== true || !safeLabel(alias) || !safeLabel(dinosaur)) return res.sendStatus(400);
  if(screenshot && (typeof screenshot!=="string" || !/^https:\/\/i\.imgur\.com\/[A-Za-z0-9]{5,12}\.(?:png|jpg|jpeg|webp)$/.test(screenshot))) return res.sendStatus(400);
  if(skin && !db.prepare("SELECT 1 FROM membership_skin_claims WHERE user_id=? AND skin_id=? AND status='fulfilled'").get(req.user.id,skin)) return res.sendStatus(403);
  db.prepare(`INSERT INTO membership_showcase(user_id,alias,dinosaur,screenshot,skin) VALUES (?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET alias=excluded.alias,dinosaur=excluded.dinosaur,
    screenshot=excluded.screenshot,skin=excluded.skin,approved=0,revision=revision+1`).run(req.user.id,alias,dinosaur,screenshot,skin);
  res.json({pending:true});
});

router.get("/review", requireAdmin, (_req,res) => {
  res.json(db.prepare("SELECT user_id,alias,dinosaur,revision,screenshot,skin FROM membership_showcase WHERE approved=0").all());
});
router.post("/review", requireAdmin, (req,res) => {
  const changed = db.prepare("UPDATE membership_showcase SET approved=1 WHERE user_id=? AND revision=? AND alias=? AND dinosaur=? AND screenshot IS ? AND skin IS ?")
    .run(req.body.userId,req.body.revision,req.body.alias,req.body.dinosaur,req.body.screenshot||null,req.body.skin||null).changes;
  res.sendStatus(changed ? 200 : 409);
});

router.post("/founding", requireAuth, (req,res) => {
  const cutoff = Date.parse(process.env.FOUNDING_SUBSCRIBER_CUTOFF || "");
  if (!Number.isFinite(cutoff)) return res.sendStatus(503);
  const verified = db.prepare("SELECT 1 FROM membership_paid_invoices WHERE user_id=? AND revoked=0 AND counts_month=1 AND paid_at<=? LIMIT 1")
    .get(req.user.id,new Date(cutoff).toISOString());
  if (!verified) return res.sendStatus(403);
  db.prepare("INSERT OR IGNORE INTO membership_collectibles(slug,name,kind) VALUES ('founding-subscriber','Founding Subscriber','title')").run();
  db.prepare("INSERT OR IGNORE INTO membership_user_collectibles(user_id,slug) VALUES (?,'founding-subscriber')").run(req.user.id);
  db.prepare("INSERT OR IGNORE INTO membership_collectibles(slug,name,kind) VALUES ('founding-subscriber-badge','Founding Subscriber','badge')").run();
  db.prepare("INSERT OR IGNORE INTO membership_user_collectibles(user_id,slug) VALUES (?,'founding-subscriber-badge')").run(req.user.id);
  res.json({earned:true});
});
module.exports = router;
