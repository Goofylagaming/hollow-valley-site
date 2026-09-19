const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STAFF_ACTION_DEFINITIONS,
  interactionNonce,
  handleStaffActionCommand,
} = require('../integration/herbyBotStaffActions');

function options(values) {
  return {
    getString(name) { return values[name] ?? null; },
    getInteger(name) { return values[name] ?? null; },
  };
}

test('staff action commands define announce and schedule as Manage Guild commands', () => {
  assert.deepEqual(STAFF_ACTION_DEFINITIONS.map((item) => item.name), ['announce', 'schedule']);
  assert.ok(STAFF_ACTION_DEFINITIONS.every((item) => item.default_member_permissions === '32'));
});

test('interaction nonce requires a Discord-style numeric interaction ID', () => {
  assert.equal(interactionNonce({ id: '123456789012345678' }), '123456789012345678');
  assert.throws(() => interactionNonce({ id: 'bad-id' }), /interaction ID/i);
});

test('/announce queues once using interaction-derived nonce', async () => {
  const calls = [];
  const api = {
    async queueAnnouncement(message, nonce) {
      calls.push({ message, nonce });
      return { event: { id: 'event-1' } };
    },
  };
  const payload = await handleStaffActionCommand({
    id: '123456789012345678',
    commandName: 'announce',
    options: options({ message: 'Server restart complete.' }),
  }, api);

  assert.deepEqual(calls, [{
    message: 'Server restart complete.',
    nonce: 'slash:123456789012345678',
  }]);
  assert.equal(payload.ephemeral, true);
  assert.match(payload.content, /queued/i);
});

test('/schedule derives an absolute time from the interaction timestamp', async () => {
  const calls = [];
  const api = {
    async scheduleAnnouncement(input) {
      calls.push(input);
      return { job: { id: 'herbybot:123456789012345679' } };
    },
  };
  const payload = await handleStaffActionCommand({
    id: '123456789012345679',
    createdTimestamp: Date.parse('2026-09-18T00:00:00.000Z'),
    commandName: 'schedule',
    options: options({
      message: 'Scheduled update',
      minutes: 30,
      repeat: 'daily',
    }),
  }, api);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].runAt, '2026-09-18T00:30:00.000Z');
  assert.equal(calls[0].recurrence, 'daily');
  assert.equal(calls[0].nonce, '123456789012345679');
  assert.equal(payload.ephemeral, true);
  assert.match(payload.embeds[0].description, /<t:/);
});
