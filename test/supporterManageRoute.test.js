const test = require("node:test");
const assert = require("node:assert/strict");

process.env.DB_PATH = ":memory:";
process.env.STRIPE_SECRET_KEY = "sk_test_fixture";
process.env.STRIPE_PRICE_MEMBER = "price_test_member";
process.env.STRIPE_PRICE_ELITE = "price_test_elite";
process.env.STRIPE_PRICE_LEGEND = "price_test_legend";
process.env.RENDER_EXTERNAL_URL = "https://hollow-valley-site-test.onrender.com";

test("existing Stripe membership blocks duplicate checkout at the HTTP route", async (t) => {
  const express = require("express");
  const { db } = require("../server/db");
  const router = require("../server/routes/supporter");

  db.exec("DELETE FROM supporter_subscriptions; DELETE FROM users;");
  db.prepare("INSERT INTO users (id, username) VALUES (42, ?)").run("route-test");
  db.prepare(
    "INSERT INTO supporter_subscriptions (user_id, tier, auto_renew, stripe_subscription_id, stripe_status) VALUES (?, ?, 1, ?, ?)"
  ).run(42, "member", "sub_test_42", "active");

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.headers["x-test-auth"] === "yes") req.user = { id: 42 };
    next();
  });
  app.use("/api/supporter", router);

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await fetch(
    "http://127.0.0.1:" + server.address().port + "/api/supporter/legend/checkout",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-auth": "yes",
      },
      body: "{}",
    }
  );

  assert.equal(response.status, 409);
  const payload = await response.json();
  assert.match(payload.error, /already have a Stripe membership/i);
});
