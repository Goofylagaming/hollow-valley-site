const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const session = require("express-session");

process.env.DB_PATH = ":memory:";
process.env.OWNER_STEAM_ID = "76561198038977506";
const { db } = require("../server/db");
const ownerRouter = require("../server/authOwner");
const { requireAdmin } = require("../server/middleware/requireAuth");
const { createApp } = require("../server/index");

test("only a recently Steam-verified owner can set up email access; login uses that account", async (t) => {
  db.prepare("INSERT INTO users (steam_id, username) VALUES (?, ?)").run(process.env.OWNER_STEAM_ID, "Owner");
  db.prepare("INSERT INTO users (steam_id, username, is_admin) VALUES (?, ?, 1)").run("76561198137456735", "Other admin");
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test-session-secret", resave: false, saveUninitialized: false }));
  app.use((req, _res, next) => {
    if (req.session.userId) req.user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.session.userId);
    next();
  });
  // Stand in for a verified Steam callback to exercise the owner route.
  app.post("/test-steam", (req, res) => {
    req.session.userId = db.prepare("SELECT id FROM users WHERE steam_id = ?").get(req.body.steamId).id;
    req.session.steamVerifiedId = req.body.steamId;
    req.session.steamVerifiedAt = Date.now();
    res.json({ ok: true });
  });
  app.use("/auth/owner", ownerRouter);
  app.get("/admin-check", requireAdmin, (_req, res) => res.json({ ok: true }));
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function post(path, body, cookie, origin = base) {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    });
    return { response, cookie: response.headers.get("set-cookie")?.split(";")[0] || cookie };
  }

  let owner = await post("/test-steam", { steamId: process.env.OWNER_STEAM_ID });
  let other = await post("/test-steam", { steamId: "76561198137456735" });
  const credentials = { email: "Owner@Example.com", password: "very-long-owner-password-2026" };
  assert.equal((await post("/auth/owner/setup", credentials, other.cookie)).response.status, 403);
  assert.equal((await post("/auth/owner/setup", credentials, owner.cookie, "https://evil.example")).response.status, 403);
  assert.equal((await post("/auth/owner/setup", credentials, owner.cookie)).response.status, 200);
  assert.equal((await post("/auth/owner/setup", credentials, owner.cookie)).response.status, 403);

  const stored = db.prepare("SELECT email, password_hash FROM owner_logins").get();
  assert.equal(stored.email, "owner@example.com");
  assert.ok(!stored.password_hash.includes(credentials.password));
  assert.equal((await post("/auth/owner/login", { ...credentials, password: "wrong" })).response.status, 401);
  const login = await post("/auth/owner/login", credentials);
  assert.equal(login.response.status, 200);
  const admin = await fetch(`${base}/admin-check`, { headers: { Cookie: login.cookie } });
  assert.equal(admin.status, 200);
  const ownerRow = db.prepare("SELECT is_admin FROM users WHERE steam_id = ?").get(process.env.OWNER_STEAM_ID);
  assert.equal(ownerRow.is_admin, 1);

  const site = createApp().listen(0);
  t.after(() => site.close());
  await new Promise((resolve) => site.once("listening", resolve));
  const siteBase = `http://127.0.0.1:${site.address().port}`;
  const siteLogin = await fetch(`${siteBase}/auth/owner/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: siteBase },
    body: JSON.stringify(credentials),
  });
  assert.equal(siteLogin.status, 200);
  const siteCookie = siteLogin.headers.get("set-cookie").split(";")[0];
  assert.equal((await fetch(`${siteBase}/admin`, { headers: { Cookie: siteCookie } })).status, 200);

  owner = await post("/test-steam", { steamId: process.env.OWNER_STEAM_ID }, owner.cookie);
  const reset = await post("/auth/owner/setup", { email: "new@example.com", password: "another-long-password-2026" }, owner.cookie);
  assert.equal(reset.response.status, 200);
  assert.equal((await fetch(`${siteBase}/admin`, { headers: { Cookie: siteCookie } })).status, 401);
  assert.equal((await fetch(`${siteBase}/auth/owner/status`, { headers: { Cookie: siteCookie } })).status, 200);
  assert.equal((await fetch(`${siteBase}/admin`, { headers: { Cookie: siteCookie } })).status, 401);
});
