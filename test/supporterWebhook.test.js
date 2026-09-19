const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

process.env.DB_PATH = ":memory:";
process.env.STRIPE_PRICE_MEMBER = "price_testmember";
process.env.STRIPE_PRICE_ELITE = "price_testelite";
process.env.STRIPE_PRICE_LEGEND = "price_testlegend";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_fixture";

const { db, getSupporterStatus } = require("../server/db");
const {
  verifyStripeSignature,
  processStripeEvent,
  tierFromSubscription,
  isEntitled,
} = require("../server/services/supporterWebhook");

function signedHeader(body, timestamp = 2_000_000_000, secret = process.env.STRIPE_WEBHOOK_SECRET) {
  const digest = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

function reset() {
  db.exec("DELETE FROM stripe_webhook_events; DELETE FROM supporter_subscriptions; DELETE FROM users;");
  db.prepare("INSERT INTO users (id, username) VALUES (?, ?)").run(42, "stripe-test");
}

test("Stripe signature verification requires the exact raw body and a fresh signature", () => {
  const body = Buffer.from('{"id":"evt_signature"}');
  const now = 2_000_000_000;
  const header = signedHeader(body.toString("utf8"), now);
  assert.equal(verifyStripeSignature(body, header, process.env.STRIPE_WEBHOOK_SECRET, now), true);
  assert.equal(verifyStripeSignature(Buffer.from('{"id":"changed"}'), header, process.env.STRIPE_WEBHOOK_SECRET, now), false);
  assert.equal(verifyStripeSignature(body, header, process.env.STRIPE_WEBHOOK_SECRET, now + 301), false);
  assert.equal(verifyStripeSignature(body, header, "wrong", now), false);
});

test("completed sandbox checkout activates the linked Hollow Valley membership idempotently", () => {
  reset();
  const event = {
    id: "evt_checkout_paid",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        mode: "subscription",
        payment_status: "paid",
        client_reference_id: "42",
        metadata: { user_id: "42", tier: "guardian" },
        customer: "cus_test_42",
        subscription: "sub_test_42",
      },
    },
  };

  assert.deepEqual(processStripeEvent(event), { processed: true, userId: 42 });
  const status = getSupporterStatus(42);
  assert.equal(status.tier, "guardian");
  assert.equal(status.stripe_status, "active");
  assert.equal(status.stripe_customer_id, "cus_test_42");
  assert.equal(status.stripe_subscription_id, "sub_test_42");
  assert.equal(status.auto_renew, 1);
  assert.equal(isEntitled(status.stripe_status), true);

  assert.deepEqual(processStripeEvent(event), { duplicate: true });
  assert.equal(db.prepare("SELECT count(*) AS n FROM stripe_webhook_events").get().n, 1);
});

test("unpaid completed checkout stays pending and does not count as entitled", () => {
  reset();
  processStripeEvent({
    id: "evt_checkout_pending",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        mode: "subscription",
        payment_status: "unpaid",
        metadata: { user_id: "42", tier: "supporter" },
        subscription: "sub_pending",
      },
    },
  });
  const status = getSupporterStatus(42);
  assert.equal(status.tier, "supporter");
  assert.equal(status.stripe_status, "pending");
  assert.equal(isEntitled(status.stripe_status), false);
});

