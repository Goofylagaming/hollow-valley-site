const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

process.env.AUTOMATION_DB_PATH = path.join(os.tmpdir(), `hollow-valley-herbybot-${randomUUID()}.sqlite`);
process.env.HERBYBOT_AUTOMATION_TOKEN = 'herbybot-test-secret';
process.env.HERBYBOT_OUTBOX_MAX_ATTEMPTS = '2';

const outbox = require('../src/services/herbyBotOutboxService');
const store = require('../src/services/automationStore');

test('HerbyBot outbox deduplicates messages by nonce', () => {
  const first = outbox.queueAnnouncement('Hello Hollow Valley', { nonce: 'announcement:test:001' });
  const second = outbox.queueAnnouncement('Hello Hollow Valley', { nonce: 'announcement:test:001' });

  assert.equal(first.id, second.id);
  assert.equal(first.destination, 'announcement');
  assert.equal(store.getOutboxSummary().total, 1);
});

test('claimed HerbyBot messages are leased and not immediately double-claimed', () => {
  outbox.queueAlert('Server test alert', { nonce: 'alert:test:lease' });

  const claimed = outbox.claimMessages({ limit: 10, leaseSeconds: 60 });
  assert.ok(claimed.some((event) => event.nonce === 'alert:test:lease'));
  const event = claimed.find((item) => item.nonce === 'alert:test:lease');
  assert.equal(event.status, 'claimed');
  assert.equal(event.attempts, 1);
  assert.ok(event.lease_until);

  const second = outbox.claimMessages({ limit: 10, leaseSeconds: 60 });
  assert.equal(second.some((item) => item.id === event.id), false);
});

test('acknowledgement is idempotent and marks delivery complete', () => {
  const event = outbox.queueAnnouncement('Delivered message', { nonce: 'announcement:test:ack' });
  const claimed = outbox.claimMessages({ limit: 10, leaseSeconds: 60 }).find((item) => item.id === event.id);
  assert.ok(claimed);

  const delivered = outbox.acknowledgeMessage(event.id);
  assert.equal(delivered.status, 'delivered');
  assert.ok(delivered.delivered_at);

  const repeated = outbox.acknowledgeMessage(event.id);
  assert.equal(repeated.status, 'delivered');
  assert.equal(repeated.id, delivered.id);
});

test('delivery failures return to pending until max attempts then become terminal', () => {
  const event = outbox.queueAlert('Retry me', { nonce: 'alert:test:retry' });

  const firstClaim = outbox.claimMessages({ limit: 10, leaseSeconds: 60 }).find((item) => item.id === event.id);
  assert.equal(firstClaim.attempts, 1);
  const firstFailure = outbox.failMessage(event.id, 'first failure');
  assert.equal(firstFailure.status, 'pending');

  const secondClaim = outbox.claimMessages({ limit: 10, leaseSeconds: 60 }).find((item) => item.id === event.id);
  assert.equal(secondClaim.attempts, 2);
  const secondFailure = outbox.failMessage(event.id, 'second failure');
  assert.equal(secondFailure.status, 'failed');
  assert.match(secondFailure.last_error, /second failure/);
});
