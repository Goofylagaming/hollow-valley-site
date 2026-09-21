const test = require("node:test");
const assert = require("node:assert/strict");

process.env.AUTOMATION_SERVICE_URL = "https://automation.example.test";
process.env.AUTOMATION_ADMIN_TOKEN = "admin-test-token";
process.env.AUTOMATION_SERVICE_TIMEOUT_MS = "5000";

test("admin server mod client uses protected automation endpoints", async (t) => {
  const calls = [];
  const previousFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ ok: true, serverMods: { enabled: true, mods: [] } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  t.after(() => { global.fetch = previousFetch; });

  const clientPath = require.resolve("../server/services/automationWebsiteClient");
  delete require.cache[clientPath];
  const client = require(clientPath);

  await client.getAdminServerMods();
  await client.deployAdminServerMods();

  assert.equal(calls[0].url, "https://automation.example.test/api/admin/server-mods");
  assert.equal(calls[0].options.headers.Authorization, "Bearer admin-test-token");

  assert.equal(calls[1].url, "https://automation.example.test/api/admin/server-mods/deploy");
  assert.equal(calls[1].options.method, "POST");
  assert.equal(JSON.parse(calls[1].options.body).confirmation, "DEPLOY SERVER MODS");
  assert.equal(calls[1].options.headers.Authorization, "Bearer admin-test-token");
});
