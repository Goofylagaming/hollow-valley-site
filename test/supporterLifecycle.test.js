const test = require('node:test');
const assert = require('node:assert/strict');
process.env.DB_PATH = ':memory:';
const { db, getSupporterStatus } = require('../server/db');
const { processLifecycle } = require('../server/services/supporterLifecycle');
const { isEntitled, isCoinBonusEligible } = require('../server/services/supporterWebhook');
const { entitlement } = require('../server/services/membershipEntitlements');
const { targetTierForStatus } = require('../server/services/discordMembership');
const env = { STRIPE_SECRET_KEY: 'rk_test_fixture', STRIPE_PRICE_MEMBER: 'price_member', MEMBERSHIP_REWARDS_ENABLED: '1' };
const now = 2000000000000;
let sequence = 0;
function reset() {
  db.exec('DELETE FROM stripe_webhook_events; DELETE FROM supporter_subscriptions; DELETE FROM users;');
  db.prepare('INSERT INTO users(id, username, steam_id, is_admin) VALUES(42, ?, ?, 1)').run('owner', '76561198000000042');
  db.prepare('INSERT INTO users(id, username, steam_id) VALUES(43, ?, ?)').run('other', '76561198000000043');
}
function sub(extra = {}) {
  return { id: 'sub_current', customer: 'cus_owner', livemode: false, status: 'active', cancel_at_period_end: false,
    metadata: { user_id: '42', steam_id: '76561198000000042', tier: 'supporter' },
    items: { data: [{ price: { id: 'price_member' }, current_period_end: now / 1000 + 60 }] }, ...extra };
}
function event(type = 'customer.subscription.updated', id = 'sub_current') {
  return { id: `evt_${++sequence}`, type, livemode: false, created: 1,
    data: { object: type.startsWith('invoice.') ? { subscription: id, customer: 'cus_owner' } : { id, customer: 'cus_owner' } } };
}
function options(...subscriptions) {
  return { env, fetchImpl: async url => {
    const value = subscriptions.find(s => url.endsWith('/' + s.id));
    assert.ok(value, 'unexpected subscription lookup');
    return { ok: true, json: async () => value };
  } };
}

test('scheduled cancellation keeps all paid perks to the boundary; existing coin exception remains', async () => {
  reset();
  await processLifecycle(event(), options(sub({ cancel_at_period_end: true })));
  const row = getSupporterStatus(42);
  assert.equal(isEntitled(row, now), true);
  assert.equal(isCoinBonusEligible(row), false);
  assert.equal(entitlement(row, { env, now }).storageBonusSlots, 1);
  assert.equal(targetTierForStatus(row, { env: {}, now }), 'supporter');
  assert.equal(isEntitled(row, now + 60000), false);
  assert.equal(targetTierForStatus(row, { env: {}, now: now + 60000 }), null);
  assert.equal(entitlement(row, { env, now: now + 60000 }).monthlySkinChoices, 0);
});

test('immediate cancellation, delayed invoices and duplicate delivery cannot restore benefits or alter admin', async () => {
  reset();
  await processLifecycle(event(), options(sub()));
  const deletion = event('customer.subscription.deleted');
  await processLifecycle(deletion, options(sub({ status: 'canceled' })));
  const duplicate = await processLifecycle(deletion, options(sub({ status: 'canceled' })));
  assert.equal(duplicate.userId, 42, 'retry must retain target for Discord synchronization');
  assert.equal(duplicate.duplicate, true);
  await processLifecycle(event('invoice.payment_failed'), options(sub({ status: 'canceled' })));
  await processLifecycle(event('invoice.paid'), options(sub({ status: 'canceled' })));
  assert.equal(isEntitled(getSupporterStatus(42), now), false);
  assert.equal(db.prepare('SELECT is_admin FROM users WHERE id=42').get().is_admin, 1);
});

test('failed payment has no grace; recovery and scheduled-cancel reversal restore paid access', async () => {
  reset();
  await processLifecycle(event(), options(sub()));
  await processLifecycle(event('invoice.payment_failed'), options(sub({ status: 'past_due' })));
  assert.equal(isEntitled(getSupporterStatus(42), now), false);
  await processLifecycle(event('invoice.paid'), options(sub()));
  assert.equal(isEntitled(getSupporterStatus(42), now), true);
  await processLifecycle(event(), options(sub({ cancel_at_period_end: true })));
  await processLifecycle(event(), options(sub()));
  assert.equal(getSupporterStatus(42).cancelled_at, null);
});

test('every inactive state is denied even when an old invoice-paid event arrives', async () => {
  for (const status of ['past_due', 'unpaid', 'paused', 'incomplete', 'incomplete_expired', 'canceled', 'trialing']) {
    reset();
    await processLifecycle(event('invoice.paid'), options(sub({ status })));
    assert.equal(isEntitled(getSupporterStatus(42), now), false, status);
    assert.equal(entitlement(getSupporterStatus(42), { env, now }).entitled, false, status);
  }
});

test('new paid subscription replaces canceled one; old failed/deleted events preserve replacement', async () => {
  reset();
  const old = sub({ status: 'canceled' });
  await processLifecycle(event(), options(old));
  const fresh = sub({ id: 'sub_new' });
  await processLifecycle(event('customer.subscription.updated', fresh.id), options(old, fresh));
  assert.equal(getSupporterStatus(42).stripe_subscription_id, fresh.id);
  const result = await processLifecycle(event('invoice.payment_failed'), options(old, fresh));
  assert.equal(result.superseded, true);
  assert.equal(isEntitled(getSupporterStatus(42), now), true);
});

test('conflicting account, Steam and customer mappings fail without recording or changing access', async () => {
  reset();
  await processLifecycle(event(), options(sub()));
  for (const wrong of [sub({ metadata: { user_id: '43', tier: 'supporter' } }),
    sub({ metadata: { user_id: '42', steam_id: '76561198000000043', tier: 'supporter' } }),
    sub({ customer: 'cus_other' })]) {
    const delivery = event();
    await assert.rejects(processLifecycle(delivery, options(wrong)), /mismatch/);
    assert.equal(db.prepare('SELECT 1 FROM stripe_webhook_events WHERE event_id=?').get(delivery.id), undefined);
  }
  assert.equal(getSupporterStatus(43), null);
  assert.equal(isEntitled(getSupporterStatus(42), now), true);
});

test('Stripe outage leaves the delivery retryable and previously paid access untouched', async () => {
  reset();
  await processLifecycle(event(), options(sub()));
  const delivery = event();
  await assert.rejects(processLifecycle(delivery, { env, fetchImpl: async () => ({ ok: false }) }), /unavailable/);
  assert.equal(db.prepare('SELECT 1 FROM stripe_webhook_events WHERE event_id=?').get(delivery.id), undefined);
  assert.equal(isEntitled(getSupporterStatus(42), now), true);
});

test('replaying a processed event reconciles current Stripe state for a missed cancellation', async () => {
  reset();
  const delivery = event();
  await processLifecycle(delivery, options(sub()));
  await processLifecycle(delivery, options(sub({ status: 'canceled' })));
  assert.equal(isEntitled(getSupporterStatus(42), now), false);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stripe_webhook_events').get().n, 1);
});
