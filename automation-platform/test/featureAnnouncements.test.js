const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';
process.env.HERBYBOT_AUTOMATION_TOKEN = 'test-only-herbybot-token';
const announcements = require('../src/services/featureAnnouncementService');
const store = require('../src/services/automationStore');
const outbox = require('../src/services/herbyBotOutboxService');

const requestId = '2fc953fe-2b8b-47bc-92eb-8f929d2998a3';

test('verified growth announcement queues to the permitted Discord destinations', () => {
  const first = announcements.queueVerifiedAnnouncement({
    kind: 'growth', multiplier: 3, channels: ['announcement', 'progress'],
    requestId, verified: true, confirm: 'ANNOUNCE VERIFIED',
  });
  assert.equal(first.queued, true);
  assert.equal(first.deliveryConfirmed, false);
  assert.equal(first.receipts.length, 2);
  assert.match(first.message, /3×/);
  assert.deepEqual(first.receipts.map((r) => r.destination), ['announcement', 'progress']);
  assert.deepEqual(first.receipts.map((r) => r.state), ['pending', 'pending']);

  const repeat = announcements.queueVerifiedAnnouncement({
    kind: 'growth', multiplier: 3, channels: ['announcement', 'progress'],
    requestId, verified: true, confirm: 'ANNOUNCE VERIFIED',
  });
  assert.deepEqual(repeat.receipts, first.receipts, 'retry must return existing outbox IDs');
});

test('feature publishing rejects unauthorized destinations and unverified changes', () => {
  const base = { kind: 'growth', multiplier: 3, channels: ['announcement'],
    requestId: 'ef121501-a67e-46e0-b175-c2f19fd64363', verified: true,
    confirm: 'ANNOUNCE VERIFIED' };
  assert.throws(() => announcements.validate({ ...base, channels: ['alert'] }), /supported Discord/);
  assert.throws(() => announcements.validate({ ...base, channels: ['announcement', 'announcement'] }), /supported Discord/);
  assert.throws(() => announcements.validate({ ...base, verified: false }), /Confirm the change/);
  assert.throws(() => announcements.validate({ ...base, multiplier: 30 }), /Growth multiplier/);
  assert.throws(() => announcements.validate({ ...base, requestId: 'bad' }), /request ID/);
});

test('request ID cannot be reused to replace an already queued message', () => {
  assert.throws(() => announcements.queueVerifiedAnnouncement({
    kind: 'growth', multiplier: 5, channels: ['announcement'],
    requestId, verified: true, confirm: 'ANNOUNCE VERIFIED',
  }), /already used for different content/);
});

test('custom event announcements are bounded and refuse missing HerbyBot bridge', () => {
  const payload = {
    kind: 'custom', message: 'Food event is now running!', channels: ['progress'],
    requestId: '01605d6e-b7e7-43ec-9ab1-6f78e0e7694e',
    verified: true, confirm: 'ANNOUNCE VERIFIED',
  };
  const event = announcements.queueVerifiedAnnouncement(payload);
  assert.equal(event.message, payload.message);
  assert.deepEqual(event.receipts.map((r) => r.destination), ['progress']);
  assert.throws(() => announcements.validate({ ...payload, message: String.fromCharCode(0) }), /announcement must/);
  const prior = process.env.HERBYBOT_AUTOMATION_TOKEN;
  delete process.env.HERBYBOT_AUTOMATION_TOKEN;
  try {
    assert.throws(() => announcements.queueVerifiedAnnouncement(payload), /HerbyBot is not configured/);
  } finally {
    process.env.HERBYBOT_AUTOMATION_TOKEN = prior;
  }
});

test('changed channels/content are rejected before any new destination is queued', () => {
  const id = '71111111-1111-4111-8111-111111111111';
  const base = { kind: 'custom', message: 'Event activated.', channels: ['announcement'], requestId: id, verified: true, confirm: 'ANNOUNCE VERIFIED' };
  announcements.queueVerifiedAnnouncement(base);
  const before = store.listOutboxEvents({}).length;
  assert.throws(() => announcements.queueVerifiedAnnouncement({ ...base, message: 'Event stopped.', channels: ['progress', 'announcement'] }), /different content/);
  assert.equal(store.listOutboxEvents({}).length, before);
  assert.throws(() => announcements.queueVerifiedAnnouncement({ ...base, channels: ['progress'] }), /different content/);
  assert.equal(store.listOutboxEvents({}).length, before);
});

test('legacy receipts and interrupted queue operations are not blindly replayed', () => {
  const id = '72222222-2222-4222-8222-222222222222';
  const base = { kind: 'custom', message: 'Legacy notice.', channels: ['announcement'], requestId: id, verified: true, confirm: 'ANNOUNCE VERIFIED' };
  outbox.queueMessage({ destination: 'announcement', message: base.message, nonce: 'hv-feature-' + id.replace(/-/g,'') + '-announcement' });
  const before = store.listOutboxEvents({}).length;
  assert.throws(() => announcements.queueVerifiedAnnouncement({ ...base, channels: ['progress', 'announcement'] }), /different content/);
  assert.equal(store.listOutboxEvents({}).length, before);
  assert.throws(() => announcements.queueVerifiedAnnouncement({ ...base, channels: ['progress', 'announcement'] }), /different content/);
  assert.equal(store.listOutboxEvents({}).length, before);
});

