"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-roadmap-votes-"));
process.env.DB_PATH = path.join(workdir, "roadmap.sqlite");
const { db } = require("../server/db");
const voting = require("../server/services/roadmapCommunity");
const express = require("express");
const router = require("../server/routes/roadmapCommunity");
const steam1 = "76561198000000001";
const steam2 = "76561198000000002";

test('Treasury votes stay historical and free active ballot slots during development',()=>{
  const steam='76561198000000017';db.prepare('INSERT INTO roadmap_votes (steam_id,feature_id) VALUES (?,17)').run(steam);
  for(const id of [3,4,5])voting.setVote(steam,id,true);
  const summary=voting.voteSummary(steam);assert.equal(summary.counts[17],1);assert.deepEqual(summary.myVotes,[3,4,5]);
  assert.throws(()=>voting.setVote(steam,17,true),{code:'FEATURE_NOT_VOTABLE'});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM roadmap_votes WHERE steam_id=? AND feature_id=17').get(steam).n,1);
  db.prepare('DELETE FROM roadmap_votes WHERE steam_id=?').run(steam);
});

test('Headquarters votes remain recorded while all active ballot slots are available',()=>{
  const steam='76561198000000016';
  db.prepare('INSERT INTO roadmap_votes (steam_id,feature_id) VALUES (?,16)').run(steam);
  for(const id of [3,4,5])voting.setVote(steam,id,true);
  const summary=voting.voteSummary(steam);
  assert.equal(summary.counts[16],1);assert.deepEqual(summary.myVotes,[3,4,5]);
  assert.throws(()=>voting.setVote(steam,16,true),{code:'FEATURE_NOT_VOTABLE'});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM roadmap_votes WHERE steam_id=? AND feature_id=16').get(steam).n,1);
  db.prepare('DELETE FROM roadmap_votes WHERE steam_id=?').run(steam);
});

test('discovery votes remain historical without using active ballot slots',()=>{
  const steam='76561198000000010';db.prepare('INSERT INTO roadmap_votes (steam_id,feature_id) VALUES (?,10)').run(steam);
  for(const id of [3,4,5])voting.setVote(steam,id,true);
  const result=voting.voteSummary(steam);assert.equal(result.counts[10],1);assert.deepEqual(result.myVotes,[3,4,5]);
  assert.throws(()=>voting.setVote(steam,10,true),{code:'FEATURE_NOT_VOTABLE'});db.prepare('DELETE FROM roadmap_votes WHERE steam_id=?').run(steam);
});

test('journey votes remain historical while development frees active slots',()=>{
  const steam='76561198000000011';
  db.prepare('INSERT INTO roadmap_votes (steam_id,feature_id) VALUES (?,11)').run(steam);
  for(const id of [3,4,5])voting.setVote(steam,id,true);
  const result=voting.voteSummary(steam);
  assert.equal(result.counts[11],1);assert.deepEqual(result.myVotes,[3,4,5]);
  assert.throws(()=>voting.setVote(steam,11,true),{code:'FEATURE_NOT_VOTABLE'});
  db.prepare('DELETE FROM roadmap_votes WHERE steam_id=?').run(steam);
});

test('gallery votes remain historical while development frees the active slots',()=>{
  const steam='76561198000000024';
  db.prepare('INSERT INTO roadmap_votes (steam_id,feature_id) VALUES (?,24)').run(steam);
  for(const id of [3,4,5])voting.setVote(steam,id,true);
  const result=voting.voteSummary(steam);
  assert.equal(result.counts[24],1);assert.deepEqual(result.myVotes,[3,4,5]);
  assert.throws(()=>voting.setVote(steam,24,true),{code:'FEATURE_NOT_VOTABLE'});
  db.prepare('DELETE FROM roadmap_votes WHERE steam_id=?').run(steam);
});

test('promotional skin code votes remain historical while development frees the active slots',()=>{
  const steam='76561198000000023';
  db.prepare('INSERT INTO roadmap_votes (steam_id,feature_id) VALUES (?,23)').run(steam);
  for(const id of [3,4,5])voting.setVote(steam,id,true);
  const result=voting.voteSummary(steam);
  assert.equal(result.counts[23],1);assert.deepEqual(result.myVotes,[3,4,5]);
  assert.throws(()=>voting.setVote(steam,23,true),{code:'FEATURE_NOT_VOTABLE'});
  db.prepare('DELETE FROM roadmap_votes WHERE steam_id=?').run(steam);
});

test.after(() => {
  db.close();
  fs.rmSync(workdir, { recursive: true, force: true });
});

