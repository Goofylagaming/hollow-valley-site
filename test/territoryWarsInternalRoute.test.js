const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

process.env.DB_PATH = ":memory:";
process.env.TERRITORY_WARS_INTERNAL_TOKEN = "territory-internal-test-secret";

const { db } = require("../server/db");
// Import the main Territory Wars router once so the shared tables are initialized.
const territoryRouter = require("../server/routes/territoryWars");
const internalRouter = require("../server/routes/territoryWarsInternal");

function appForInternal() {
  const app = express();
  app.use(express.json());
  app.use("/api/territory-wars/internal", internalRouter);
  return app;
}

function appForPreviewRuntime() {
  const app = express();
  app.use(express.json());
  app.use("/api/territory-wars/internal", internalRouter);
  app.use("/api/territory-wars", territoryRouter);
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function baseUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(server, path, options = {}) {
  return fetch(`${baseUrl(server)}${path}`, {
    headers: {
      "content-type": "application/json",
      authorization: "Bearer territory-internal-test-secret",
      ...(options.headers || {}),
    },
    ...options,
  });
}

let sequence = 0;

function insertUser({ role = null, groupId = null, discord = true } = {}) {
  sequence += 1;
  const steamId = `76561198${String(200000000 + sequence).slice(-9)}`;
  const discordId = discord
    ? `22345678${String(1000000000 + sequence).slice(-10)}`
    : null;

  const result = db.prepare(`
    INSERT INTO users (discord_id, steam_id, username, is_admin)
    VALUES (?, ?, ?, 0)
  `).run(
    discordId,
    steamId,
    `InternalTester${sequence}`
  );

  const user = {
    id: Number(result.lastInsertRowid),
    discord_id: discordId,
    steam_id: steamId,
    username: `InternalTester${sequence}`,
  };

  if (groupId && role) {
    db.prepare(`
      INSERT INTO territory_group_members (group_id, user_id, role)
      VALUES (?, ?, ?)
    `).run(groupId, user.id, role);
  }

  return user;
}

function createGroup(leader) {
  const result = db.prepare(`
    INSERT INTO territory_groups (name, tag, leader_user_id)
    VALUES (?, ?, ?)
  `).run(
    `Internal Pack ${sequence}`,
    `I${String(sequence).slice(-4)}`,
    leader.id
  );

  const groupId = Number(result.lastInsertRowid);

  db.prepare(`
    INSERT INTO territory_group_members (group_id, user_id, role)
    VALUES (?, ?, 'leader')
  `).run(groupId, leader.id);

  db.prepare(
    "INSERT OR IGNORE INTO territory_group_stats (group_id) VALUES (?)"
  ).run(groupId);

  return groupId;
}

function createEvent({ status = "scheduled" } = {}) {
  const result = db.prepare(`
    INSERT INTO territory_events
      (name, territory_key, territory_name, status, owner_name, control_score)
    VALUES (?, 'south-plains', 'South Plains', ?, 'Admin', -100)
  `).run(`Internal Event ${sequence}`, status);

  return Number(result.lastInsertRowid);
}

test("internal Territory Wars endpoints reject bad service tokens", async (t) => {
  const server = await listen(appForInternal());
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await request(
    server,
    "/api/territory-wars/internal/roster",
    {
      method: "POST",
      headers: { authorization: "Bearer wrong-token" },
      body: JSON.stringify({ discordId: "223456789012345678" }),
    }
  );

  assert.equal(response.status, 401);
});

test("Discord leader can register Group, view roster and set scheduled lineup", async (t) => {
  const leader = insertUser();
  const groupId = createGroup(leader);
  const fighter = insertUser({ groupId, role: "member" });
  const outsider = insertUser();
  const eventId = createEvent();

  const server = await listen(appForInternal());
  t.after(() => new Promise((resolve) => server.close(resolve)));

  let response = await request(
    server,
    "/api/territory-wars/internal/register",
    {
      method: "POST",
      body: JSON.stringify({
        discordId: leader.discord_id,
        eventId,
      }),
    }
  );

  assert.equal(response.status, 200);
  let body = await response.json();
  assert.equal(Number(body.registration.group_id), groupId);

  response = await request(
    server,
    "/api/territory-wars/internal/lineup",
    {
      method: "POST",
      body: JSON.stringify({
        discordId: leader.discord_id,
        eventId,
        memberDiscordIds: [
          leader.discord_id,
          fighter.discord_id,
        ],
      }),
    }
  );

  assert.equal(response.status, 200);
  body = await response.json();
  assert.equal(body.lineup.length, 2);
  assert.equal(body.lineupCap, 6);

  const lineupDiscordIds = new Set(body.lineup.map((entry) => entry.discord_id));
  assert.ok(lineupDiscordIds.has(leader.discord_id));
  assert.ok(lineupDiscordIds.has(fighter.discord_id));

  response = await request(
    server,
    "/api/territory-wars/internal/roster",
    {
      method: "POST",
      body: JSON.stringify({
        discordId: fighter.discord_id,
        eventId,
      }),
    }
  );

  assert.equal(response.status, 200);
  body = await response.json();
  assert.equal(body.roster.length, 2);
  assert.equal(body.roster.filter((member) => member.inLineup).length, 2);
  assert.equal(body.roster.filter((member) => member.activeNow).length, 2);

  response = await request(
    server,
    "/api/territory-wars/internal/lineup",
    {
      method: "POST",
      body: JSON.stringify({
        discordId: leader.discord_id,
        eventId,
        memberDiscordIds: [outsider.discord_id],
      }),
    }
  );

  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /current member/i);
});

