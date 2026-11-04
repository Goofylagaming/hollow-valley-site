const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_PATH = ':memory:';
const { db, getSupporterStatus } = require('../server/db');
const { createCheckoutSession } = require('../server/services/supporterCheckout');
const { processLifecycle } = require('../server/services/supporterLifecycle');
const { resumeSubscription } = require('../server/services/supporterManage');
const { isEntitled, isCoinBonusEligible } = require('../server/services/supporterWebhook');
const { subscriberForSubscription, creditMonthlySubscriberBonus } = require('../server/services/supporterCoinBonus');
const { targetTierForStatus } = require('../server/services/discordMembership');
const env = { STRIPE_SECRET_KEY: 'rk_test_fixture', STRIPE_PRICE_MEMBER: 'price_member',
  STRIPE_PRICE_ELITE: 'price_elite', STRIPE_PRICE_LEGEND: 'price_legend',
  PUBLIC_SITE_URL: 'https://example.com', AUTOMATION_SERVICE_URL: 'https://wallet.example', HOLLOW_VALLEY_API_TOKEN: 'fixture' };
const session = { id: 'cs_test_fixture', url: 'https://checkout.stripe.com/c/pay/cs_test_fixture', livemode: false };
const response = value => ({ ok: true, json: async () => structuredClone(value) });
let seq = 0;
function event(type = 'customer.subscription.updated') {
  return { id: `evt_renewal_${++seq}`, livemode: false, created: 1, type,
    data: { object: type.startsWith('invoice.') ? { id: 'in_first', subscription: 'sub_month', customer: 'cus_month', billing_reason: 'subscription_create', amount_paid: 700 }
      : type.startsWith('checkout.') ? { mode: 'subscription', subscription: 'sub_month', customer: 'cus_month', client_reference_id: '42', metadata: { user_id: '42' } }
      : { id: 'sub_month', customer: 'cus_month' } } };
}
function fixture() {
  db.exec('DELETE FROM stripe_webhook_events; DELETE FROM supporter_subscriptions; DELETE FROM users;');
  db.prepare('INSERT INTO users(id, username, steam_id, is_admin) VALUES (42, ?, ?, 1)').run('owner', '76561198000000042');
  let state = { id: 'sub_month', customer: 'cus_month', livemode: false, status: 'active', cancel_at_period_end: false,
    metadata: { user_id: '42', steam_id: '76561198000000042', tier: 'supporter', renewal_mode: 'one_month' },
    items: { data: [{ price: { id: 'price_member' }, current_period_end: Math.floor(Date.now() / 1000) + 2592000 }] } };
  const calls = [];
  return { calls, get state() { return state; }, set state(value) { state = value; },
    fetchImpl: async (url, options = {}) => {
      assert.equal(url, 'https://api.stripe.com/v1/subscriptions/sub_month');
      calls.push(options);
      if (options.method === 'POST') {
        state.cancel_at_period_end = options.body.get('cancel_at_period_end') === 'true';
        if (options.body.has('metadata[renewal_mode]')) state.metadata.renewal_mode = options.body.get('metadata[renewal_mode]');
      }
      return response(state);
    } };
}

test('one-month checkout validates a monthly price and persists the authenticated choice', async () => {
  for (const tier of ['supporter', 'guardian', 'legend']) {
    let calls = 0;
    const result = await createCheckoutSession({ tier, userId: 42, steamId: '76561198000000042', renewalMode: 'one_month', env,
      fetchImpl: async (url, options) => {
        calls++;
        if (url.includes('/prices/')) return response({ id: url.split('/').pop(), active: true, livemode: false, recurring: { interval: 'month', interval_count: 1 } });
        assert.equal(options.body.get('mode'), 'subscription');
        assert.equal(options.body.get('subscription_data[metadata][renewal_mode]'), 'one_month');
        assert.equal(options.body.get('subscription_data[metadata][user_id]'), '42');
        assert.equal(options.body.has('custom_text[submit][message]'), false, 'Managed Payments does not support custom_text');
        assert.equal(options.body.has('managed_payments[enabled]'), false, 'preserve account payment settings');
        return response(session);
      } });
    assert.equal(calls, 2);
    assert.equal(result.url, session.url);
  }
});

test('invalid renewal choices and non-monthly prices never open Checkout', async () => {
  for (const renewalMode of [null, '', true, 'yearly', '__proto__']) {
    await assert.rejects(createCheckoutSession({ tier: 'supporter', userId: 42, renewalMode, env, fetchImpl: () => assert.fail() }), { status: 400 });
  }
  for (const recurring of [{ interval: 'year', interval_count: 1 }, { interval: 'month', interval_count: 3 }]) {
    await assert.rejects(createCheckoutSession({ tier: 'supporter', userId: 42, renewalMode: 'one_month', env,
      fetchImpl: async url => { assert.ok(url.includes('/prices/')); return response({ id: 'price_member', active: true, livemode: false, recurring }); } }), { status: 502 });
  }
});

