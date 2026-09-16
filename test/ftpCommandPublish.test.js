const test = require("node:test");
const assert = require("node:assert/strict");
const { Client: FtpClient } = require("basic-ftp");
const files = require("../server/services/sftpBridge");

const queuePath = "/TheIsle/Binaries/Win64/ue4ss/Mods/CommandBridge/Saved/commands.ndjson";
const queueDirectory = "/TheIsle/Binaries/Win64/ue4ss/Mods/CommandBridge/Saved";
const queueName = "commands.ndjson";

function missing(path) {
  const err = new Error(`550 ${path}: No such file or directory`);
  err.code = 550;
  return err;
}

function configureFtp(t) {
  const env = {
    GAME_FILE_PROTOCOL: "ftp",
    SFTP_HOST: "host.invalid",
    SFTP_PORT: "21",
    SFTP_USER: "test",
    SFTP_PASSWORD: "test-password",
    FTP_SECURE: "false",
  };
  const original = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  t.mock.method(FtpClient.prototype, "access", async () => {});
  t.mock.method(FtpClient.prototype, "close", () => {});
}

test("FTP CommandBridge publish CWDs into Saved and uses filename-only STOR/RNFR/RNTO", async (t) => {
  configureFtp(t);
  const cd = t.mock.method(FtpClient.prototype, "cd", async () => {});
  t.mock.method(FtpClient.prototype, "size", async (path) => {
    assert.equal(path, queueName);
    throw missing(path);
  });
  let uploadedPath;
  let uploadedBody;
  t.mock.method(FtpClient.prototype, "uploadFrom", async (stream, path) => {
    uploadedPath = path;
    const chunks = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    uploadedBody = Buffer.concat(chunks).toString("utf8");
  });
  const rename = t.mock.method(FtpClient.prototype, "rename", async () => {});
  const appendFrom = t.mock.method(FtpClient.prototype, "appendFrom", async () => assert.fail("APPE must not be used for CommandBridge"));
  const remove = t.mock.method(FtpClient.prototype, "remove", async () => {});

  const client = files.createFileBridgeClient();
  await client.connect(files.getFileBridgeConfig());
  await client.append(Buffer.from('{"id":"test"}\n'), queuePath);

  assert.match(uploadedPath, /^commands\.ndjson\.upload-[0-9a-f-]{36}$/);
  assert.equal(uploadedPath.includes("/"), false);
  assert.equal(uploadedBody, '{"id":"test"}\n');
  assert.equal(rename.mock.callCount(), 1);
  assert.equal(rename.mock.calls[0].arguments[0], uploadedPath);
  assert.equal(rename.mock.calls[0].arguments[1], queueName);
  assert.equal(cd.mock.callCount(), 2);
  assert.equal(cd.mock.calls[0].arguments[0], queueDirectory);
  assert.equal(cd.mock.calls[1].arguments[0], "/");
  assert.equal(appendFrom.mock.callCount(), 0);
  assert.equal(remove.mock.callCount(), 0);
});

test("FTP CommandBridge publish refuses to overwrite an existing live queue", async (t) => {
  configureFtp(t);
  const cd = t.mock.method(FtpClient.prototype, "cd", async () => {});
  t.mock.method(FtpClient.prototype, "size", async (path) => {
    assert.equal(path, queueName);
    return 42;
  });
  const uploadFrom = t.mock.method(FtpClient.prototype, "uploadFrom", async () => {});
  const rename = t.mock.method(FtpClient.prototype, "rename", async () => {});

  const client = files.createFileBridgeClient();
  await client.connect(files.getFileBridgeConfig());
  await assert.rejects(
    client.append(Buffer.from('{"id":"test"}\n'), queuePath),
    /already exists.*refusing to overwrite/i
  );

  assert.equal(uploadFrom.mock.callCount(), 0);
  assert.equal(rename.mock.callCount(), 0);
  assert.equal(cd.mock.callCount(), 2);
  assert.equal(cd.mock.calls[0].arguments[0], queueDirectory);
  assert.equal(cd.mock.calls[1].arguments[0], "/");
});

