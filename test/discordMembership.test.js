const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DB_PATH = ":memory:";

const { db } = require("../server/db");
require("../server/services/supporterWebhook");
const {
  configuration,
  syncDiscordMembershipForUser,
} = require("../server/services/discordMembership");

const env = {
  DISCORD_ROLE_BOT_TOKEN: "test_bot_token",
  DISCORD_GUILD_ID: "1540359454627725382",
};

function reset({ tier = "legend", stripeStatus = "active", discordId = "1546023362642317404" } = {}) {
  db.exec("DELETE FROM supporter_subscriptions; DELETE FROM users;");
  db.prepare("INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?)").run(42, discordId, "discord-test");
  if (tier) {
    db.prepare(
      "INSERT INTO supporter_subscriptions (user_id, tier, stripe_status, auto_renew) VALUES (?, ?, ?, 1)"
    ).run(42, tier, stripeStatus);
  }
}

test("Discord membership role sync is disabled until token and guild are configured", async () => {
  assert.equal(configuration({}), null);
  reset();
  assert.deepEqual(await syncDiscordMembershipForUser(42, { env: {}, fetchImpl: async () => {
    throw new Error("should not fetch");
  }}), { configured: false, changed: false });
});

test("active membership gets exactly its matching Discord role", async () => {
  reset();
  const calls = [];
  const roles = [
    { id: "1", name: "Valley Member" },
    { id: "2", name: "Valley Elite" },
    { id: "3", name: "Valley Legend" },
    { id: "4", name: "Community Member" },
  ];

  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });
    if ((options.method || "GET") === "GET") {
      if (url.endsWith("/roles")) {
        return { ok: true, status: 200, json: async () => roles };
      }
      return { ok: true, status: 200, json: async () => ({ roles: ["1", "2"] }) };
    }
    return { ok: true, status: 204, json: async () => null };
  };

  const result = await syncDiscordMembershipForUser(42, { env, fetchImpl });
  assert.equal(result.tier, "legend");
  assert.equal(result.roleName, "Valley Legend");

  const methods = calls.map((call) => [call.method, call.url]);
  assert.ok(methods.some(([method, url]) => method === "PUT" && url.endsWith("/members/1546023362642317404/roles/3")));
  assert.ok(methods.some(([method, url]) => method === "DELETE" && url.endsWith("/members/1546023362642317404/roles/1")));
  assert.ok(methods.some(([method, url]) => method === "DELETE" && url.endsWith("/members/1546023362642317404/roles/2")));
  assert.ok(!methods.some(([, url]) => url.endsWith("/roles/4")));
});

test("inactive membership removes all Hollow Valley membership roles", async () => {
  reset({ tier: "legend", stripeStatus: "canceled" });
  const roles = [
    { id: "1", name: "Valley Member" },
    { id: "2", name: "Valley Elite" },
    { id: "3", name: "Valley Legend" },
  ];
  const calls = [];

  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || "GET" });
    if ((options.method || "GET") === "GET") {
      if (url.endsWith("/roles")) {
        return { ok: true, status: 200, json: async () => roles };
      }
      return { ok: true, status: 200, json: async () => ({ roles: ["1", "2", "3"] }) };
    }
    return { ok: true, status: 204, json: async () => null };
  };

  const result = await syncDiscordMembershipForUser(42, { env, fetchImpl });
  assert.equal(result.tier, null);
  assert.equal(calls.filter((call) => call.method === "DELETE").length, 3);
  assert.equal(calls.filter((call) => call.method === "PUT").length, 0);
});

test("missing target role is created before assignment", async () => {
  reset({ tier: "elite" });
  const calls = [];
  let roles = [{ id: "1", name: "Valley Member" }];

  const fetchImpl = async (url, options = {}) => {
    const method = options.method || "GET";
    calls.push({ url, method, body: options.body });
    if (method === "GET") {
      if (url.endsWith("/roles")) {
        return { ok: true, status: 200, json: async () => roles };
      }
      return { ok: true, status: 200, json: async () => ({ roles: ["1"] }) };
    }
    if (method === "POST" && url.endsWith("/roles")) {
      const created = { id: "2", name: "Valley Elite" };
      roles = [...roles, created];
      return { ok: true, status: 200, json: async () => created };
    }
    return { ok: true, status: 204, json: async () => null };
  };

  const result = await syncDiscordMembershipForUser(42, { env, fetchImpl });
  assert.equal(result.roleName, "Valley Elite");
  assert.ok(calls.some((call) => call.method === "POST" && call.url.endsWith("/guilds/1540359454627725382/roles")));
  assert.ok(calls.some((call) => call.method === "PUT" && call.url.endsWith("/roles/2")));
});


test("configured supporter role IDs are used directly without listing or creating roles", async () => {
  reset({ tier: "legend" });
  const exactEnv = {
    ...env,
    DISCORD_ROLE_MEMBER_ID: "1550695486464204810",
    DISCORD_ROLE_ELITE_ID: "1550695581373042688",
    DISCORD_ROLE_LEGEND_ID: "1550695426456555551",
  };
  const calls = [];

  const fetchImpl = async (url, options = {}) => {
    const method = options.method || "GET";
    calls.push({ url, method });
    assert.notEqual(method, "POST");
    if (method === "GET") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          roles: ["1550695486464204810", "1550695581373042688"],
        }),
      };
    }
    return { ok: true, status: 204, json: async () => null };
  };

  const result = await syncDiscordMembershipForUser(42, { env: exactEnv, fetchImpl });
  assert.equal(result.tier, "legend");
  assert.equal(result.roleName, "Valley Legend");
  assert.ok(calls.some((call) => call.method === "PUT" && call.url.endsWith("/roles/1550695426456555551")));
  assert.ok(calls.some((call) => call.method === "DELETE" && call.url.endsWith("/roles/1550695486464204810")));
  assert.ok(calls.some((call) => call.method === "DELETE" && call.url.endsWith("/roles/1550695581373042688")));
});


test("already-correct exact membership role is a no-op", async () => {
  reset({ tier: "legend" });
  const exactEnv = {
    ...env,
    DISCORD_ROLE_MEMBER_ID: "1550695486464204810",
    DISCORD_ROLE_ELITE_ID: "1550695581373042688",
    DISCORD_ROLE_LEGEND_ID: "1550695426456555551",
  };
  const calls = [];

  const fetchImpl = async (url, options = {}) => {
    const method = options.method || "GET";
    calls.push({ url, method });
    if (method !== "GET") {
      return { ok: true, status: 204, json: async () => null };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ roles: ["1550695426456555551"] }),
    };
  };

  const result = await syncDiscordMembershipForUser(42, { env: exactEnv, fetchImpl });
  assert.equal(result.changed, false);
  assert.equal(calls.filter((call) => call.method === "PUT").length, 0);
  assert.equal(calls.filter((call) => call.method === "DELETE").length, 0);
});
