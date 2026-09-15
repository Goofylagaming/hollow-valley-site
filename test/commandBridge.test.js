const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const express = require("express");
const bridge = require("../server/services/commandBridge");
const files = require("../server/services/sftpBridge");
const storage = require("../server/services/dinoStorage");
const bodyDrop = require("../server/services/bodyDrop");
const { Client: FtpClient } = require("basic-ftp");
const SftpClient = require("ssh2-sftp-client");

process.env.DB_PATH = ":memory:";
const db = require("../server/db");
const bodyRouter = require("../server/routes/bodydrop");
const storageRouter = require("../server/routes/dinoStorage");
const mydinosRouter = require("../server/routes/mydinos");
const parkHandler = require("../api/park");
const redeemHandler = require("../api/redeem");

const steam = "76561198000000000";
const directory = "/TheIsle/Binaries/Win64/ue4ss/Mods/CommandBridge/Saved";
const command = { id: "test-id", verb: "bd", steam };
const ack = { ...command, ok: true, msg: "queued" };
const final = { id: command.id, steam, source: "BodyDrop", ok: true, msg: "spawned" };
const ndjson = (...rows) => rows.map((row) => JSON.stringify(row) + "\n").join("");

function configure(t, extra = {}) {
  const env = {
    COMMAND_BRIDGE_ENABLED: "true",
    COMMAND_BRIDGE_SAVED_PATH: "Mods/CommandBridge/Saved",
    COMMAND_BRIDGE_TIMEOUT_MS: "1000",
    SFTP_BASE_PATH: "/",
    SFTP_HOST: "host.invalid",
    SFTP_PORT: "21",
    SFTP_USER: "test",
    SFTP_PASSWORD: "test-password",
    GAME_FILE_PROTOCOL: "ftp",
    BODYDROP_BRIDGE_MODE: "commandbridge",
    ...extra,
  };
  const original = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  for (const method of ["info", "error", "warn"]) t.mock.method(console, method, () => {});
}

function fixture(t, results = (job) => ndjson({ ...final, id: job.id, steam: job.steam })) {
  let sent;
  const client = {
    connect: t.mock.fn(async () => {}),
    exists: t.mock.fn(async () => true),
    size: t.mock.fn(async () => 1024),
    get: t.mock.fn(async () => Buffer.from(sent ? results(sent) : "")),
    append: t.mock.fn(async (buffer, remotePath) => {
      assert.equal(remotePath, `${directory}/commands.ndjson`);
      assert.ok(buffer.toString().endsWith("\n"));
      sent = JSON.parse(buffer.toString());
    }),
    end: t.mock.fn(async () => {}),
  };
  t.mock.method(files, "createFileBridgeClient", () => client);
  return { client, sent: () => sent };
}

test("CommandBridge commands match documented envelope and default slot", async (t) => {
  configure(t);
  const { sent } = fixture(t, (job) => ndjson({
    ...final, source: "DinoStorage", id: job.id, steam: job.steam, msg: "parked; kill scheduled",
  }));
  const result = await storage.runDinoStorageAction("store", steam);
  assert.deepEqual(Object.keys(sent()), ["id", "ts", "verb", "steam", "args"]);
  assert.match(sent().id, /^[0-9a-f-]{36}$/);
  assert.ok(Number.isInteger(sent().ts));
  assert.equal(sent().verb, "dino_store");
  assert.equal(sent().steam, steam);
  assert.deepEqual(sent().args, { args: ["default"] });
  assert.equal(result.confirmed, true);
  assert.match(result.message, /deferred in-game kill is not independently confirmed/);
  await storage.runDinoStorageAction("redeem", steam);
  assert.equal(sent().verb, "dino_retrieve");
  await assert.rejects(storage.runDinoStorageAction("delete", steam), /Unsupported/);
});

test("Body Drop sends bd nested token array, fraction growth and live target Steam", async (t) => {
  configure(t);
  const { sent } = fixture(t);
  const result = await bodyDrop.executeBodyDrop({
    bodyDropRequestId: 123, steamId: steam, species: "Dryosaurus", growth: 0.75,
    location: { x: 12.5, y: -9, z: 44 },
  });
  assert.equal(sent().verb, "bd");
  assert.deepEqual(sent().args, { args: ["spawn", "Dryosaurus", "12.5", "-9", "44", "0.75", steam] });
  assert.equal(sent().action, undefined);
  assert.equal(result.ok, true);
  assert.equal(result.queued, false);
  assert.equal(result.source, "BodyDrop");
});

