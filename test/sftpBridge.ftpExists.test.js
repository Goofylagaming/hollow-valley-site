const test = require("node:test");
const assert = require("node:assert/strict");
const { Client: FtpClient } = require("basic-ftp");
const files = require("../server/services/sftpBridge");

test("FTP exists checks the file with SIZE and does not LIST the parent directory", async (t) => {
  const originalProtocol = process.env.GAME_FILE_PROTOCOL;
  process.env.GAME_FILE_PROTOCOL = "ftp";
  t.after(() => {
    if (originalProtocol === undefined) delete process.env.GAME_FILE_PROTOCOL;
    else process.env.GAME_FILE_PROTOCOL = originalProtocol;
  });

  const target = "/TheIsle/Binaries/Win64/ue4ss/Mods/CommandBridge/Saved/results.ndjson";
  const size = t.mock.method(FtpClient.prototype, "size", async (remotePath) => {
    assert.equal(remotePath, target);
    return 0;
  });
  const list = t.mock.method(FtpClient.prototype, "list", async () => {
    assert.fail("FTP exists must not LIST the parent directory");
  });

  const client = files.createFileBridgeClient();
  assert.equal(await client.exists(target), true);
  assert.equal(size.mock.callCount(), 1);
  assert.equal(list.mock.callCount(), 0);
});

test("FTP exists treats a missing-file SIZE response as false", async (t) => {
  const originalProtocol = process.env.GAME_FILE_PROTOCOL;
  process.env.GAME_FILE_PROTOCOL = "ftp";
  t.after(() => {
    if (originalProtocol === undefined) delete process.env.GAME_FILE_PROTOCOL;
    else process.env.GAME_FILE_PROTOCOL = originalProtocol;
  });

  t.mock.method(FtpClient.prototype, "size", async () => {
    const err = new Error("550 No such file or directory");
    err.code = 550;
    throw err;
  });

  const client = files.createFileBridgeClient();
  assert.equal(await client.exists("/missing/results.ndjson"), false);
});
