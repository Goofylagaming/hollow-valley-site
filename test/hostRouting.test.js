const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { createApp, HOLLOW_VALLEY_HOSTNAME } = require("../server/index");

async function request(pathname, host) {
  const app = createApp();
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  try {
    const { port } = server.address();
    return await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: pathname,
          method: "GET",
          headers: { Host: host },
        },
        (res) => {
          let body = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => { body += chunk; });
          res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
        }
      );
      req.on("error", reject);
      req.end();
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

for (const legacyHost of [
  "herbydeathsquadgames.com",
  "www.herbydeathsquadgames.com",
  "hollowvalley.herbydeathsquadgames.com",
  "www.hollowvalleyisle.com",
]) {
  test(`${legacyHost} redirects to the canonical Hollow Valley Isle domain`, async () => {
    const response = await request("/dashboard?tab=wallet", legacyHost);
    assert.strictEqual(response.status, 308);
    assert.strictEqual(
      response.headers.location,
      `https://${HOLLOW_VALLEY_HOSTNAME}/dashboard?tab=wallet`
    );
  });
}

test("HollowValleyIsle.com serves the main portal", async () => {
  const response = await request("/", HOLLOW_VALLEY_HOSTNAME);
  assert.strictEqual(response.status, 200);
  assert.match(response.body, /COMMAND CENTER/);
  assert.match(response.body, /View my dinos/);
});
