const test = require("node:test");
const assert = require("node:assert/strict");
const { Client: FtpClient } = require("basic-ftp");
const files = require("../server/services/sftpBridge");

test("explicit FTPS passes the legacy certificate override only to basic-ftp", async (t) => {
  const env = {
    GAME_FILE_PROTOCOL: "ftp",
    SFTP_HOST: "host.invalid",
    SFTP_PORT: "21",
    SFTP_USER: "test",
    SFTP_PASSWORD: "test-password",
    FTP_SECURE: "true",
  };
  const original = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  let accessOptions;
  t.mock.method(FtpClient.prototype, "access", async (options) => { accessOptions = options; });
  t.mock.method(FtpClient.prototype, "close", () => {});

  const client = files.createFileBridgeClient();
  await client.connect(files.getFileBridgeConfig());
  await client.end();

  assert.equal(accessOptions.secure, true);
  assert.deepEqual(accessOptions.secureOptions, { rejectUnauthorized: false });
});
