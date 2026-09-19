const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DB_PATH = ":memory:";

const { db, getSupporterStatus } = require("../server/db");
const { reconcileCurrentUser } = require("../server/services/supporterReconcile");

const env = {
  STRIPE_SECRET_KEY: "sk_test_fixture",
  STRIPE_PRICE_MEMBER: "price_testmember",
  STRIPE_PRICE_ELITE: "price_testelite",
  STRIPE_PRICE_LEGEND: "price_testlegend",
  RENDER_EXTERNAL_URL: "https://hollow-valley-site-test.onrender.com",
};

function reset() {
  db.exec("DELETE FROM stripe_webhook_events; DELETE FROM supporter_subscriptions; DELETE FROM users;");
  db.prepare("INSERT INTO users (id, steam_id, username) VALUES (?, ?, ?)").run(42, "76561198000000042", "recover-test");
}

test("recovers an old sandbox subscription by legacy user_id metadata and backfills Steam ID", async () => {
  reset();
  const calls = [];
  const subscription = {
    id: "sub_test_42",
    livemode: false,
    status: "active",
    cancel_at_period_end: false,
    created: 2_000_000_000,
    metadata: { user_id: "42", tier: "member" },
    customer: "cus_test_42",
    items: {
      data: [{
        id: "si_test_42",
        price: { id: env.STRIPE_PRICE_MEMBER },
        current_period_end: 2_100_000_000,
      }],
    },
  };

  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes("/subscriptions/search?")) {
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query");
      if (query.includes("steam_id")) {
        return { ok: true, json: async () => ({ data: [] }) };
      }
      return { ok: true, json: async () => ({ data: [subscription] }) };
    }
    assert.equal(url, "https://api.stripe.com/v1/subscriptions/sub_test_42");
    assert.equal(options.method, "POST");
    assert.equal(options.body.get("metadata[steam_id]"), "76561198000000042");
    return { ok: true, json: async () => ({ ...subscription, metadata: { ...subscription.metadata, steam_id: "76561198000000042" } }) };
  };

  const result = await reconcileCurrentUser({
    userId: 42,
    steamId: "76561198000000042",
    env,
    fetchImpl,
  });

  assert.deepEqual(result, {
    recovered: true,
    tier: "member",
    stripeStatus: "active",
  });

  const status = getSupporterStatus(42);
  assert.equal(status.tier, "member");
  assert.equal(status.stripe_status, "active");
  assert.equal(status.stripe_subscription_id, "sub_test_42");
  assert.equal(status.stripe_customer_id, "cus_test_42");
  assert.equal(status.auto_renew, 1);
  assert.equal(calls.length, 3);
});

test("ignores canceled or live subscriptions during sandbox recovery", async () => {
  reset();

  const fetchImpl = async (url) => {
    const parsed = new URL(url);
    const query = parsed.searchParams.get("query");
    if (query.includes("steam_id")) return { ok: true, json: async () => ({ data: [] }) };
    return {
      ok: true,
      json: async () => ({
        data: [
          {
            id: "sub_live",
            livemode: true,
            status: "active",
            metadata: { user_id: "42" },
            items: { data: [{ price: { id: env.STRIPE_PRICE_MEMBER } }] },
          },
          {
            id: "sub_cancelled",
            livemode: false,
            status: "canceled",
            metadata: { user_id: "42" },
            items: { data: [{ price: { id: env.STRIPE_PRICE_MEMBER } }] },
          },
        ],
      }),
    };
  };

  const result = await reconcileCurrentUser({
    userId: 42,
    steamId: "76561198000000042",
    env,
    fetchImpl,
  });

  assert.deepEqual(result, { recovered: false });
  assert.equal(getSupporterStatus(42), null);
});


test("strict recovery only searches by Steam metadata and requires Steam identity", async () => {
  reset();
  const strictEnv = { ...env, SUPPORTER_REQUIRE_STEAM_ID: "true" };
  const calls = [];
  const subscription = {
    id: "sub_test_steam",
    livemode: false,
    status: "active",
    cancel_at_period_end: false,
    created: 2_000_000_001,
    metadata: {
      user_id: "999",
      steam_id: "76561198000000042",
      tier: "legend",
    },
    customer: "cus_test_steam",
    items: {
      data: [{
        id: "si_test_steam",
        price: { id: strictEnv.STRIPE_PRICE_LEGEND },
        current_period_end: 2_100_000_001,
      }],
    },
  };

  const fetchImpl = async (url) => {
    calls.push(url);
    const parsed = new URL(url);
    const query = parsed.searchParams.get("query");
    assert.match(query, /steam_id/);
    return { ok: true, json: async () => ({ data: [subscription] }) };
  };

  const result = await reconcileCurrentUser({
    userId: 42,
    steamId: "76561198000000042",
    env: strictEnv,
    fetchImpl,
  });
  assert.equal(result.recovered, true);
  assert.equal(result.tier, "legend");
  assert.equal(calls.length, 1);

  await assert.rejects(
    reconcileCurrentUser({
      userId: 42,
      env: strictEnv,
      fetchImpl: () => assert.fail("Stripe should not be contacted"),
    }),
    { status: 409 }
  );
});
