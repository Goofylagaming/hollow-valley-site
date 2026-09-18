const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STAFF_COMMAND_DEFINITIONS,
  escapeDiscordText,
  growthLabel,
  playersReply,
  queueReply,
  handleStaffOverviewCommand,
} = require('../integration/herbyBotStaffCommands');

const overview = {
  server: {
    online: true,
    configured: true,
    playerCount: 3,
    maxPlayers: 100,
    players: [
      { name: 'Alpha', species: 'Carnotaurus', growth: 0.4 },
      { name: '@everyone', species: 'Omniraptor', growth: 0.6 },
      { name: 'Third', species: null, growth: null },
    ],
  },
  requests: {
    total: 9,
    pending: 2,
    confirmed: 5,
    failed: 1,
    unknown: 1,
    bodyDrop: 4,
    dinoStorage: 5,
  },
  outbox: {
    pending: 1,
    claimed: 1,
    delivered: 8,
    failed: 0,
  },
};

test('staff command definitions include players and queue with Manage Guild permission', () => {
  assert.deepEqual(STAFF_COMMAND_DEFINITIONS.map((item) => item.name), ['players', 'queue']);
  assert.ok(STAFF_COMMAND_DEFINITIONS.every((item) => item.default_member_permissions === '32'));
});

test('player overview is ephemeral and excludes sensitive fields', () => {
  const payload = playersReply(overview, 1);
  assert.equal(payload.ephemeral, true);
  const serialized = JSON.stringify(payload);
  assert.match(serialized, /Carnotaurus/);
  assert.match(serialized, /40% growth/);
  assert.equal(serialized.includes('steamId'), false);
  assert.equal(serialized.includes('location'), false);
  assert.equal(serialized.includes('health'), false);
});

test('player names cannot create Discord mentions', () => {
  assert.equal(escapeDiscordText('@everyone'), '@\u200beveryone');
  assert.equal(growthLabel(0.6), '60% growth');
  assert.equal(growthLabel(42), '42% growth');
});

test('queue overview summarizes game requests and HerbyBot delivery', () => {
  const payload = queueReply(overview);
  assert.equal(payload.ephemeral, true);
  const serialized = JSON.stringify(payload);
  assert.match(serialized, /Pending: 2/);
  assert.match(serialized, /DinoStorage: 5/);
  assert.match(serialized, /Delivered: 8/);
});

test('staff overview handler reads requested players page', async () => {
  let calls = 0;
  const api = { async getStaffOverview() { calls += 1; return overview; } };
  const interaction = {
    commandName: 'players',
    options: { getInteger(name) { assert.equal(name, 'page'); return 2; } },
  };

  const payload = await handleStaffOverviewCommand(interaction, api);
  assert.equal(calls, 1);
  assert.equal(payload.ephemeral, true);
  assert.match(payload.embeds[0].footer.text, /Page 1\/1/);
});
