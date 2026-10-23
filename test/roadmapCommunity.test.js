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

test.after(() => {
  db.close();
  fs.rmSync(workdir, { recursive: true, force: true });
});

test("roadmap ballot limits voting to three idea-stage features per Steam identity", () => {
  const initial = voting.voteSummary(steam1);
  assert.equal(initial.maxVotes, 3);
  assert.equal(initial.myVotes.length, 0);
  assert.equal(initial.eligibleFeatureIds.length, 26);

  for (const id of [1, 2, 3]) voting.setVote(steam1, id, true);
  voting.setVote(steam1, 3, true); // idempotent repeated request
  assert.deepEqual(voting.voteSummary(steam1).myVotes, [1, 2, 3]);
  assert.equal(voting.voteSummary(steam1).counts[3], 1);
  assert.throws(() => voting.setVote(steam1, 4, true), { code: "VOTE_LIMIT" });

  for (const id of [7, 8, 9, 13, 31, 0, 100]) {
    assert.throws(() => voting.setVote(steam1, id, true), { code: "FEATURE_NOT_VOTABLE" });
  }
  assert.throws(() => voting.setVote("not-steam", 1, true), { code: "STEAM_REQUIRED" });
  assert.throws(() => voting.setVote(steam1, 1, "true"), { code: "INVALID_BALLOT" });

  voting.setVote(steam1, 2, false);
  voting.setVote(steam1, 4, true);
  assert.deepEqual(voting.voteSummary(steam1).myVotes, [1, 3, 4]);
  voting.setVote(steam2, 1, true);
  assert.equal(voting.voteSummary().counts[1], 2);
  assert.equal(voting.voteSummary().myVotes.length, 0);
  assert.equal(voting.voteSummary().requiresSteam, true);
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
  assert.throws(
    () => voting.submitSuggestion(steam1, "Improved galleries", "Give profiles a screenshot gallery for their dinosaurs."),
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

    assert.equal((await post("/api/roadmap/votes", { featureId: 10, selected: true })).status, 401);
    assert.equal((await post("/api/roadmap/votes", { featureId: 10, selected: true }, { "X-Test-Steam": "nope" })).status, 403);
    assert.equal((await post("/api/roadmap/votes", { featureId: 10, selected: true }, { "X-Test-Steam": steam2, Origin: "https://evil.example" })).status, 403);
    const okay = await post("/api/roadmap/votes", { featureId: 10, selected: true }, { "X-Test-Steam": steam2 });
    assert.equal(okay.status, 200);
    assert.ok((await okay.json()).myVotes.includes(10));
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
