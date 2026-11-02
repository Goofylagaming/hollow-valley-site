const test = require("node:test");
const assert = require("node:assert/strict");
const { financeConfiguration, loadStripeFinance, _test } = require("../server/services/stripeFinance");

const NOW = Date.UTC(2026, 10, 2, 0);
const end = (days) => Math.floor((NOW + days * 86400000) / 1000);
const env = {
  STRIPE_FINANCE_READ_KEY: "rk_test_fixture",
  STRIPE_LIVE_ENABLED: "false",
  STRIPE_PRICE_MEMBER: "price_member",
  STRIPE_PRICE_ELITE: "price_guardian",
  STRIPE_PRICE_LEGEND: "price_legend",
};
function sub(id, status, tier, days, extra = {}) {
  return {
    id, status, metadata: { tier }, created: end(-30), collection_method: "charge_automatically",
    customer: { name: id + " payer", email: id + "@example.com" },
    items: { data: [{ current_period_end: end(days), quantity: 1,
      price: { id: "price_" + tier, unit_amount: 1500, currency: "aud",
        recurring: { interval: "month", usage_type: "licensed" } } }] },
    ...extra,
  };
}
function ok(result) { return { ok: true, json: async () => result }; }

test("finance uses read-only mode-matched Stripe keys and fails closed without credentials", () => {
  assert.equal(financeConfiguration({ STRIPE_FINANCE_READ_KEY: "rk_test_fixture" }).live, false);
  assert.equal(financeConfiguration({ STRIPE_FINANCE_READ_KEY: "rk_test_fixture", STRIPE_LIVE_ENABLED: "1" }), null);
  assert.equal(financeConfiguration({ STRIPE_FINANCE_READ_KEY: "rk_live_fixture", STRIPE_LIVE_ENABLED: "1" }).live, true);
  assert.equal(financeConfiguration({ STRIPE_SECRET_KEY: "sk_test_existing" }).secret, "sk_test_existing");
  assert.equal(financeConfiguration({ STRIPE_FINANCE_READ_KEY: "bad", STRIPE_SECRET_KEY: "sk_test_existing" }), null);
  assert.equal(financeConfiguration({}), null);
});

test("reports Hollow Valley renewals and bank payouts with item-level periods, pagination and no secrets", async () => {
  const urls = [];
  const fetchImpl = async (raw, opts) => {
    const url = new URL(raw);
    urls.push(url);
    assert.equal(opts.method, "GET");
    assert.equal(opts.headers.Authorization, "Bearer rk_test_fixture");
    if (url.pathname.endsWith("/subscriptions")) {
      const cursor = url.searchParams.get("starting_after");
      assert.equal(url.searchParams.get("status"), "all");
      assert.ok(url.searchParams.has("expand[]"));
      return cursor
        ? ok({ has_more: false, data: [
          sub("sub_c", "past_due", "legend", 8),
          sub("sub_unrelated", "active", "unrelated", 4),
        ] })
        : ok({ has_more: true, data: [
          sub("sub_a", "active", "guardian", 4),
          sub("sub_b", "active", "member", 10, { cancel_at_period_end: true }),
        ] });
    }
    if (url.pathname.endsWith("/payouts")) return ok({
      has_more: false,
      data: [
        { id: "po_next", amount: 1200, currency: "aud", status: "in_transit",
          arrival_date: end(2), created: end(-1), type: "bank_account", automatic: true },
        { id: "po_past", amount: 500, currency: "aud", status: "paid",
          arrival_date: end(-6), created: end(-7), type: "bank_account", automatic: true },
        { id: "po_card", amount: 99, currency: "aud", status: "paid", type: "card" },
      ],
    });
    if (url.pathname.endsWith("/balance")) return ok({
      available: [{ amount: 3000, currency: "aud" }],
      pending: [{ amount: 4500, currency: "aud" }],
    });
    throw Error("unexpected Stripe URL");
  };

  const data = await loadStripeFinance({
    env, fetchImpl, now: NOW,
    websiteNames: new Map([["sub_a", "Chromie"], ["sub_b", "DefaultGuy1"]]),
  });
  assert.equal(data.mode, "test");
  assert.equal(data.subscriptions.length, 3);
  assert.equal(data.subscriptions[0].player, "Chromie");
  assert.equal(data.subscriptions[0].amount, 1500);
  assert.ok(data.subscriptions[0].periodEndAt.startsWith("2026-11-06"));
  assert.equal(data.subscriptions.find((s) => s.subscriptionId === "sub_b").autoRenew, false);
  assert.equal(data.summary.active, 2);
  assert.equal(data.summary.paymentAttention, 1);
  assert.equal(data.summary.upcomingRenewals30Days, 1);
  assert.deepEqual(data.summary.estimatedRenewalGross30Days, [{ currency: "aud", amount: 1500 }]);
  assert.equal(data.summary.nextStripePayout.id, "po_next");
  assert.equal(data.balance.length, 2);
  assert.equal(data.payouts.length, 2);
  assert.equal(urls.length, 4);
  assert.ok(!JSON.stringify(data).includes("rk_test_fixture"));
});

test("unknown recurring or usage prices are not presented as guaranteed amounts", () => {
  const metered = sub("sub_m", "active", "legend", 4);
  metered.items.data[0].price.recurring.usage_type = "metered";
  assert.equal(_test.priceEstimate(metered), null);
  const unknown = sub("sub_x", "active", "guardian", 4);
  unknown.items.data[0].price.unit_amount = null;
  assert.equal(_test.priceEstimate(unknown), null);
});

test("an absent finance key does not call the Stripe network", async () => {
  await assert.rejects(loadStripeFinance({ env: {}, fetchImpl: () => assert.fail("No network request permitted") }), {
    status: 503,
  });
});
