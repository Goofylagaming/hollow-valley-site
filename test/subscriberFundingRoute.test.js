"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { createSubscriberFundingRouters } = require("../server/routes/subscriberFunding");
const { FundingError } = require("../server/services/subscriberFunding");
const OWNER = "76561198000000001";
const ORIGIN = "https://hollowvalley.example";
const PUBLIC_UNAVAILABLE = { enabled: false, configured: false, available: false, month: null,
  timeZone: "Australia/Brisbane", periodEnd: null, updatedAt: null, coveragePercent: null };
async function fixture(t, user, options = {}) {
  const calls = [];
  const state = { config: { enabled: false, categories: [], version: 0 }, progress: { enabled: false, available: false, amountMinor: null } };
  const service = {
    getProgress() { calls.push("public"); return state.progress; },
    getOwnerState() { calls.push("owner"); return state; },
    setConfig(input) { calls.push({ method: "save", input }); return state; },
    async refresh() { calls.push("refresh"); return state; },
    ...options.service,
  };
  const app = express(); app.set("trust proxy", 1); app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  const routers = createSubscriberFundingRouters({ service, env: { OWNER_STEAM_ID: OWNER, PUBLIC_SITE_URL: ORIGIN, ...options.env } });
  app.use("/api/supporter/progress", routers.publicRouter);
  app.use("/api/admin/finance/support-goal", routers.ownerRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { calls, origin: base.replace("http:", "https:"), request: (path, { method = "GET", body, headers = {} } = {}) => fetch(base + path, {
    method, headers: { "Content-Type": "application/json", "X-Forwarded-Proto": "https", ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  }) };
}
const PATH = "/api/admin/finance/support-goal";

test("the aggregate is public, uncached, and cannot expose owner settings through its route", async t => {
  const f = await fixture(t, null);
  const result = await f.request("/api/supporter/progress");
  assert.equal(result.status, 200); assert.match(result.headers.get("cache-control"), /no-store/);
  assert.deepEqual(await result.json(), PUBLIC_UNAVAILABLE);
  assert.equal((await f.request(PATH)).status, 404);
  assert.deepEqual(f.calls, ["public"]);
});

test("public HTTP serializes only the percentage contract even for an owner or enriched service response", async t => {
  const safe = { enabled: true, configured: true, available: true, month: "2026-11",
    timeZone: "Australia/Brisbane", periodEnd: "2026-11-30T14:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z", coveragePercent: 75 };
  const privateDetails = { amountMinor: 9753, targetCents: 13004, currency: "aud", basis: "private ledger basis",
    categories: [{ id: "private-fixture", label: "Private service provider", amountCents: 13004 }],
    customer: { email: "payer@example.invalid" }, invoice: "in_sensitive", internalDiagnostic: "confidential" };
  for (const user of [null, { steam_id: OWNER }]) {
    const f = await fixture(t, user, { service: {
      getProgress: () => ({ ...safe, ...privateDetails, timeZone: privateDetails.invoice }),
      getOwnerState: () => ({ config: { enabled: true, categories: privateDetails.categories },
        progress: { ...privateDetails }, publicProgress: safe }),
    } });
    const result = await f.request("/api/supporter/progress");
    assert.equal(result.status, 200);
    assert.deepEqual(await result.json(), safe);
    if (user) {
      const owner = await (await f.request(PATH)).json();
      assert.deepEqual(owner.publicProgress, safe);
      assert.equal(owner.progress.amountMinor, privateDetails.amountMinor);
    }
  }
});

test("ordinary administrator flags and body identity cannot bypass the exact configured finance owner", async t => {
  const f = await fixture(t, { is_admin: 1, steam_id: "76561198000000002" });
  for (const method of ["GET", "PUT", "POST"]) {
    const result = await f.request(method === "POST" ? PATH + "/refresh" : PATH, {
      method, ...(method !== "GET" ? { body: { steam_id: OWNER, enabled: true }, headers: { Origin: f.origin } } : {}),
    });
    assert.equal(result.status, 404);
  }
  assert.equal(f.calls.length, 0);
});

test("owner saves and read-only refreshes require the exact site origin before invoking the service", async t => {
  const f = await fixture(t, { steam_id: OWNER });
  const read = await f.request(PATH); assert.equal(read.status, 200); assert.match(read.headers.get("cache-control"), /private.*no-store/);
  for (const headers of [{}, { Origin: "https://evil.example" }, { Origin: "null" },
    { Origin: f.origin + "/path" }, { Origin: f.origin, "Sec-Fetch-Site": "cross-site" }]) {
    assert.equal((await f.request(PATH, { method: "PUT", body: {}, headers })).status, 403);
    assert.equal((await f.request(PATH + "/refresh", { method: "POST", headers })).status, 403);
  }
  assert.deepEqual(f.calls, ["owner"]);
  const config = { enabled: true, categories: [{ id: "server", label: "Server costs", amountCents: 1200 }], version: 0 };
  assert.equal((await f.request(PATH, { method: "PUT", body: config, headers: { Origin: f.origin } })).status, 200);
  assert.deepEqual(f.calls[1], { method: "save", input: config });
  assert.equal((await f.request(PATH + "/refresh", { method: "POST", headers: { Origin: f.origin } })).status, 200);
  assert.equal(f.calls[2], "refresh");
});

test("unconfigured owner identity fails closed even for an otherwise matching signed-in owner", async t => {
  const f = await fixture(t, { steam_id: OWNER, is_admin: 1 }, { env: { OWNER_STEAM_ID: "" } });
  assert.equal((await f.request(PATH)).status, 404); assert.equal(f.calls.length, 0);
});

test("a preview may save its own cost draft even when it inherits a different production site URL", async t => {
  const f = await fixture(t, { steam_id: OWNER }, { env: { PUBLIC_SITE_URL: "https://production.example" } });
  const result = await f.request(PATH, { method: "PUT", body: { enabled: false, categories: [], version: 0 }, headers: { Origin: f.origin } });
  assert.equal(result.status, 200); assert.equal(f.calls.length, 1);
  assert.equal((await f.request(PATH, { method: "PUT", body: {}, headers: { Origin: f.origin.replace("https:", "http:") } })).status, 403);
});

test("conflicts preserve their safe status and raw provider error contents never reach either browser endpoint", async t => {
  const f = await fixture(t, { steam_id: OWNER }, { service: {
    setConfig() { throw new FundingError("conflict", 409); },
    async refresh() { throw new Error("alice@example.com rk_live_secret ch_private"); },
    getProgress() { throw new Error("private database details"); },
  } });
  const conflict = await f.request(PATH, { method: "PUT", body: {}, headers: { Origin: f.origin } });
  assert.equal(conflict.status, 409); assert.equal((await conflict.json()).code, "conflict");
  const refresh = await f.request(PATH + "/refresh", { method: "POST", headers: { Origin: f.origin } });
  assert.equal(refresh.status, 502); assert.doesNotMatch(await refresh.text(), /alice|rk_live|ch_private/);
  const result = await f.request("/api/supporter/progress");
  assert.equal(result.status, 503); assert.deepEqual(await result.json(), PUBLIC_UNAVAILABLE);
});
