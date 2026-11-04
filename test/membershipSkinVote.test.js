const test = require("node:test");
const assert = require("node:assert/strict");
process.env.DB_PATH = ":memory:";
const { db } = require("../server/db");
require("../server/services/supporterWebhook");
const vote = require("../server/services/membershipSkinVote");

const env = { MEMBERSHIP_REWARDS_ENABLED: "1" };
const now = Date.parse("2026-11-15T00:00:00Z");
const admin = { id: 99, is_admin: 1 };
const supporter = { id: 41, username: "Supporter" };
const legend = { id: 42, username: "Legend" };
const guest = { id: 43, username: "Guest" };

function reset() {
  vote.ensureSchema();
  for (const table of [
    "membership_skin_votes",
    "membership_skin_vote_options",
    "membership_skin_vote_ballots",
    "supporter_subscriptions",
    "users",
  ]) db.exec(`DELETE FROM ${table}`);
  db.prepare("INSERT INTO users(id,username,is_admin) VALUES (?,?,?)").run(99, "Admin", 1);
  db.prepare("INSERT INTO users(id,username) VALUES (?,?)").run(41, "Supporter");
  db.prepare("INSERT INTO users(id,username) VALUES (?,?)").run(42, "Legend");
  db.prepare("INSERT INTO users(id,username) VALUES (?,?)").run(43, "Guest");
  db.prepare("INSERT INTO supporter_subscriptions(user_id,tier,stripe_status,auto_renew,renews_at) VALUES (?,?, 'active',1,?)")
    .run(41, "supporter", "2026-12-01T00:00:00Z");
  db.prepare("INSERT INTO supporter_subscriptions(user_id,tier,stripe_status,auto_renew,renews_at) VALUES (?,?, 'active',1,?)")
    .run(42, "legend", "2026-12-01T00:00:00Z");
}

const choices = [
  { label: "Ember Fern", description: "Warm rust with dark forest tones." },
  { label: "River Ghost", description: "Cool slate and pale teal." },
  { label: "Golden Hollow", description: "Cream, brown and muted gold." },
];

test("one active member gets one equal vote and can change it", () => {
  reset();
  vote.createBallot(admin, { title: "December premium skin", durationDays: 7, options: choices }, { env, now });
  let state = vote.currentForUser(supporter, { env, now });
  assert.equal(state.eligible, true);
  assert.equal(state.options.length, 3);
  vote.castVote(supporter, state.options[0].id, { env, now });
  state = vote.currentForUser(supporter, { env, now });
  assert.equal(state.totalVotes, 1);
  assert.equal(state.selectedOptionId, state.options[0].id);
  vote.castVote(supporter, state.options[1].id, { env, now });
  state = vote.currentForUser(supporter, { env, now });
  assert.equal(state.totalVotes, 1);
  assert.equal(state.selectedOptionId, state.options[1].id);
});

test("higher tiers do not receive extra voting weight", () => {
  reset();
  vote.createBallot(admin, { title: "December premium skin", durationDays: 7, options: choices }, { env, now });
  const first = vote.currentForUser(supporter, { env, now }).options[0].id;
  vote.castVote(supporter, first, { env, now });
  vote.castVote(legend, first, { env, now });
  const adminState = vote.adminState({ env, now });
  assert.equal(adminState.current.options.find((option) => option.id === first).votes, 2);
  assert.equal(adminState.current.options.reduce((sum, option) => sum + option.votes, 0), 2);
});

test("non-members can see that a vote exists but cannot see options or vote", () => {
  reset();
  vote.createBallot(admin, { title: "December premium skin", durationDays: 7, options: choices }, { env, now });
  const state = vote.currentForUser(guest, { env, now });
  assert.equal(state.open, true);
  assert.equal(state.eligible, false);
  assert.deepEqual(state.options, []);
  assert.equal(state.totalVotes, null);
  assert.throws(() => vote.castVote(guest, 1, { env, now }), (error) => error.code === "MEMBERSHIP_REQUIRED");
});

test("closing a vote exposes only aggregate winning information", () => {
  reset();
  vote.createBallot(admin, { title: "December premium skin", durationDays: 7, options: choices }, { env, now });
  const option = vote.currentForUser(supporter, { env, now }).options[2];
  vote.castVote(supporter, option.id, { env, now });
  vote.closeBallot(admin, { env, now });
  const state = vote.currentForUser(supporter, { env, now });
  assert.equal(state.open, false);
  assert.equal(state.lastWinner.label, option.label);
  assert.equal(state.lastWinner.votes, 1);
  assert.equal(Object.hasOwn(state.lastWinner, "userId"), false);
});

test("expired votes close automatically and invalid duplicate options are rejected", () => {
  reset();
  vote.createBallot(admin, { title: "Short vote", durationDays: 1, options: choices }, { env, now });
  assert.equal(vote.currentForUser(supporter, { env, now: now + 2 * 86400000 }).open, false);
  assert.throws(
    () => vote.createBallot(admin, {
      title: "Bad vote",
      durationDays: 7,
      options: [{ label: "Same" }, { label: "same" }],
    }, { env, now: now + 2 * 86400000 }),
    (error) => error.code === "INVALID_SKIN_VOTE"
  );
});
