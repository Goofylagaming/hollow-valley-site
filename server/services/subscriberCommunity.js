"use strict";

// Website-owned delivery ledger. Discord reactions never enter the vote ledger.
const { createHash } = require("node:crypto");
const { db, getSupporterStatus } = require("../db");
const rewards = require("./membershipRewards");
const { entitlement } = require("./membershipEntitlements");
const funding = require("./subscriberFunding");
const { getSkinStudioSafety } = require("../middleware/skinStudioSafety");
const GUILD = "1540359454627725382";
const CHANNELS = new Set(["subscriber-lounge", "premium-skins", "subscriber-votes", "subscriber-suggestions", "perks-and-rewards", "dev-previews"]);
const enabled = (env = process.env) => env.SUBSCRIBER_COMMUNITY_ENABLED === "1";
const live = (env = process.env) => enabled(env) && env.SUBSCRIBER_COMMUNITY_MODE === "apply" && !getSkinStudioSafety(env).readOnly;
function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
function admin(actor) { if (!actor?.is_admin) fail(403, "Admin access required."); }
function schema() {
  rewards.ensureSchema();
  db.exec(`CREATE TABLE IF NOT EXISTS subscriber_community_posts (
    key TEXT PRIMARY KEY, channel TEXT NOT NULL, content TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','review')),
    message_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS subscriber_suggestions (
    id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
    text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'submitted'
      CHECK(status IN ('submitted','shortlisted','closed')),
    created_at INTEGER NOT NULL, reviewed_by INTEGER REFERENCES users(id));`);
}
function safeText(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 1200 || /[\u0000-\u001f<>@]|https?:|\b(?:in|cus|sub|pi|ch)_[a-z0-9_]+|\b\d{15,}\b|\$|\b(?:AUD|USD|EUR)\b/i.test(text)) {
    fail(400, "Use plain community text without mentions, links, financial details or account identifiers.");
  }
  return text;
}
function enqueue(key, channel, content, { env = process.env, dryRun = true } = {}) {
  if (!CHANNELS.has(channel)) fail(400, "Invalid subscriber channel.");
  if (!enabled(env) || dryRun) return { key, channel, content, dryRun: true };
  schema();
  const result = db.prepare("INSERT OR IGNORE INTO subscriber_community_posts(key,channel,content) VALUES (?,?,?)").run(key, channel, content);
  return { key, queued: Boolean(result.changes), duplicate: !result.changes };
}
function monthly({ env = process.env, now = Date.now(), dryRun = true, progress } = {}) {
  const month = funding.monthBounds(now).month;
  const options = { env, dryRun };
  const result = [enqueue(`drop:${month}`, "perks-and-rewards",
    `🎁 Subscriber Drop • ${month}\nCheck this month's premium skin choices in your website membership account. Claims open when reviewed skins are released. Eligibility follows your paid membership period. Claimed skins and earned loyalty rewards are permanent.`, options)];
  // This allowlist strips all finance/customer fields before constructing a post.
  const p = funding.publicFundingView(progress || funding.getDefaultService().getProgress());
  if (p.available && p.month === month && Date.parse(p.updatedAt) <= now && now - Date.parse(p.updatedAt) < funding.MAX_AGE_MS) {
    for (const percent of [50, 75]) if (p.coveragePercent >= percent) {
      result.push(enqueue(`goal:${month}:${percent}`, "perks-and-rewards", `💚 Community support has reached ${percent}% of this month's goal. Thank you for helping build Hollow Valley!`, options));
    }
  }
  return result;
}
function publish(actor, input, options = {}) {
  admin(actor);
  const now = options.now ?? Date.now();
  const kind = input?.kind;
  if (kind === "digest") {
    const month = funding.monthBounds(now).month;
    return enqueue("digest:" + month, "perks-and-rewards",
      "The " + month + " subscriber digest is ready. Open My Membership for your monthly rewards and community updates.", options);
  }
  if (kind === "suggestion") {
    schema();
    const suggestion = db.prepare("SELECT id FROM subscriber_suggestions WHERE id=? AND status='shortlisted'").get(Number(input.suggestionId));
    if (!suggestion) fail(409, "Shortlist the suggestion before announcing it.");
    return enqueue("suggestion:" + suggestion.id, "subscriber-suggestions",
      "Community suggestion #" + suggestion.id + " has been shortlisted for review.", options);
  }
  if (!["dev-preview", "support-update", "vote"].includes(kind)) fail(400, "Invalid post kind.");
  if (kind === "vote") {
    const vote = require("./membershipSkinVote").adminState(options).current;
    if (!vote) fail(409, "Open a website ballot first.");
    return enqueue(`vote:${vote.id}`, "subscriber-votes", "🗳️ A subscriber vote is open on the Hollow Valley website. Cast your vote in your membership account; Discord reactions do not count. Public community events remain open to everyone.", options);
  }
  const text = safeText(input?.text);
  const month = funding.monthBounds(now).month;
  const key = kind === "support-update" ? `update:${month}` : `preview:${createHash("sha256").update(text).digest("hex")}`;
  return enqueue(key, kind === "dev-preview" ? "dev-previews" : "perks-and-rewards",
    `${kind === "dev-preview" ? "🛠️ Development preview" : `💚 What your support helped build • ${month}`}\n${text}`, options);
}
function suggest(user, text, { env = process.env, now = Date.now() } = {}) {
  if (!enabled(env)) fail(503, "Subscriber community is disabled.");
  if (!user?.id || !entitlement(getSupporterStatus(user.id), { env, now }).entitled) fail(403, "Active paid membership required.");
  text = safeText(text); schema();
  const duplicate = db.prepare("SELECT id FROM subscriber_suggestions WHERE user_id=? AND text=?").get(user.id, text);
  if (duplicate) return { id: duplicate.id, duplicate: true };
  if (db.prepare("SELECT id FROM subscriber_suggestions WHERE user_id=? AND created_at>?").get(user.id, now - 60000)) fail(429, "Please wait a minute before submitting another suggestion.");
  return { id: Number(db.prepare("INSERT INTO subscriber_suggestions(user_id,text,created_at) VALUES (?,?,?)").run(user.id, text, now).lastInsertRowid) };
}
function shortlist(actor, id, status) {
  admin(actor); schema();
  if (!["shortlisted", "closed"].includes(status)) fail(400, "Invalid review status.");
  if (!db.prepare("UPDATE subscriber_suggestions SET status=?,reviewed_by=? WHERE id=?").run(status, actor.id, Number(id)).changes) fail(404, "Suggestion not found.");
  return { updated: true };
}
function state(actor) {
  admin(actor); schema();
  let suggestions;
  if(process.env.COMMUNITY_PARTICIPATION_ENABLED==="1"){
    require("./communityParticipation").schema();
    suggestions=db.prepare(`SELECT s.id,s.text,coalesce(r.stage,s.status) AS status FROM subscriber_suggestions s
      LEFT JOIN membership_suggestion_reviews r ON r.suggestion_id=s.id ORDER BY s.id DESC LIMIT 100`).all();
  } else suggestions=db.prepare("SELECT id,text,status FROM subscriber_suggestions ORDER BY id DESC LIMIT 100").all();
  return {posts:db.prepare("SELECT key,channel,state,message_id FROM subscriber_community_posts ORDER BY created_at DESC LIMIT 100").all(),suggestions,participation:process.env.COMMUNITY_PARTICIPATION_ENABLED==="1"};
}
async function request(path, method, body, env, fetchImpl) {
  if (!env.DISCORD_ROLE_BOT_TOKEN || env.DISCORD_GUILD_ID !== GUILD) fail(503, "Subscriber Discord configuration is incomplete.");
  const response = await fetchImpl(`https://discord.com/api/v10${path}`, { method, headers: { Authorization: `Bot ${env.DISCORD_ROLE_BOT_TOKEN}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  if (!response.ok) fail(502, "Subscriber Discord delivery requires review.");
  return response.status === 204 ? null : response.json();
}
async function deliver({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!live(env)) return { dryRun: true, delivered: 0 };
  schema();
  const channels = await request(`/guilds/${GUILD}/channels`, "GET", null, env, fetchImpl);
  const categories = channels.filter(c => c.name === "💎 SUBSCRIBERS" && c.type === 4);
  if (categories.length !== 1) fail(409, "Reconcile the subscriber category first.");
  let delivered = 0;
  for (const job of db.prepare("SELECT * FROM subscriber_community_posts WHERE state='pending' ORDER BY created_at LIMIT 10").all()) {
    const target = channels.filter(c => c.name === job.channel && c.type === 0 && c.parent_id === categories[0].id);
    if (target.length !== 1) fail(409, "Reconcile the subscriber channels first.");
    const everyone = target[0].permission_overwrites?.find(o => o.id === GUILD);
    if (!everyone || !(BigInt(everyone.deny || "0") & 1024n) || (BigInt(everyone.allow || "0") & 1024n)) {
      fail(409, "Subscriber channel privacy must be reconciled before publishing.");
    }
    // Claim BEFORE send. Ambiguous sends/crashes are never blindly retried.
    if (!db.prepare("UPDATE subscriber_community_posts SET state='sending' WHERE key=? AND state='pending'").run(job.key).changes) continue;
    try {
      const message = await request(`/channels/${target[0].id}/messages`, "POST", { content: job.content, allowed_mentions: { parse: [] }, nonce: createHash("sha256").update(job.key).digest("hex").slice(0, 24), enforce_nonce: true }, env, fetchImpl);
      if (!message?.id) throw new Error("Missing message confirmation");
      db.prepare("UPDATE subscriber_community_posts SET state='sent',message_id=? WHERE key=?").run(message.id, job.key);
      delivered++;
    } catch {
      db.prepare("UPDATE subscriber_community_posts SET state='review' WHERE key=?").run(job.key);
    }
  }
  return { delivered };
}
async function syncLoyalty({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  schema();
  const grants = db.prepare(`SELECT u.discord_id,r.months FROM membership_loyalty_rewards r JOIN users u ON u.id=r.user_id WHERE u.discord_id IS NOT NULL`).all();
  if (!live(env)) return { dryRun: true, grants: grants.length };
  const roles = await request(`/guilds/${GUILD}/roles`, "GET", null, env, fetchImpl);
  const mapping = new Map();
  for (const milestone of rewards.MILESTONES) {
    const id = env[`SUBSCRIBER_LOYALTY_ROLE_${milestone.months}`];
    const found = roles.filter(r => r.id === id && r.name === milestone.title && !r.managed && String(r.permissions) === "0");
    if (found.length !== 1) fail(409, "Configure the three cosmetic loyalty role IDs from the HerbyBot reconciliation.");
    mapping.set(milestone.months, id);
  }
  let failed = 0;
  for (const grant of grants) {
    if (!/^\d{15,22}$/.test(grant.discord_id) || !mapping.has(grant.months)) continue;
    // PUT is idempotent; never revoke an earned loyalty role.
    try { await request(`/guilds/${GUILD}/members/${grant.discord_id}/roles/${mapping.get(grant.months)}`, "PUT", null, env, fetchImpl); }
    catch { failed++; } // One departed member must not prevent other earned grants.
  }
  return { grants: grants.length, failed };
}
function start({ env = process.env, schedule = setInterval } = {}) {
  if (!enabled(env)) return null;
  let running = false;
  const tick = async () => {
    if (running) return; running = true;
    try { monthly({ env, dryRun: !live(env) }); await deliver({ env }); await syncLoyalty({ env }); }
    catch { /* Admin status exposes delivery review; never log provider/user data. */ }
    finally { running = false; }
  };
  void tick(); const timer = schedule(tick, 3600000); timer?.unref?.(); return timer;
}
module.exports = { enabled, live, schema, monthly, publish, suggest, shortlist, state, deliver, syncLoyalty, start, safeText };