test("result matching requires ID, Steam and expected source; bridge ACK is not completion", () => {
  assert.deepEqual(bridge.findResult(ndjson(ack, ack), command), { result: null, acknowledged: true });
  for (const wrong of [{ id: "other" }, { steam: "76561198000000001" }, { source: "DinoStorage" }]) {
    assert.equal(bridge.findResult(ndjson({ ...final, ...wrong }), command).result, null);
  }
  assert.deepEqual(bridge.findResult(ndjson(ack, final), command).result, final);
  assert.deepEqual(bridge.findResult(ndjson(final, ack), command).result, final);
  const failed = { ...ack, ok: false, msg: "inbox write failed" };
  assert.deepEqual(bridge.findResult(ndjson(failed), command).result, failed);
  assert.equal(bridge.findResult(ndjson({ ...failed, verb: "dino_store" }), command).result, null);
});

test("partial NDJSON is deferred and malformed complete records fail explicitly", () => {
  assert.equal(bridge.findResult(JSON.stringify(final), command).result, null);
  assert.deepEqual(bridge.findResult(ndjson(final), command).result, final);
  assert.throws(() => bridge.findResult("{broken}\n", command), /malformed NDJSON/);
  assert.throws(() => bridge.findResult(ndjson({ ...final, ok: "true" }), command), /schema/);
});

test("disabled or invalid configuration never connects or uploads", async (t) => {
  configure(t, { COMMAND_BRIDGE_ENABLED: "false" });
  const { client } = fixture(t);
  let result = await bridge.executeCommand("dino_store", steam);
  assert.equal(result.ok, false);
  assert.match(result.error, /disabled/);
  process.env.COMMAND_BRIDGE_ENABLED = "true";
  process.env.COMMAND_BRIDGE_SAVED_PATH = "ue4ss/Mods/CommandBridge/Saved";
  result = await bridge.executeCommand("dino_store", steam);
  assert.equal(result.ok, false);
  process.env.COMMAND_BRIDGE_SAVED_PATH = "/absolute/CommandBridge/Saved";
  delete process.env.SFTP_BASE_PATH;
  assert.equal(bridge.getConfig().commandsPath, "/absolute/CommandBridge/Saved/commands.ndjson");
  for (const timeout of ["0", "999", "60001", "NaN"]) {
    process.env.COMMAND_BRIDGE_TIMEOUT_MS = timeout;
    assert.throws(bridge.getConfig, /TIMEOUT_MS/);
  }
  assert.equal(client.connect.mock.callCount(), 0);
  assert.equal(client.append.mock.callCount(), 0);
  assert.throws(() => bridge.buildCommand("kill", steam), /Unsupported/);
  assert.throws(() => bridge.buildCommand("constructor", steam), /Unsupported/);
  assert.throws(() => bridge.buildCommand("bd", "bad-id"), /Steam ID/);
  assert.throws(() => bridge.buildCommand("bd", steam, ['"escape"']), /tokens/);
});

test("only routing ACK times out as unknown, without re-uploading", async (t) => {
  configure(t);
  const { client } = fixture(t, (job) => ndjson({ ...ack, id: job.id }));
  const result = await bridge.executeCommand("bd", steam);
  assert.equal(result.ok, false);
  assert.equal(result.queued, true);
  assert.equal(result.confirmed, false);
  assert.match(result.message, /routed.*BodyDrop.*Do not retry/);
  assert.equal(client.append.mock.callCount(), 1);
  assert.equal(client.end.mock.callCount(), 1);
});

test("sub-mod rejection is not transport success", async (t) => {
  configure(t);
  fixture(t, (job) => ndjson({ ...final, id: job.id, ok: false, msg: "class not found" }));
  const result = await bridge.executeCommand("bd", steam);
  assert.equal(result.ok, false);
  assert.equal(result.queued, false);
  assert.equal(result.error, "class not found");
});

test("preflight read errors and oversized logs prevent any side effects", async (t) => {
  configure(t);
  const { client } = fixture(t);
  client.exists = async () => { throw new Error("550 Permission denied"); };
  let result = await bridge.executeCommand("bd", steam);
  assert.equal(result.ok, false);
  assert.match(result.error, /read results preflight/);
  client.exists = async () => true;
  client.size = async () => 8 * 1024 * 1024 + 1;
  result = await bridge.executeCommand("bd", steam);
  assert.equal(result.ok, false);
  assert.match(result.error, /8 MiB/);
  assert.equal(client.append.mock.callCount(), 0);
});

