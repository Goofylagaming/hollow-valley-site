const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTOMATION_DB_PATH = ':memory:';
process.env.HERBYBOT_AUTOMATION_TOKEN = 'test-only-herbybot-token';
const announcements = require('../src/services/featureAnnouncementService');

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
  assert.throws(() => announcements.validate({ ...payload, message: '\\x00' }), /announcement must/);
  const prior = process.env.HERBYBOT_AUTOMATION_TOKEN;
  delete process.env.HERBYBOT_AUTOMATION_TOKEN;
  try {
    assert.throws(() => announcements.queueVerifiedAnnouncement(payload), /HerbyBot is not configured/);
  } finally {
    process.env.HERBYBOT_AUTOMATION_TOKEN = prior;
  }
});
