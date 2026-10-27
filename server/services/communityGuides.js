"use strict";
// Hollow Valley policies are drafted and explicitly published by website admins.
// Species data contains *reference* pack values, not enforceable server rules.
const fs = require("node:fs");
const path = require("node:path");
const { db } = require("../db");

const speciesData = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "species.json"), "utf8"));
const speciesById = new Map(speciesData.map(entry => [entry.id, entry]));
const RULE_CATEGORIES = Object.freeze(["general", "conduct", "combat", "grouping", "nesting", "events", "other"]);
const BLANK = Object.freeze({ rules: [], packs: [], compatibility: [] });

db.exec([
  "CREATE TABLE IF NOT EXISTS community_guide_state (",
  " id INTEGER PRIMARY KEY CHECK (id = 1),",
  " draft_json TEXT NOT NULL,",
  " draft_version INTEGER NOT NULL DEFAULT 0,",
  " updated_at TEXT,",
  " published_json TEXT,",
  " published_version INTEGER NOT NULL DEFAULT 0,",
  " published_at TEXT,",
  " published_by_steam_id TEXT",
  ");",
  "INSERT OR IGNORE INTO community_guide_state (id,draft_json) VALUES (1,'{\"rules\":[],\"packs\":[],\"compatibility\":[]}');",
  "CREATE TABLE IF NOT EXISTS community_guide_history (",
  " version INTEGER PRIMARY KEY,",
  " published_json TEXT NOT NULL,",
  " published_at TEXT NOT NULL,",
  " published_by_steam_id TEXT NOT NULL",
  ");",
].join("\n"));

