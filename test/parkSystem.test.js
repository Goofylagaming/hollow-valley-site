const test = require("node:test");
const assert = require("node:assert/strict");
const parkHandler = require("../api/park");
const playerdataHandler = require("../api/playerdata");
const redeemHandler = require("../api/redeem");
const adminHandler = require("../api/admin");
const express = require("express");
const bodydropRouter = require("../server/routes/bodydrop");

async function requestBodydrop({ method = "GET", path = "/api/bodydrop", user, body } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (user) req.user = user;
    next();
  });
  app.use("/api/bodydrop", bodydropRouter);

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      status: response.status,
      body: await response.json(),
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

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

test("api/admin requires a command", async () => {
  let statusCode = 0;
  let jsonResult = null;

  const req = {
    user: { is_admin: 1 },
    body: {},
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
  assert.strictEqual(jsonResult.error, "Missing command");
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

test("api/admin runs allowed commands", async () => {
  let statusCode = 0;
  let jsonResult = null;
  const rcon = require("../api/rcon");
  const originalSendRcon = rcon.sendRcon;

  rcon.sendRcon = async (command) => {
    assert.strictEqual(command, "listparked");
    return "ok";
  };

  const req = {
    user: { is_admin: 1 },
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

  try {
    await adminHandler(req, res);
  } finally {
    rcon.sendRcon = originalSendRcon;
  }

  assert.strictEqual(statusCode, 0);
  assert.deepStrictEqual(jsonResult, { success: true, rcon: "ok" });
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

test("api/bodydrop requires a logged-in user", async () => {
  const response = await requestBodydrop();
  assert.strictEqual(response.status, 401);
  assert.strictEqual(response.body.error, "Not logged in");
});

test("api/bodydrop requires a linked Steam account", async () => {
  const response = await requestBodydrop({
    method: "POST",
    user: { id: 999001, steam_id: null },
    body: { dropType: "small" },
  });
  assert.strictEqual(response.status, 400);
  assert.strictEqual(response.body.error, "Your Steam account is not linked. Please sign in with Steam first.");
});

test("api/bodydrop rejects requests while server status is offline", async () => {
  const response = await requestBodydrop({
    method: "POST",
    user: { id: 999002, steam_id: "76561198000000000" },
    body: { dropType: "small" },
  });
  assert.strictEqual(response.status, 503);
  assert.strictEqual(response.body.error, "The Isle server is not online or RCON is not synced yet.");
});
