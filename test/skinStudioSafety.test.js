const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
process.env.DB_PATH = ":memory:";
const automation = require("../server/services/automationWebsiteClient");
const router = require("../server/routes/skins");
const { skinShareCodeRedaction } = require("../server/middleware/skinShareCodeRedaction");
const { getSkinStudioSafety, getSkinStudioContext, startSkinSharePolicySync } = require("../server/middleware/skinStudioSafety");

const PROD = "srv-dajsk9nqj5pc73euebdg";
const PREVIEW = "srv-davbt13bc2fs73c9ma4g";
const ADMIN = { id: 1, steam_id: "76561198000000901", is_admin: 1 };
const PLAYER = { id: 2, steam_id: "76561198000000902", is_admin: 0 };
const ENV_KEYS = ["SKIN_STUDIO_READ_ONLY", "RENDER_SERVICE_ID", "RENDER_EXTERNAL_URL", "PUBLIC_SITE_URL", "STEAM_REALM", "STEAM_RETURN_URL"];

function configure(t, values) {
  const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  t.after(() => {
    for (const key of ENV_KEYS) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
}

function stubAutomation(t, replacements) {
  const previous = {};
  for (const [key, replacement] of Object.entries(replacements)) {
    previous[key] = automation[key];
    automation[key] = replacement;
  }
  t.after(() => Object.assign(automation, previous));
}

async function serve(t, user = ADMIN) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use("/api/skins", skinShareCodeRedaction, router);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/skins`;
  return async (path, { method = "GET", body, headers = {} } = {}) => fetch(`${base}${path}`, {
    method,
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

test("Render preview identities and configured test hosts stay read-only even with copied production login settings", () => {
  for (const serviceId of [PREVIEW, "srv-damcaq61egvs73bmlc20", "srv-db2m76navr4c73ejla10", "srv-new-preview"]) {
    assert.equal(getSkinStudioSafety({
      RENDER_SERVICE_ID: serviceId,
      PUBLIC_SITE_URL: "https://hollowvalleyisle.com",
      STEAM_REALM: "https://hollowvalleyisle.com/",
      SKIN_STUDIO_READ_ONLY: "false",
    }).readOnly, true);
  }
  for (const url of [
    "https://hollow-valley-ui-v2-preview.onrender.com",
    "https://hollow-valley-site-test.onrender.com",
    "https://hollow-valley-skin-v012-preview.onrender.com",
    "https://staging.hollowvalleyisle.com",
    "http://localhost:3000/",
  ]) {
    assert.equal(getSkinStudioSafety({ STEAM_REALM: url }).readOnly, true);
  }
  assert.equal(getSkinStudioSafety({ RENDER_SERVICE_ID: PROD, RENDER_EXTERNAL_URL: "https://hollow-valley-site.onrender.com" }).readOnly, false);
  assert.equal(getSkinStudioSafety({ PUBLIC_SITE_URL: "https://hollowvalleyisle.com" }).readOnly, false);
  assert.equal(getSkinStudioSafety({ RENDER_SERVICE_ID: PROD, SKIN_STUDIO_READ_ONLY: "true" }).readOnly, true);
});

test("studio context communicates preview restrictions and existing Steam/admin permissions", async (t) => {
  configure(t, { RENDER_SERVICE_ID: PREVIEW });
  const request = await serve(t);
  const response = await request("/studio-context");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const context = await response.json();
  assert.equal(context.readOnly, true);
  assert.equal(context.reasonCode, "SKIN_STUDIO_READ_ONLY");
  assert.match(context.reason, /read-only/i);
  assert.equal(context.loggedIn, true);
  assert.equal(context.steamLinked, true);
  assert.deepEqual(context.capabilities, { preview: true, importPreview: true, save: false, wear: false, buy: false, manage: false, share: false });
  assert.equal(getSkinStudioContext(PLAYER, { RENDER_SERVICE_ID: PROD }).capabilities.save, true);
  assert.equal(getSkinStudioContext(PLAYER, { RENDER_SERVICE_ID: PROD }).capabilities.manage, false);
  assert.equal(getSkinStudioContext(null, { RENDER_SERVICE_ID: PROD }).capabilities.save, false);
});

test("read-only preview rejects every skin write and wear reconciliation before automation is called", async (t) => {
  configure(t, { RENDER_SERVICE_ID: PREVIEW });
  let calls = 0;
  const mutationNames = ["saveStudioSkin", "importSharedSkin", "createSkinPresetFromStored", "updateSkin", "deleteSkin", "buySkin", "wearSkin", "retrySkinWear", "resetSkinWear", "applySkinPreset", "grantExclusiveSkin", "revokeExclusiveSkin", "publishSkin", "getSkinWearState"];
  stubAutomation(t, Object.fromEntries(mutationNames.map((name) => [name, async () => {
    calls += 1;
    throw new Error("A preview must never reach automation writes");
  }])));
  const request = await serve(t);
  const paths = [
    ["POST", "/studio"], ["POST", "/import"], ["POST", "/from-stored"],
    ["PUT", "/preset-12345678"], ["DELETE", "/preset-12345678"],
    ["POST", "/preset-12345678/buy"], ["POST", "/preset-12345678/wear"],
    ["POST", "/wear-retry"], ["POST", "/wear-reset"], ["POST", "/preset-12345678/apply"],
    ["POST", "/preset-12345678/grant"], ["POST", "/preset-12345678/revoke"],
    ["POST", "/preset-12345678/publish"], ["GET", "/wear-state"],
    ["HEAD", "/WEAR-STATE/"], ["PATCH", "/future-skin-write"],
  ];
  for (const [method, path] of paths) {
    const response = await request(path, {
      method,
      headers: { host: "hollowvalleyisle.com", "x-forwarded-host": "hollowvalleyisle.com" },
      ...(["GET", "HEAD"].includes(method) ? {} : { body: { steamId: PLAYER.steam_id } }),
    });
    assert.equal(response.status, 403, `${method} ${path}`);
    if (method !== "HEAD") assert.equal((await response.json()).code, "SKIN_STUDIO_READ_ONLY");
  }
  assert.equal(calls, 0);
});

test("read-only preview can read existing player records without changing IDs, exact colours or ownership", async (t) => {
  configure(t, { RENDER_SERVICE_ID: PREVIEW });
  const records = [
    { id: "old-private-12345", owner_steam_id: PLAYER.steam_id, species: "Tyrannosaurus", name: "Existing skin", owned: true, skin: { body: { r: 0.123456789, g: 0, b: 1, a: 0.42 }, skinVariation: 38, patternIndex: 2, themeIndex: 3 } },
    { id: "old-exclusive-12345", owner_steam_id: ADMIN.steam_id, species: "universal", name: "My personal exclusive", owned: true, exclusive: true, granted: true, grantCustomized: true, skin: { body: { r: 0, g: 0.987654321, b: 0, a: 0.8 } } },
    { id: "old-purchase-12345", owner_steam_id: ADMIN.steam_id, species: "Deinosuchus", name: "Paid skin", owned: true, price: 30000 },
  ];
  const before = JSON.stringify(records);
  let readSteam = null;
  stubAutomation(t, {
    listSkinPresets: async (steamId) => { readSteam = steamId; return { systemEnabled: true, presets: records }; },
    listSkinStore: async () => ({ skins: [] }),
  });
  const request = await serve(t, PLAYER);
  const response = await request("/mine");
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).presets, records);
  assert.equal(readSteam, PLAYER.steam_id);
  assert.equal(JSON.stringify(records), before);
  assert.equal((await request("/")).status, 200);
});

test("preview permits non-writing external imports while retaining authentication and batch admin checks", async (t) => {
  configure(t, { RENDER_SERVICE_ID: PREVIEW });
  const baseSkin = { teeth: { r: 0.333333333, g: 0.4, b: 0.6, a: 0.9 }, patternIndex: 7 };
  const body = { rawCode: "FNF-DEIN-C0000-112233-223344-334455-445566-000000-667788-778899", baseSkin };
  const adminRequest = await serve(t);
  const preview = await adminRequest("/external/preview", { method: "POST", body });
  assert.equal(preview.status, 200);
  const parsed = await preview.json();
  assert.deepEqual(parsed.skin.underbelly, { r: 0, g: 0, b: 0, a: 1 });
  assert.deepEqual(parsed.skin.teeth, baseSkin.teeth);
  assert.equal(parsed.skin.patternIndex, 7);
  assert.equal((await adminRequest("/external/batch-preview", { method: "POST", body })).status, 200);
  const playerRequest = await serve(t, PLAYER);
  assert.equal((await playerRequest("/external/preview", { method: "POST", body })).status, 200);
  assert.equal((await playerRequest("/external/batch-preview", { method: "POST", body })).status, 403);
  const guestRequest = await serve(t, null);
  assert.equal((await guestRequest("/external/preview", { method: "POST", body })).status, 401);
});

test("production keeps authenticated save behaviour and exact payloads while guests remain blocked", async (t) => {
  configure(t, { RENDER_SERVICE_ID: PROD });
  let received = null;
  stubAutomation(t, {
    saveStudioSkin: async (payload) => { received = payload; return { duplicate: false, preset: { id: "new-preset-12345", skin: payload.skin } }; },
  });
  const request = await serve(t, PLAYER);
  const body = { species: "Tyrannosaurus", name: "Unchanged precision", description: "", skin: { body: { r: 0.123456789, g: 0, b: 1, a: 0.42 } }, idempotencyKey: "studio-preserve-test" };
  const response = await request("/studio", { method: "POST", body });
  assert.equal(response.status, 201);
  assert.deepEqual(received, { steamId: PLAYER.steam_id, ...body });
  const context = await (await request("/studio-context")).json();
  assert.equal(context.readOnly, false);
  assert.equal(context.capabilities.save, true);
  assert.equal(context.capabilities.manage, false);
  const guest = await serve(t, null);
  assert.equal((await guest("/studio", { method: "POST", body })).status, 401);
});

test("preview startup neither reconciles share policy nor schedules a production-changing timer", () => {
  let calls = 0;
  let schedules = 0;
  let unrefs = 0;
  const sync = () => { calls += 1; };
  const schedule = (callback, delay) => {
    schedules += 1;
    assert.equal(callback, sync);
    assert.equal(delay, 5 * 60 * 1000);
    return { unref() { unrefs += 1; } };
  };
  assert.equal(startSkinSharePolicySync(sync, { env: { RENDER_SERVICE_ID: PREVIEW }, schedule }), null);
  assert.equal(startSkinSharePolicySync(sync, { env: { PUBLIC_SITE_URL: "https://hollow-valley-site-test.onrender.com" }, schedule }), null);
  assert.equal(calls, 0);
  assert.equal(schedules, 0);
  startSkinSharePolicySync(sync, { env: { RENDER_SERVICE_ID: PROD }, schedule });
  assert.equal(calls, 1);
  assert.equal(schedules, 1);
  assert.equal(unrefs, 1);
});

test("reading the test site's signed-in account does not synchronize production progression identity", async (t) => {
  configure(t, { RENDER_SERVICE_ID: PREVIEW });
  const { createApp } = require("../server/index");
  let linked = 0;
  stubAutomation(t, { linkProgressionIdentity: async () => { linked += 1; return { ok: true }; } });
  const outer = express();
  outer.use((req, _res, next) => { req.user = { ...PLAYER, discord_id: "123456789012345678" }; next(); });
  outer.use(createApp());
  const server = await new Promise((resolve) => {
    const listener = outer.listen(0, "127.0.0.1", () => resolve(listener));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/me`;
  const preview = await fetch(url);
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).user.steam_id, PLAYER.steam_id);
  assert.equal(linked, 0);

  process.env.RENDER_SERVICE_ID = PROD;
  assert.equal((await fetch(url)).status, 200);
  assert.equal(linked, 1);
});