test("seven fighters are rejected without replacing a valid six-player lineup", async (t) => {
  const leader = insertUser();
  const groupId = createGroup(leader);
  const members = Array.from({ length: 6 }, () =>
    insertUser({ groupId, role: "member" })
  );
  const eventId = createEvent({ status: "scheduled" });
  const server = await listen(appForInternal());
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const registered = await request(server, "/api/territory-wars/internal/register", {
    method: "POST",
    body: JSON.stringify({ discordId: leader.discord_id, eventId }),
  });
  assert.equal(registered.status, 200);

  const sixIds = [leader.discord_id, ...members.slice(0, 5).map((member) => member.discord_id)];
  const six = await request(server, "/api/territory-wars/internal/lineup", {
    method: "POST",
    body: JSON.stringify({
      discordId: leader.discord_id,
      eventId,
      memberDiscordIds: sixIds,
    }),
  });
  assert.equal(six.status, 200);
  assert.equal((await six.json()).lineup.length, 6);

  const seven = await request(server, "/api/territory-wars/internal/lineup", {
    method: "POST",
    body: JSON.stringify({
      discordId: leader.discord_id,
      eventId,
      memberDiscordIds: [leader.discord_id, ...members.map((member) => member.discord_id)],
    }),
  });
  assert.equal(seven.status, 400);
  assert.match((await seven.json()).error, /capped at 6/i);

  const roster = await request(server, "/api/territory-wars/internal/roster", {
    method: "POST",
    body: JSON.stringify({ discordId: leader.discord_id, eventId }),
  });
  assert.equal(roster.status, 200);
  const body = await roster.json();
  assert.equal(body.roster.length, 7);
  assert.equal(body.roster.filter((member) => member.inLineup).length, 6);
});

test("only Group Leader can register and only Leader or Officer can set lineup", async (t) => {
  const leader = insertUser();
  const groupId = createGroup(leader);
  const officer = insertUser({ groupId, role: "officer" });
  const member = insertUser({ groupId, role: "member" });
  const eventId = createEvent();

  const server = await listen(appForInternal());
  t.after(() => new Promise((resolve) => server.close(resolve)));

  let response = await request(
    server,
    "/api/territory-wars/internal/register",
    {
      method: "POST",
      body: JSON.stringify({
        discordId: member.discord_id,
        eventId,
      }),
    }
  );

  assert.equal(response.status, 403);

  response = await request(
    server,
    "/api/territory-wars/internal/register",
    {
      method: "POST",
      body: JSON.stringify({
        discordId: leader.discord_id,
        eventId,
      }),
    }
  );
  assert.equal(response.status, 200);

  response = await request(
    server,
    "/api/territory-wars/internal/lineup",
    {
      method: "POST",
      body: JSON.stringify({
        discordId: officer.discord_id,
        eventId,
        memberDiscordIds: [leader.discord_id, officer.discord_id],
      }),
    }
  );
  assert.equal(response.status, 200);

  response = await request(
    server,
    "/api/territory-wars/internal/lineup",
    {
      method: "POST",
      body: JSON.stringify({
        discordId: member.discord_id,
        eventId,
        memberDiscordIds: [leader.discord_id, member.discord_id],
      }),
    }
  );
  assert.equal(response.status, 403);
});

test("live lineup additions receive the ten-minute substitution delay", async (t) => {
  const leader = insertUser();
  const groupId = createGroup(leader);
  const fighter = insertUser({ groupId, role: "member" });
  const substitute = insertUser({ groupId, role: "member" });
  const eventId = createEvent({ status: "live" });

  db.prepare(`
    INSERT INTO territory_event_registrations
      (event_id, group_id, registered_by_user_id, status)
    VALUES (?, ?, ?, 'registered')
  `).run(eventId, groupId, leader.id);

  const server = await listen(appForInternal());
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const before = Date.now();

  const response = await request(
    server,
    "/api/territory-wars/internal/lineup",
    {
      method: "POST",
      body: JSON.stringify({
        discordId: leader.discord_id,
        eventId,
        memberDiscordIds: [
          leader.discord_id,
          fighter.discord_id,
          substitute.discord_id,
        ],
      }),
    }
  );

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.liveSubstitutionDelayMinutes, 10);

  for (const entry of body.lineup) {
    const delay = new Date(entry.active_from).getTime() - before;
    assert.ok(delay >= (10 * 60 * 1000) - 2000, `delay only ${delay}ms`);
    assert.ok(delay <= (10 * 60 * 1000) + 5000, `delay was ${delay}ms`);
  }
});


