const test = require("node:test");
const assert = require("node:assert/strict");
const { Client: FtpClient } = require("basic-ftp");
const SftpClient = require("ssh2-sftp-client");
const { executeGameAction, getBodyDropInboxRemotePath } = require("../server/services/sftpBridge");

function configure(t, overrides = {}) {
  const values = {
    GAME_FILE_PROTOCOL: "ftp",
    SFTP_HOST: "file-host.invalid",
    SFTP_PORT: "21",
    SFTP_USER: "test-user",
    SFTP_PASSWORD: "test-password",
    SFTP_BASE_PATH: "/",
    BODYDROP_INBOX_PATH: "",
    FTP_SECURE: "false",
    ...overrides,
  };
  const original = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

const action = {
  action: "body_drop",
  bodyDropRequestId: 42,
  steamId: "76561198000000000",
  species: "Dryosaurus",
  growth: 1,
  location: { x: 12, y: -8, z: 44 },
};
const defaultPath = "/TheIsle/Binaries/Win64/ue4ss/Mods/HollowValleyBodyDrop/Saved/inbox.ndjson";

test("Body Drop resolves FTP-root, nested, Windows-separated and absolute paths", (t) => {
  configure(t);
  assert.equal(getBodyDropInboxRemotePath(), defaultPath);
  process.env.SFTP_BASE_PATH = " /games//isle/ ";
  assert.equal(getBodyDropInboxRemotePath(), `/games/isle${defaultPath}`);
  process.env.SFTP_BASE_PATH = "\\games\\isle\\";
  process.env.BODYDROP_INBOX_PATH = "Mods\\HollowValleyBodyDrop\\Saved\\inbox.ndjson";
  assert.equal(getBodyDropInboxRemotePath(), `/games/isle${defaultPath}`);
  delete process.env.SFTP_BASE_PATH;
  process.env.BODYDROP_INBOX_PATH = "/custom//mod/inbox.ndjson";
  assert.equal(getBodyDropInboxRemotePath(), "/custom/mod/inbox.ndjson");
});

test("Body Drop rejects ambiguous, traversal and non-file inbox paths", (t) => {
  configure(t);
  for (const path of [
    "ue4ss/Mods/HollowValleyBodyDrop/Saved/inbox.ndjson",
    "TheIsle/Binaries/Win64/ue4ss/Mods/inbox.ndjson",
    "Mods\\..\\inbox.ndjson",
    "/Mods/../inbox.ndjson",
    "Mods/./inbox.ndjson",
    "C:\\server\\inbox.ndjson",
    "Mods/inbox.ndjson\nDELE file",
    "Mods/Saved/",
    "   ",
  ]) {
    process.env.BODYDROP_INBOX_PATH = path;
    assert.throws(() => getBodyDropInboxRemotePath(), /BODYDROP_INBOX_PATH/);
  }
  process.env.BODYDROP_INBOX_PATH = "";
  for (const path of [" ", "/games/../isle", "C:\\server"]) {
    process.env.SFTP_BASE_PATH = path;
    assert.throws(() => getBodyDropInboxRemotePath(), /SFTP_BASE_PATH/);
  }
});

function mockFtp(t) {
  t.mock.method(FtpClient.prototype, "access", async () => {});
  t.mock.method(FtpClient.prototype, "close", () => {});
  for (const method of ["ensureDir", "size", "downloadTo", "uploadFrom"]) {
    t.mock.method(FtpClient.prototype, method, async () => {
      assert.fail(`Body Drop must not call ${method}: only append the live inbox`);
    });
  }
}

test("FTP Body Drop appends one spawn job without rewriting or creating a mod tree", async (t) => {
  configure(t);
  mockFtp(t);
  const log = t.mock.method(console, "info", () => {});
  let appended;
  t.mock.method(FtpClient.prototype, "appendFrom", async (stream, remotePath) => {
    assert.equal(remotePath, defaultPath);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    appended = Buffer.concat(chunks).toString("utf8");
  });
  const result = await executeGameAction(action);
  assert.equal(result.ok, true);
  assert.equal(result.queued, true);
  assert.match(result.message, /not yet confirmed/);
  assert.equal(appended.split("\n").length, 2);
  const job = JSON.parse(appended);
  assert.equal(job.action, "spawn");
  assert.equal(job.id, 42);
  assert.equal(job.species, "Dryosaurus");
  assert.deepEqual({ x: job.x, y: job.y, z: job.z }, action.location);
  const context = log.mock.calls[0].arguments[1];
  assert.equal(context.remotePath, defaultPath);
  assert.equal(context.requestId, result.requestId);
  assert.equal(context.protocol, "ftp");
  assert.equal(context.bodyDropRequestId, 42);
  assert.ok(!JSON.stringify(context).includes("test-password"));
});

test("FTP append failure exposes stage and correlation ID without a rewrite fallback", async (t) => {
  configure(t);
  mockFtp(t);
  const log = t.mock.method(console, "error", () => {});
  t.mock.method(FtpClient.prototype, "appendFrom", async () => {
    throw new Error("550 Directory unavailable");
  });
  const result = await executeGameAction(action);
  assert.equal(result.ok, false);
  assert.equal(result.queued, undefined);
  assert.match(result.error, /append inbox.*550 Directory unavailable/);
  assert.match(result.error, /Saved folder/);
  assert.match(result.requestId, /^req_/);
  assert.equal(log.mock.calls[0].arguments[1].remotePath, defaultPath);
  assert.equal(log.mock.calls[0].arguments[1].requestId, result.requestId);
  assert.equal(FtpClient.prototype.close.mock.callCount(), 1);
});

test("invalid bridge ports fail before a network connection", async (t) => {
  configure(t);
  mockFtp(t);
  t.mock.method(console, "error", () => {});
  for (const port of ["", "0", "-1", "65536", "21.5", "invalid"]) {
    process.env.SFTP_PORT = port;
    const result = await executeGameAction(action);
    assert.equal(result.ok, false);
    assert.match(result.error, /configuration.*SFTP_PORT/);
  }
  assert.equal(FtpClient.prototype.access.mock.callCount(), 0);
});

test("connection errors are distinguishable from inbox write errors", async (t) => {
  configure(t);
  mockFtp(t);
  t.mock.method(console, "error", () => {});
  t.mock.method(FtpClient.prototype, "access", async () => {
    throw new Error("530 Login incorrect");
  });
  const result = await executeGameAction(action);
  assert.equal(result.ok, false);
  assert.match(result.error, /\(connect\).*530 Login incorrect/);
  assert.match(result.requestId, /^req_/);
});

test("SFTP Body Drop retains append semantics and the same queue destination", async (t) => {
  configure(t, { GAME_FILE_PROTOCOL: "sftp", SFTP_PORT: "22" });
  t.mock.method(console, "info", () => {});
  t.mock.method(SftpClient.prototype, "connect", async (config) => {
    assert.equal(config.username, "test-user");
    assert.equal(config.port, 22);
  });
  const append = t.mock.method(SftpClient.prototype, "append", async (buffer, path) => {
    assert.equal(path, defaultPath);
    assert.equal(JSON.parse(buffer.toString()).action, "spawn");
  });
  t.mock.method(SftpClient.prototype, "mkdir", async () => assert.fail("Do not create a mod tree"));
  t.mock.method(SftpClient.prototype, "end", async () => {});
  const result = await executeGameAction(action);
  assert.equal(result.ok, true);
  assert.equal(result.queued, true);
  assert.equal(append.mock.callCount(), 1);
});

test("a connection cleanup failure cannot mark an uploaded job failed", async (t) => {
  configure(t, { GAME_FILE_PROTOCOL: "sftp", SFTP_PORT: "22" });
  t.mock.method(console, "info", () => {});
  const warning = t.mock.method(console, "warn", () => {});
  t.mock.method(SftpClient.prototype, "connect", async () => {});
  t.mock.method(SftpClient.prototype, "append", async () => {});
  t.mock.method(SftpClient.prototype, "end", async () => {
    throw new Error("Connection closed");
  });
  const result = await executeGameAction(action);
  assert.equal(result.ok, true);
  assert.equal(result.queued, true);
  assert.equal(warning.mock.callCount(), 1);
  assert.equal(warning.mock.calls[0].arguments[1].requestId, result.requestId);
});

test("Park still exchanges request/result files with a root base path", async (t) => {
  configure(t, { GAME_FILE_PROTOCOL: "sftp", SFTP_PORT: "22" });
  const base = "/TheIsle/Binaries/Win64/ue4ss/Mods/HollowValleyPark/Saved";
  let requestId;
  t.mock.method(SftpClient.prototype, "connect", async () => {});
  t.mock.method(SftpClient.prototype, "mkdir", async (path) => {
    assert.ok([`${base}/requests`, `${base}/results`].includes(path));
  });
  t.mock.method(SftpClient.prototype, "put", async (buffer, path) => {
    const job = JSON.parse(buffer.toString());
    requestId = job.requestId;
    assert.equal(job.action, "park");
    assert.equal(path, `${base}/requests/${requestId}.json`);
  });
  t.mock.method(SftpClient.prototype, "exists", async (path) => {
    assert.equal(path, `${base}/results/${requestId}.json`);
    return "-";
  });
  t.mock.method(SftpClient.prototype, "get", async () => Buffer.from('{"ok":true}'));
  t.mock.method(SftpClient.prototype, "delete", async (path) => {
    assert.equal(path, `${base}/results/${requestId}.json`);
  });
  t.mock.method(SftpClient.prototype, "end", async () => {});
  assert.deepEqual(await executeGameAction({ action: "park", steamId: action.steamId }), { ok: true });
});
