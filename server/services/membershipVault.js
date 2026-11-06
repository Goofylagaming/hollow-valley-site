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
  return { ...collection(db,userId), milestones: rewards.MILESTONES,
    passport: { lifetime: lifetime.lifetime_paid_months, consecutive: coverageEnd > now ? consecutive : 0 } };
}

module.exports = { readVault };
