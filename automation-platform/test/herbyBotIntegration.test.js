const test = require('node:test');
const assert = require('node:assert/strict');

const { createHerbyBotIntegration } = require('../integration/herbyBotIntegration');

test('combined HerbyBot integration reuses one client for commands and outbox delivery', async () => {
  let loginCalls = 0;
  let interactionHandler = null;
  let registered = null;
  let sent = 0;
  const client = {
    isReady: () => true,
    login() { loginCalls += 1; },
    on(event, handler) {
      if (event === 'interactionCreate') interactionHandler = handler;
    },
    application: {
      commands: {
        async set(commands) { registered = commands; },
      },
    },
    guilds: {
      async fetch() { throw new Error('guild registration should not be used'); },
    },
    channels: {
      async fetch() {
        return {
          isTextBased: () => true,
          async send() { sent += 1; return { id: 'discord-message' }; },
        };
      },
    },
  };

  const calls = [];
  const api = {
    async getStatus() {
      return {
        bridge: { configured: true, outbox: {} },
        server: { online: true, configured: true, playerCount: 1, maxPlayers: 100 },
        automation: {
          service: 'hollow-valley-automation-platform',
          integrations: { rcon: true, commandBridge: false, herbyBot: true },
          modules: { bodyDrop: true, dinoStorage: true, discordAutomation: true },
        },
      };
    },
    async claimMessages() {
      calls.push('claim');
      return { events: [] };
    },
    async acknowledgeMessage(id) { calls.push(`ack:${id}`); },
    async failMessage(id) { calls.push(`fail:${id}`); },
  };

  const previousGuild = process.env.DISCORD_GUILD_ID;
  delete process.env.DISCORD_GUILD_ID;
  try {
    const integration = createHerbyBotIntegration({ client, api });
    assert.equal(typeof interactionHandler, 'function');
    assert.equal(loginCalls, 0);

    const result = await integration.onReady();
    assert.equal(result.started, true);
    assert.equal(result.bridge, true);
    assert.equal(result.commands.scope, 'global');
    assert.deepEqual(registered.map((item) => item.name), ['server', 'automation', 'players', 'queue', 'announce', 'schedule']);
    assert.equal(loginCalls, 0);

    const repeated = await integration.onReady();
    assert.deepEqual(repeated, { started: false, reason: 'already-started' });

    const poll = await integration.pollOnce();
    assert.equal(poll.skipped, false);
    assert.equal(poll.checked, 0);
    assert.ok(calls.includes('claim'));
    assert.equal(sent, 0);

    integration.stop();
  } finally {
    if (previousGuild === undefined) delete process.env.DISCORD_GUILD_ID;
    else process.env.DISCORD_GUILD_ID = previousGuild;
  }
});