test("FTP CommandBridge publish cleans its temp file if a queue appears during staging", async (t) => {
  configureFtp(t);
  const cd = t.mock.method(FtpClient.prototype, "cd", async () => {});
  let sizeCalls = 0;
  t.mock.method(FtpClient.prototype, "size", async (path) => {
    assert.equal(path, queueName);
    sizeCalls += 1;
    if (sizeCalls === 1) throw missing(path);
    return 42;
  });
  let uploadedPath;
  t.mock.method(FtpClient.prototype, "uploadFrom", async (stream, path) => {
    uploadedPath = path;
    for await (const _chunk of stream) { /* drain */ }
  });
  const rename = t.mock.method(FtpClient.prototype, "rename", async () => {});
  const remove = t.mock.method(FtpClient.prototype, "remove", async () => {});

  const client = files.createFileBridgeClient();
  await client.connect(files.getFileBridgeConfig());
  await assert.rejects(
    client.append(Buffer.from('{"id":"test"}\n'), queuePath),
    /appeared while staging.*refusing to overwrite/i
  );

  assert.equal(rename.mock.callCount(), 0);
  assert.equal(remove.mock.callCount(), 1);
  assert.equal(remove.mock.calls[0].arguments[0], uploadedPath);
  assert.equal(uploadedPath.includes("/"), false);
  assert.equal(cd.mock.callCount(), 2);
  assert.equal(cd.mock.calls[0].arguments[0], queueDirectory);
  assert.equal(cd.mock.calls[1].arguments[0], "/");
});

test("FTP CommandBridge publish attempts temp cleanup when STOR itself fails", async (t) => {
  configureFtp(t);
  const cd = t.mock.method(FtpClient.prototype, "cd", async () => {});
  t.mock.method(FtpClient.prototype, "size", async (path) => { throw missing(path); });
  let attemptedPath;
  t.mock.method(FtpClient.prototype, "uploadFrom", async (_stream, path) => {
    attemptedPath = path;
    throw new Error("read ECONNRESET (data socket)");
  });
  const remove = t.mock.method(FtpClient.prototype, "remove", async () => {});

  const client = files.createFileBridgeClient();
  await client.connect(files.getFileBridgeConfig());
  await assert.rejects(
    client.append(Buffer.from('{"id":"test"}\n'), queuePath),
    /ECONNRESET/
  );

  assert.match(attemptedPath, /^commands\.ndjson\.upload-[0-9a-f-]{36}$/);
  assert.equal(remove.mock.callCount(), 1);
  assert.equal(remove.mock.calls[0].arguments[0], attemptedPath);
  assert.equal(cd.mock.callCount(), 2);
  assert.equal(cd.mock.calls[0].arguments[0], queueDirectory);
  assert.equal(cd.mock.calls[1].arguments[0], "/");
});

test("FTP append for non-CommandBridge files keeps APPE semantics", async (t) => {
  configureFtp(t);
  const cd = t.mock.method(FtpClient.prototype, "cd", async () => {});
  const appendFrom = t.mock.method(FtpClient.prototype, "appendFrom", async (stream, path) => {
    assert.equal(path, "/TheIsle/Binaries/Win64/ue4ss/Mods/BodyDrop/Saved/inbox.ndjson");
    for await (const _chunk of stream) { /* drain */ }
  });
  const uploadFrom = t.mock.method(FtpClient.prototype, "uploadFrom", async () => assert.fail("STOR should not replace generic append"));

  const client = files.createFileBridgeClient();
  await client.connect(files.getFileBridgeConfig());
  await client.append(Buffer.from("line\n"), "/TheIsle/Binaries/Win64/ue4ss/Mods/BodyDrop/Saved/inbox.ndjson");

  assert.equal(appendFrom.mock.callCount(), 1);
  assert.equal(uploadFrom.mock.callCount(), 0);
  assert.equal(cd.mock.callCount(), 0);
});

test("FTP CommandBridge publish falls back to walking the Saved path when absolute CWD is rejected", async (t) => {
  configureFtp(t);
  const expectedSegments = ["TheIsle", "Binaries", "Win64", "ue4ss", "Mods", "CommandBridge", "Saved"];
  const cdCalls = [];
  t.mock.method(FtpClient.prototype, "cd", async (path) => {
    cdCalls.push(path);
    if (path === queueDirectory) throw missing(path);
  });
  t.mock.method(FtpClient.prototype, "size", async (path) => {
    assert.equal(path, queueName);
    throw missing(path);
  });
  t.mock.method(FtpClient.prototype, "uploadFrom", async (stream, path) => {
    assert.match(path, /^commands\.ndjson\.upload-[0-9a-f-]{36}$/);
    for await (const _chunk of stream) { /* drain */ }
  });
  t.mock.method(FtpClient.prototype, "rename", async () => {});
  t.mock.method(FtpClient.prototype, "remove", async () => {});

  const client = files.createFileBridgeClient();
  await client.connect(files.getFileBridgeConfig());
  await client.append(Buffer.from('{"id":"test"}\n'), queuePath);

  assert.deepEqual(cdCalls, [queueDirectory, "/", ...expectedSegments, "/"]);
});
