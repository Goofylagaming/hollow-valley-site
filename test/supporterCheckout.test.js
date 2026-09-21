const test = require('node:test');
const assert = require('node:assert/strict');
const { TIERS, checkoutConfigured, createCheckoutSession } = require('../server/services/supporterCheckout');
const env = {
  STRIPE_SECRET_KEY: 'sk_test_fixture',
  STRIPE_PRICE_MEMBER: 'price_1UHAaB2dLCIXuWvnJd8S66oJ',
  STRIPE_PRICE_ELITE: 'price_1UHAbJ2dLCIXuWvnPb6FtysO',
  STRIPE_PRICE_LEGEND: 'price_1UHAc92dLCIXuWvnCUZqqZov',
  RENDER_EXTERNAL_URL: 'https://hollow-valley-site-test.onrender.com',
  STEAM_REALM: 'https://ignored.example',
};
const session = { id: 'cs_test_fixture', livemode: false, url: 'https://checkout.stripe.com/c/pay/cs_test_fixture' };
const ok = async () => ({ ok: true, json: async () => session });

test('exactly three monthly AUD display tiers', () => {
  assert.deepEqual(TIERS, {
    supporter: { label: 'Valley Supporter', priceAud: 7, multiplier: 2 },
    guardian: { label: 'Valley Guardian', priceAud: 15, multiplier: 3 },
    legend: { label: 'Valley Legend', priceAud: 25, multiplier: 5 },
  });
});
for (const tier of Object.keys(TIERS)) {
  test(`${tier} maps to its fixed server price and authenticated metadata`, async () => {
    const result = await createCheckoutSession({ tier, userId: 42, env, fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.stripe.com/v1/checkout/sessions');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers.Authorization, 'Bearer sk_test_fixture');
      assert.ok(options.signal instanceof AbortSignal);
      assert.deepEqual(Object.fromEntries(options.body), {
        mode: 'subscription',
        'line_items[0][price]': tier === 'supporter' ? env.STRIPE_PRICE_MEMBER : tier === 'guardian' ? env.STRIPE_PRICE_ELITE : env.STRIPE_PRICE_LEGEND,
        'line_items[0][quantity]': '1',
        client_reference_id: '42',
        'metadata[user_id]': '42', 'metadata[tier]': tier,
        'subscription_data[metadata][user_id]': '42', 'subscription_data[metadata][tier]': tier,
        success_url: `${env.RENDER_EXTERNAL_URL}/supporter?checkout=success`,
        cancel_url: `${env.RENDER_EXTERNAL_URL}/supporter?checkout=cancelled`,
      });
      return ok();
    }});
    assert.deepEqual(result, { url: session.url });
  });
}
for (const tier of ['scout', 'hunter', 'apex', '__proto__', 'constructor', 'price_arbitrary']) {
  test(`rejects unknown tier ${tier} before contacting Stripe`, async () => {
    await assert.rejects(createCheckoutSession({ tier, userId: 42, env, fetchImpl: () => assert.fail() }), { status: 404 });
  });
}
test('requires an authenticated user', async () => {
  await assert.rejects(createCheckoutSession({ tier: 'supporter', env, fetchImpl: () => assert.fail() }), { status: 401 });
});
test('missing configuration, live keys and unsafe origins fail closed', async () => {
  for (const override of [
    { STRIPE_SECRET_KEY: '' }, { STRIPE_SECRET_KEY: 'sk_live_fixture' },
    { STRIPE_PRICE_MEMBER: '' }, { STRIPE_PRICE_ELITE: '' }, { STRIPE_PRICE_LEGEND: 'invalid' },
    { RENDER_EXTERNAL_URL: 'https://name:password@example.com' },
    { RENDER_EXTERNAL_URL: 'http://example.com' }, { RENDER_EXTERNAL_URL: 'broken' },
  ]) {
    const broken = { ...env, ...override };
    assert.equal(checkoutConfigured(broken), false);
    await assert.rejects(createCheckoutSession({ tier: 'supporter', userId: 42, env: broken, fetchImpl: () => assert.fail() }), { status: 503 });
  }
  assert.equal(checkoutConfigured(env), true);
});
for (const [name, fetchImpl] of Object.entries({
  rejection: async () => ({ ok: false }),
  network: async () => { throw new Error('private secret'); },
  timeout: async () => { throw new DOMException('private secret', 'TimeoutError'); },
  malformed: async () => ({ ok: true, json: async () => { throw new Error('private secret'); } }),
  missingUrl: async () => ({ ok: true, json: async () => ({ id: 'cs_test_fixture', livemode: false }) }),
  wrongHost: async () => ({ ok: true, json: async () => ({ ...session, url: 'https://evil.example' }) }),
  live: async () => ({ ok: true, json: async () => ({ ...session, livemode: true }) }),
})) {
  test(`sanitizes Stripe ${name} errors`, async () => {
    await assert.rejects(createCheckoutSession({ tier: 'supporter', userId: 42, env, fetchImpl }), {
      status: 502, message: 'Unable to start Stripe checkout. Please try again.',
    });
  });
}

