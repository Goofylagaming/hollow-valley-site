const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-friends-"));
process.env.DB_PATH = path.join(tempDir, "friends.sqlite");

const {
  db,
  getFriendState,
  searchFriendUsers,
  sendFriendRequest,
  acceptFriendRequest,
  removeFriend,
  blockFriendUser,
  unblockFriendUser,
} = require("../server/db");

const ALPHA = "76561198000000001";
const BRAVO = "76561198000000002";
const CHARLIE = "76561198000000003";

for (const [steamId, username] of [[ALPHA, "Alpha"], [BRAVO, "Bravo"], [CHARLIE, "Charlie"]]) {
  db.prepare("INSERT INTO users (steam_id, username) VALUES (?, ?)").run(steamId, username);
}

test("friend request can be sent and accepted", () => {
  const request = sendFriendRequest(ALPHA, BRAVO);
  assert.equal(request.status, "pending");

  const bravoState = getFriendState(BRAVO);
  assert.equal(bravoState.incoming.length, 1);
  assert.equal(bravoState.incoming[0].user.steamId, ALPHA);

  const accepted = acceptFriendRequest(BRAVO, request.id);
  assert.equal(accepted.accepted, true);

  const alphaState = getFriendState(ALPHA);
  assert.equal(alphaState.friends.length, 1);
  assert.equal(alphaState.friends[0].steamId, BRAVO);
});

test("reciprocal request automatically accepts the existing request", () => {
  const request = sendFriendRequest(ALPHA, CHARLIE);
  assert.equal(request.status, "pending");

  const result = sendFriendRequest(CHARLIE, ALPHA);
  assert.equal(result.accepted, true);

  const state = getFriendState(ALPHA);
  assert.ok(state.friends.some((friend) => friend.steamId === CHARLIE));
});

test("blocking removes friendship and prevents requests until unblocked", () => {
  blockFriendUser(ALPHA, BRAVO);
  assert.equal(getFriendState(ALPHA).friends.some((friend) => friend.steamId === BRAVO), false);
  assert.equal(getFriendState(ALPHA).blocked[0].user.steamId, BRAVO);
  assert.throws(() => sendFriendRequest(BRAVO, ALPHA), /cannot be sent/i);

  const unblocked = unblockFriendUser(ALPHA, BRAVO);
  assert.equal(unblocked.unblocked, true);
  const request = sendFriendRequest(BRAVO, ALPHA);
  assert.equal(request.status, "pending");
});

test("player search reports relationship state", () => {
  const results = searchFriendUsers(ALPHA, "Char");
  assert.equal(results.length, 1);
  assert.equal(results[0].steamId, CHARLIE);
  assert.equal(results[0].relationship, "friend");
});

test("friendship can be removed", () => {
  const result = removeFriend(ALPHA, CHARLIE);
  assert.equal(result.removed, true);
  assert.equal(getFriendState(ALPHA).friends.some((friend) => friend.steamId === CHARLIE), false);
});
