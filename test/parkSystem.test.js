const test = require("node:test");
const assert = require("node:assert/strict");
const parkHandler = require("../api/park");
const playerdataHandler = require("../api/playerdata");
const redeemHandler = require("../api/redeem");
const adminHandler = require("../api/admin");
const express = require("express");
const bodydropRouter = require("../server/routes/bodydrop");
const sftpBridge = require("../server/services/sftpBridge");

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

test("api/park requires authentication even for a submitted Steam ID", async () => {
  let statusCode = 0;
  let jsonResult = null;

  const req = { method: "POST", body: { steamid: "76561198000000000" } };
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
  assert.strictEqual(statusCode, 401);
  assert.strictEqual(jsonResult.error, "Not logged in");
});

test("api/redeem requires authentication even for a submitted Steam ID", async () => {
  let statusCode = 0;
  let jsonResult = null;

  const req = { method: "POST", body: { steamid: "76561198000000000" } };
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
  assert.strictEqual(statusCode, 401);
  assert.strictEqual(jsonResult.error, "Not logged in");
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

test("api/bodydrop requires the player to be spawned in-game", async () => {
  const serverStatus = require("../server/services/serverStatus");
  const state = serverStatus.getState();
  const original = { online: state.online, characters: state.characters };
  state.online = true;
  state.characters = [];

  try {
    const response = await requestBodydrop({
      method: "POST",
      user: { id: 999003, steam_id: "76561198000000001" },
      body: { dropType: "small" },
    });
    assert.strictEqual(response.status, 400);
    assert.strictEqual(response.body.error, "You must be spawned in-game to request a body drop.");
  } finally {
    state.online = original.online;
    state.characters = original.characters;
  }
});

test("bodydrop bridge defaults to the UE4SS inbox.ndjson path from config.lua", () => {
  const originalBase = process.env.SFTP_BASE_PATH;
  const originalInbox = process.env.BODYDROP_INBOX_PATH;
  process.env.SFTP_BASE_PATH = "103.193.81.65_5565";
  delete process.env.BODYDROP_INBOX_PATH;

  try {
    assert.strictEqual(
      sftpBridge.getBodyDropInboxRemotePath(),
      "/103.193.81.65_5565/TheIsle/Binaries/Win64/ue4ss/Mods/HollowValleyBodyDrop/Saved/inbox.ndjson"
    );
  } finally {
    if (originalBase === undefined) delete process.env.SFTP_BASE_PATH;
    else process.env.SFTP_BASE_PATH = originalBase;
    if (originalInbox === undefined) delete process.env.BODYDROP_INBOX_PATH;
    else process.env.BODYDROP_INBOX_PATH = originalInbox;
  }
});

test("queued body drops remain locked until the request is completed or failed", () => {
  const { cooldownFor } = bodydropRouter._private;
  const cooldown = cooldownFor({ status: "queued", created_at: new Date().toISOString() });
  assert.equal(cooldown.active, true);
  assert.equal(cooldown.reason, "pending");
  assert.equal(cooldown.remainingSeconds, null);
});

test("api/bodydrop rejects releasing a request when none is queued", async () => {
  const response = await requestBodydrop({
    method: "DELETE",
    user: { id: 999004 },
  });
  assert.equal(response.status, 409);
  assert.equal(response.body.error, "There is no uploaded Body Drop request awaiting reconciliation.");
});

test("bodydrop bridge builds the UE4SS spawn job with raw player coordinates", () => {
  const job = sftpBridge.buildBodyDropJob({
    bodyDropRequestId: 42,
    steamId: "76561198000000000",
    species: "Dryosaurus",
    growth: 1,
    location: { x: 12.5, y: -8, z: 44 },
  });

  assert.equal(job.id, 42);
  assert.equal(job.action, "spawn");
  assert.equal(job.species, "Dryosaurus");
  assert.deepEqual({ x: job.x, y: job.y, z: job.z }, { x: 12.5, y: -8, z: 44 });
  assert.equal(job.steamId, "76561198000000000");
});

test("bodydrop bridge rejects unsafe relative inbox paths", () => {
  const originalBase = process.env.SFTP_BASE_PATH;
  const originalInbox = process.env.BODYDROP_INBOX_PATH;
  process.env.SFTP_BASE_PATH = "verygames-root";
  process.env.BODYDROP_INBOX_PATH = "Mods/../outside/inbox.ndjson";

  try {
    assert.throws(() => sftpBridge.getBodyDropInboxRemotePath(), /parent-directory segments/);
  } finally {
    if (originalBase === undefined) delete process.env.SFTP_BASE_PATH;
    else process.env.SFTP_BASE_PATH = originalBase;
    if (originalInbox === undefined) delete process.env.BODYDROP_INBOX_PATH;
    else process.env.BODYDROP_INBOX_PATH = originalInbox;
  }
});

test("file bridge defaults to SFTP and supports FTP protocol selection", () => {
  const originalProtocol = process.env.GAME_FILE_PROTOCOL;
  const originalLegacyProtocol = process.env.FILE_BRIDGE_PROTOCOL;
  delete process.env.GAME_FILE_PROTOCOL;
  delete process.env.FILE_BRIDGE_PROTOCOL;

  try {
    assert.strictEqual(sftpBridge.getFileBridgeProtocol(), "sftp");
    process.env.GAME_FILE_PROTOCOL = "ftp";
    assert.strictEqual(sftpBridge.getFileBridgeProtocol(), "ftp");
    process.env.GAME_FILE_PROTOCOL = "sftp";
    assert.strictEqual(sftpBridge.getFileBridgeProtocol(), "sftp");
    process.env.GAME_FILE_PROTOCOL = "bogus";
    assert.throws(
      () => sftpBridge.getFileBridgeProtocol(),
      /Unsupported game file bridge protocol: bogus/
    );
  } finally {
    if (originalProtocol === undefined) delete process.env.GAME_FILE_PROTOCOL;
    else process.env.GAME_FILE_PROTOCOL = originalProtocol;
    if (originalLegacyProtocol === undefined) delete process.env.FILE_BRIDGE_PROTOCOL;
    else process.env.FILE_BRIDGE_PROTOCOL = originalLegacyProtocol;
  }
});