// Exercise the actual route and authentication middleware without any external service.
test('HTTP routes enforce auth, ignore browser price/user fields, and preserve cancellation', async (t) => {
  process.env.DB_PATH = ':memory:';
  const oldEnv = { ...process.env };
  Object.assign(process.env, env);
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; for (const key of Object.keys(env)) { if (oldEnv[key] === undefined) delete process.env[key]; else process.env[key] = oldEnv[key]; } });
  const express = require('express');
  const { db } = require('../server/db');
  db.prepare('INSERT INTO users (id, steam_id, username) VALUES (42, ?, ?)').run('76561198000000042', 'checkout-test');
  const router = require('../server/routes/supporter');
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { if (req.headers['x-test-auth'] === 'yes') req.user = { id: 42, steam_id: '76561198000000042' }; next(); });
  app.use('/api/supporter', router);
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/supporter`;
  const request = (path, authenticated = true, body = {}) => originalFetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(authenticated ? { 'x-test-auth': 'yes' } : {}) }, body: JSON.stringify(body),
  });
  let calls = 0;
  global.fetch = async (url, options) => {
    calls++;
    assert.equal(options.body.get('line_items[0][price]'), env.STRIPE_PRICE_MEMBER);
    assert.equal(options.body.get('client_reference_id'), '42');
    assert.equal(options.body.get('metadata[tier]'), 'supporter');
    return ok();
  };
  assert.equal((await request('/supporter/checkout', false)).status, 401);
  assert.equal(calls, 0);
  const tiers = await (await originalFetch(base + '/tiers')).json();
  assert.deepEqual(tiers, { tiers: TIERS, checkoutConfigured: true });
  assert.equal(JSON.stringify(tiers).includes('price_'), false);
  const success = await request('/supporter/checkout', true, { price: 'price_attacker', user_id: 99, tier: 'legend', success_url: 'https://evil.example' });
  assert.equal(success.status, 200);
  assert.deepEqual(await success.json(), { url: session.url });
  assert.equal(calls, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM supporter_subscriptions').get().n, 0);
  assert.equal((await request('/constructor/checkout')).status, 404);
  global.fetch = async () => { throw new Error('secret'); };
  assert.equal((await request('/supporter/checkout')).status, 502);
  delete process.env.STRIPE_PRICE_MEMBER;
  assert.equal((await request('/supporter/checkout')).status, 503);
  assert.equal((await request('/cancel', false)).status, 401);
  assert.equal((await request('/cancel')).status, 200);
});


test('strict supporter identity requires a valid Steam ID before checkout', async () => {
  const strictEnv = { ...env, SUPPORTER_REQUIRE_STEAM_ID: 'true' };
  await assert.rejects(
    createCheckoutSession({
      tier: 'supporter',
      userId: 42,
      env: strictEnv,
      fetchImpl: () => assert.fail('Stripe should not be contacted'),
    }),
    { status: 409 }
  );

  const result = await createCheckoutSession({
    tier: 'supporter',
    userId: 42,
    steamId: '76561198000000042',
    env: strictEnv,
    fetchImpl: async (url, options) => {
      const body = Object.fromEntries(options.body);
      assert.equal(body['metadata[steam_id]'], '76561198000000042');
      assert.equal(body['subscription_data[metadata][steam_id]'], '76561198000000042');
      return ok();
    },
  });
  assert.deepEqual(result, { url: session.url });
});


test('live checkout requires explicit live flag and validates live Stripe response', async () => {
  const liveEnv = {
    ...env,
    STRIPE_LIVE_ENABLED: 'true',
    STRIPE_SECRET_KEY: 'sk_live_fixture',
    RENDER_EXTERNAL_URL: 'https://hollowvalley.herbydeathsquadgames.com',
  };
  const liveSession = {
    id: 'cs_live_fixture',
    livemode: true,
    url: 'https://checkout.stripe.com/c/pay/cs_live_fixture',
  };

  const result = await createCheckoutSession({
    tier: 'legend',
    userId: 42,
    steamId: '76561198000000042',
    env: liveEnv,
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer sk_live_fixture');
      return { ok: true, json: async () => liveSession };
    },
  });
  assert.deepEqual(result, { url: liveSession.url });

  await assert.rejects(
    createCheckoutSession({
      tier: 'legend',
      userId: 42,
      env: { ...liveEnv, STRIPE_LIVE_ENABLED: 'false' },
      fetchImpl: () => assert.fail('live key must not be used without explicit live flag'),
    }),
    { status: 503 }
  );
});


test('legacy member and elite checkout aliases normalize to official tier metadata', async () => {
  for (const [legacy, canonical] of [['member', 'supporter'], ['elite', 'guardian']]) {
    await createCheckoutSession({
      tier: legacy,
      userId: 42,
      env,
      fetchImpl: async (url, options) => {
        assert.equal(options.body.get('metadata[tier]'), canonical);
        return ok();
      },
    });
  }
});
