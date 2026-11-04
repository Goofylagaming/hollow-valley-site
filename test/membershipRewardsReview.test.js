const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DB_PATH = ":memory:";
const { db, getSupporterStatus } = require("../server/db");
const { processStripeEvent } = require("../server/services/supporterWebhook");
const rewards = require("../server/services/membershipRewards");

const env = {
  MEMBERSHIP_REWARDS_ENABLED: "1",
  STRIPE_PRICE_SUPPORTER: "price_review_supporter",
  STRIPE_PRICE_GUARDIAN: "price_review_guardian",
  STRIPE_PRICE_LEGEND: "price_review_legend",
  STRIPE_SECRET_KEY: "sk_test_review_fixture",
};
const now = Date.parse("2026-11-15T00:00:00Z");
const steamId = "76561198038977506";
const user = { id: 52, steam_id: steamId, username: "review-member" };

function reset() {
  rewards.ensureSchema();
  // Include future refund markers as the implementation is hardened, without
  // depending on the internal table name chosen for those markers.
  const membershipTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'membership_%'").all();
  for (const row of membershipTables) db.exec(`DELETE FROM "${row.name.replaceAll('"', '""')}"`);
  db.exec("DELETE FROM stripe_webhook_events; DELETE FROM supporter_subscriptions; DELETE FROM users;");
  db.prepare("INSERT INTO users (id,steam_id,username) VALUES (?,?,?)").run(user.id, steamId, user.username);
  db.prepare("INSERT INTO supporter_subscriptions (user_id,tier,stripe_subscription_id,stripe_status,auto_renew,renews_at) VALUES (?,'supporter','sub_review','active',1,'2026-12-01T00:00:00Z')").run(user.id);
}

function invoice({ name = "base", tier = "supporter", start = "2026-11-01", reason = "subscription_cycle", prorated = false } = {}) {
  return {
    id: `in_review_${name}`, livemode: false, status: "paid", paid: true, amount_paid: 700,
    subscription: "sub_review", billing_reason: reason, created: Math.floor(now / 1000) - 200,
    lines: { data: [{
      amount: 700, subscription: "sub_review", proration: prorated,
      price: { id: `price_review_${tier}`, recurring: { interval: "month", interval_count: 1 } },
      period: { start: Date.parse(`${start}T00:00:00Z`) / 1000, end: Date.parse("2026-12-01T00:00:00Z") / 1000 },
    }] },
  };
}

function refund(invoiceId) {
  return { id: `evt_refund_${invoiceId}`, type: "charge.refunded", livemode: false,
    data: { object: { id: `ch_${invoiceId}`, invoice: invoiceId, refunded: true } } };
}

const record = (value) => rewards.recordPaidInvoice(value, { env, now });
const summary = () => rewards.rewardSummary(user, { env, now });

test("refund arriving before the paid invoice is remembered and cannot fund later rewards", () => {
  reset();
  const bill = invoice();
  rewards.processRewardEvent(refund(bill.id), { env, now });
  record(bill);
  assert.equal(summary().monthly.allowance, 0);
  assert.equal(summary().loyalty.paidMonths, 0);
  record(bill);
  assert.equal(summary().monthly.allowance, 0);
});

test("refunding a paid upgrade restores the surviving base allowance", () => {
  reset(); record(invoice());
  const upgrade = invoice({ name: "upgrade", tier: "legend", start: "2026-11-10", reason: "subscription_update", prorated: true });
  record(upgrade);
  assert.equal(summary().monthly.allowance, 3);
  rewards.processRewardEvent(refund(upgrade.id), { env, now });
  assert.equal(summary().monthly.allowance, 1);
  assert.equal(summary().loyalty.paidMonths, 1);
  // A replay cannot restore the allowance from a refunded upgrade.
  record(upgrade);
  assert.equal(summary().monthly.allowance, 1);
});

test("an unverified fulfillment response keeps the same choice pending", async () => {
  reset(); record(invoice());
  const client = {
    listCatalog: async () => ({ enabled: true, skins: [{ id: "review-ashfall" }] }),
    fulfillClaim: async () => ({ ok: true }),
  };
  await assert.rejects(rewards.claimSkin(user, "review-ashfall", { env, now, client }), (error) => error.status === 503);
  assert.equal(db.prepare("SELECT status FROM membership_skin_claims").get().status, "pending");
  assert.equal(summary().monthly.remaining, 0);
});

