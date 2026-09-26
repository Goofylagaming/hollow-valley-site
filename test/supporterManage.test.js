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
    customer: "cus_test_42",
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

test("changing tier creates a prorated Stripe Billing Portal flow for the existing subscription", async () => {
  const calls = [];
  const portalUrl = "https://billing.stripe.com/p/session/test_fixture";
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });

    if (url === "https://api.stripe.com/v1/subscriptions/sub_test_42") {
      assert.equal(options.method, "GET");
      return { ok: true, json: async () => subscription() };
    }

    if (url === `https://api.stripe.com/v1/prices/${env.STRIPE_PRICE_ELITE}`) {
      assert.equal(options.method, "GET");
      return {
        ok: true,
        json: async () => ({
          id: env.STRIPE_PRICE_ELITE,
          livemode: false,
          active: true,
          recurring: { interval: "month" },
          product: "prod_hollow_valley_membership",
        }),
      };
    }

    if (url === "https://api.stripe.com/v1/billing_portal/configurations") {
      assert.equal(options.method, "POST");
      const body = Object.fromEntries(options.body);
      assert.equal(body["features[subscription_update][enabled]"], "true");
      assert.equal(body["features[subscription_update][proration_behavior]"], "always_invoice");
      assert.equal(body["features[subscription_update][products][0][product]"], "prod_hollow_valley_membership");
      assert.equal(body["features[subscription_update][products][0][prices][0]"], env.STRIPE_PRICE_ELITE);
      return { ok: true, json: async () => ({ id: "bpc_test_fixture", livemode: false }) };
    }

    if (url === "https://api.stripe.com/v1/billing_portal/sessions") {
      assert.equal(options.method, "POST");
      const body = Object.fromEntries(options.body);
      assert.equal(body.customer, "cus_test_42");
      assert.equal(body.configuration, "bpc_test_fixture");
      assert.equal(body["flow_data[type]"], "subscription_update_confirm");
      assert.equal(body["flow_data[subscription_update_confirm][subscription]"], "sub_test_42");
      assert.equal(body["flow_data[subscription_update_confirm][items][0][id]"], "si_test_42");
      assert.equal(body["flow_data[subscription_update_confirm][items][0][price]"], env.STRIPE_PRICE_ELITE);
      return { ok: true, json: async () => ({ id: "bps_test_fixture", livemode: false, url: portalUrl }) };
    }

    assert.fail(`Unexpected Stripe request: ${url}`);
  };

  const result = await changeSubscription({
    subscriptionId: "sub_test_42",
    tier: "elite",
    userId: 42,
    env,
    fetchImpl,
  });

  assert.deepEqual(result, {
    ok: true,
    changed: false,
    tier: "guardian",
    portal: true,
    url: portalUrl,
    prorationBehavior: "always_invoice",
  });
  assert.equal(calls.length, 4);
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


test("Steam metadata takes precedence over local user id when present", async () => {
  const fetchImpl = async () => ({
    ok: true,
    json: async () => subscription({
      metadata: {
        user_id: "42",
        steam_id: "76561198000000999",
        tier: "member",
      },
    }),
  });

  await assert.rejects(
    changeSubscription({
      subscriptionId: "sub_test_42",
      tier: "elite",
      userId: 42,
      steamId: "76561198000000042",
      env,
      fetchImpl,
    }),
    { status: 403 }
  );
});

test("strict supporter identity requires matching Steam metadata", async () => {
  const strictEnv = { ...env, SUPPORTER_REQUIRE_STEAM_ID: "true" };
  const fetchImpl = async () => ({
    ok: true,
    json: async () => subscription({
      metadata: {
        user_id: "42",
        steam_id: "76561198000000042",
        tier: "member",
      },
    }),
  });

  const result = await changeSubscription({
    subscriptionId: "sub_test_42",
    tier: "member",
    userId: 42,
    steamId: "76561198000000042",
    env: strictEnv,
    fetchImpl,
  });
  assert.equal(result.changed, false);

  await assert.rejects(
    changeSubscription({
      subscriptionId: "sub_test_42",
      tier: "member",
      userId: 42,
      env: strictEnv,
      fetchImpl,
    }),
    { status: 403 }
  );
});


test("live membership management accepts live objects only when explicitly enabled", async () => {
  const liveEnv = {
    ...env,
    STRIPE_LIVE_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_live_fixture",
  };
  const liveSubscription = subscription({
    id: "sub_live_42",
    livemode: true,
    metadata: { user_id: "42", tier: "member" },
  });
  const result = await changeSubscription({
    subscriptionId: "sub_live_42",
    tier: "member",
    userId: 42,
    env: liveEnv,
    fetchImpl: async () => ({ ok: true, json: async () => liveSubscription }),
  });
  assert.equal(result.changed, false);

  await assert.rejects(
    changeSubscription({
      subscriptionId: "sub_live_42",
      tier: "member",
      userId: 42,
      env: liveEnv,
      fetchImpl: async () => ({ ok: true, json: async () => ({ ...liveSubscription, livemode: false }) }),
    }),
    { status: 502 }
  );
});
