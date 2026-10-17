const { spawnSync } = require("node:child_process");
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const root = path.join(__dirname, "..");

function check(enabled) {
  const child = `
    const { createApp } = require("./server/index");
    const { db } = require("./server/db");
    const app = createApp();
    const server = app.listen(0, "127.0.0.1", async () => {
      const base = "http://127.0.0.1:" + server.address().port;
      const paths = [
        "/adminterritorywars", "/adminterritorywars.html",
        "/groups/territory-wars/", "/groups/territory-wars/index.html",
        "/api/territory-wars/state", "/api/territory-wars/admin/state",
      ];
      try {
        const statuses = [];
        for (const pathname of paths) {
          const r = await fetch(base + pathname, { redirect: "manual" });
          statuses.push(r.status);
        }
        const me = await (await fetch(base + "/api/me")).json();
        const tables = db.prepare("SELECT count(*) as count FROM sqlite_master WHERE type='table' AND name LIKE 'territory_%'").get().count;
        process.stdout.write(JSON.stringify({ statuses, tables, meAccess:me.territoryWarsAdminAccess }) + "\\n");
      } catch (err) {
        console.error(err);
        process.exitCode = 1;
      } finally {
        server.close();
      }
    });
  `;
  const result = spawnSync(process.execPath, ["-e", child], {
    cwd: root,
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, DB_PATH: ":memory:", TERRITORY_WARS_ADMIN_TEST_ENABLED: enabled ? "1" : "0" },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const line = result.stdout.trim().split("\n").find(s => s.startsWith('{"statuses"'));
  assert.ok(line, result.stdout);
  return JSON.parse(line);
}

test("live site defaults to dormant Territory Wars without SQLite territory migrations",()=>{
  const data=check(false);
  assert.deepEqual(data.statuses, [404,404,404,404,404,404]);
  assert.equal(data.tables, 0);
  assert.equal(data.meAccess,false);
});

test("enabling the test still blocks guest API, admin page and direct player HTML",()=>{
  const data=check(true);
  assert.deepEqual(data.statuses,[401,401,401,401,401,401]);
  assert.ok(data.tables > 0);
  assert.equal(data.meAccess,false);
});