test("roadmap ballot limits voting to three idea-stage features per Steam identity", () => {
  const initial = voting.voteSummary(steam1);
  assert.equal(initial.maxVotes, 3);
  assert.equal(initial.myVotes.length, 0);
  assert.equal(initial.eligibleFeatureIds.length, 12);
  assert.equal(new Set(initial.eligibleFeatureIds).size, 12, "No duplicate roadmap feature IDs");

  for (const id of [3, 4, 5]) voting.setVote(steam1, id, true);
  voting.setVote(steam1, 5, true); // idempotent repeated request
  assert.deepEqual(voting.voteSummary(steam1).myVotes, [3, 4, 5]);
  assert.equal(voting.voteSummary(steam1).counts[5], 1);
  assert.throws(() => voting.setVote(steam1, 6, true), { code: "VOTE_LIMIT" });

  for (const id of [1, 2, 7, 8, 9, 10, 11, 12, 13, 15, 16, 17, 22, 23, 24, 31, 0, 100]) {
    assert.throws(() => voting.setVote(steam1, id, true), { code: "FEATURE_NOT_VOTABLE" });
  }
  assert.throws(() => voting.setVote("not-steam", 1, true), { code: "STEAM_REQUIRED" });
  assert.throws(() => voting.setVote(steam1, 3, "true"), { code: "INVALID_BALLOT" });

  voting.setVote(steam1, 3, false);
  voting.setVote(steam1, 6, true);
  assert.deepEqual(voting.voteSummary(steam1).myVotes, [4, 5, 6]);
  voting.setVote(steam2, 4, true);
  assert.equal(voting.voteSummary().counts[4], 2);
  assert.equal(voting.voteSummary().myVotes.length, 0);
  assert.equal(voting.voteSummary().requiresSteam, true);
});

test("retired #25 votes remain in historical totals but free all three active ballot slots", () => {
  const steam3 = "76561198000000003";
  db.prepare("INSERT INTO roadmap_votes (steam_id, feature_id) VALUES (?, 25)").run(steam3);
  db.prepare("INSERT INTO roadmap_votes (steam_id, feature_id) VALUES (?, 26)").run(steam3);
  const historyBefore = voting.voteSummary(steam3);
  assert.equal(historyBefore.counts[25], 1);
  assert.equal(historyBefore.counts[26], 1);
  db.prepare("INSERT INTO roadmap_votes (steam_id, feature_id) VALUES (?, 29)").run(steam3);
  const summary = voting.voteSummary(steam3);
  assert.equal(summary.counts[25], 1);
  assert.equal(summary.counts[26], 1);
  assert.equal(summary.counts[29], 1);
  assert.equal(summary.eligibleFeatureIds.includes(29), false);
  assert.equal(summary.eligibleFeatureIds.includes(26), false);
  assert.deepEqual(summary.myVotes, []);
  assert.equal(summary.eligibleFeatureIds.includes(25), false);
  for (const feature of [3, 4, 5]) voting.setVote(steam3, feature, true);
  assert.deepEqual(voting.voteSummary(steam3).myVotes, [3, 4, 5]);
  assert.throws(() => voting.setVote(steam3, 6, true), { code: "VOTE_LIMIT" });
  assert.throws(() => voting.setVote(steam3, 25, true), { code: "FEATURE_NOT_VOTABLE" });
  assert.throws(() => voting.setVote(steam3, 26, true), { code: "FEATURE_NOT_VOTABLE" });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM roadmap_votes WHERE steam_id = ? AND feature_id IN (25, 26)").get(steam3).n, 2);
  assert.throws(() => voting.setVote(steam3, 29, true), { code: "FEATURE_NOT_VOTABLE" });
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM roadmap_votes WHERE steam_id = ? AND feature_id IN (25, 26, 29)").get(steam3).n, 3);
});

test("retired world-event votes remain recorded without occupying active slots", () => {
  const steam = "76561198000000009";
  db.prepare("INSERT INTO roadmap_votes (steam_id, feature_id) VALUES (?, 15)").run(steam);
  for (const id of [3,4,5]) voting.setVote(steam, id, true);
  assert.deepEqual(voting.voteSummary(steam).myVotes, [3,4,5]);
  assert.equal(voting.voteSummary().counts[15], 1);
});

test("skin-collection votes stay recorded after development starts without consuming an active vote", () => {
  const steam = "76561198000000022";
  db.prepare("INSERT INTO roadmap_votes (steam_id, feature_id) VALUES (?, 22)").run(steam);
  for (const id of [3,4,5]) voting.setVote(steam,id,true);
  assert.deepEqual(voting.voteSummary(steam).myVotes,[3,4,5]);
  assert.equal(voting.voteSummary().counts[22],1);
});

test("achievement votes remain historical after development starts", () => {
  const steam = "76561198000000012";
  db.prepare("INSERT INTO roadmap_votes (steam_id, feature_id) VALUES (?, 2)").run(steam);
  for (const id of [3,4,5]) voting.setVote(steam,id,true);
  assert.deepEqual(voting.voteSummary(steam).myVotes,[3,4,5]);
  assert.equal(voting.voteSummary().counts[2],1);
  assert.throws(() => voting.setVote(steam,2,true), {code:"FEATURE_NOT_VOTABLE"});
});

