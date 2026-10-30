"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs");
const express = require("express");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-player-reports-"));
process.env.DB_PATH = path.join(dir, "reports.sqlite");
process.env.PLAYER_REPORTS_ENABLED = "true";
delete process.env.PUBLIC_SITE_URL;

const { db } = require("../server/db");
const reports = require("../server/services/playerReports");
const router = require("../server/routes/playerReports");

const steam1 = "76561198000000001";
const steam2 = "76561198000000002";
const steamAdmin = "76561198000000003";

const user1 = { id: 1, steam_id:steam1, is_admin:0 };
const user2 = { id: 2, steam_id:steam2, is_admin:0 };
const admin = { id: 3, steam_id:steamAdmin, is_admin:1 };
for (const [id,steam_id,username,is_admin] of [
  [1,steam1,"Reporter",0],[2,steam2,"Another",0],[3,steamAdmin,"Admin",1],
]) {
  db.prepare("INSERT INTO users (id,steam_id,username,is_admin) VALUES (?,?,?,?)").run(id,steam_id,username,is_admin);
}
test.after(() => {
  db.close();
  fs.rmSync(dir, { recursive:true, force:true });
});

function payload() {
  return {
    category:"harassment",
    description:"An incident in the Valley needs an admin to review the supplied evidence.",
    reportedSteamId:steam2,
    evidenceUrls:["https://cdn.discordapp.com/attachments/123/456/image.png"],
    occurredAt: new Date(Date.now() - 60000).toISOString(),
    reporterSteamId:steamAdmin, // malicious client-supplied identity must be ignored
  };
}

function app() {
  const a = express();
  a.use(express.json());
  a.use((req,_res,next)=>{
    const id=Number(req.get("X-Test-User"));
    req.user = id === 1 ? user1 : id === 2 ? user2 : id === 3 ? admin : null;
    next();
  });
  a.use("/api/reports", router);
  return a;
}

async function running(task) {
  const server=app().listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  const base="http://127.0.0.1:"+server.address().port;
  try {return await task(base);} finally {await new Promise(resolve=>server.close(resolve));}
}
function post(base, route, input, userId=1, overrides={}) {
  return fetch(base+route,{
    method:"POST",
    headers:{ "Content-Type":"application/json", Origin:base, "X-Test-User":String(userId), ...overrides },
    body:JSON.stringify(input),
  });
}

test("reports validate safe evidence providers, timestamps, report category and identity",()=>{
  assert.equal(reports.validateEvidence(["https://youtu.be/example"]).length,1);
  for(const url of [
    "http://cdn.discordapp.com/attachments/1/2", "javascript:alert(1)",
    "https://localhost/secret", "https://user:pass@cdn.discordapp.com/e",
    "https://cdn.discordapp.com:444/anything", "https://discord.com.evil.example/phishing",
  ]) {
    assert.throws(()=>reports.validateEvidence([url]), {code:"INVALID_EVIDENCE"});
  }
  assert.throws(()=>reports.validateEvidence(new Array(4).fill("https://youtu.be/abc")), {code:"INVALID_EVIDENCE"});
  assert.throws(()=>reports.validateEvidence(["https://youtu.be/abc","https://youtu.be/abc"]), {code:"INVALID_EVIDENCE"});
  assert.throws(()=>reports.validateReport({...payload(),category:"invalid"},steam1), {code:"INVALID_REPORT"});
  assert.throws(()=>reports.validateReport({...payload(),reportedSteamId:steam1},steam1), {code:"INVALID_REPORT"});
  assert.throws(()=>reports.validateReport({...payload(),description:"Too short"},steam1), {code:"INVALID_REPORT"});
  assert.throws(()=>reports.validateReport({...payload(),occurredAt:"2100-01-01T00:00:00Z"},steam1), {code:"INVALID_REPORT"});
});

test("public capability check is safe; guests and cross-origin posts cannot submit",async()=>{
  await running(async base=>{
    const caps=await fetch(base+"/api/reports/capabilities");
    assert.equal((await caps.json()).enabled,true);
    assert.equal((await post(base,"/api/reports",payload(),0)).status,401);
    assert.equal((await post(base,"/api/reports",payload(),1,{Origin:"https://not-hollow-valley.example"})).status,403);
    const noOrigin=await fetch(base+"/api/reports",{
      method:"POST",headers:{"Content-Type":"application/json","X-Test-User":"1"},
      body:JSON.stringify(payload()),
    });
    assert.equal(noOrigin.status,403);
    assert.equal((await fetch(base+"/api/reports/admin", {headers:{"X-Test-User":"1"}})).status,403);
    assert.equal((await fetch(base+"/api/reports/admin")).status,401);
  });
});

