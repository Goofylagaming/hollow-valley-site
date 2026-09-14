const test = require("node:test");
const assert = require("node:assert/strict");
const parkHandler = require("../api/park");
const playerdataHandler = require("../api/playerdata");
const redeemHandler = require("../api/redeem");
const adminHandler = require("../api/admin");

test("api/park returns 400 when steamid is missing", async () => {
  let statusCode = 0;
  let jsonResult = null;

  const req = { body: {} };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResult = data;
      return this;
    },
  };

  await parkHandler(req, res);
  assert.strictEqual(statusCode, 400);
  assert.strictEqual(jsonResult.error, "Missing SteamID");
});

test("api/redeem returns 400 when steamid is missing", async () => {
  let statusCode = 0;
  let jsonResult = null;

  const req = { body: {} };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResult = data;
      return this;
    },
  };

  await redeemHandler(req, res);
  assert.strictEqual(statusCode, 400);
  assert.strictEqual(jsonResult.error, "Missing SteamID");
});

test("api/playerdata returns 400 when steamid is missing", async () => {
  let statusCode = 0;
  let jsonResult = null;

  const req = { query: {} };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResult = data;
      return this;
    },
  };

  await playerdataHandler(req, res);
  assert.strictEqual(statusCode, 400);
  assert.strictEqual(jsonResult.error, "Missing SteamID");
});

test("api/admin requires a logged-in user", async () => {
  let statusCode = 0;
  let jsonResult = null;

  const req = { body: { command: "listparked" } };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResult = data;
      return this;
    },
  };

  await adminHandler(req, res);
  assert.strictEqual(statusCode, 401);
  assert.strictEqual(jsonResult.error, "Login required");
});

test("api/admin requires an admin user", async () => {
  let statusCode = 0;
  let jsonResult = null;

  const req = {
    user: { is_admin: 0 },
    body: { command: "listparked" },
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResult = data;
      return this;
    },
  };

  await adminHandler(req, res);
  assert.strictEqual(statusCode, 403);
  assert.strictEqual(jsonResult.error, "Admin access required");
});

test("api/admin rejects unsupported commands", async () => {
  let statusCode = 0;
  let jsonResult = null;

  const req = {
    user: { is_admin: 1 },
    body: { command: "DestroyServer" },
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResult = data;
      return this;
    },
  };

  await adminHandler(req, res);
  assert.strictEqual(statusCode, 400);
  assert.strictEqual(jsonResult.error, "Unsupported admin command");
});

test("api/admin rejects newline-delimited commands", async () => {
  let statusCode = 0;
  let jsonResult = null;

  const req = {
    user: { is_admin: 1 },
    body: { command: "listparked\nplayers" },
  };
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(data) {
      jsonResult = data;
      return this;
    },
  };

  await adminHandler(req, res);
  assert.strictEqual(statusCode, 400);
  assert.strictEqual(jsonResult.error, "Unsupported admin command");
});