test("player ideas require moderation, are rate limited and never publish Steam identities", () => {
  assert.throws(() => voting.submitSuggestion(steam1, "Short", "Needs a much longer feature description."), { code: "INVALID_SUGGESTION" });
  const one = voting.submitSuggestion(steam1, "Dinosaur photo challenges", "A monthly photo contest with a featured gallery.");
  assert.equal(one.status, "pending");
  assert.equal(voting.approvedSuggestions().length, 0);
  assert.throws(
    () => voting.submitSuggestion(steam1, "Dinosaur photo challenges", "The same idea a second time should not be allowed."),
    { code: "SUGGESTION_DUPLICATE" }
  );
  assert.throws(() => voting.moderateSuggestion(one.id, "approved", "invalid"), { code: "STEAM_REQUIRED" });
  assert.deepEqual(voting.moderateSuggestion(one.id, "approved", steam2), { id: one.id, status: "approved" });
  assert.throws(() => voting.moderateSuggestion(one.id, "rejected", steam2), { code: "SUGGESTION_NOT_PENDING" });
  const approved = voting.approvedSuggestions();
  assert.equal(approved.length, 1);
  assert.equal(approved[0].title, "Dinosaur photo challenges");
  assert.equal(JSON.stringify(approved).includes(steam1), false);
  assert.equal(voting.adminSuggestions()[0].steamId, steam1);
  voting.submitSuggestion(steam1, "Night mode for maps", "Offer a darker live-map palette for evening use.");
  voting.submitSuggestion(steam1, "Improved galleries", "Give profiles a screenshot gallery for their dinosaurs.");
  assert.throws(
    () => voting.submitSuggestion(steam1, "Nesting improvements", "Add more detail to the existing nesting roadmap concept."),
    { code: "SUGGESTION_LIMIT" }
  );
});

test("website routes enforce linked Steam, same-origin JSON requests and admin moderation", async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.get("X-Test-Steam")) req.user = {
      steam_id: req.get("X-Test-Steam"),
      is_admin: req.get("X-Test-Admin") === "yes" ? 1 : 0,
    };
    next();
  });
  app.use("/api/roadmap", router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = "http://127.0.0.1:" + server.address().port;
  const post = (url, body, headers = {}) => fetch(base + url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: base, ...headers },
    body: JSON.stringify(body),
  });
  try {
    const publicResult = await fetch(base + "/api/roadmap/votes");
    assert.equal(publicResult.status, 200);
    const publicBody = await publicResult.json();
    assert.equal(publicBody.requiresSteam, true);

    assert.equal((await post("/api/roadmap/votes", { featureId: 14, selected: true })).status, 401);
    assert.equal((await post("/api/roadmap/votes", { featureId: 14, selected: true }, { "X-Test-Steam": "nope" })).status, 403);
    assert.equal((await post("/api/roadmap/votes", { featureId: 14, selected: true }, { "X-Test-Steam": steam2, Origin: "https://evil.example" })).status, 403);
    const okay = await post("/api/roadmap/votes", { featureId: 14, selected: true }, { "X-Test-Steam": steam2 });
    assert.equal(okay.status, 200);
    assert.ok((await okay.json()).myVotes.includes(14));
    assert.equal((await post("/api/roadmap/votes", { featureId: 31, selected: true }, { "X-Test-Steam": steam2 })).status, 400);
    assert.equal((await fetch(base + "/api/roadmap/admin/suggestions")).status, 401);
    assert.equal((await fetch(base + "/api/roadmap/admin/suggestions", { headers: { "X-Test-Steam": steam1 } })).status, 403);
    assert.equal((await fetch(base + "/api/roadmap/admin/suggestions", { headers: { "X-Test-Steam": steam2, "X-Test-Admin": "yes" } })).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("homepage includes a parsable, accessible voting UI and protected admin page", () => {
  const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  assert.doesNotThrow(() => new Function(read("public/assets/roadmap-voting.js")));
  assert.doesNotThrow(() => new Function(read("public/assets/admin-roadmap.js")));
  const html = read("public/index.html");
  assert.match(html, /roadmap-suggestion-form/);
  assert.match(html, /roadmap-voting\.js/);
  assert.match(html, /roadmap-vote-leaders/);
  assert.match(read("public/adminroadmap.html"), /roadmap-admin-list/);
  const app = read("server/index.js");
  assert.match(app, /roadmapCommunityRouter/);
  assert.match(app, /adminroadmap: "adminroadmap\.html"/);
  const nav = read("public/partials/nav.html");
  assert.match(nav, /Roadmap suggestions/);
  assert.match(read("public/admin.html"), /href="\/adminroadmap"/);
  assert.equal(read("server/services/roadmapCommunity.js").includes("territoryWarsRouter"), false);
});
