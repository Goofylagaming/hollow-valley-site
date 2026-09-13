const test = require("node:test");
const assert = require("node:assert/strict");
const parkHandler = require("../api/park");
const playerdataHandler = require("../api/playerdata");

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