test("player submission is private, rate-limited, stored additively and uses session identity",async()=>{
  await running(async base=>{
    const created=await post(base,"/api/reports",payload(),1);
    assert.equal(created.status,201);
    assert.match(created.headers.get("cache-control"),/no-store/);
    const body=await created.json();
    assert.equal(body.report.status,"open");
    assert.equal(body.report.reporterSteamId,undefined);
    assert.equal(db.prepare("SELECT reporter_steam_id FROM player_reports WHERE id = ?").get(body.report.id).reporter_steam_id,steam1);
    const mine=await fetch(base+"/api/reports/mine", {headers:{"X-Test-User":"1"}});
    const myBody=await mine.json();
    assert.equal(myBody.reports.length,1);
    assert.equal(myBody.reports[0].id,body.report.id);
    assert.equal(myBody.reports[0].reviewedBySteamId,undefined);
    const other=await fetch(base+"/api/reports/mine", {headers:{"X-Test-User":"2"}});
    assert.deepEqual((await other.json()).reports,[]);
    const rate=await post(base,"/api/reports",payload(),1);
    assert.equal(rate.status,429);
    assert.equal((await rate.json()).code,"REPORT_LIMIT");
  });
});

test("admin queue, detail and reviews are protected, auditable and idempotent",async()=>{
  await running(async base=>{
    const list=await fetch(base+"/api/reports/admin?q="+steam1,{headers:{"X-Test-User":"3"}});
    assert.equal(list.status,200);
    const items=(await list.json()).reports;
    assert.equal(items.length,1);
    const id=items[0].id;
    assert.equal(items[0].reporterSteamId,steam1);
    assert.equal(items[0].reporterName,"Reporter");
    assert.equal((await fetch(base+"/api/reports/admin/"+id,{headers:{"X-Test-User":"2"}})).status,403);
    assert.equal((await post(base,"/api/reports/admin/"+id+"/review",{status:"resolved"},1)).status,403);
    const result=await post(base,"/api/reports/admin/"+id+"/review",{
      status:"reviewing",note:"Checking server logs",adminSteamId:steam1,
    },3);
    assert.equal(result.status,200);
    const body=await result.json();
    assert.equal(body.changed,true);
    assert.equal(body.report.status,"reviewing");
    assert.equal(body.reviews[0].adminSteamId,steamAdmin);
    assert.equal(body.reviews[0].note,"Checking server logs");
    const countBefore=db.prepare("SELECT COUNT(*) AS n FROM player_report_reviews WHERE report_id = ?").get(id).n;
    const retry=await post(base,"/api/reports/admin/"+id+"/review",{status:"reviewing"},3);
    assert.equal((await retry.json()).changed,false);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM player_report_reviews WHERE report_id = ?").get(id).n,countBefore);
    const mine=await fetch(base+"/api/reports/mine",{headers:{"X-Test-User":"1"}});
    const mineText=await mine.text();
    assert.doesNotMatch(mineText,/Checking server logs|adminSteamId|reviewedBySteamId/);
    assert.match(mineText,/"status":"reviewing"/);
  });
});

test("disabling new reports does not hide already submitted reports or block admin review",async()=>{
  const previous=process.env.PLAYER_REPORTS_ENABLED;
  process.env.PLAYER_REPORTS_ENABLED="false";
  try {
    await running(async base=>{
      assert.equal((await (await fetch(base+"/api/reports/capabilities")).json()).enabled,false);
      assert.equal((await post(base,"/api/reports",payload(),2)).status,503);
      const mine=await fetch(base+"/api/reports/mine",{headers:{"X-Test-User":"1"}});
      assert.equal((await mine.json()).reports.length,1);
      assert.equal((await fetch(base+"/api/reports/admin",{headers:{"X-Test-User":"3"}})).status,200);
    });
  } finally {process.env.PLAYER_REPORTS_ENABLED=previous;}
});

test("report pages are routed, admin page is gated and all untrusted text is escaped",()=>{
  const read=(f)=>fs.readFileSync(path.join(__dirname,"..",f),"utf8");
  const index=read("server/index.js");
  const ui=read("public/reports.html");
  const adminUi=read("public/adminreports.html");
  const playerJs=read("public/assets/player-reports.js");
  const adminJs=read("public/assets/admin-reports.js");
  assert.match(index,/app\.use\("\/api\/reports", playerReportsRouter\)/);
  assert.match(index,/adminreports: "adminreports\.html"/);
  assert.match(index,/"reports"/);
  assert.match(index,/"events"/);
  assert.match(ui,/report-form/);
  assert.match(adminUi,/noindex, nofollow/);
  assert.match(adminJs,/escapeHtml/);
  assert.match(adminJs,/noopener noreferrer/);
  assert.match(playerJs,/escapeHtml/);
  assert.doesNotThrow(()=>new Function(playerJs));
  assert.doesNotThrow(()=>new Function(adminJs));
  assert.match(read("public/profile.html"),/href="\/reports"/);
  assert.match(read("public/partials/nav.html"),/href="\/adminreports"/);
  assert.match(read("public/assets/home-roadmap.js"),/26: \{ status: 'building'/);
});
