const test = require('node:test');
const assert = require('node:assert/strict');

const {
  TERRITORY_COMMAND,
  territoryReply,
  createTerritoryCommandHandler,
  registerTerritoryCommand,
} = require('../integration/herbyBotTerritoryCommand');

function interaction() {
  const replies = [];
  return {
    commandName: 'territory',
    isChatInputCommand: () => true,
    async deferReply(payload) { this.deferred = true; this.deferredPayload = payload; },
    async reply(payload) { replies.push(payload); this.replied = true; },
    async editReply(payload) { replies.push(payload); },
    replies,
  };
}

const state = {
  event: {
    id: 42,
    territory_name: 'South Plains',
    owner_name: 'Admin',
    challenger_name: 'Ridge Runners',
    owner_control: 62,
    challenger_control: 38,
    status: 'live',
    starts_at: '2026-10-05T07:00:00.000Z',
    ends_at: '2026-10-05T12:00:00.000Z',
  },
  attack: {
    attacker_name: 'Ridge Runners',
    status: 'active',
  },
  presence: {
    eligibleClaimCount: 3,
    claimCount: 4,
    playerCount: 9,
  },
};

test('Territory command definition is public and read-only', () => {
  assert.equal(TERRITORY_COMMAND.name, 'territory');
  assert.equal(TERRITORY_COMMAND.default_member_permissions, undefined);
  assert.match(TERRITORY_COMMAND.description, /status/i);
});

test('/territory reply summarizes live war state without player identities', () => {
  const payload = territoryReply(state, {
    TERRITORY_WARS_MAP_URL: 'https://preview.example.test/groups/territory-wars/',
  });
  const serialized = JSON.stringify(payload);
  assert.match(serialized, /South Plains/);
  assert.match(serialized, /Admin: 62%/);
  assert.match(serialized, /Ridge Runners: 38%/);
  assert.match(serialized, /3 eligible/);
  assert.match(serialized, /9 players/);
  assert.match(serialized, /preview\.example\.test/);
  assert.equal(serialized.includes('steamId'), false);
});

test('/territory handler reads current state and replies publicly', async () => {
  let calls = 0;
  const api = {
    async getTerritoryWarsState() {
      calls += 1;
      return state;
    },
  };
  const i = interaction();
  const handler = createTerritoryCommandHandler({ api });

  assert.equal(await handler(i), true);
  assert.equal(calls, 1);
  assert.deepEqual(i.deferredPayload, { ephemeral: false });
  assert.equal(i.replies.length, 1);
  assert.match(JSON.stringify(i.replies[0]), /Territory War/);
});

test('Territory command registration creates only the dedicated guild command', async () => {
  const previous = process.env.DISCORD_GUILD_ID;
  process.env.DISCORD_GUILD_ID = '123456789012345678';
  const created = [];
  const manager = {
    async fetch() { return new Map(); },
    async create(definition) { created.push(definition); },
  };
  const client = {
    application: { commands: {} },
    guilds: {
      async fetch(id) {
        assert.equal(id, '123456789012345678');
        return { commands: manager };
      },
    },
  };

  try {
    const result = await registerTerritoryCommand(client);
    assert.equal(result.scope, 'guild');
    assert.equal(result.created, true);
    assert.equal(created.length, 1);
    assert.equal(created[0].name, 'territory');
  } finally {
    if (previous === undefined) delete process.env.DISCORD_GUILD_ID;
    else process.env.DISCORD_GUILD_ID = previous;
  }
});
