const test = require('node:test');
const assert = require('node:assert/strict');

const {
  commandDefinitions,
  serverReply,
  automationReply,
  hasStaffAccess,
  createHerbyBotCommandHandler,
  registerHerbyBotCommands,
  attachHerbyBotCommands,
} = require('../integration/herbyBotCommands');

function interaction(commandName, { staff = false } = {}) {
  const replies = [];
  return {
    commandName,
    isChatInputCommand: () => true,
    memberPermissions: {
      has(permission) {
        if (!staff) return false;
        return ['Administrator', 'ManageGuild', BigInt(8), BigInt(32)].includes(permission);
      },
    },
    async deferReply(payload) { this.deferred = true; this.deferredPayload = payload; },
    async reply(payload) { replies.push(payload); this.replied = true; },
    async editReply(payload) { replies.push(payload); },
    replies,
  };
}

const status = {
  bridge: {
    configured: true,
    outbox: { pending: 2, claimed: 1, failed: 0, delivered: 10 },
  },
  server: {
    online: true,
    configured: true,
    playerCount: 12,
    maxPlayers: 100,
    checkedAt: '2026-09-18T00:00:00.000Z',
  },
  automation: {
    service: 'hollow-valley-automation-platform',
    integrations: { rcon: true, commandBridge: false, herbyBot: true },
    modules: { bodyDrop: true, dinoStorage: true, discordAutomation: true },
  },
};

test('HerbyBot command definitions expose public /server and staff commands', () => {
  const commands = commandDefinitions();
  assert.deepEqual(commands.map((item) => item.name), ['server', 'automation', 'players', 'queue', 'announce', 'schedule']);
  assert.equal(commands[0].default_member_permissions, undefined);
  assert.ok(commands.slice(1).every((item) => item.default_member_permissions === '32'));
});

test('/server response exposes aggregate status only', () => {
  const payload = serverReply(status);
  assert.equal(payload.ephemeral, undefined);
  assert.match(payload.embeds[0].description, /online/i);
  assert.match(payload.embeds[0].fields[0].value, /12\/100/);
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes('steamId'), false);
  assert.equal(serialized.includes('players:['), false);
});

test('/automation response is ephemeral and summarizes bridge health', () => {
  const payload = automationReply(status);
  assert.equal(payload.ephemeral, true);
  const serialized = JSON.stringify(payload);
  assert.match(serialized, /Pending: 2/);
  assert.match(serialized, /CommandBridge: gated/);
  assert.match(serialized, /DinoStorage: built/);
});

test('staff access accepts Manage Guild or Administrator only', () => {
  assert.equal(hasStaffAccess(interaction('automation', { staff: true })), true);
  assert.equal(hasStaffAccess(interaction('automation', { staff: false })), false);
  assert.equal(hasStaffAccess({}), false);
});

test('/server handler reads automation bridge and replies publicly', async () => {
  const callLog = [];
  const api = { async getStatus() { callLog.push('status'); return status; } };
  const handle = createHerbyBotCommandHandler({ api });
  const i = interaction('server');

  assert.equal(await handle(i), true);
  assert.deepEqual(callLog, ['status']);
  assert.equal(i.replies.length, 1);
  assert.equal(i.replies[0].ephemeral, undefined);
  assert.match(i.replies[0].embeds[0].description, /online/i);
});

test('/automation blocks non-staff without contacting automation API', async () => {
  let calls = 0;
  const api = { async getStatus() { calls += 1; return status; } };
  const handle = createHerbyBotCommandHandler({ api });
  const i = interaction('automation', { staff: false });

  assert.equal(await handle(i), true);
  assert.equal(calls, 0);
  assert.equal(i.replies[0].ephemeral, true);
  assert.match(i.replies[0].content, /permission/i);
});

test('/automation gives staff an ephemeral health summary', async () => {
  const api = { async getStatus() { return status; } };
  const handle = createHerbyBotCommandHandler({ api });
  const i = interaction('automation', { staff: true });

  assert.equal(await handle(i), true);
  assert.equal(i.replies[0].ephemeral, true);
  assert.match(JSON.stringify(i.replies[0]), /HerbyBot bridge connected/);
});

test('command registration uses guild scope when DISCORD_GUILD_ID is configured', async () => {
  const previous = process.env.DISCORD_GUILD_ID;
  process.env.DISCORD_GUILD_ID = '123456789012345678';
  let registered = null;
  const client = {
    application: { commands: { set: async () => assert.fail('global registration should not be used') } },
    guilds: {
      async fetch(id) {
        assert.equal(id, '123456789012345678');
        return { commands: { set: async (commands) => { registered = commands; } } };
      },
    },
  };
  try {
    const result = await registerHerbyBotCommands(client);
    assert.equal(result.scope, 'guild');
    assert.equal(result.count, 6);
    assert.equal(registered.length, 6);
  } finally {
    if (previous === undefined) delete process.env.DISCORD_GUILD_ID;
    else process.env.DISCORD_GUILD_ID = previous;
  }
});

test('command attachment reuses existing client and never logs in', async () => {
  let loginCalls = 0;
  const handlers = {};
  const client = {
    on(event, handler) { handlers[event] = handler; },
    login() { loginCalls += 1; },
    application: { commands: { set: async () => {} } },
  };

  const attached = attachHerbyBotCommands({ client, autoRegister: false });
  assert.equal(typeof handlers.interactionCreate, 'function');
  assert.equal(typeof attached.handler, 'function');
  assert.equal(loginCalls, 0);
  assert.deepEqual(await attached.register(), { skipped: true });
});


test('/players blocks non-staff without contacting staff overview API', async () => {
  let calls = 0;
  const api = { async getStaffOverview() { calls += 1; return {}; } };
  const handle = createHerbyBotCommandHandler({ api });
  const i = interaction('players', { staff: false });

  assert.equal(await handle(i), true);
  assert.equal(calls, 0);
  assert.equal(i.replies[0].ephemeral, true);
  assert.match(i.replies[0].content, /permission/i);
});

test('/queue uses deferred ephemeral staff reply', async () => {
  const api = {
    async getStaffOverview() {
      return { server: { online: true, configured: true, players: [] }, requests: {}, outbox: {} };
    },
  };
  const handle = createHerbyBotCommandHandler({ api });
  const i = interaction('queue', { staff: true });

  assert.equal(await handle(i), true);
  assert.deepEqual(i.deferredPayload, { ephemeral: true });
  assert.equal(i.replies[0].ephemeral, true);
  assert.match(JSON.stringify(i.replies[0]), /Hollow Valley Queues/);
});


test('/announce is staff-only before any write API is called', async () => {
  let calls = 0;
  const api = { async queueAnnouncement() { calls += 1; return {}; } };
  const handle = createHerbyBotCommandHandler({ api });
  const i = interaction('announce', { staff: false });
  i.id = '123456789012345678';

  assert.equal(await handle(i), true);
  assert.equal(calls, 0);
  assert.equal(i.replies[0].ephemeral, true);
  assert.match(i.replies[0].content, /permission/i);
});