test("HerbyBot Territory actions honor controlled live-test allowlist", async (t) => {
  const approvedLeader = insertUser();
  const blockedLeader = insertUser();
  const approvedGroupId = createGroup(approvedLeader);
  const blockedGroupId = createGroup(blockedLeader);
  const eventId = createEvent({ status: "live" });

  db.prepare(
    "UPDATE territory_events SET live_test_mode = 1 WHERE id = ?"
  ).run(eventId);

  db.prepare(`
    INSERT INTO territory_live_test_groups
      (event_id, group_id, added_by_user_id)
    VALUES (?, ?, NULL)
  `).run(eventId, approvedGroupId);

  const server = await listen(appForInternal());
  t.after(() => new Promise((resolve) => server.close(resolve)));

  let response = await request(
    server,
    "/api/territory-wars/internal/register",
    {
      method: "POST",
      body: JSON.stringify({
        discordId: approvedLeader.discord_id,
        eventId,
      }),
    }
  );
  assert.equal(response.status, 200);

  response = await request(
    server,
    "/api/territory-wars/internal/register",
    {
      method: "POST",
      body: JSON.stringify({
        discordId: blockedLeader.discord_id,
        eventId,
      }),
    }
  );
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /controlled live testing/i);

  db.prepare(`
    INSERT INTO territory_event_registrations
      (event_id, group_id, registered_by_user_id, status)
    VALUES (?, ?, ?, 'registered')
  `).run(eventId, blockedGroupId, blockedLeader.id);

  response = await request(
    server,
    "/api/territory-wars/internal/lineup",
    {
      method: "POST",
      body: JSON.stringify({
        discordId: blockedLeader.discord_id,
        eventId,
        memberDiscordIds: [blockedLeader.discord_id],
      }),
    }
  );
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /controlled live testing/i);

  response = await request(
    server,
    "/api/territory-wars/internal/attack",
    {
      method: "POST",
      body: JSON.stringify({
        discordId: blockedLeader.discord_id,
        eventId,
      }),
    }
  );
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /controlled live testing/i);
});


test("verified death removes Claim contribution until absence and a real return", async (t) => {
  const previousPreviewSeed = process.env.TERRITORY_WARS_PREVIEW_SEED;
  process.env.TERRITORY_WARS_PREVIEW_SEED = "true";

  const server = await listen(appForPreviewRuntime());
  t.after(async () => {
    if (previousPreviewSeed === undefined) {
      delete process.env.TERRITORY_WARS_PREVIEW_SEED;
    } else {
      process.env.TERRITORY_WARS_PREVIEW_SEED = previousPreviewSeed;
    }
    await new Promise((resolve) => server.close(resolve));
  });

  let response = await request(
    server,
    "/api/territory-wars/internal/preview-death-presence",
    {
      method: "POST",
      body: JSON.stringify({ mode: "prepare" }),
    }
  );
  assert.equal(response.status, 200);
  const prepared = await response.json();
  assert.equal(prepared.attackersBefore, 2);
  assert.equal(prepared.controlBefore, -100);

  response = await request(server, "/api/territory-wars/state");
  assert.equal(response.status, 200);
  let state = await response.json();
  assert.ok(state.attack?.contest_started_at);
  assert.equal(Number(state.event.control_score), -100);

  response = await request(
    server,
    "/api/territory-wars/internal/preview-death-presence",
    {
      method: "POST",
      body: JSON.stringify({ mode: "kill" }),
    }
  );
  assert.equal(response.status, 200);
  const killed = await response.json();
  assert.equal(killed.combat?.counted, true);
  assert.equal(killed.deathLock, true);
  assert.equal(killed.seenAbsent, false);

  response = await request(server, "/api/territory-wars/state");
  state = await response.json();
  assert.equal(state.attack?.contest_started_at, null);
  assert.equal(Number(state.event.control_score), -100);

  response = await request(
    server,
    "/api/territory-wars/internal/preview-death-presence",
    {
      method: "POST",
      body: JSON.stringify({ mode: "absent" }),
    }
  );
  assert.equal(response.status, 200);

  response = await request(server, "/api/territory-wars/state");
  state = await response.json();
  assert.equal(state.attack?.contest_started_at, null);
  assert.equal(Number(state.event.control_score), -100);

  response = await request(
    server,
    "/api/territory-wars/internal/preview-death-presence",
    {
      method: "POST",
      body: JSON.stringify({ mode: "return" }),
    }
  );
  assert.equal(response.status, 200);

  response = await request(server, "/api/territory-wars/state");
  state = await response.json();
  assert.ok(state.attack?.contest_started_at);
  assert.equal(Number(state.event.control_score), -100);

  const remainingLock = db.prepare(`
    SELECT 1
    FROM territory_presence_deaths
    WHERE event_id = ? AND user_id = (
      SELECT id FROM users WHERE steam_id = ?
    )
  `).get(prepared.eventId, prepared.victimSteamId);
  assert.equal(remainingLock, undefined);
});
