const test = require("node:test");
const assert = require("node:assert/strict");
process.env.DB_PATH = ":memory:";
const { db } = require("../server/db");
require("../server/services/supporterWebhook");
const rewards = require("../server/services/membershipRewards");
const { syncPaidHistory } = require("../server/services/membershipHistory");
const { entitlement } = require("../server/services/membershipEntitlements");

const env = { MEMBERSHIP_REWARDS_ENABLED: "1", STRIPE_PRICE_SUPPORTER: "price_supporter", STRIPE_PRICE_GUARDIAN: "price_guardian", STRIPE_PRICE_LEGEND: "price_legend", STRIPE_SECRET_KEY: "sk_test_fixture" };
const now = Date.parse("2026-11-15T00:00:00Z");
const steam = "76561198038977506";
const user = { id: 42, steam_id: steam, username: "member" };
function reset(tier = "supporter") {
  rewards.ensureSchema();
  for (const name of ["membership_skin_claims", "membership_appearance", "membership_loyalty_rewards", "membership_reward_periods", "membership_paid_invoices", "membership_refunded_invoices", "membership_refunded_payments", "membership_invoice_payment_refs", "membership_history_sync", "supporter_subscriptions", "users"]) db.exec(`DELETE FROM ${name}`);
  db.prepare("INSERT INTO users (id,steam_id,username) VALUES (?,?,?)").run(42,steam,"member");
  db.prepare("INSERT INTO supporter_subscriptions (user_id,tier,stripe_subscription_id,stripe_status,auto_renew,renews_at) VALUES (?,?,?,'active',1,?)")
    .run(42,tier,"sub_member","2026-12-01T00:00:00Z");
}
function invoice({ name = "first", tier = "supporter", start = "2026-11-01", end = "2026-12-01", reason = "subscription_cycle", amount = 700, prorated = false } = {}) {
  return { id: `in_${name}`, livemode: false, status: "paid", paid: true, amount_paid: amount,
    charge: { id: `ch_${name}`, livemode: false, paid: true, refunded: false, amount, amount_refunded: 0 },
    subscription: "sub_member", billing_reason: reason, created: Math.floor(now / 1000),
    lines: { data: [{ amount, subscription: "sub_member", proration: prorated,
      price: { id: `price_${tier}`, recurring: { interval: "month", interval_count: 1 } },
      period: { start: Date.parse(`${start}T00:00:00Z`) / 1000, end: Date.parse(`${end}T00:00:00Z`) / 1000 } }] } };
}
const record = value => rewards.recordPaidInvoice(value, { env, now });
const summary = () => rewards.rewardSummary(user, { env, now });
const catalogue = () => ({ enabled: true, skins: [{ id: "ashfall" }, { id: "moonlit" }, { id: "royalty" }] });

test("loyalty dates distinguish automatic payments, manual renewal and expired access", () => {
  reset();
  record(invoice({ name: "october", start: "2026-10-01", end: "2026-11-01" }));
  record(invoice());
  assert.deepEqual(summary().loyalty.schedule, {
    nextPaymentAt: "2026-12-01T00:00:00.000Z", renewalDueAt: null,
    manualRenewalRequired: false, expectedUnlockAt: "2026-12-01T00:00:00.000Z",
  });
  db.exec("UPDATE supporter_subscriptions SET auto_renew=0");
  assert.deepEqual(summary().loyalty.schedule, {
    nextPaymentAt: null, renewalDueAt: "2026-12-01T00:00:00.000Z",
    manualRenewalRequired: true, expectedUnlockAt: "2026-12-01T00:00:00.000Z",
  });
  db.exec("UPDATE supporter_subscriptions SET stripe_status='canceled'");
  assert.equal(summary().loyalty.schedule.expectedUnlockAt, null);
  assert.equal(summary().loyalty.schedule.nextPaymentAt, null);
});

test("unlock estimates handle month-end clamping and require a matching verified cycle", () => {
  reset();
  record(invoice({ start: "2026-10-31", end: "2026-11-30" }));
  db.exec("UPDATE supporter_subscriptions SET renews_at='2026-11-30T00:00:00Z'");
  assert.equal(summary().loyalty.schedule.expectedUnlockAt, "2026-12-31T00:00:00.000Z");
  db.exec("UPDATE supporter_subscriptions SET renews_at='2026-12-02T00:00:00Z'");
  assert.equal(summary().loyalty.schedule.expectedUnlockAt, null);
  reset();
  assert.equal(summary().loyalty.schedule.expectedUnlockAt, null);
});

