const test = require("node:test");
const assert = require("node:assert/strict");
const { scryptSync } = require("node:crypto");
const express = require("express");

process.env.DB_PATH = ":memory:";
process.env.OWNER_STEAM_ID = "76561198038977506";
process.env.SESSION_SECRET = "owner-finance-test-session-secret";
delete process.env.STRIPE_FINANCE_READ_KEY;
delete process.env.STRIPE_SECRET_KEY;

const { db } = require("../server/db");
const { createApp } = require("../server/index");
const { isFinanceOwner, requireFinanceOwner } = require("../server/middleware/requireFinanceOwner");

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}
function base(server) { return "http://127.0.0.1:" + server.address().port; }

test("finance gate rejects staff admins, namesakes and missing owner configuration", () => {
  const owner = { steam_id: "76561198038977506", is_admin: 1 };
  const staff = { steam_id: "76561198137456735", is_admin: 1 };
  assert.equal(isFinanceOwner(owner), true);
  assert.equal(isFinanceOwner(staff), false);
  assert.equal(isFinanceOwner({ username: "Goofy", is_admin: 1 }), false);
  assert.equal(isFinanceOwner(owner, {}), false);
  assert.equal(isFinanceOwner(owner, { OWNER_STEAM_ID: "invalid" }), false);
});

test("direct HTML and API addresses are denied for anyone but owner", async (t) => {
  const app = express();
  app.use((req, _res, next) => {
    req.user = req.headers["x-test-user"] === "owner"
      ? { steam_id: process.env.OWNER_STEAM_ID }
      : req.headers["x-test-user"] === "staff"
        ? { steam_id: "76561198137456735", is_admin: 1 }
        : null;
    next();
  });
  app.get("/admin/finance", requireFinanceOwner, (_req, res) => res.send("owner page"));
  app.get("/api/admin/finance", requireFinanceOwner, (_req, res) => res.json({ balance: "private" }));
  const server = await listen(app);
  t.after(() => new Promise((resolve) => server.close(resolve)));
  for (const url of ["/admin/finance", "/api/admin/finance"]) {
    for (const identity of ["staff", ""]) {
      const response = await fetch(base(server) + url, {
        headers: { "x-test-user": identity },
      });
      assert.equal(response.status, 404, identity + " " + url);
      assert.match(response.headers.get("cache-control"), /no-store/);
    }
    const permitted = await fetch(base(server) + url, { headers: { "x-test-user": "owner" } });
    assert.equal(permitted.status, 200);
  }
});

test("real site permits configured owner login but not anonymous direct finance URLs", async (t) => {
  const ownerId = process.env.OWNER_STEAM_ID;
  const password = "safe-owner-password-2026";
  const salt = "test-owner-salt";
  const hash = scryptSync(password, salt, 64).toString("hex");
  db.prepare("INSERT OR IGNORE INTO users (steam_id, username, is_admin) VALUES (?, ?, 1)")
    .run(ownerId, "Goofy");
  db.prepare(
    "INSERT INTO owner_logins (steam_id, email, password_salt, password_hash, session_version) VALUES (?, ?, ?, ?, ?)"
  ).run(ownerId, "owner@example.com", salt, hash, "finance-test-session-v1");
  const server = await listen(createApp());
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = base(server);

  for (const path of ["/admin/finance", "/api/admin/finance"]) {
    assert.equal((await fetch(url + path)).status, 404, path);
  }
  const noAccess = await fetch(url + "/api/me");
  assert.equal((await noAccess.json()).financeOwnerAccess, false);

  const login = await fetch(url + "/auth/owner/login", {
    method: "POST",
    headers: { Origin: url, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "owner@example.com", password }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const page = await fetch(url + "/admin/finance", { headers: { Cookie: cookie } });
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Owner Finance/);
  const me = await fetch(url + "/api/me", { headers: { Cookie: cookie } });
  assert.equal((await me.json()).financeOwnerAccess, true);
  const apiResult = await fetch(url + "/api/admin/finance", { headers: { Cookie: cookie } });
  assert.equal(apiResult.status, 503); // owner passed guard; no Stripe secret was configured
  const result = await apiResult.json();
  assert.equal(result.error, "Stripe finance reporting is not configured.");
});
