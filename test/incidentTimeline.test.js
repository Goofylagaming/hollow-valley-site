"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const automation = require("../server/services/automationWebsiteClient");
const timeline = require("../server/services/incidentTimeline");
const router = require("../server/routes/incidentTimeline");

const steam = "76561198000000001";
const actor = "76561198000000002";
const at = "2026-10-27T00:00:00.000Z";

function makeApp(user) {
  const app = express();
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use("/api/admin-incidents", router);
  return app;
}
async function running(app, task) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try { return await task("http://127.0.0.1:" + server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
function audit() {
  return { id:"audit-1", category:"game_admin", action:"slay_player",
    status:"succeeded", created_at:at,
    message:"Sensitive operator exception: token=SECRET_DO_NOT_SEND",
    details: {
      actorSteamId:actor, actorName:"Chromie", steamId:steam, requestId:"req-123",
      sessionCookie:"SECRET_DO_NOT_SEND", payload:{accessToken:"SECRET_DO_NOT_SEND"},
    },
  };
}
function request() {
  return { id:"job-3", kind:"dinostorage", status:"failed", updated_at:"2026-10-27T00:01:00.000Z",
    steam_id:steam, rawError:"SECRET_DO_NOT_SEND" };
}

test("normalizer produces bounded safe fields, never raw audit messages or request metadata", () => {
  const a = timeline.normalizeAudit(audit());
  const r = timeline.normalizeRequest(request());
  assert.equal(a.actorSteamId, actor);
  assert.equal(a.playerSteamId, steam);
  assert.equal(a.actorName, "Chromie");
  assert.equal(a.reference, "req-123");
  assert.equal(r.source, "request");
  assert.equal(r.status, "failed");
  assert.doesNotMatch(JSON.stringify([a,r]), /SECRET_DO_NOT_SEND|sessionCookie|rawError|payload/);
});

test("timeline is chronologically ordered and filters by Steam ID, action and source", () => {
  const entries = timeline.buildTimeline([audit()], [request()], { q: steam });
  assert.deepEqual(entries.events.map(x => x.id), ["job-3", "audit-1"]);
  assert.equal(timeline.buildTimeline([audit()], [request()], { q: "slay_player" }).events.length, 1);
  assert.equal(timeline.buildTimeline([audit()], [request()], { status:"failed" }).events[0].id, "job-3");
  assert.equal(timeline.buildTimeline([audit()], [request()], { source:"audit" }).events[0].id, "audit-1");
  assert.deepEqual(timeline.buildTimeline([audit()], [request()], { source:"request" }).events.map(x=>x.source),["request"]);
  assert.equal(timeline.buildTimeline(new Array(200).fill(audit()), [], {}).hasMoreUnloaded, true);
});

test("incident timeline denies guests and non-admins before querying privileged automation feeds", async () => {
  const before = automation.getAdminAudit;
  automation.getAdminAudit = async () => { throw new Error("must not call automation"); };
  try {
    for (const [user,code] of [[null,401],[{ id:5, is_admin:0 },403]]) {
      await running(makeApp(user), async(base) => {
        const res = await fetch(base + "/api/admin-incidents/timeline");
        assert.equal(res.status,code);
      });
    }
  } finally { automation.getAdminAudit = before; }
});

test("admin timeline returns sanitized bounded activity with no cache", async () => {
  const originals = { audit:automation.getAdminAudit, requests:automation.getAdminRequests };
  automation.getAdminAudit = async(options) => { assert.equal(options.limit,200); return {audit:[audit()]}; };
  automation.getAdminRequests = async(options) => { assert.equal(options.limit,100); return {requests:[request()]}; };
  try {
    await running(makeApp({id:1,steam_id:actor,is_admin:1}), async(base) => {
      const response = await fetch(base + "/api/admin-incidents/timeline?q=" + steam);
      assert.equal(response.status,200);
      assert.match(response.headers.get("cache-control"), /no-store/);
      const json=await response.json();
      assert.equal(json.events.length,2);
      assert.equal(json.sourceCounts.requests,1);
      assert.equal(json.sourceCounts.audit,1);
      assert.doesNotMatch(JSON.stringify(json), /SECRET_DO_NOT_SEND|sessionCookie|rawError/);
      const filtered=await fetch(base + "/api/admin-incidents/timeline?source=request&status=failed");
      assert.deepEqual((await filtered.json()).events.map(e=>e.id),["job-3"]);
    });
  } finally { automation.getAdminAudit=originals.audit; automation.getAdminRequests=originals.requests; }
});

test("a broken audit source is clearly marked partial; two broken sources return 502",async()=>{
  const originals = { audit:automation.getAdminAudit, requests:automation.getAdminRequests };
  automation.getAdminAudit = async () => {throw Error("sensitive error");};
  automation.getAdminRequests = async () => ({requests:[request()]});
  try {
    await running(makeApp({id:1,is_admin:1}),async(base)=>{
      const partial=await fetch(base + "/api/admin-incidents/timeline");
      assert.equal(partial.status,200);
      assert.deepEqual((await partial.json()).partialSources,["audit"]);
      automation.getAdminRequests = async () => {throw Error("secret unavailable");};
      const down=await fetch(base + "/api/admin-incidents/timeline");
      assert.equal(down.status,502);
      assert.doesNotMatch(await down.text(), /sensitive|secret/);
    });
  } finally { automation.getAdminAudit=originals.audit;automation.getAdminRequests=originals.requests; }
});

test("admin incident page is routed behind an admin gate with escaped data rendering", () => {
  const read=(f)=>fs.readFileSync(path.join(__dirname,"..",f),"utf8");
  const app=read("server/index.js");
  const ui=read("public/adminincidents.html");
  const js=read("public/assets/admin-incidents.js");
  const nav=read("public/partials/nav.html");
  const roadmap=read("public/assets/home-roadmap.js");
  assert.match(app, /adminincidents: "adminincidents\.html"/);
  assert.match(app, /app\.use\("\/api\/admin-incidents", adminIncidentsRouter\)/);
  assert.match(app, /app\.get\(\[\`\/\$\{route\}\`, \`\/\$\{route\}\.html\`\], requireAdmin/);
  assert.match(ui, /robots" content="noindex, nofollow"/);
  assert.match(ui, /admin-incidents\.js/);
  assert.match(nav, /href="\/adminincidents"/);
  assert.match(js, /escapeHtml/);
  assert.match(js, /incident-records/);
  assert.doesNotThrow(()=>new Function(js));
  assert.match(roadmap, /25: \{ status: 'building'/);
  assert.match(read("server/services/roadmapCommunity.js"), /18, 19, 20, 21, 22, 23, 24, 26/);
});