function failure(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function cleanText(value, limit, { allowNewlines = false } = {}) {
  if (typeof value !== "string") return "";
  const normalized = value.replace(allowNewlines ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g : /[\u0000-\u001f\u007f]/g, " ")
    .trim();
  return normalized.slice(0, limit + 1);
}
function validSteamId(id) {
  return typeof id === "string" && /^\d{17}$/.test(id);
}
function knownPlayableSpecies(id) {
  return speciesById.has(id) && speciesById.get(id).releasedInEvrima === true;
}
function normalizeDocument(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw failure("INVALID_POLICY", "A valid Hollow Valley policy document is required.");
  }
  const rules = input.rules, packs = input.packs, compatibility = input.compatibility;
  if (!Array.isArray(rules) || !Array.isArray(packs) || !Array.isArray(compatibility) ||
      rules.length > 100 || packs.length > speciesById.size || compatibility.length > 100) {
    throw failure("INVALID_POLICY", "Policy exceeds allowed list sizes or is missing rule, pack or compatibility sections.");
  }
  const ruleIds = new Set();
  const normalizedRules = rules.map(rule => {
    const id = cleanText(rule?.id, 40);
    const title = cleanText(rule?.title, 100);
    const body = cleanText(rule?.body, 1500, { allowNewlines: true });
    const category = cleanText(rule?.category, 24).toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(id) || ruleIds.has(id) ||
        title.length < 5 || title.length > 100 || body.length < 15 || body.length > 1500 ||
        !RULE_CATEGORIES.includes(category)) {
      throw failure("INVALID_POLICY", "Each rule needs a unique ID, 5–100 character title, 15–1,500 character body and valid category.");
    }
    ruleIds.add(id);
    return { id, title, body, category };
  });
  const seenPacks = new Set();
  const normalizedPacks = packs.map(pack => {
    const speciesId = cleanText(pack?.speciesId, 50);
    const maxMembers = pack?.maxMembers;
    const note = cleanText(pack?.note || "", 300, { allowNewlines: true });
    if (!knownPlayableSpecies(speciesId) || seenPacks.has(speciesId) ||
        !Number.isInteger(maxMembers) || maxMembers < 1 || maxMembers > 100 || note.length > 300) {
      throw failure("INVALID_POLICY", "Pack policies must use unique currently playable species and a maximum of 1–100.");
    }
    seenPacks.add(speciesId);
    return { speciesId, maxMembers, note };
  });
  const seenPairs = new Set();
  const normalizedCompatibility = compatibility.map(pair => {
    const speciesA = cleanText(pair?.speciesA, 50);
    const speciesB = cleanText(pair?.speciesB, 50);
    const allowed = pair?.allowed;
    const note = cleanText(pair?.note || "", 300, { allowNewlines: true });
    if (!knownPlayableSpecies(speciesA) || !knownPlayableSpecies(speciesB) ||
        speciesA === speciesB || typeof allowed !== "boolean" || note.length > 300) {
      throw failure("INVALID_POLICY", "Mixed species decisions require two different playable species and a true/false approval.");
    }
    const [a,b] = [speciesA,speciesB].sort();
    const key = a + ":" + b;
    if (seenPairs.has(key)) throw failure("INVALID_POLICY", "Each mixed-species combination may have only one decision.");
    seenPairs.add(key);
    return { speciesA:a, speciesB:b, allowed, note };
  });
  return { rules: normalizedRules, packs: normalizedPacks, compatibility: normalizedCompatibility };
}
function stateRow() {
  return db.prepare("SELECT * FROM community_guide_state WHERE id = 1").get();
}
function parseDocument(value) {
  if (!value) return { rules:[], packs:[], compatibility:[] };
  // The database stores documents only after normalizeDocument validation.
  return JSON.parse(value);
}
function speciesList() {
  return speciesData.map(item => ({
    id: item.id,
    name: item.name,
    category: item.category,
    social: item.social || "",
    releasedInEvrima: item.releasedInEvrima === true,
    referencePackLimit: Number.isInteger(item.packLimit) ? item.packLimit : null,
  }));
}
function publicState() {
  const state = stateRow();
  const published = Boolean(state.published_json);
  return {
    published,
    version: state.published_version,
    publishedAt: state.published_at,
    ...parseDocument(state.published_json),
    species: speciesList(),
    referenceOnly: true,
  };
}
function publicHistory(limit = 20) {
  const cap = Math.max(1, Math.min(50, Number(limit) || 20));
  return db.prepare("SELECT version, published_at AS publishedAt, published_json AS document FROM community_guide_history ORDER BY version DESC LIMIT ?")
    .all(cap).map(row => {
      const doc = parseDocument(row.document);
      return {
        version: row.version,
        publishedAt: row.publishedAt,
        ruleCount: doc.rules.length,
        packCount: doc.packs.length,
        compatibilityCount: doc.compatibility.length,
      };
    });
}
function adminState() {
  const state = stateRow();
  return {
    draft: parseDocument(state.draft_json),
    draftVersion: state.draft_version,
    draftUpdatedAt: state.updated_at,
    publishedVersion: state.published_version,
    publishedAt: state.published_at,
    publishedBySteamId: state.published_by_steam_id,
    published: parseDocument(state.published_json),
    history: db.prepare("SELECT version, published_at AS publishedAt, published_by_steam_id AS publishedBySteamId FROM community_guide_history ORDER BY version DESC LIMIT 20").all(),
    species: speciesList(),
  };
}
function checkDraftVersion(version, current) {
  if (!Number.isSafeInteger(version) || version < 0 || version !== current) {
    throw failure("EDIT_CONFLICT", "Rules have changed since you opened the editor. Reload to avoid replacing another admin's work.");
  }
}
function saveDraft(input, expectedDraftVersion) {
  const normalized = normalizeDocument(input);
  db.exec("BEGIN IMMEDIATE");
  try {
    const state = stateRow();
    checkDraftVersion(expectedDraftVersion, state.draft_version);
    db.prepare("UPDATE community_guide_state SET draft_json = ?, draft_version = draft_version + 1, updated_at = datetime('now') WHERE id = 1")
      .run(JSON.stringify(normalized));
    db.exec("COMMIT");
    return adminState();
  } catch(error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
function publish({ expectedDraftVersion, confirm, adminSteamId } = {}) {
  if (confirm !== "PUBLISH") throw failure("CONFIRM_REQUIRED", 'Type "PUBLISH" to confirm.');
  if (!validSteamId(adminSteamId)) throw failure("STEAM_REQUIRED", "A linked Steam admin account is required to publish rules.");
  db.exec("BEGIN IMMEDIATE");
  try {
    const state = stateRow();
    checkDraftVersion(expectedDraftVersion, state.draft_version);
    const doc = normalizeDocument(parseDocument(state.draft_json));
    if (!doc.rules.length && !doc.packs.length && !doc.compatibility.length) {
      throw failure("EMPTY_POLICY", "Add and save at least one approved rule or pack policy before publishing.");
    }
    const snapshot = JSON.stringify(doc);
    if (snapshot === state.published_json) {
      throw failure("UNCHANGED_POLICY", "This revision is already published.");
    }
    const now = new Date().toISOString();
    const version = state.published_version + 1;
    db.prepare(
      "UPDATE community_guide_state SET published_json = ?, published_version = ?, published_at = ?, published_by_steam_id = ? WHERE id = 1"
    ).run(snapshot, version, now, adminSteamId);
    db.prepare(
      "INSERT INTO community_guide_history (version,published_json,published_at,published_by_steam_id) VALUES (?,?,?,?)"
    ).run(version, snapshot, now, adminSteamId);
    db.exec("COMMIT");
    return { version, publishedAt:now, ruleCount:doc.rules.length, packCount:doc.packs.length, compatibilityCount:doc.compatibility.length };
  } catch(error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function assessGroup(policy, { speciesA, speciesB = speciesA, count = 1 } = {}) {
  if (!knownPlayableSpecies(speciesA) || !knownPlayableSpecies(speciesB) ||
      !Number.isSafeInteger(count) || count < 1 || count > 100) {
    throw failure("INVALID_GROUP", "Choose playable species and a group size between 1 and 100.");
  }
  const source = normalizeDocument(policy);
  const nameA = speciesById.get(speciesA).name;
  const nameB = speciesById.get(speciesB).name;
  if (speciesA === speciesB) {
    const entry = source.packs.find(p => p.speciesId === speciesA);
    if (!entry) return { status:"unverified", message:"No staff-published group-size limit is available for " + nameA + "." };
    return count <= entry.maxMembers
      ? { status:"within-limit", message:count + " / " + entry.maxMembers + " members — within this published single-species limit.", limit:entry.maxMembers, note:entry.note }
      : { status:"over-limit", message:count + " / " + entry.maxMembers + " members — exceeds the published single-species limit.", limit:entry.maxMembers, note:entry.note };
  }
  const [first, second] = [speciesA, speciesB].sort();
  const entry = source.compatibility.find(p => p.speciesA === first && p.speciesB === second);
  if (!entry) return { status:"unverified", message:"Mixed grouping of " + nameA + " and " + nameB + " has not been verified in published Hollow Valley rules." };
  if (!entry.allowed) return { status:"prohibited", message:"This species combination is marked prohibited in the published policy.", note:entry.note };
  return { status:"compatibility-only", message:"This combination is listed as permitted, but the mixed-group size limit has not been verified by this checker.", note:entry.note };
}
module.exports = {
  RULE_CATEGORIES, BLANK, normalizeDocument, speciesList, publicState,
  publicHistory, adminState, saveDraft, publish, assessGroup,
};
