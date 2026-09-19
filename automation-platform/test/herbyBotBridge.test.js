const test = require('node:test');
const assert = require('node:assert/strict');

const { deliverEvent, createHerbyBotAutomationBridge } = require('../integration/herbyBotBridge');

test('HerbyBot bridge delivers through the existing ready Discord client with nonce dedupe', async () => {
  const sent = [];
  let loginCalls = 0;
  const client = {
    isReady: () => true,
    login: async () => { loginCalls += 1; },
    channels: {
      fetch: async (id) => ({
        isTextBased: () => true,
        send: async (payload) => {
          sent.push({ id, payload });
          return { id: 'discord-message-1' };
        },
      }),
    },
  };

  const previous = process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID;
  process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID = '123456789012345678';
  try {
    const result = await deliverEvent(client, {
      id: 'event-1',
      destination: 'announcement',
      message: 'Hello from automation',
      nonce: 'announcement:event:001',
    });

    assert.equal(loginCalls, 0);
    assert.equal(result.channelId, '123456789012345678');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].payload.content, 'Hello from automation');
    assert.equal(sent[0].payload.nonce, 'announcement:event:001');
    assert.equal(sent[0].payload.enforceNonce, true);
    assert.deepEqual(sent[0].payload.allowedMentions, { parse: [] });
  } finally {
    if (previous === undefined) delete process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID;
    else process.env.DISCORD_ANNOUNCEMENT_CHANNEL_ID = previous;
  }
});

test('HerbyBot bridge polls, sends and acknowledges without creating another client', async () => {
  const calls = [];
  const client = {
    isReady: () => true,
    channels: {
      fetch: async () => ({
        isTextBased: () => true,
        send: async () => ({ id: 'discord-message-2' }),
      }),
    },
  };
  const api = {
    async claimMessages() {
      calls.push('claim');
      return {
        events: [{
          id: 'event-2',
          destination: 'alert',
          message: 'Server alert',
          nonce: 'alert:event:002',
        }],
      };
    },
    async acknowledgeMessage(id) { calls.push(`ack:${id}`); },
    async failMessage(id) { calls.push(`fail:${id}`); },
  };

  const previous = process.env.DISCORD_ALERT_CHANNEL_ID;
  process.env.DISCORD_ALERT_CHANNEL_ID = '987654321098765432';
  try {
    const bridge = createHerbyBotAutomationBridge({ client, api });
    const result = await bridge.pollOnce();

    assert.equal(result.checked, 1);
    assert.equal(result.delivered, 1);
    assert.equal(result.failed, 0);
    assert.deepEqual(calls, ['claim', 'ack:event-2']);
  } finally {
    if (previous === undefined) delete process.env.DISCORD_ALERT_CHANNEL_ID;
    else process.env.DISCORD_ALERT_CHANNEL_ID = previous;
  }
});