test('invoice-first, duplicate and delayed checkout events end renewal once, retain paid perks and expire exactly', async () => {
  const f = fixture();
  const paid = event('invoice.paid');
  const options = { env, fetchImpl: f.fetchImpl };
  await processLifecycle(paid, options);
  await processLifecycle(paid, options);
  await processLifecycle(event('checkout.session.completed'), options);
  const posts = f.calls.filter(c => c.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].headers['Idempotency-Key'], 'hv-one-month-sub_month');
  const row = getSupporterStatus(42);
  assert.equal(row.auto_renew, 0);
  assert.equal(row.renewal_mode, 'one_month');
  assert.equal(isEntitled(row), true);
  assert.equal(isCoinBonusEligible(subscriberForSubscription('sub_month')), true);
  assert.equal(targetTierForStatus(row), 'supporter');
  const end = Date.parse(row.renews_at);
  assert.equal(isEntitled(row, end - 1), true);
  assert.equal(isEntitled(row, end), false);
  assert.equal(targetTierForStatus(row, { now: end }), null);
  const payoutIds = [];
  for (let i = 0; i < 2; i++) {
    const result = await creditMonthlySubscriberBonus(paid, { env, fetchImpl: async (url, options) => {
      const payload = JSON.parse(options.body); payoutIds.push(payload.invoiceId);
      assert.equal(payload.amount, 15000);
      return response({ duplicate: i === 1 });
    } });
    assert.equal(result.duplicate, i === 1);
  }
  assert.deepEqual(payoutIds, ['in_first', 'in_first']);
  f.state.status = 'canceled';
  await processLifecycle(event('customer.subscription.deleted'), options);
  assert.equal(isCoinBonusEligible(getSupporterStatus(42)), false);
  assert.equal(db.prepare('SELECT is_admin FROM users WHERE id=42').get().is_admin, 1);
});

test('cancellation API failure remains retryable without granting an accidentally renewing membership', async () => {
  const f = fixture();
  const delivery = event();
  await assert.rejects(processLifecycle(delivery, { env, fetchImpl: (url, options) => options.method === 'POST' ? Promise.resolve({ ok: false }) : f.fetchImpl(url, options) }), /could not be scheduled/);
  assert.equal(getSupporterStatus(42), null);
  assert.equal(db.prepare('SELECT 1 FROM stripe_webhook_events WHERE event_id=?').get(delivery.id), undefined);
  await processLifecycle(delivery, { env, fetchImpl: f.fetchImpl });
  assert.equal(getSupporterStatus(42).auto_renew, 0);
});

test('one-month payment failure revokes perks; recovery keeps renewal off; explicit resume changes mode', async () => {
  const f = fixture();
  const options = { env, fetchImpl: f.fetchImpl };
  await processLifecycle(event(), options);
  f.state.status = 'past_due';
  await processLifecycle(event('invoice.payment_failed'), options);
  assert.equal(isCoinBonusEligible(getSupporterStatus(42)), false);
  f.state.status = 'active';
  await processLifecycle(event('invoice.paid'), options);
  assert.equal(isCoinBonusEligible(getSupporterStatus(42)), true);
  await resumeSubscription({ subscriptionId: 'sub_month', userId: 42, steamId: '76561198000000042', ...options });
  await processLifecycle(event(), options);
  assert.equal(getSupporterStatus(42).renewal_mode, 'auto_renew');
  assert.equal(getSupporterStatus(42).auto_renew, 1);
  await processLifecycle(event('checkout.session.completed'), options);
  assert.equal(f.state.cancel_at_period_end, false, 'old checkout must not cancel explicit auto-renew');
  assert.equal(isCoinBonusEligible(getSupporterStatus(42)), true);
});

test('existing renewing and canceled-at-period-end members are not converted to one-month purchases', async () => {
  const f = fixture();
  delete f.state.metadata.renewal_mode;
  await processLifecycle(event(), { env, fetchImpl: f.fetchImpl });
  assert.equal(f.calls.filter(c => c.method === 'POST').length, 0);
  assert.equal(getSupporterStatus(42).auto_renew, 1);
  f.state.cancel_at_period_end = true;
  await processLifecycle(event(), { env, fetchImpl: f.fetchImpl });
  assert.equal(isEntitled(getSupporterStatus(42)), true);
  assert.equal(isCoinBonusEligible(getSupporterStatus(42)), true);
});

test('a concurrent explicit resume wins after the initial one-month webhook completes', async () => {
  const f = fixture();
  let started;
  const readStarted = new Promise(resolve => { started = resolve; });
  let release;
  const readReleased = new Promise(resolve => { release = resolve; });
  let firstRead = true;
  const fetchImpl = async (url, options = {}) => {
    if (firstRead) { firstRead = false; started(); await readReleased; }
    return f.fetchImpl(url, options);
  };
  const webhook = processLifecycle(event(), { env, fetchImpl });
  await readStarted;
  const resume = resumeSubscription({ subscriptionId: 'sub_month', userId: 42, env, fetchImpl });
  release();
  await Promise.all([webhook, resume]);
  await processLifecycle(event(), { env, fetchImpl });
  assert.equal(f.state.cancel_at_period_end, false);
  assert.equal(getSupporterStatus(42).auto_renew, 1);
});

test('internal game lookup includes one-month coin eligibility only while paid and active', async t => {
  const f = fixture();
  await processLifecycle(event(), { env, fetchImpl: f.fetchImpl });
  const express = require('express');
  const app = express();
  app.use(express.json());
  const previousToken = process.env.HOLLOW_VALLEY_API_TOKEN;
  process.env.HOLLOW_VALLEY_API_TOKEN = 'renewal-test';
  t.after(() => { if (previousToken === undefined) delete process.env.HOLLOW_VALLEY_API_TOKEN; else process.env.HOLLOW_VALLEY_API_TOKEN = previousToken; });
  app.use('/memberships', require('../server/routes/supporterInternal'));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const lookup = async () => {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/memberships`, { method: 'POST',
      headers: { Authorization: 'Bearer renewal-test', 'Content-Type': 'application/json' },
      body: JSON.stringify({ steamIds: ['76561198000000042'] }) });
    assert.equal(res.status, 200);
    return (await res.json()).memberships[0];
  };
  assert.equal((await lookup()).entitled, true);
  db.prepare("UPDATE supporter_subscriptions SET renews_at='2020-01-01T00:00:00Z'").run();
  assert.equal((await lookup()).entitled, false);
});
