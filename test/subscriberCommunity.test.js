const test = require("node:test");
const assert = require("node:assert/strict");
process.env.DB_PATH = ":memory:";
const { db } = require("../server/db");
require("../server/services/supporterWebhook");
const service = require("../server/services/subscriberCommunity");
const vote = require("../server/services/membershipSkinVote");
const env = { SUBSCRIBER_COMMUNITY_ENABLED: "1", MEMBERSHIP_REWARDS_ENABLED: "1" };
const now = Date.parse("2026-11-05T00:00:00Z");
const admin = { id: 901, is_admin: 1 }, member = { id: 902 };
function reset() {
  service.schema(); vote.ensureSchema();
  for (const table of ["subscriber_community_posts", "subscriber_suggestions", "membership_skin_votes", "membership_skin_vote_options", "membership_skin_vote_ballots", "membership_loyalty_rewards", "supporter_subscriptions", "users"]) db.exec(`DELETE FROM ${table}`);
  db.prepare("INSERT INTO users(id,username,is_admin,discord_id) VALUES (?,?,?,?)").run(901, "Admin", 1, null);
  db.prepare("INSERT INTO users(id,username,is_admin,discord_id) VALUES (?,?,?,?)").run(902, "Member", 0, "123456789012345678");
  db.prepare("INSERT INTO supporter_subscriptions(user_id,tier,stripe_status,auto_renew,renews_at) VALUES (902,'supporter','active',0,?)").run("2026-12-01T00:00:00Z");
}
const progress = { enabled: true, configured: true, available: true, month: "2026-11", periodEnd: "2026-11-30T14:00:00.000Z", updatedAt: new Date(now).toISOString(), coveragePercent: 80, amountMinor: 1234567, customer: "cus_secret", email: "private@example.com" };
test("dry-run has no writes; monthly drop and 50/75 milestones dedupe durably and redact finance", () => {
  reset(); const plan = service.monthly({ env, now, progress });
  assert.equal(plan.length, 3); assert.equal(db.prepare("SELECT COUNT(*) n FROM subscriber_community_posts").get().n, 0);
  const output = JSON.stringify(plan); for (const secret of ["1234567", "cus_secret", "private@example.com", "amountMinor", "80%"]) assert.equal(output.includes(secret), false);
  assert.match(output, /50%/); assert.match(output, /75%/);
  const first = service.monthly({ env, now, progress, dryRun: false }); assert.ok(first.every(p => p.queued));
  assert.ok(service.monthly({ env, now, progress, dryRun: false }).every(p => p.duplicate));
  assert.equal(service.monthly({ env, now, progress: { ...progress, available: false } }).length, 1);
  assert.equal(service.monthly({ env, now, progress: { ...progress, month: "2026-10" } }).length, 1);
});
test("Brisbane month boundaries and unavailable/stale progress never announce a milestone", () => {
  reset(); const plan = service.monthly({ env, now: Date.parse("2026-11-30T14:00:00Z"), progress });
  assert.equal(plan.length, 1); assert.equal(plan[0].key, "drop:2026-12");
  assert.equal(service.monthly({ env, now: now + 7200001, progress }).length, 1);
});
test("admin-only support updates, dev previews and website vote announcements", () => {
  reset(); assert.throws(() => service.publish(member, { kind: "support-update", text: "New trails" }), { status: 403 });
  for (const text of ["@everyone", "Invoice in_secret", "cost $45", "mail me private@example.com", "user 123456789012345678"]) assert.throws(() => service.safeText(text));
  const opts = { env, now, dryRun: false };
  assert.equal(service.publish(admin, { kind: "support-update", text: "New trails" }, opts).queued, true);
  assert.equal(service.publish(admin, { kind: "support-update", text: "Different copy" }, opts).duplicate, true);
  assert.equal(service.publish(admin, { kind: "dev-preview", text: "New trail preview" }, opts).queued, true);
  assert.equal(service.publish(admin, { kind: "dev-preview", text: "New trail preview" }, opts).duplicate, true);
});
test("paid-period suggestion intake, dedupe and staff shortlist", () => {
  reset(); const first = service.suggest(member, "A public forest event", { env, now });
  assert.equal(service.suggest(member, "A public forest event", { env, now }).duplicate, true);
  assert.throws(() => service.shortlist(member, first.id, "shortlisted"), { status: 403 });
  service.shortlist(admin, first.id, "shortlisted"); assert.equal(service.state(admin).suggestions[0].status, "shortlisted");
  assert.throws(() => service.suggest(member, "Another event", { env, now: Date.parse("2026-12-01T00:00:00Z") }), { status: 403 });
});
test("all three ballot kinds use the existing website-authoritative one-user-one-vote ledger", () => {
  for (const kind of ["premium-skin", "public-event-theme", "community-choice"]) {
    reset(); vote.createBallot(admin, { kind, title: "Choose a theme", durationDays: 7, options: [{ label: "Forest" }, { label: "River" }] }, { env, now });
    const state = vote.currentForUser(member, { env, now }); assert.equal(state.ballot.kind, kind);
    vote.castVote(member, state.options[0].id, { env, now }); vote.castVote(member, state.options[1].id, { env, now });
    assert.equal(vote.currentForUser(member, { env, now }).totalVotes, 1);
    const post = service.publish(admin, { kind: "vote", votes: 1000 }, { env, now }); assert.match(post.content, /reactions do not count/);
    assert.equal(vote.currentForUser(member, { env, now }).totalVotes, 1);
    assert.throws(() => vote.castVote(member, state.options[0].id, { env, now: Date.parse("2026-12-02") }));
  }
});
test("disabled/preview delivery makes no calls; concurrent runs send once and ambiguous sends stay held", async () => {
  reset(); let sends = 0;
  const fetchImpl = async (url, opts) => {
    if (opts.method === "GET") return { ok: true, json: async () => [{ id: "cat", name: "💎 SUBSCRIBERS", type: 4 }, { id: "chan", name: "perks-and-rewards", type: 0, parent_id: "cat", permission_overwrites: [{ id: "1540359454627725382", deny: "1024", allow: "0" }] }] };
    sends++; assert.deepEqual(JSON.parse(opts.body).allowed_mentions, { parse: [] });
    return { ok: true, json: async () => ({ id: "message" }) };
  };
  service.monthly({ env, now, progress: {}, dryRun: false });
  assert.equal((await service.deliver({ env, fetchImpl })).dryRun, true); assert.equal(sends, 0);
  const apply = { ...env, SUBSCRIBER_COMMUNITY_MODE: "apply", DISCORD_GUILD_ID: "1540359454627725382", DISCORD_ROLE_BOT_TOKEN: "fake" };
  await service.deliver({ env: { ...apply, SKIN_STUDIO_READ_ONLY: "1" }, fetchImpl }); assert.equal(sends, 0);
  await Promise.all([service.deliver({ env: apply, fetchImpl }), service.deliver({ env: apply, fetchImpl })]); assert.equal(sends, 1);
  service.monthly({ env, now: Date.parse("2026-12-05"), progress: {}, dryRun: false });
  const uncertain = async (url, opts) => { if (opts.method === "POST") { sends++; throw new Error("secret provider response"); } return fetchImpl(url, opts); };
  await service.deliver({ env: apply, fetchImpl: uncertain }); await service.deliver({ env: apply, fetchImpl: uncertain }); assert.equal(sends, 2);
  assert.equal(service.state(admin).posts.find(p => p.key === "drop:2026-12").state, "review");
  assert.equal(JSON.stringify(service.state(admin)).includes("secret provider"), false);
});
test("earned loyalty grants survive cancellation and never remove or modify other roles", async () => {
  reset(); db.prepare("INSERT INTO membership_loyalty_rewards(user_id,months,title,frame_id) VALUES (902,3,'Valley Companion','loyalty-3')").run();
  db.prepare("UPDATE supporter_subscriptions SET stripe_status='canceled',renews_at=NULL WHERE user_id=902").run();
  const apply = { ...env, SUBSCRIBER_COMMUNITY_MODE: "apply", DISCORD_GUILD_ID: "1540359454627725382", DISCORD_ROLE_BOT_TOKEN: "fake", SUBSCRIBER_LOYALTY_ROLE_3: "r3", SUBSCRIBER_LOYALTY_ROLE_6: "r6", SUBSCRIBER_LOYALTY_ROLE_12: "r12" };
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push([url, opts.method]); return { ok: true, status: opts.method === "PUT" ? 204 : 200, json: async () => [{ id: "r3", name: "Valley Companion", permissions: "0" }, { id: "r6", name: "Ancient Guardian", permissions: "0" }, { id: "r12", name: "Heart of the Valley", permissions: "0" }] }; };
  await service.syncLoyalty({ env: apply, fetchImpl }); assert.equal(calls.filter(c => c[1] === "PUT").length, 1); assert.ok(calls[1][0].endsWith("/roles/r3")); assert.ok(!calls.some(c => c[1] === "DELETE" || c[1] === "POST"));
});
