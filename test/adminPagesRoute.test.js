const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DB_PATH = ":memory:";
process.env.SESSION_SECRET = "admin-pages-test-secret";

const { createApp } = require("../server/index");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

test("all admin HTML routes are protected before static file serving", async (t) => {
  const server = await listen(createApp());
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  for (const path of [
    "/admin",
    "/admin.html",
    "/adminoperations",
    "/adminoperations.html",
    "/admincomms",
    "/admincomms.html",
    "/adminrestore",
    "/adminrestore.html",
  ]) {
    const response = await fetch(base + path, { redirect: "manual" });
    assert.equal(response.status, 401, path);
  }
});
