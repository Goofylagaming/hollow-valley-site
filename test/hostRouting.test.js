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
          res.on("data", (chunk) => {
            body += chunk;
          });
          res.on("end", () => {
            resolve({ status: res.statusCode, headers: res.headers, body });
          });
        }
      );
      req.on("error", reject);
      req.end();
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("root domain serves the studio landing page", async () => {
  const response = await request("/", "herbydeathsquadgames.com");

  assert.strictEqual(response.status, 200);
  assert.match(response.body, /Herby Death Squad Games/);
  assert.match(response.body, /Enter the Server/);
});

test("root domain app paths redirect to the Hollow Valley subdomain", async () => {
  const response = await request("/dashboard?tab=wallet", "herbydeathsquadgames.com");

  assert.strictEqual(response.status, 302);
  assert.strictEqual(response.headers.location, `https://${HOLLOW_VALLEY_HOSTNAME}/dashboard?tab=wallet`);
});

test("the Hollow Valley subdomain still serves the main portal", async () => {
  const response = await request("/", HOLLOW_VALLEY_HOSTNAME);

  assert.strictEqual(response.status, 200);
  assert.match(response.body, /COMMAND CENTER/);
  assert.match(response.body, /View my dinos/);
});
