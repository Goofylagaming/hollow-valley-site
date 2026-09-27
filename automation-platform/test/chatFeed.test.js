const test = require('node:test');
const assert = require('node:assert/strict');
const chat = require('../src/services/chatFeedService');
const store = require('../src/services/automationStore');

test('chat ingestion deduplicates, preserves messages and mirrors lag reports only', () => {
  const oldMode = process.env.GAME_CHAT_DISCORD_MODE;
  const oldToken = process.env.HERBYBOT_AUTOMATION_TOKEN;
  process.env.GAME_CHAT_DISCORD_MODE = 'lag';
  process.env.HERBYBOT_AUTOMATION_TOKEN = 'test-token';
  const suffix = Date.now();
  try {
    const messages = [
      { id: `chat-${suffix}-1`, name: 'Player One', steamId: '76561198449777255', message: 'anyone lagging?', channel: 'Global', at: new Date().toISOString() },
      { id: `chat-${suffix}-2`, name: 'Player Two', message: 'hello', channel: 'Spatial', at: new Date().toISOString() },
    ];
    assert.equal(chat.ingest(messages).accepted, 2);
    assert.equal(chat.ingest(messages).accepted, 0);
    assert.equal(chat.list().messages.filter((entry) => entry.id.startsWith(`chat-${suffix}`)).length, 2);
    assert.deepEqual(chat.list().messages.filter((entry) => entry.id.startsWith(`chat-${suffix}`)).map((entry) => entry.channel), ['global', 'local']);
    assert.equal(chat.list().messages.find((entry) => entry.id === `chat-${suffix}-1`).steamId, '76561198449777255');
    assert.equal(store.listOutboxEvents({ limit: 100 }).filter((entry) => entry.nonce === `gamechat:chat-${suffix}-1`).length, 1);
    assert.equal(store.listOutboxEvents({ limit: 100 }).filter((entry) => entry.nonce === `gamechat:chat-${suffix}-2`).length, 0);
  } finally {
    if (oldMode === undefined) delete process.env.GAME_CHAT_DISCORD_MODE;
    else process.env.GAME_CHAT_DISCORD_MODE = oldMode;
    if (oldToken === undefined) delete process.env.HERBYBOT_AUTOMATION_TOKEN;
    else process.env.HERBYBOT_AUTOMATION_TOKEN = oldToken;
  }
});

test('all-chat mode mirrors ordinary messages and rejects malformed Steam IDs', () => {
  const oldMode = process.env.GAME_CHAT_DISCORD_MODE;
  const oldToken = process.env.HERBYBOT_AUTOMATION_TOKEN;
  process.env.GAME_CHAT_DISCORD_MODE = 'all';
  process.env.HERBYBOT_AUTOMATION_TOKEN = 'test-token';
  const id = `chat-all-${Date.now()}`;
  try {
    assert.throws(() => chat.ingest([{ id: `${id}-bad`, name: 'Player', steamId: 'invalid', message: 'hello', channel: 'local', at: new Date().toISOString() }]), /Invalid chat message/);
    assert.equal(chat.ingest([{ id, name: 'Player', steamId: '76561198038977506', message: 'hello', channel: 'local', at: new Date().toISOString() }]).accepted, 1);
    assert.equal(store.listOutboxEvents({ limit: 100 }).filter((entry) => entry.nonce === `gamechat:${id}`).length, 1);
  } finally {
    if (oldMode === undefined) delete process.env.GAME_CHAT_DISCORD_MODE;
    else process.env.GAME_CHAT_DISCORD_MODE = oldMode;
    if (oldToken === undefined) delete process.env.HERBYBOT_AUTOMATION_TOKEN;
    else process.env.HERBYBOT_AUTOMATION_TOKEN = oldToken;
  }
});