test("unlock dates advance to six and twelve paid months and stop after the last milestone", () => {
  reset();
  for (let month = 0; month < 12; month++) {
    const start = new Date(Date.UTC(2025, 11 + month, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(2025, 12 + month, 1)).toISOString().slice(0, 10);
    record(invoice({ name: `date_${month}`, start, end }));
    if (month === 4) {
      db.prepare("UPDATE supporter_subscriptions SET renews_at=?").run(end + "T00:00:00Z");
      const result = rewards.rewardSummary(user, { env, now: Date.parse(start + "T12:00:00Z") });
      assert.equal(result.loyalty.nextMilestone.months, 6);
      assert.equal(result.loyalty.schedule.expectedUnlockAt, end + "T00:00:00.000Z");
    }
    if (month === 10) {
      db.prepare("UPDATE supporter_subscriptions SET renews_at=?").run(end + "T00:00:00Z");
      const result = rewards.rewardSummary(user, { env, now: Date.parse(start + "T12:00:00Z") });
      assert.equal(result.loyalty.nextMilestone.months, 12);
      assert.equal(result.loyalty.schedule.expectedUnlockAt, end + "T00:00:00.000Z");
    }
  }
  assert.equal(summary().loyalty.schedule.expectedUnlockAt, null);
});

test("paid period records once despite different webhook IDs or repeated history imports", () => {
  reset(); const bill = invoice(); record(bill); record(bill);
  rewards.processRewardEvent({ id:"evt_different", type:"invoice.paid", livemode:false, data:{object:bill} }, {env,now});
  assert.equal(rewards.paidMonths(42, now), 1);
  assert.equal(summary().monthly.allowance, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM membership_paid_invoices").get().n, 1);
});

test("trial/free invoices, wrong Stripe mode and unrecognized prices grant no monthly choices", () => {
  reset();
  record(invoice({amount:0}));
  record({...invoice({name:"live"}),livemode:true});
  const unknown=invoice({name:"unknown"}); unknown.lines.data[0].price.id="price_unrelated"; record(unknown);
  assert.equal(summary().monthly.allowance,0);
  assert.equal(rewards.paidMonths(42,now),0);
});

test("prorated upgrade expands the same paid allowance without granting another loyalty month", () => {
  reset(); record(invoice());
  record(invoice({name:"upgrade",tier:"legend",reason:"subscription_update",start:"2026-11-15",amount:900,prorated:true}));
  assert.equal(summary().monthly.allowance,3);
  assert.equal(rewards.paidMonths(42,now),1);
});

test("paid upgrade arriving before original cycle is attached when that cycle arrives", () => {
  reset();
  record(invoice({name:"upgrade",tier:"guardian",reason:"subscription_update",start:"2026-11-10",prorated:true}));
  assert.equal(summary().monthly.allowance,0);
  record(invoice());
  assert.equal(summary().monthly.allowance,2);
  assert.equal(summary().loyalty.paidMonths,1);
});

test("newer Stripe nested invoice and price fields are recognized", () => {
  reset(); const bill=invoice();
  delete bill.subscription; bill.parent={subscription_details:{subscription:"sub_member"}};
  const line=bill.lines.data[0]; delete line.price; delete line.subscription;
  line.pricing={price_details:{price:"price_supporter"}};
  line.parent={subscription_item_details:{subscription:"sub_member",proration:false}};
  record(bill); assert.equal(summary().monthly.allowance,1);
});

test("missing subscription links are retriable and do not silently lose paid history", () => {
  reset(); db.exec("DELETE FROM supporter_subscriptions");
  assert.throws(()=>record(invoice()),error=>error.code==="MEMBERSHIP_NOT_LINKED");
  assert.equal(db.prepare("SELECT count(*) AS n FROM membership_paid_invoices").get().n,0);
});

test("scheduled cancellation retains bounded non-coin benefits and actual expiry removes them", () => {
  reset("guardian"); record(invoice({tier:"guardian"}));
  db.exec("UPDATE supporter_subscriptions SET auto_renew=0,cancelled_at='2026-11-10'");
  assert.equal(summary().entitled,true);
  assert.equal(Object.hasOwn(summary(), "storage"), false);
  assert.equal(rewards.rewardSummary(user,{env,now:Date.parse("2026-12-01T00:00:00Z")}).entitled,false);
  db.exec("UPDATE supporter_subscriptions SET stripe_status='canceled'");
  assert.equal(summary().entitled,false);
  assert.equal(summary().monthly.remaining,0);
  assert.equal(rewards.paidMonths(42,now),1);
});

test("active status without a verified future period cannot grant extra storage", () => {
  assert.equal(entitlement({tier:"legend",stripe_status:"active"},{env,now}).storageBonusSlots,0);
  assert.equal(entitlement({tier:"legend",stripe_status:"trialing",renews_at:"2026-12-01"},{env,now}).entitled,false);
});

test("three six and twelve paid months earn permanent frames, without counting calendar age", () => {
  reset("legend");
  for(let month=0;month<12;month++) {
    const start=new Date(Date.UTC(2025,11+month,1)).toISOString().slice(0,10);
    const end=new Date(Date.UTC(2025,12+month,1)).toISOString().slice(0,10);
    record(invoice({name:`month_${month}`,start,end,tier:"legend"}));
  }
  assert.equal(summary().loyalty.paidMonths,12);
  assert.deepEqual(summary().loyalty.milestones.map(m=>m.earned),[true,true,true]);
  rewards.updateAppearance(user,{frameId:"loyalty-12",badgeVisible:false},{env,now});
  db.exec("UPDATE supporter_subscriptions SET stripe_status='canceled'");
  assert.equal(summary().appearance.frameId,"loyalty-12");
  assert.equal(summary().appearance.badgeVisible,false);
  assert.equal(summary().appearance.badge,null);
  assert.equal(summary().appearance.frames.find(f=>f.id==="legend-gold").available,false);
});

test("overlapping subscription periods do not double-count loyalty", () => {
  reset(); record(invoice());
  db.exec("UPDATE supporter_subscriptions SET stripe_subscription_id='sub_replacement'");
  const bill=invoice({name:"replacement"}); bill.subscription="sub_replacement"; bill.lines.data[0].subscription="sub_replacement";
  record(bill); assert.equal(rewards.paidMonths(42,now),1);
});

test("forged or unearned profile frames and nonboolean visibility are rejected", () => {
  reset();
  assert.throws(()=>rewards.updateAppearance(user,{frameId:"legend-gold",badgeVisible:true},{env,now}),e=>e.status===403);
  assert.throws(()=>rewards.updateAppearance(user,{frameId:"loyalty-3",badgeVisible:true},{env,now}),e=>e.status===403);
  assert.throws(()=>rewards.updateAppearance(user,{frameId:"none",badgeVisible:"false"},{env,now}),e=>e.status===400);
  const saved=rewards.updateAppearance(user,{frameId:"supporter-fern",badgeVisible:false},{env,now});
  assert.equal(saved.appearance.frameId,"supporter-fern");
  assert.equal(saved.appearance.badgeVisible,false);
});

test("simultaneous different skin claims cannot exceed the paid period allowance", async () => {
  reset(); record(invoice()); const delivered=[];
  const client={listCatalog:async()=>catalogue(),fulfillClaim:async input=>{delivered.push(input);return {...input,presetId:"preset",alreadyOwned:false};}};
  const result=await Promise.allSettled([rewards.claimSkin(user,"ashfall",{env,now,client}),rewards.claimSkin(user,"moonlit",{env,now,client})]);
  assert.equal(result.filter(r=>r.status==="fulfilled").length,1);
  assert.equal(delivered.length,1);
  assert.equal(summary().monthly.remaining,0);
});

test("uncertain skin delivery keeps one reservation and retries the same claim after expiry", async () => {
  reset(); record(invoice()); const ids=[]; let failed=true;
  const client={listCatalog:async()=>catalogue(),fulfillClaim:async input=>{ids.push(input.claimId);if(failed)throw new Error("timeout");return {...input,presetId:"preset",duplicate:true,alreadyOwned:false};}};
  await assert.rejects(rewards.claimSkin(user,"ashfall",{env,now,client}),e=>e.code==="SKIN_CHOICE_PENDING");
  assert.equal(summary().monthly.remaining,0);
  failed=false; db.exec("UPDATE supporter_subscriptions SET stripe_status='canceled'");
  await rewards.claimSkin(user,"ashfall",{env,now:now+86400000*60,client});
  assert.equal(new Set(ids).size,1);
  assert.equal(db.prepare("SELECT status FROM membership_skin_claims").get().status,"fulfilled");
});

test("already owned skins return a reservation and do not consume a monthly choice", async () => {
  reset(); record(invoice());
  const client={listCatalog:async()=>catalogue(),fulfillClaim:async input=>({...input,alreadyOwned:true,presetId:"preset"})};
  await rewards.claimSkin(user,"ashfall",{env,now,client});
  assert.equal(summary().monthly.remaining,1);
});

test("fully refunded billing period cannot fund new choices", () => {
  reset(); record(invoice());
  rewards.processRewardEvent({type:"charge.refunded",livemode:false,data:{object:{refunded:true,invoice:"in_first"}}},{env,now});
  assert.equal(summary().monthly.allowance,0);
  assert.equal(summary().loyalty.paidMonths,0);
});

test("paid history import uses only this subscription, is read-only in Stripe and is idempotent", async () => {
  reset(); const calls=[];
  const fetchImpl=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({data:[invoice()],has_more:false})};};
  const result=await syncPaidHistory(42,{env,now,fetchImpl});
  assert.equal(result.recorded,1);
  assert.ok(calls[0].url.includes("subscription=sub_member"));
  assert.equal(calls[0].options.method,undefined);
  assert.equal(summary().loyalty.historyVerified,true);
  await assert.rejects(syncPaidHistory(42,{env,now,fetchImpl}),e=>e.status===429);
  const again=await syncPaidHistory(42,{env,now:now+61000,fetchImpl});
  assert.equal(again.duplicates,1);
});

test("history import refuses another subscription and leaves it unrecorded", async () => {
  reset(); const bill=invoice(); bill.subscription="sub_someone_else";
  const fetchImpl=async()=>({ok:true,json:async()=>({data:[bill],has_more:false})});
  await assert.rejects(syncPaidHistory(42,{env,now,fetchImpl}),e=>e.code==="HISTORY_IDENTITY_MISMATCH");
  assert.equal(rewards.paidMonths(42,now),0);
});
