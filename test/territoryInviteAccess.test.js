const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
process.env.DB_PATH = ":memory:";
process.env.TERRITORY_WARS_ADMIN_TEST_ENABLED = "1";
const { db } = require("../server/db");
const { createApp } = require("../server/index");

function makeUser(steamId, name, admin = false) {
  return Number(db.prepare("INSERT INTO users (steam_id, username, is_admin) VALUES (?, ?, ?)")
    .run(steamId, name, admin ? 1 : 0).lastInsertRowid);
}
function sessionCookie(userId) {
  const sid = crypto.randomBytes(16).toString("hex");
  const data = {
    cookie: { originalMaxAge: 86400000, expires: new Date(Date.now() + 86400000).toISOString() },
    userId,
  };
  db.prepare("INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)")
    .run(sid, JSON.stringify(data), Date.now() + 86400000);
  const sig = crypto.createHmac("sha256", "dev-secret-change-me")
    .update(sid).digest("base64").replace(/=+$/, "");
  return "connect.sid=" + encodeURIComponent("s:" + sid + "." + sig);
}

test("non-admin Steam users can see only their own Territory group invites and accept them", async () => {
  const playerSteam = "76561198000000901";
  const strangerSteam = "76561198000000902";
  const leadSteam = "76561198000000903";
  const adminSteam = "76561198137456735"; // Allowlisted Territory admin.
  const player = makeUser(playerSteam, "Invitee");
  const stranger = makeUser(strangerSteam, "No Invite");
  const leader = makeUser(leadSteam, "Territory Leader");
  const admin = makeUser(adminSteam, "Territory Admin", true);
  const server = await new Promise(resolve => {
    const instance = createApp().listen(0, "127.0.0.1", () => resolve(instance));
  });
  const root = "http://127.0.0.1:" + server.address().port;
  const playerCookie = sessionCookie(player);
  const strangerCookie = sessionCookie(stranger);
  const adminCookie = sessionCookie(admin);
  const request = (url, cookie, options = {}) => fetch(root + url, {
    redirect: "manual",
    headers: { ...(cookie ? {cookie} : {}), "content-type": "application/json", ...options.headers },
    ...options,
  });
  try {
    const groupId = Number(db.prepare(
      "INSERT INTO territory_groups (name, tag, leader_user_id) VALUES (?, ?, ?)"
    ).run("South Plains Trial", "SPT", leader).lastInsertRowid);
    db.prepare("INSERT INTO territory_group_members (group_id, user_id, role) VALUES (?, ?, 'leader')")
      .run(groupId, leader);
    const inviteId = Number(db.prepare(
      "INSERT INTO territory_group_invites (group_id, invited_steam_id, invited_by_user_id) VALUES (?, ?, ?)"
    ).run(groupId, playerSteam, leader).lastInsertRowid);

    const guestPage = await request("/groups/territory-wars/");
    assert.equal(guestPage.status, 302);
    assert.match(guestPage.headers.get("location"), /\/auth\/steam/);
    assert.equal((await request("/api/territory-wars/invites")).status, 401);

    const playerPage = await request("/groups/territory-wars/", playerCookie);
    assert.equal(playerPage.status, 200);
    assert.match(await playerPage.text(), /Your Territory Wars group invites/);

    const invitations = await request("/api/territory-wars/invites", playerCookie);
    assert.equal(invitations.status, 200);
    const data = await invitations.json();
    assert.equal(data.invites.length, 1);
    assert.equal(data.invites[0].id, inviteId);
    assert.equal(data.invites[0].group_name, "South Plains Trial");

    const strangerInvites = await request("/api/territory-wars/invites", strangerCookie);
    assert.equal(strangerInvites.status, 200);
    assert.deepEqual((await strangerInvites.json()).invites, []);

    assert.equal((await request("/api/territory-wars/state", playerCookie)).status, 403);
    assert.equal((await request("/api/territory-wars/me", playerCookie)).status, 403);
    assert.equal((await request("/api/territory-wars/admin/state", playerCookie)).status, 403);
    assert.equal((await request("/adminterritorywars", playerCookie)).status, 403);
    assert.equal((await request("/api/territory-wars/group", playerCookie, {
      method: "POST", body: JSON.stringify({ name: "Not Allowed", tag: "NA" }),
    })).status, 403);
    assert.equal((await request("/adminterritorywars", adminCookie)).status, 200);

    const strangerAttempt = await request("/api/territory-wars/group/invite/accept", strangerCookie, {
      method: "POST", body: JSON.stringify({ inviteId }),
    });
    assert.equal(strangerAttempt.status, 403);

    const accepted = await request("/api/territory-wars/group/invite/accept", playerCookie, {
      method: "POST", body: JSON.stringify({ inviteId }),
    });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json()).group.id, groupId);

    const after = await request("/api/territory-wars/invites", playerCookie);
    assert.equal(after.status, 200);
    assert.equal((await after.json()).group.name, "South Plains Trial");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