test("subscription price is authoritative for upgrades and lifecycle events update status", () => {
  reset();
  const env = {
    ...process.env,
    STRIPE_PRICE_SUPPORTER: "",
    STRIPE_PRICE_GUARDIAN: "",
    STRIPE_PRICE_MEMBER: "price_testmember",
    STRIPE_PRICE_ELITE: "price_testelite",
    STRIPE_PRICE_LEGEND: "price_testlegend",
  };
  processStripeEvent({
    id: "evt_seed",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        mode: "subscription",
        payment_status: "paid",
        metadata: { user_id: "42", tier: "supporter" },
        customer: "cus_test_42",
        subscription: "sub_test_42",
      },
    },
  });

  const subscription = {
    id: "sub_test_42",
    customer: "cus_test_42",
    status: "active",
    cancel_at_period_end: false,
    metadata: { user_id: "42", tier: "supporter" },
    items: {
      data: [{
        price: { id: env.STRIPE_PRICE_LEGEND },
        current_period_end: 2_100_000_000,
      }],
    },
  };
  assert.equal(tierFromSubscription(subscription, env), "legend");

  processStripeEvent({
    id: "evt_upgrade",
    type: "customer.subscription.updated",
    livemode: false,
    data: { object: subscription },
  }, env);
  let status = getSupporterStatus(42);
  assert.equal(status.tier, "legend");
  assert.equal(status.stripe_status, "active");
  assert.equal(status.auto_renew, 1);
  assert.match(status.renews_at, /^2036-/);

  processStripeEvent({
    id: "evt_failed_invoice",
    type: "invoice.payment_failed",
    livemode: false,
    data: {
      object: {
        parent: { subscription_details: { subscription: "sub_test_42" } },
      },
    },
  }, env);
  status = getSupporterStatus(42);
  assert.equal(status.stripe_status, "past_due");
  assert.equal(status.auto_renew, 1);
  assert.equal(isEntitled(status.stripe_status), false);

  processStripeEvent({
    id: "evt_deleted",
    type: "customer.subscription.deleted",
    livemode: false,
    data: {
      object: {
        ...subscription,
        status: "canceled",
      },
    },
  }, env);
  status = getSupporterStatus(42);
  assert.equal(status.stripe_status, "canceled");
  assert.equal(status.auto_renew, 0);
  assert.ok(status.cancelled_at);
  assert.equal(isEntitled(status.stripe_status), false);
});

test("live-mode events are ignored on the sandbox integration", () => {
  reset();
  assert.deepEqual(processStripeEvent({
    id: "evt_live",
    type: "checkout.session.completed",
    livemode: true,
    data: {
      object: {
        mode: "subscription",
        payment_status: "paid",
        metadata: { user_id: "42", tier: "legend" },
      },
    },
  }), { ignored: true });
  assert.equal(getSupporterStatus(42), null);
});

test("HTTP webhook route accepts a valid signed raw body and rejects tampering", async (t) => {
  reset();
  const express = require("express");
  const router = require("../server/routes/stripeWebhook");
  const app = express();
  app.use("/api/stripe/webhook", router);
  app.use(express.json());

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const url = `http://127.0.0.1:${server.address().port}/api/stripe/webhook`;
  const event = {
    id: "evt_http",
    type: "checkout.session.completed",
    livemode: false,
    data: {
      object: {
        mode: "subscription",
        payment_status: "paid",
        metadata: { user_id: "42", tier: "supporter" },
        subscription: "sub_http",
      },
    },
  };
  const body = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  const good = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": signedHeader(body, timestamp),
    },
    body,
  });
  assert.equal(good.status, 200);
  assert.equal(getSupporterStatus(42).tier, "supporter");

  const bad = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Stripe-Signature": signedHeader(body, timestamp),
    },
    body: body.replace("supporter", "legend"),
  });
  assert.equal(bad.status, 400);
});


test("live-mode webhooks are processed only when live mode is explicitly enabled", () => {
  reset();
  const liveEnv = {
    ...process.env,
    STRIPE_LIVE_ENABLED: "true",
  };
  const liveEvent = {
    id: "evt_live_enabled",
    type: "checkout.session.completed",
    livemode: true,
    data: {
      object: {
        mode: "subscription",
        payment_status: "paid",
        metadata: { user_id: "42", tier: "legend" },
        customer: "cus_live_42",
        subscription: "sub_live_42",
      },
    },
  };

  assert.deepEqual(processStripeEvent(liveEvent, liveEnv), { processed: true, userId: 42 });
  assert.equal(getSupporterStatus(42).tier, "legend");

  assert.deepEqual(processStripeEvent({
    ...liveEvent,
    id: "evt_test_rejected_in_live",
    livemode: false,
  }, liveEnv), { ignored: true });
});