test('partial queue failure preserves its uncertain receipt and cannot replay', t => {
  const original = outbox.queueMessage;
  let calls = 0;
  outbox.queueMessage = payload => {
    calls++;
    if (calls === 2) throw new Error('simulated database interruption');
    return original(payload);
  };
  t.after(() => { outbox.queueMessage = original; });
  const input = { kind: 'custom', message: 'Verified event stopped.', channels: ['announcement', 'progress'], requestId: '73333333-3333-4333-8333-333333333333', verified: true, confirm: 'ANNOUNCE VERIFIED' };
  assert.throws(() => announcements.queueVerifiedAnnouncement(input), /interruption/);
  const count = store.listOutboxEvents({}).length;
  assert.throws(() => announcements.queueVerifiedAnnouncement(input), /uncertain queue result/);
  assert.equal(store.listOutboxEvents({}).length, count);
  assert.equal(calls, 2);
});

test('verified global growth notice can ping only the selected announcement-channel audience', () => {
  const id = '9f0d9cea-9a7d-4b17-811e-985531aa0d13';
  const input = {
    kind: 'growth', multiplier: 3, channels: ['announcement', 'progress'],
    pingMode: 'community', requestId: id, verified: true, confirm: 'ANNOUNCE VERIFIED',
  };
  const before = store.listOutboxEvents({}).length;
  const result = announcements.queueVerifiedAnnouncement(input);
  assert.equal(result.queued, true);
  assert.equal(result.pingMode, 'community');
  assert.equal(result.receipts.length, 2);
  const out = store.listOutboxEvents({ limit: 500 }).filter(row => row.nonce.includes(id.replace(/-/g, '')));
  assert.equal(out.length, 2);
  assert.ok(out.some(row => row.destination === 'announcement' &&
    row.nonce.endsWith('-announcement-ping-community')));
  assert.ok(out.some(row => row.destination === 'progress' && row.nonce.endsWith('-progress')));
  const retry = announcements.queueVerifiedAnnouncement(input);
  assert.deepEqual(retry.receipts, result.receipts);
  assert.equal(store.listOutboxEvents({}).length, before + 2);
  assert.throws(() => announcements.queueVerifiedAnnouncement({ ...input, pingMode: 'everyone' }), /different content/);
  assert.equal(store.listOutboxEvents({}).length, before + 2);
});

test('growth ping cannot be forged by custom notices, invalid modes or progress-only publication', () => {
  const input = {
    kind: 'growth', multiplier: 2, channels: ['announcement'],
    requestId: '0dc9be11-6b17-4ce2-b496-53e417d23b31',
    verified: true, confirm: 'ANNOUNCE VERIFIED',
  };
  assert.throws(() => announcements.validate({ ...input, pingMode: '@everyone' }), /Choose no ping/);
  assert.throws(() => announcements.validate({ ...input, pingMode: 'everyone', verified: false }), /Confirm the change/);
  assert.throws(() => announcements.validate({ ...input, pingMode: 'everyone', channels: ['progress'] }), /require a verified growth/);
  assert.throws(() => announcements.validate({ ...input, kind: 'custom', message: 'Event start', pingMode: 'community' }), /require a verified growth/);
  assert.equal(announcements.validate(input).pingMode, 'none');
});

test('older silent growth notices cannot be replayed as mass mentions', () => {
  const id = '16d43e9b-5838-4796-8027-478bd0191d78';
  const original = {
    kind: 'growth', multiplier: 2, channels: ['announcement'], requestId: id,
    verified: true, confirm: 'ANNOUNCE VERIFIED',
  };
  const first = announcements.queueVerifiedAnnouncement(original);
  assert.equal(first.pingMode, 'none');
  const count = store.listOutboxEvents({}).length;
  assert.throws(() => announcements.queueVerifiedAnnouncement({ ...original, pingMode: 'everyone' }), /different content/);
  assert.equal(store.listOutboxEvents({}).length, count);
  const silentRetry = announcements.queueVerifiedAnnouncement({ ...original, pingMode: 'none' });
  assert.deepEqual(silentRetry.receipts, first.receipts);
  assert.equal(store.listOutboxEvents({}).length, count);
});

test('unreserved legacy receipt cannot be converted to another ping on retry', () => {
  const id = '3a433350-2835-481c-969b-b1874137ad31';
  const sample = {
    kind: 'growth', multiplier: 2, channels: ['announcement'], requestId: id,
    verified: true, confirm: 'ANNOUNCE VERIFIED',
  };
  const msg = announcements.validate(sample).message;
  outbox.queueMessage({
    destination: 'announcement', message: msg,
    nonce: 'hv-feature-' + id.replace(/-/g, '') + '-announcement',
  });
  const count = store.listOutboxEvents({}).length;
  assert.throws(() => announcements.queueVerifiedAnnouncement({ ...sample, pingMode: 'everyone' }), /different content/);
  assert.equal(store.listOutboxEvents({}).length, count);
});