test("ambiguous upload/read failure remains pending and never retries the command", async (t) => {
  configure(t);
  const { client } = fixture(t);
  client.append = t.mock.fn(async () => { throw new Error("Connection lost after write"); });
  let result = await bridge.executeCommand("bd", steam);
  assert.equal(result.queued, true);
  assert.match(result.message, /Outcome unknown.*append command/);
  assert.equal(client.append.mock.callCount(), 1);
  client.append = async () => {};
  let readCount = 0;
  client.get = t.mock.fn(async () => {
    if (++readCount > 1) throw new Error("Read disconnected");
    return Buffer.from("");
  });
  result = await bridge.executeCommand("bd", steam);
  assert.equal(result.queued, true);
  assert.match(result.message, /await sub-mod result/);
  assert.match(result.message, /Read disconnected/);
});

for (const protocol of ["ftp", "sftp"]) {
  test(`${protocol} adapter appends commands and reads matching sub-mod results`, async (t) => {
    configure(t, { GAME_FILE_PROTOCOL: protocol, SFTP_PORT: protocol === "ftp" ? "21" : "22" });
    let sent;
    const resultText = () => sent ? ndjson({ ...final, id: sent.id }) : "";
    if (protocol === "ftp") {
      t.mock.method(FtpClient.prototype, "access", async () => {});
      t.mock.method(FtpClient.prototype, "close", () => {});
      t.mock.method(FtpClient.prototype, "list", async () => [{ name: "results.ndjson", isFile: true }]);
      t.mock.method(FtpClient.prototype, "size", async () => Buffer.byteLength(resultText()));
      t.mock.method(FtpClient.prototype, "downloadTo", async (sink) => { sink.end(Buffer.from(resultText())); });
      t.mock.method(FtpClient.prototype, "appendFrom", async (stream, remotePath) => {
        assert.equal(remotePath, `${directory}/commands.ndjson`);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        sent = JSON.parse(Buffer.concat(chunks));
      });
      t.mock.method(FtpClient.prototype, "uploadFrom", async () => assert.fail("No queue overwrite"));
    } else {
      t.mock.method(SftpClient.prototype, "connect", async () => {});
      t.mock.method(SftpClient.prototype, "end", async () => {});
      t.mock.method(SftpClient.prototype, "exists", async () => "-");
      t.mock.method(SftpClient.prototype, "stat", async () => ({ size: Buffer.byteLength(resultText()) }));
      t.mock.method(SftpClient.prototype, "get", async () => Buffer.from(resultText()));
      t.mock.method(SftpClient.prototype, "append", async (buffer, remotePath) => {
        assert.equal(remotePath, `${directory}/commands.ndjson`);
        sent = JSON.parse(buffer);
      });
    }
    const result = await bridge.executeCommand("bd", steam, ["status"]);
    assert.equal(result.ok, true);
    assert.equal(result.confirmed, true);
    assert.equal(result.requestId, sent.id);
  });
}

async function request(t, url, { user = { id: 999301, steam_id: steam }, method = "POST", body } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = user; next(); });
  app.use("/api/dinostorage", storageRouter);
  app.use("/api/mydinos", mydinosRouter);
  app.use("/api/bodydrop", bodyRouter);
  app.all("/api/park", parkHandler);
  app.all("/api/redeem", redeemHandler);
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("all storage routes target the authenticated Steam and propagate failures/pending outcomes", async (t) => {
  configure(t);
  const execute = t.mock.method(bridge, "executeCommand", async (verb, target, args) => {
    assert.equal(target, steam);
    assert.deepEqual(args, ["default"]);
    return { ok: false, error: "mod not loaded" };
  });
  for (const url of ["/api/dinostorage/store", "/api/dinostorage/redeem", "/api/mydinos/park-active", "/api/park", "/api/redeem"]) {
    const result = await request(t, url, { body: { steamid: "76561198000000001" } });
    assert.equal(result.status, 502);
    assert.equal(result.body.error, "mod not loaded");
  }
  assert.equal(execute.mock.callCount(), 5);
  const anon = await request(t, "/api/park", { user: null });
  assert.equal(anon.status, 401);
  assert.equal((await request(t, "/api/redeem", { method: "GET" })).status, 405);
  t.mock.method(bridge, "executeCommand", async () => ({ ok: false, queued: true, message: "Outcome unknown; do not retry" }));
  const pending = await request(t, "/api/mydinos/park-active");
  assert.equal(pending.status, 202);
  assert.equal(pending.body.ok, false);
  assert.match(pending.body.message, /unknown/);
  t.mock.method(bridge, "executeCommand", async () => { throw new Error("Unexpected bridge failure"); });
  assert.equal((await request(t, "/api/mydinos/park-active")).status, 502);
});

