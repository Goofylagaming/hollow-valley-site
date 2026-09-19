const test = require("node:test");
const assert = require("node:assert/strict");

const {
  changeSubscription,
  cancelSubscription,
  resumeSubscription,
} = require("../server/services/supporterManage");

const env = {
  STRIPE_SECRET_KEY: "sk_test_fixture",
  STRIPE_PRICE_MEMBER: "price_testmember",
  STRIPE_PRICE_ELITE: "price_testelite",
  STRIPE_PRICE_LEGEND: "price_testlegend",
  RENDER_EXTERNAL_URL: "https://hollow-valley-site-test.onrender.com",
};

function subscription(overrides = {}) {
  return {
    id: "sub_test_42",
    livemode: false,
    status: "active",
    cancel_at_period_end: false,
    metadata: { user_id: "42", tier: "member" },
    items: {
      data: [{
        id: "si_test_42",
        price: { id: env.STRIPE_PRICE_MEMBER },
      }],
    },
    ...overrides,
  };
}

test("changing tier updates the existing subscription item instead of creating another subscription", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (options.method === "GET") {
      return { ok: true, json: async () => subscription() };
    }
    const body = Object.fromEntries(options.body);
    assert.equal(body["items[0][id]"], "si_test_42");
    assert.equal(body["items[0][price]"], env.STRIPE_PRICE_ELITE);
    assert.equal(body["metadata[tier]"], "elite");
    assert.equal(body.cancel_at_period_end, "false");
    assert.equal(body.proration_behavior, "create_prorations");
    return {
      ok: true,
      json: async () => subscription({
        metadata: { user_id: "42", tier: "elite" },
        items: { data: [{ id: "si_test_42", price: { id: env.STRIPE_PRICE_ELITE } }] },
      }),
    };
  };

  const result = await changeSubscription({
    subscriptionId: "sub_test_42",
    tier: "elite",
    userId: 42,
    env,
    fetchImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.tier, "elite");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.stripe.com/v1/subscriptions/sub_test_42");
  assert.equal(calls[1].url, "https://api.stripe.com/v1/subscriptions/sub_test_42");
});

test("selecting the current tier makes no Stripe update", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    return { ok: true, json: async () => subscription() };
  };
  const result = await changeSubscription({
    subscriptionId: "sub_test_42",
    tier: "member",
    userId: 42,
    env,
    fetchImpl,
  });
  assert.equal(result.changed, false);
  assert.equal(calls, 1);
});

test("cancellation is scheduled at period end and can be resumed", async () => {
  let step = 0;
  const cancelFetch = async (url, options) => {
    step++;
    if (options.method === "GET") {
      return { ok: true, json: async () => subscription() };
    }
    assert.equal(options.body.get("cancel_at_period_end"), "true");
    return {
      ok: true,
      json: async () => subscription({ cancel_at_period_end: true }),
    };
  };

  const cancelled = await cancelSubscription({
    subscriptionId: "sub_test_42",
    userId: 42,
    env,
    fetchImpl: cancelFetch,
  });
  assert.equal(cancelled.changed, true);
  assert.equal(cancelled.cancelAtPeriodEnd, true);
  assert.equal(step, 2);

  const resumeFetch = async (url, options) => {
    if (options.method === "GET") {
      return {
        ok: true,
        json: async () => subscription({ cancel_at_period_end: true }),
      };
    }
    assert.equal(options.body.get("cancel_at_period_end"), "false");
    return { ok: true, json: async () => subscription({ cancel_at_period_end: false }) };
  };

  const resumed = await resumeSubscription({
    subscriptionId: "sub_test_42",
    userId: 42,
    env,
    fetchImpl: resumeFetch,
  });
  assert.equal(resumed.changed, true);
  assert.equal(resumed.cancelAtPeriodEnd, false);
});

test("management refuses a subscription linked to another Hollow Valley user", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => subscription({ metadata: { user_id: "99", tier: "member" } }),
  });

  await assert.rejects(
    changeSubscription({
      subscriptionId: "sub_test_42",
      tier: "elite",
      userId: 42,
      env,
      fetchImpl,
    }),
    { status: 403 }
  );
});

test("sandbox management rejects live Stripe objects and bad subscription ids", async () => {
  await assert.rejects(
    changeSubscription({
      subscriptionId: "bad",
      tier: "elite",
      userId: 42,
      env,
      fetchImpl: () => assert.fail("Stripe should not be contacted"),
    }),
    { status: 400 }
  );

  await assert.rejects(
    changeSubscription({
      subscriptionId: "sub_test_42",
      tier: "legend",
      userId: 42,
      env,
      fetchImpl: async () => ({
        ok: true,
        json: async () => subscription({ livemode: true }),
      }),
    }),
    { status: 502 }
  );
});
