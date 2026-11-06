"use strict";

const { db } = require("../db");

const rewards = require("./membershipRewards");

function activePass(userId, now=Date.now()) {
  return db.prepare(`SELECT tier,expires_at FROM membership_passes WHERE user_id=?
    AND starts_at<=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1`).get(userId,now,now) || null;
}

function recordReferral(recipient,referrer,now=Date.now()) {
  if (!Number.isSafeInteger(referrer) || referrer===recipient) return false;
  rewards.ensureSchema();
  const accounts=db.prepare("SELECT id,steam_id FROM users WHERE id IN (?,?)").all(recipient,referrer);
  if(accounts.length!==2 || accounts.some(a=>!a.steam_id) || accounts[0].steam_id===accounts[1].steam_id) return false;
  if(db.prepare("SELECT 1 FROM membership_paid_invoices WHERE user_id=? LIMIT 1").get(recipient)) return false;
  db.prepare("CREATE TABLE IF NOT EXISTS membership_referral_dates(recipient INTEGER PRIMARY KEY, created_at INTEGER NOT NULL)").run();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("INSERT OR IGNORE INTO membership_referrals(recipient,referrer) VALUES (?,?)").run(recipient,referrer);
    db.prepare("INSERT OR IGNORE INTO membership_referral_dates VALUES (?,?)").run(recipient,now);
    const saved=db.prepare("SELECT referrer FROM membership_referrals WHERE recipient=?").get(recipient);
    db.exec("COMMIT");return saved.referrer===referrer;
  } catch(e){db.exec("ROLLBACK");throw e;}
}

function qualifyReferral(recipient,actor,now=Date.now()) {
  rewards.ensureSchema();
  db.exec("BEGIN IMMEDIATE");
  try{
    const referral=db.prepare("SELECT * FROM membership_referrals WHERE recipient=?").get(recipient);
    if(!referral){db.exec("COMMIT");return false;}
    const period=db.prepare(`SELECT p.period_key FROM membership_reward_periods p JOIN membership_paid_invoices i
      ON i.invoice_id=p.source_invoice_id JOIN membership_referral_dates d ON d.recipient=p.user_id
      WHERE p.user_id=? AND i.revoked=0 AND i.counts_month=1 AND p.period_start>=d.created_at
      AND p.period_end<=? AND p.period_end-p.period_start>=27*86400000 ORDER BY p.period_end LIMIT 1`).get(recipient,now);
    if(!period){db.exec("COMMIT");return false;}
    db.prepare(`INSERT OR IGNORE INTO membership_bonus_claim_tokens(grant_key,user_id,granted_by,reason,granted_at)
      VALUES (?,?,?,'Completed referral cycle',?)`).run("referral:"+recipient,referral.referrer,actor,now);
    db.prepare("UPDATE membership_referrals SET qualified_period=?,granted_at=coalesce(granted_at,?) WHERE recipient=?")
      .run(period.period_key,now,recipient);
    db.exec("COMMIT");return true;
  } catch(e){db.exec("ROLLBACK");throw e;}
}

function digest(user, now=Date.now()){
  const month=new Date(now+36000000).toISOString().slice(0,7);
  const summary=rewards.rewardSummary(user,{now});
  const vote=require("./membershipSkinVote").currentForUser(user,{now});
  require("./membershipCollection").migrate(db,month);
  const season=db.prepare("SELECT name,public_event_ref FROM membership_seasons WHERE brisbane_month=? AND state='live' ORDER BY slug LIMIT 1").get(month);
  return {month,season:season?.name||null,publicEvent:season?.public_event_ref||null,
    skinChoices:summary.monthly?.remaining||0,paidMonths:summary.loyalty?.paidMonths||0,
    nextMilestone:summary.loyalty?.nextMilestone?.title||null,vote:vote.ballot?.title||null};
}
module.exports={activePass,recordReferral,qualifyReferral,digest};