test("Body Drop cannot release a queued command merely on player confirmation", async (t) => {
  const user = db.findOrCreateUser({ discordId: "test-bridge-user", username: "bridge-test", avatar: null });
  const row = db.createBodyDropRequest({ userId: user.id, steamId: steam, dropType: "small" });
  db.updateBodyDropRequest(row.id, { status: "queued", bridgeRequestId: "unconfirmed-command" });
  const response = await request(t, "/api/bodydrop", { method: "DELETE", user: { ...user, steam_id: steam } });
  assert.equal(response.status, 409);
  assert.match(response.body.error, /may still execute/);
  assert.equal(db.getLatestBodyDropRequest(user.id).status, "queued");
});

test("Body Drop persists confirmed, rejected and unknown outcomes correctly", async (t) => {
  configure(t);
  const state = require("../server/services/serverStatus").getState();
  const original = { online: state.online, characters: state.characters };
  state.online = true;
  state.characters = [{ steamId: steam, location: { x: 12, y: -9, z: 44 } }];
  t.after(() => Object.assign(state, original));
  for (const [index, outcome] of [
    { ok: true, queued: false, source: "BodyDrop", message: "spawned", expected: "completed", http: 200 },
    { ok: false, queued: false, error: "class not found", expected: "failed", http: 400 },
    { ok: false, queued: true, message: "Outcome unknown; do not retry", expected: "queued", http: 202 },
  ].entries()) {
    const user = db.findOrCreateUser({ discordId: `body-outcome-${index}`, username: "body-test", avatar: null });
    t.mock.method(bridge, "executeCommand", async () => ({ ...outcome, requestId: `correlation-${index}` }));
    const response = await request(t, "/api/bodydrop", {
      user: { ...user, steam_id: steam }, body: { dropType: "small" },
    });
    assert.equal(response.status, outcome.http);
    const latest = db.getLatestBodyDropRequest(user.id);
    assert.equal(latest.status, outcome.expected);
    assert.equal(latest.bridge_request_id, `correlation-${index}`);
    if (outcome.queued) {
      assert.equal(latest.error, outcome.message);
      const repeated = await request(t, "/api/bodydrop", { user: { ...user, steam_id: steam }, body: { dropType: "small" } });
      assert.equal(repeated.status, 429);
    }
  }
});

test("legacy Body Drop requires explicit mode; unknown modes never write", async (t) => {
  configure(t);
  const legacy = t.mock.method(files, "executeGameAction", async () => ({ ok: true, queued: true }));
  process.env.BODYDROP_BRIDGE_MODE = "legacy";
  assert.equal((await bodyDrop.executeBodyDrop({ steamId: steam })).queued, true);
  assert.equal(legacy.mock.callCount(), 1);
  process.env.BODYDROP_BRIDGE_MODE = "invalid";
  assert.equal((await bodyDrop.executeBodyDrop({ steamId: steam })).ok, false);
  assert.equal(legacy.mock.callCount(), 1);
});

test("DinoStorage store handler is callable at page scope and reports errors", async () => {
  const alerts = [];
  const context = vm.createContext({
    window: { HDS: { api: async () => { throw new Error("bridge disabled"); }, escapeHtml: (value) => value } },
    document: { querySelectorAll: () => [], getElementById: () => null },
    alert: (message) => alerts.push(message),
  });
  const source = fs.readFileSync(path.join(__dirname, "..", "public", "assets", "mydinos.js"), "utf8");
  // Do not run page initialization; exercise the declared browser handler.
  vm.runInContext(source.replace(/init\(\);?\s*$/, ""), context);
  assert.equal(typeof context.runDinoStorageStore, "function");
  await context.runDinoStorageStore();
  assert.deepEqual(alerts, ["bridge disabled"]);
});