test("a fulfillment receipt for a different claim cannot complete this choice", async () => {
  reset(); record(invoice());
  const client = {
    listCatalog: async () => ({ enabled: true, skins: [{ id: "review-ashfall" }] }),
    fulfillClaim: async () => ({ claimId: "different-claim", skinId: "review-ashfall", presetId: "preset-review", alreadyOwned: false }),
  };
  await assert.rejects(rewards.claimSkin(user, "review-ashfall", { env, now, client }), (error) => error.status === 503);
  assert.equal(db.prepare("SELECT status FROM membership_skin_claims").get().status, "pending");
});

test("a delayed paid invoice cannot reactivate a subscription after deletion", () => {
  reset();
  const bill = invoice();
  const subscription = {
    id: "sub_review", status: "canceled", cancel_at_period_end: false,
    metadata: { user_id: String(user.id), tier: "supporter" },
    current_period_end: Date.parse("2026-12-01T00:00:00Z") / 1000,
    items: { data: [{ price: { id: env.STRIPE_PRICE_SUPPORTER } }] },
  };
  processStripeEvent({ id: "evt_review_delete", type: "customer.subscription.deleted", livemode: false,
    created: Math.floor(now / 1000), data: { object: subscription } }, env);
  assert.equal(getSupporterStatus(user.id).stripe_status, "canceled");
  processStripeEvent({ id: "evt_review_old_paid", type: "invoice.paid", livemode: false,
    created: Math.floor(now / 1000) - 100, data: { object: bill } }, env);
  assert.equal(getSupporterStatus(user.id).stripe_status, "canceled");
  record(bill);
  assert.equal(summary().entitled, false);
  assert.equal(summary().monthly.allowance, 0);
});

test("terminal subscriptions cannot be revived by late checkout or update events", () => {
  reset();
  db.exec("UPDATE supporter_subscriptions SET stripe_status='canceled',auto_renew=0");
  processStripeEvent({id:"evt_late_update",type:"customer.subscription.updated",livemode:false,data:{object:{
    id:"sub_review",status:"active",metadata:{user_id:String(user.id),tier:"legend"},current_period_end:Math.floor(now/1000)+86400,
  }}},env);
  assert.equal(getSupporterStatus(user.id).stripe_status,"canceled");
  processStripeEvent({id:"evt_late_checkout",type:"checkout.session.completed",livemode:false,data:{object:{
    mode:"subscription",payment_status:"paid",subscription:"sub_review",metadata:{user_id:String(user.id),tier:"legend"},
  }}},env);
  assert.equal(getSupporterStatus(user.id).stripe_status,"canceled");
  processStripeEvent({id:"evt_new_checkout",type:"checkout.session.completed",livemode:false,data:{object:{
    mode:"subscription",payment_status:"paid",subscription:"sub_new",metadata:{user_id:String(user.id),tier:"guardian"},
  }}},env);
  assert.equal(getSupporterStatus(user.id).stripe_subscription_id,"sub_new");
  assert.equal(getSupporterStatus(user.id).stripe_status,"active");
});

test("refund payment references survive disabled rollout and match a later imported invoice", () => {
  reset();
  rewards.processRewardEvent({type:"charge.refunded",livemode:false,data:{object:{id:"ch_offline",refunded:true,payment_intent:"pi_offline"}}},
    {env:{...env,MEMBERSHIP_REWARDS_ENABLED:"0"},now});
  const bill=invoice(); bill._membershipFunding={verified:true,revoked:false,references:["charge:ch_offline","payment_intent:pi_offline"]};
  record(bill); assert.equal(summary().monthly.allowance,0); assert.equal(summary().loyalty.paidMonths,0);
});

test("a late lifecycle event cannot replace a newer subscription tier", () => {
  reset(); const created=Math.floor(now/1000);
  processStripeEvent({id:"evt_new_tier",type:"customer.subscription.updated",livemode:false,created,data:{object:{
    id:"sub_review",status:"active",metadata:{user_id:String(user.id),tier:"legend"},current_period_end:created+86400,
  }}},env);
  processStripeEvent({id:"evt_older_tier",type:"customer.subscription.updated",livemode:false,created:created-100,data:{object:{
    id:"sub_review",status:"active",metadata:{user_id:String(user.id),tier:"supporter"},current_period_end:created+86400,
  }}},env);
  assert.equal(getSupporterStatus(user.id).tier,"legend");
});
