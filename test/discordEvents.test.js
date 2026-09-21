const test = require("node:test");
const assert = require("node:assert/strict");

const events = require("../server/services/discordEvents");

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

test.beforeEach(() => events._test.resetForTests());

test("Discord events configuration accepts the shared bot token and guild ID", () => {
  assert.equal(events.isConfigured({
    DISCORD_BOT_TOKEN: "token",
    DISCORD_GUILD_ID: "123456789012345678",
  }), true);
  assert.equal(events.isConfigured({}), false);
});

test("Discord scheduled events are normalized and sorted for the website", async () => {
  const calls = [];
  const env = {
    DISCORD_BOT_TOKEN: "token",
    DISCORD_GUILD_ID: "123456789012345678",
  };
  const fetchImpl = async (url) => {
    calls.push(url);
    return response(200, [
      {
        id: "2",
        name: "Later Event",
        scheduled_start_time: "2026-09-25T10:00:00.000Z",
        scheduled_end_time: null,
        status: 1,
        entity_type: 3,
        entity_metadata: { location: "Hollow Valley" },
        user_count: 8,
      },
      {
        id: "1",
        name: "Earlier Event",
        description: "Community migration",
        scheduled_start_time: "2026-09-24T09:00:00.000Z",
        scheduled_end_time: "2026-09-24T10:00:00.000Z",
        status: 2,
        entity_type: 3,
        entity_metadata: { location: "South Plains" },
        user_count: 12,
      },
      {
        id: "3",
        name: "Completed Event",
        scheduled_start_time: "2026-09-20T09:00:00.000Z",
        status: 3,
      },
    ]);
  };

  const result = await events.listScheduledEvents({
    env,
    fetchImpl,
    now: Date.parse("2026-09-21T00:00:00.000Z"),
  });

  assert.equal(result.configured, true);
  assert.equal(result.events.length, 2);
  assert.equal(result.events[0].id, "1");
  assert.equal(result.events[0].title, "Earlier Event");
  assert.equal(result.events[0].attendees, 12);
  assert.equal(result.events[0].location, "South Plains");
  assert.equal(
    result.events[0].url,
    "https://discord.com/events/123456789012345678/1"
  );
  assert.equal(calls.length, 1);
});

test("Discord events use cache until HerbyBot invalidates it", async () => {
  const env = {
    DISCORD_BOT_TOKEN: "token",
    DISCORD_GUILD_ID: "123456789012345678",
  };
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return response(200, [{
      id: String(calls),
      name: `Event ${calls}`,
      scheduled_start_time: "2026-09-25T10:00:00.000Z",
      status: 1,
    }]);
  };

  const first = await events.listScheduledEvents({ env, fetchImpl, now: 100000 });
  const cached = await events.listScheduledEvents({ env, fetchImpl, now: 100500 });
  assert.equal(calls, 1);
  assert.equal(first.events[0].id, cached.events[0].id);

  events.invalidateCache("updated:1");
  const refreshed = await events.listScheduledEvents({ env, fetchImpl, now: 101000 });
  assert.equal(calls, 2);
  assert.equal(refreshed.events[0].id, "2");

  const state = events.getSyncState();
  assert.equal(state.lastInvalidationReason, "updated:1");
  assert.ok(state.lastInvalidatedAt);
});

test("Discord guild can be resolved from the configured status channel", async () => {
  const env = {
    DISCORD_BOT_TOKEN: "token",
    DISCORD_STATUS_CHANNEL_ID: "999999999999999999",
  };
  const fetchImpl = async (url) => {
    assert.match(url, /channels\/999999999999999999$/);
    return response(200, { guild_id: "123456789012345678" });
  };

  const guildId = await events.getGuildId({ env, fetchImpl });
  assert.equal(guildId, "123456789012345678");
});
