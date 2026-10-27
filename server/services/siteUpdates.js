"use strict";
// Versioned Hollow Valley changelog. Staff posts may describe development,
// testing, blockers or readiness. Only a verified release path may say LIVE.
const { randomUUID } = require("node:crypto");
const { db } = require("../db");

const CATEGORIES = Object.freeze(["website", "game", "automation", "community"]);
const STAGES = Object.freeze(["building", "testing", "blocked", "ready", "live", "fixed"]);
const STAFF_STAGES = Object.freeze(["building", "testing", "blocked", "ready"]);
const GITHUB_REF = /^https:\/\/github\.com\/Goofylagaming\/hollow-valley-site\/(?:pull\/[1-9]\d*|commit\/[0-9a-f]{40}|actions\/runs\/[1-9]\d*)\/?$/;

db.exec([
  "CREATE TABLE IF NOT EXISTS site_updates (",
  " id TEXT PRIMARY KEY,",
  " category TEXT NOT NULL CHECK(category IN ('website','game','automation','community')),",
  " stage TEXT NOT NULL CHECK(stage IN ('building','testing','blocked','ready','live','fixed')),",
  " milestone TEXT NOT NULL,",
  " title TEXT NOT NULL,",
  " summary TEXT NOT NULL,",
  " reference_url TEXT,",
  " source TEXT NOT NULL CHECK(source IN ('staff','verified-release')),",
  " revision INTEGER NOT NULL DEFAULT 1,",
  " created_by_steam_id TEXT,",
  " created_at TEXT NOT NULL,",
  " updated_at TEXT NOT NULL,",
  " published_at TEXT,",
  " published_by_steam_id TEXT,",
  " release_sha TEXT UNIQUE",
  ");",
  "CREATE INDEX IF NOT EXISTS idx_site_updates_public ON site_updates(published_at DESC, id DESC);",
  "CREATE INDEX IF NOT EXISTS idx_site_updates_stage ON site_updates(stage, published_at DESC);",
  "CREATE TABLE IF NOT EXISTS site_update_events (",
  " id INTEGER PRIMARY KEY AUTOINCREMENT,",
  " update_id TEXT NOT NULL REFERENCES site_updates(id),",
  " event_type TEXT NOT NULL,",
  " revision INTEGER NOT NULL,",
  " actor_steam_id TEXT,",
  " snapshot_json TEXT NOT NULL,",
  " created_at TEXT NOT NULL",
  ");",
  "CREATE INDEX IF NOT EXISTS idx_site_update_events_entry ON site_update_events(update_id, id ASC);",
].join("\n"));

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function clean(value, max, multiline = false) {
  if (typeof value !== "string") return "";
  const safe = value
    .replace(multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, " ")
    .replace(multiline ? /\r/g : /\s+/g, " ")
    .trim();
  return safe.length > max ? "" : safe;
}
function validSteamId(value) {
  return typeof value === "string" && /^\d{17}$/.test(value);
}
function actorSteam(admin) {
  if (!admin?.is_admin || !validSteamId(admin.steam_id)) {
    throw failure("STEAM_ADMIN_REQUIRED", "Publishing requires a Steam-linked website administrator.");
  }
  return admin.steam_id;
}
function validateReference(value, required = false) {
  if (value === null || value === undefined || value === "") {
    if (required) throw failure("INVALID_UPDATE", "Publish a link to the relevant Hollow Valley GitHub pull request or commit.");
    return null;
  }
  const url = clean(value, 300);
  if (!GITHUB_REF.test(url)) throw failure("INVALID_UPDATE", "References must link to a Hollow Valley GitHub PR, commit or workflow run.");
  return url;
}
function validateStaffPayload(value, { requireReference = false } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw failure("INVALID_UPDATE", "Provide a valid update.");
  }
  const stage = String(value.stage || "");
  const category = String(value.category || "");
  const milestone = clean(value.milestone, 40);
  const title = clean(value.title, 100);
  const summary = clean(value.summary, 900, true);
  if (!STAFF_STAGES.includes(stage)) throw failure("STAGE_RESTRICTED", "Only verified production releases can be labelled Live or Fix Released.");
  if (!CATEGORIES.includes(category) || !/^[A-Za-z0-9][A-Za-z0-9._ -]{2,39}$/.test(milestone) ||
      title.length < 8 || title.length > 100 || summary.length < 30 || summary.length > 900) {
    throw failure("INVALID_UPDATE", "Choose a category, valid milestone, title (8–100) and summary (30–900).");
  }
  const referenceUrl = validateReference(value.referenceUrl, requireReference);
  return { stage, category, milestone, title, summary, referenceUrl };
}
function recordEvent(entry, eventType, actor, at) {
  db.prepare(
    "INSERT INTO site_update_events (update_id,event_type,revision,actor_steam_id,snapshot_json,created_at) VALUES (?,?,?,?,?,?)"
  ).run(entry.id, eventType, entry.revision, actor, JSON.stringify({
    category: entry.category, stage: entry.stage, milestone: entry.milestone,
    title: entry.title, summary: entry.summary, referenceUrl: entry.reference_url,
    source: entry.source, publishedAt: entry.published_at, releaseSha: entry.release_sha,
  }), at);
}
function privateRow(row) {
  return {
    id:row.id, category:row.category, stage:row.stage, milestone:row.milestone,
    title:row.title, summary:row.summary, referenceUrl:row.reference_url,
    source:row.source, revision:row.revision, createdAt:row.created_at,
    updatedAt:row.updated_at, publishedAt:row.published_at,
    createdBySteamId:row.created_by_steam_id, publishedBySteamId:row.published_by_steam_id,
    releaseSha:row.release_sha,
  };
}
function publicRow(row) {
  return {
    id:row.id, category:row.category, stage:row.stage, milestone:row.milestone,
    title:row.title, summary:row.summary, referenceUrl:row.reference_url,
    source:row.source, publishedAt:row.published_at, releaseSha:row.release_sha,
    verifiedLive:row.source === "verified-release" && Boolean(row.release_sha) && ["live", "fixed"].includes(row.stage),
  };
}
function asLimit(value, fallback = 20, max = 100) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(max, number) : fallback;
}
function listPublic({ category = "", stage = "", q = "", page = 0, limit = 20 } = {}) {
  const safeCategory = CATEGORIES.includes(category) ? category : "";
  const safeStage = STAGES.includes(stage) ? stage : "";
  const query = clean(q || "", 120).toLowerCase();
  const safePage = Number.isSafeInteger(Number(page)) ? Math.max(0, Math.min(1000, Number(page))) : 0;
  const safeLimit = asLimit(limit);
  const parts = ["published_at IS NOT NULL"];
  const args = [];
  if (safeCategory) { parts.push("category = ?"); args.push(safeCategory); }
  if (safeStage) { parts.push("stage = ?"); args.push(safeStage); }
  if (query) {
    parts.push("instr(lower(title || ' ' || summary || ' ' || milestone), ?) > 0");
    args.push(query);
  }
  const rows = db.prepare(
    "SELECT * FROM site_updates WHERE " + parts.join(" AND ") +
    " ORDER BY published_at DESC, id DESC LIMIT ? OFFSET ?"
  ).all(...args, safeLimit + 1, safePage * safeLimit);
  return {
    updates: rows.slice(0,safeLimit).map(publicRow),
    hasMore: rows.length > safeLimit,
    page: safePage,
    limit: safeLimit,
  };
}
function listAdmin() {
  return {
    updates: db.prepare("SELECT * FROM site_updates ORDER BY created_at DESC, id DESC LIMIT 150").all().map(privateRow),
  };
}
function auditHistory(id) {
  return db.prepare(
    "SELECT event_type AS eventType, revision, actor_steam_id AS actorSteamId, snapshot_json AS snapshot, created_at AS createdAt FROM site_update_events WHERE update_id = ? ORDER BY id ASC LIMIT 50"
  ).all(String(id || "")).map(entry => ({...entry,snapshot:JSON.parse(entry.snapshot)}));
}
function draft(admin, payload) {
  const actor = actorSteam(admin);
  const item = validateStaffPayload(payload);
  const id = randomUUID();
  const at = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(
      "INSERT INTO site_updates (id,category,stage,milestone,title,summary,reference_url,source,created_by_steam_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
    ).run(id,item.category,item.stage,item.milestone,item.title,item.summary,item.referenceUrl,"staff",actor,at,at);
    const entry = db.prepare("SELECT * FROM site_updates WHERE id = ?").get(id);
    recordEvent(entry,"draft_created",actor,at);
    db.exec("COMMIT");
    return privateRow(entry);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function updateDraft(admin,id,payload,expectedRevision) {
  const actor = actorSteam(admin);
  const next = validateStaffPayload(payload);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw failure("EDIT_CONFLICT","The draft revision is invalid. Reload the update.");
  const key = String(id || "");
  db.exec("BEGIN IMMEDIATE");
  try {
    const prev = db.prepare("SELECT * FROM site_updates WHERE id = ?").get(key);
    if (!prev) throw failure("NOT_FOUND","Update not found.");
    if (prev.published_at || prev.source !== "staff") throw failure("ALREADY_PUBLISHED","Published updates are immutable. Create a new correction instead.");
    if (prev.revision !== expectedRevision) throw failure("EDIT_CONFLICT","Another change was saved first. Reload before updating.");
    const at = new Date().toISOString();
    db.prepare(
      "UPDATE site_updates SET stage=?,category=?,milestone=?,title=?,summary=?,reference_url=?,revision=revision+1,updated_at=? WHERE id=?"
    ).run(next.stage,next.category,next.milestone,next.title,next.summary,next.referenceUrl,at,key);
    const entry = db.prepare("SELECT * FROM site_updates WHERE id = ?").get(key);
    recordEvent(entry,"draft_updated",actor,at);
    db.exec("COMMIT");
    return privateRow(entry);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function publishDraft(admin,id,{confirm,expectedRevision}={}) {
  const actor = actorSteam(admin);
  if (confirm !== "PUBLISH") throw failure("CONFIRM_REQUIRED",'Type "PUBLISH" to publish this staff update.');
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw failure("EDIT_CONFLICT","The draft revision is invalid.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const prev = db.prepare("SELECT * FROM site_updates WHERE id = ?").get(String(id || ""));
    if (!prev) throw failure("NOT_FOUND","Update not found.");
    if (prev.published_at || prev.source !== "staff") throw failure("ALREADY_PUBLISHED","This update is already published.");
    if (prev.revision !== expectedRevision) throw failure("EDIT_CONFLICT","This draft has changed. Reload before publishing.");
    // Revalidate at publication, and never publish an unattributed draft or
    // a staff-authored Live/Fix claim, even if the database was edited manually.
    validateStaffPayload({...privateRow(prev),referenceUrl:prev.reference_url},{requireReference:true});
    const at = new Date().toISOString();
    db.prepare(
      "UPDATE site_updates SET published_at=?,published_by_steam_id=?,updated_at=? WHERE id=? AND published_at IS NULL"
    ).run(at,actor,at,prev.id);
    const entry = db.prepare("SELECT * FROM site_updates WHERE id = ?").get(prev.id);
    recordEvent(entry,"staff_published",actor,at);
    db.exec("COMMIT");
    return publicRow(entry);
  } catch(error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function recordVerifiedRelease({sha,expectedRevision}={}) {
  // Called ONLY after the route's strong bearer token check and successful
  // readiness checks. Enforce exact running-revision parity in this process.
  if (process.env.NODE_ENV !== "production" || process.env.SITE_UPDATES_AUTO_RELEASE_ENABLED !== "true") {
    throw failure("RELEASE_DISABLED","Verified release announcements are disabled.");
  }
  const sourceSha=String(sha||"");
  const running=String(process.env.RENDER_GIT_COMMIT||"");
  if (!/^[a-f0-9]{40}$/.test(sourceSha) || sourceSha !== running) {
    throw failure("REVISION_MISMATCH","The requested SHA is not the running website release.");
  }
  if (expectedRevision !== undefined && expectedRevision !== sourceSha) throw failure("REVISION_MISMATCH","Invalid release revision.");
  const id="deploy-"+sourceSha;
  const at=new Date().toISOString();
  const title="Website release "+sourceSha.slice(0,8);
  const summary="Hollow Valley website revision "+sourceSha.slice(0,8)+
    " passed deployment readiness checks. This confirms the website revision is responding, not that every external game or Discord integration is healthy.";
  db.exec("BEGIN IMMEDIATE");
  try {
    const inserted=db.prepare(
      "INSERT INTO site_updates (id,category,stage,milestone,title,summary,reference_url,source,created_at,updated_at,published_at,release_sha) " +
      "VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(release_sha) DO NOTHING"
    ).run(id,"website","live","SITE-RELEASE",title,summary,
      "https://github.com/Goofylagaming/hollow-valley-site/commit/"+sourceSha,
      "verified-release",at,at,at,sourceSha).changes === 1;
    const entry=db.prepare("SELECT * FROM site_updates WHERE release_sha=?").get(sourceSha);
    if (inserted) recordEvent(entry,"verified_release",null,at);
    db.exec("COMMIT");
    return publicRow(entry);
  } catch(error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
module.exports = {
  CATEGORIES,STAGES,STAFF_STAGES,validateReference,validateStaffPayload,
  listPublic,listAdmin,auditHistory,draft,updateDraft,publishDraft,recordVerifiedRelease,
};
