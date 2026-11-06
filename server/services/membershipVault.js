"use strict";

const { db } = require("../db");
const rewards = require("./membershipRewards");
const { migrate, collection } = require("./membershipCollection");

function readVault(userId, now = Date.now()) {
  rewards.ensureSchema();
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Australia/Brisbane", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(now));
  migrate(db, day.slice(0, 7));
  const verified = rewards.paidMonths(userId, now);
  const lifetime = db.prepare(`INSERT INTO membership_passports(user_id,lifetime_paid_months) VALUES (?,?)
    ON CONFLICT(user_id) DO UPDATE SET lifetime_paid_months=max(lifetime_paid_months,excluded.lifetime_paid_months)
    RETURNING lifetime_paid_months`).get(userId, verified);
  const periods = db.prepare(`SELECT DISTINCT p.period_start,p.period_end FROM membership_reward_periods p
    JOIN membership_paid_invoices i ON i.invoice_id=p.source_invoice_id
    WHERE p.user_id=? AND p.period_start<=? AND i.revoked=0 ORDER BY p.period_start,p.period_end`).all(userId, now);
  let consecutive = 0;
  let coverageEnd = 0;
  for (const period of periods) {
    if (period.period_start > coverageEnd) consecutive = 0;
    if (period.period_start >= coverageEnd) consecutive++;
    coverageEnd = Math.max(coverageEnd, period.period_end);
  }
  const extended = db.prepare(`SELECT m.months,c.slug,c.name FROM membership_extended_milestones m
    JOIN membership_collectibles c ON c.slug=m.collectible_slug ORDER BY m.months`).all();
  for(const item of extended.filter(item=>verified>=item.months)){
    db.prepare("INSERT OR IGNORE INTO membership_user_collectibles(user_id,slug) VALUES (?,?)").run(userId,item.slug);
  }
  const preferences=db.prepare("SELECT accent,banner,favourite_dinosaur,featured_skin,featured_title,featured_achievement,beta_opt_in,wall_opt_in,display_alias FROM membership_profile_preferences WHERE user_id=?").get(userId)||{};
  return { ...collection(db,userId), milestones: rewards.MILESTONES, extended, preferences,
    passport: { lifetime: lifetime.lifetime_paid_months, consecutive: coverageEnd > now ? consecutive : 0 } };
}

function savePreferences(userId,input,achievementIds=[]) {
  const vault=readVault(userId);
  const owned=vault.collectibles.filter(item=>item.earned_at);
  const valid={
    accent:owned.filter(i=>i.kind==="accent").map(i=>i.slug),
    banner:owned.filter(i=>i.kind==="banner").map(i=>i.slug),
    featured_skin:vault.skins.map(s=>s.skin_id),
    featured_title:[...vault.loyalty.map(i=>i.title),...owned.filter(i=>i.kind==="title").map(i=>i.slug)],
    featured_achievement:[...achievementIds,...owned.filter(i=>i.kind==="achievement").map(i=>i.slug)]
  };
  for(const [key,choices] of Object.entries(valid)){
    if(input[key] && !choices.includes(input[key])) throw new rewards.MembershipError(403,"COSMETIC_REQUIRED","Choose an item from your collection.");
  }
  for(const key of ["favourite_dinosaur","display_alias"]) {
    if(input[key] && (typeof input[key]!=="string" || !/^[\p{L}][\p{L} '-]{0,31}$/u.test(input[key]))) throw new rewards.MembershipError(400,"INVALID_LABEL","Use up to 32 letters, spaces, hyphens or apostrophes.");
  }
  if(typeof input.beta_opt_in!=="boolean" || typeof input.wall_opt_in!=="boolean") throw new rewards.MembershipError(400,"INVALID_PREFERENCE","Choose your visibility preferences.");
  db.prepare(`INSERT INTO membership_profile_preferences(user_id,accent,banner,favourite_dinosaur,featured_skin,featured_title,featured_achievement,beta_opt_in,wall_opt_in,display_alias)
    VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET accent=excluded.accent,banner=excluded.banner,
    favourite_dinosaur=excluded.favourite_dinosaur,featured_skin=excluded.featured_skin,featured_title=excluded.featured_title,
    featured_achievement=excluded.featured_achievement,beta_opt_in=excluded.beta_opt_in,wall_opt_in=excluded.wall_opt_in,display_alias=excluded.display_alias`)
    .run(userId,input.accent||null,input.banner||null,input.favourite_dinosaur||null,input.featured_skin||null,input.featured_title||null,
      input.featured_achievement||null,+input.beta_opt_in,+input.wall_opt_in,input.display_alias||null);
  return readVault(userId);
}
module.exports = { readVault, savePreferences };
