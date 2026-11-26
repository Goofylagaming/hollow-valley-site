"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
process.env.DB_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hv-arcade-route-")), "site.sqlite");
process.env.VALLEY_ARCADE_ENABLED = "1";
const express = require("express");
const client = require("../server/services/automationWebsiteClient");
const { db } = require("../server/db");

const you = "76561198000000111";
const hidden = "76561198000000222";
const calls = [];
const state = { weekly: null };
client.arcadeRequest = async (action, body) => {
  calls.push({ action, body });
  if (action === "weekly") return state.weekly;
  return { ok: true, state: action };
};
delete require.cache[require.resolve("../server/routes/valleyArcade")];
const route = require("../server/routes/valleyArcade");
db.prepare("INSERT INTO users(username, steam_id) VALUES (?, ?)").run("Josh", you);
db.prepare("INSERT INTO users(username, steam_id) VALUES (?, ?)").run("Survivor12345", hidden);

function appFor(user) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use("/api/valley-arcade", route);
  return app;
}
async function listen(user) {
  const server = appFor(user).listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin,
    close: () => new Promise(resolve => server.close(resolve)),
    request(path, body, originOverride = origin) {
      return fetch(origin + "/api/valley-arcade" + path, {
        method: body ? "POST" : "GET",
        headers: { Origin: originOverride, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined
      });
    }
  };
}

test("valley arcade routes keep identity, timing and names on the server", async (t) => {
await t.test("weekly leaderboard uses the session player and strips steam ids", async () => {
  state.weekly = {
    weekStart: "2026-11-23", weekEnd: "2026-11-29", resetAt: 1,
    entries: [{ rank: 1, steamId: hidden, score: 9 }, { rank: 2, steamId: you, score: 3 }],
    you: { rank: 2, steamId: you, score: 3 }
  };
  const server = await listen({ id: 7, steam_id: you, username: "Josh", is_admin: 0 });
  try {
    calls.length = 0;
    const response = await server.request("/weekly?steamId=" + hidden);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-store/);
    const payload = await response.json();
    assert.equal(payload.entries[1].name, "Josh");
    assert.match(payload.entries[0].name, /^Survivor #\d{4}$/);
    assert.equal(payload.you.rank, 2);
    assert.equal(JSON.stringify(payload).includes(you), false);
    assert.equal(JSON.stringify(payload).includes(hidden), false);
    assert.equal(JSON.stringify(payload).includes("12345"), false);
    assert.equal(calls[0].action, "weekly");
    assert.equal(calls[0].body.steamId, you);
  } finally { await server.close(); }
});

await t.test("reaction and memory forwards keep the server clock and session identity", async () => {
  const server = await listen({ id: 7, steam_id: you, username: "Josh", is_admin: 0 });
  try {
    calls.length = 0;
    assert.equal((await server.request("/signal", { id: "round-1", now: 5, opens: 9 })).status, 200);
    assert.deepEqual(calls.at(-1).body, { steamId: you, id: "round-1" });
    assert.equal((await server.request("/flip", { id: "round-2", position: 3, board: ["Egg"] })).status, 200);
    assert.deepEqual(calls.at(-1).body, { steamId: you, id: "round-2", position: 3 });
    assert.equal((await server.request("/answer", { id: "round-3", choice: "Tap", token: "abc", reactionMs: 1, score: 1, now: 5 })).status, 200);
    assert.deepEqual(calls.at(-1).body, { steamId: you, id: "round-3", choice: "Tap", token: "abc" });
    assert.equal((await server.request("/answer", { id: "round-4", choice: "Tap", token: 12 })).status, 200);
    assert.equal(calls.at(-1).body.token, undefined);
    assert.equal((await server.request("/signal", { id: "round-5" }, "https://attacker.example")).status, 403);
    assert.equal(calls.at(-1).action, "answer");
  } finally { await server.close(); }
});

await t.test("anonymous and disabled arcade requests never reach automation", async () => {
  const anon = await listen(null);
  try {
    calls.length = 0;
    assert.equal((await anon.request("/weekly")).status, 401);
    assert.equal(calls.length, 0);
  } finally { await anon.close(); }
  process.env.VALLEY_ARCADE_ENABLED = "0";
  const signedIn = await listen({ id: 7, steam_id: you, username: "Josh", is_admin: 0 });
  try {
    calls.length = 0;
    assert.equal((await signedIn.request("/weekly")).status, 404);
    assert.equal((await signedIn.request("/signal", { id: "round" })).status, 404);
    assert.equal(calls.length, 0);
  } finally {
    process.env.VALLEY_ARCADE_ENABLED = "1";
    await signedIn.close();
  }
});
});
