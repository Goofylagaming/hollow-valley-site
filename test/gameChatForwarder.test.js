const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('one invalid log entry does not block later chat', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hollow-chat-'));
  const file = path.join(dir, 'TheIsle.log');
  const makeLine = (name, message) => `[2026.09.27-01.01.38:062][873]LogTheIsleChatData: [2026.09.27-11.01.38] [Spatial] [GROUP-1412674960] ${name} [76561198038977506]: ${message}`;
  fs.writeFileSync(file, `${makeLine('Bad', 'bad')}\n${makeLine('Good', 'hello')}\n`);
  const previous = {
    path: process.env.CHAT_LOG_PATH,
    url: process.env.CHAT_FEED_URL,
    token: process.env.PRESENCE_FEED_TOKEN,
    fetch: global.fetch,
    error: console.error,
  };
  process.env.CHAT_LOG_PATH = file;
  process.env.CHAT_FEED_URL = 'https://automation.example/api/chat-feed/messages';
  process.env.PRESENCE_FEED_TOKEN = 'test-token';
  const attempts = [];
  global.fetch = async (_url, options) => {
    const names = JSON.parse(options.body).messages.map((entry) => entry.name);
    attempts.push(names);
    return names.includes('Bad')
      ? { ok: false, status: 400, text: async () => '{"error":"Invalid chat message."}' }
      : { ok: true, status: 201 };
  };
  console.error = () => {};
  try {
    const { poll } = require('../scripts/game-chat-forwarder');
    await poll();
    await poll();
    await poll();
    assert.deepEqual(attempts, [['Bad', 'Good'], ['Bad'], ['Good']]);
  } finally {
    global.fetch = previous.fetch;
    console.error = previous.error;
    for (const [key, value] of Object.entries({ CHAT_LOG_PATH: previous.path, CHAT_FEED_URL: previous.url, PRESENCE_FEED_TOKEN: previous.token })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
