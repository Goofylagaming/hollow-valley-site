"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

const root = path.join(__dirname, "..");
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "hv-ux02-rules-"));
process.env.DB_PATH = path.join(workdir, "rules.sqlite");
delete process.env.PUBLIC_SITE_URL;
const { db } = require("../server/db");
const guides = require("../server/services/communityGuides");
const router = require("../server/routes/communityGuides");
const STEAM_ID = "76561198000000001";
const REX = "tyrannosaurus";
const TRIKE = "triceratops";

test.after(() => {
  db.close();
  fs.rmSync(workdir, { recursive:true, force:true });
});
function sampleDocument() {
  return {
    rules:[
      {id:"rule-respect-01",category:"conduct",title:"Respect other players",
        body:"This sample rule exists in the isolated test database only and must be admin-approved before publication."},
      {id:"rule-group-02",category:"grouping",title:"Example grouping policy",
        body:"Staff must verify the approved grouping restrictions before publishing anything to the live website."},
    ],
    packs:[{speciesId:REX,maxMembers:2,note:"Test-only administrator-approved maximum."}],
    compatibility:[{speciesA:REX,speciesB:TRIKE,allowed:false,note:"Test-only decision."}],
  };
}
function app() {
  const server = express();
  server.use(express.json());
  server.use((req,_res,next) => {
    const role = req.get("X-Test-Role");
    req.user = role === "admin" ? {id:1,is_admin:1,steam_id:STEAM_ID} :
      role === "player" ? {id:2,is_admin:0,steam_id:"76561198000000002"} : null;
    next();
  });
  server.use("/api/community-guides",router);
  return server;
}
async function withServer(callback) {
  const server = app().listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  const base = "http://127.0.0.1:"+server.address().port;
  try {return await callback(base);}
  finally {await new Promise(resolve=>server.close(resolve));}
}
function write(base,path,document,method="PUT",headers={}) {
  return fetch(base+path,{
    method,headers:{"Content-Type":"application/json",Origin:base,"X-Test-Role":"admin",...headers},
    body:JSON.stringify(document),
  });
}

test("startup exposes species reference data but no invented published pack restrictions",()=>{
  const state=guides.publicState();
  assert.equal(state.published,false);
  assert.equal(state.version,0);
  assert.deepEqual(state.rules,[]);
  assert.deepEqual(state.packs,[]);
  const rex=state.species.find(x=>x.id===REX);
  assert.equal(rex.referencePackLimit,2);
  assert.equal(rex.releasedInEvrima,true);
  assert.equal(state.referenceOnly,true);
  assert.equal(guides.assessGroup(state,{speciesA:REX,count:3}).status,"unverified");
  assert.equal(guides.assessGroup(state,{speciesA:REX,speciesB:TRIKE,count:2}).status,"unverified");
});

test("reject invalid policy shape, duplicate IDs, unknown/unplayable species and incompatible pairs",()=>{
  const base=sampleDocument();
  assert.throws(()=>guides.normalizeDocument({}),{code:"INVALID_POLICY"});
  assert.throws(()=>guides.normalizeDocument({...base,rules:[base.rules[0],base.rules[0]]}),{code:"INVALID_POLICY"});
  assert.throws(()=>guides.normalizeDocument({...base,rules:[{...base.rules[0],title:"x"}]}),{code:"INVALID_POLICY"});
  assert.throws(()=>guides.normalizeDocument({...base,packs:[{speciesId:"other-server-dragon",maxMembers:1}]}),{code:"INVALID_POLICY"});
  assert.throws(()=>guides.normalizeDocument({...base,packs:[{speciesId:"deinocheirus",maxMembers:1}]}),{code:"INVALID_POLICY"});
  assert.throws(()=>guides.normalizeDocument({...base,packs:[{speciesId:REX,maxMembers:0}]}),{code:"INVALID_POLICY"});
  assert.throws(()=>guides.normalizeDocument({...base,compatibility:[{speciesA:REX,speciesB:REX,allowed:true}]}),{code:"INVALID_POLICY"});
  assert.throws(()=>guides.normalizeDocument({...base,compatibility:[
    {speciesA:REX,speciesB:TRIKE,allowed:true},
    {speciesA:TRIKE,speciesB:REX,allowed:false},
  ]}),{code:"INVALID_POLICY"});
  assert.equal(guides.normalizeDocument(base).compatibility[0].allowed,false);
  assert.throws(()=>guides.assessGroup(base,{speciesA:REX,count:101}),{code:"INVALID_GROUP"});
});

test("guest and regular player cannot read drafts, edit or publish; writes require same-origin JSON",async()=>{
  await withServer(async base=>{
    for (const route of ["/api/community-guides/admin"]) {
      assert.equal((await fetch(base+route)).status,401);
      assert.equal((await fetch(base+route,{headers:{"X-Test-Role":"player"}})).status,403);
    }
    assert.equal((await write(base,"/api/community-guides/admin/draft",{document:sampleDocument(),expectedDraftVersion:0},"PUT",{"X-Test-Role":"player"})).status,403);
    assert.equal((await write(base,"/api/community-guides/admin/draft",{document:sampleDocument(),expectedDraftVersion:0},"PUT",{Origin:"https://evil.example"})).status,403);
    const missingOrigin=await fetch(base+"/api/community-guides/admin/publish",{
      method:"POST",headers:{"Content-Type":"application/json","X-Test-Role":"admin"},
      body:JSON.stringify({confirm:"PUBLISH",expectedDraftVersion:0}),
    });
    assert.equal(missingOrigin.status,403);
    assert.equal((await write(base,"/api/community-guides/check",{speciesA:REX,count:2},"POST",{Origin:"https://evil.example"})).status,403);
  });
});

test("drafts are private until an explicit Steam-admin PUBLISH, with immutable history",async()=>{
  await withServer(async base=>{
    let state=await (await fetch(base+"/api/community-guides")).json();
    assert.equal(state.published,false);
    const saved=await write(base,"/api/community-guides/admin/draft",{
      document:sampleDocument(),expectedDraftVersion:0,
    });
    assert.equal(saved.status,200);
    state=await saved.json();
    assert.equal(state.draftVersion,1);
    assert.equal(state.draft.rules.length,2);
    assert.equal(state.publishedVersion,0);
    const privateSnapshot=await (await fetch(base+"/api/community-guides/admin",{
      headers:{"X-Test-Role":"admin"},
    })).json();
    assert.equal(privateSnapshot.draft.packs.length,1);
    const publicDraft=await (await fetch(base+"/api/community-guides")).json();
    assert.equal(publicDraft.published,false);
    assert.deepEqual(publicDraft.rules,[]);
    assert.equal(JSON.stringify(publicDraft).includes("Test-only"),false);

    assert.equal((await write(base,"/api/community-guides/admin/publish",{
      expectedDraftVersion:1,confirm:"WRONG",
    },"POST")).status,400);
    assert.equal((await write(base,"/api/community-guides/admin/publish",{
      expectedDraftVersion:1,confirm:"PUBLISH",
    },"POST",{"X-Test-Role":"player"})).status,403);
    const published=await write(base,"/api/community-guides/admin/publish",{
      expectedDraftVersion:1,confirm:"PUBLISH",
    },"POST");
    assert.equal(published.status,200);
    assert.equal((await published.json()).version,1);
    state=await (await fetch(base+"/api/community-guides")).json();
    assert.equal(state.published,true);
    assert.equal(state.rules.length,2);
    assert.equal(state.packs[0].maxMembers,2);

    const history=await (await fetch(base+"/api/community-guides/history")).json();
    assert.equal(history.history.length,1);
    assert.equal(history.history[0].ruleCount,2);
    assert.equal(JSON.stringify(history).includes(STEAM_ID),false);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM community_guide_history").get().c,1);
    assert.equal((await write(base,"/api/community-guides/admin/publish",{
      expectedDraftVersion:1,confirm:"PUBLISH",
    },"POST")).status,409);
  });
});

test("checker uses only published caps; mixed permission never implies a group-size allowance",async()=>{
  await withServer(async base=>{
    async function checked(input) {
      const response=await write(base,"/api/community-guides/check",input,"POST",{"X-Test-Role":"player"});
      assert.equal(response.status,200);
      return response.json();
    }
    assert.equal((await checked({speciesA:REX,count:2})).status,"within-limit");
    assert.equal((await checked({speciesA:REX,count:3})).status,"over-limit");
    assert.equal((await checked({speciesA:TRIKE,count:4})).status,"unverified");
    assert.equal((await checked({speciesA:REX,speciesB:TRIKE,count:2})).status,"prohibited");

    const updated=sampleDocument();
    updated.compatibility[0].allowed=true;
    assert.equal((await write(base,"/api/community-guides/admin/draft",{
      document:updated,expectedDraftVersion:1,
    })).status,200);
    // Published policy remains unchanged until administrator release.
    assert.equal((await checked({speciesA:REX,speciesB:TRIKE,count:2})).status,"prohibited");
    assert.equal((await write(base,"/api/community-guides/admin/publish",{
      expectedDraftVersion:2,confirm:"PUBLISH",
    },"POST")).status,200);
    const allowed=await checked({speciesA:TRIKE,speciesB:REX,count:99});
    assert.equal(allowed.status,"compatibility-only");
    assert.match(allowed.message,/size limit has not been verified/);
    const history=await (await fetch(base+"/api/community-guides/history")).json();
    assert.equal(history.history.length,2);
  });
});

test("stale editor cannot overwrite another admin's saved draft or publish it",async()=>{
  await withServer(async base=>{
    const draft=sampleDocument();
    draft.rules[0].title="A different test revision";
    const first=await write(base,"/api/community-guides/admin/draft",{
      document:draft,expectedDraftVersion:2,
    });
    assert.equal(first.status,200);
    assert.equal((await first.json()).draftVersion,3);
    const conflict=await write(base,"/api/community-guides/admin/draft",{
      document:sampleDocument(),expectedDraftVersion:2,
    });
    assert.equal(conflict.status,409);
    assert.equal((await conflict.json()).code,"EDIT_CONFLICT");
    assert.equal((await write(base,"/api/community-guides/admin/publish",{
      expectedDraftVersion:2,confirm:"PUBLISH",
    },"POST")).status,409);
    assert.equal((await write(base,"/api/community-guides/admin/publish",{
      expectedDraftVersion:3,confirm:"PUBLISH",
    },"POST")).status,200);
  });
});

test("UX02 pages and routes exist and never claim unapproved reference pack numbers are law",()=>{
  const read=p=>fs.readFileSync(path.join(root,p),"utf8");
  const app=read("server/index.js");
  const nav=read("public/partials/nav.html");
  const rules=read("public/rules.html"), packs=read("public/packs.html");
  const admin=read("public/adminrules.html");
  assert.match(app,/app\.use\("\/api\/community-guides", communityGuidesRouter\)/);
  assert.match(app,/"help", "rules", "packs"/);
  assert.match(app,/adminrules: "adminrules\.html"/);
  assert.match(nav,/href="\/rules"/);
  assert.match(nav,/href="\/packs"/);
  assert.match(nav,/href="\/adminrules"/);
  assert.match(nav,/id="admin-nav-group" hidden/);
  assert.match(rules,/id="hv-rules-search"/);
  assert.match(packs,/id="hv-pack-checker"/);
  assert.match(packs,/informational only|not official restrictions/);
  assert.match(admin,/noindex, nofollow/);
  assert.match(admin,/PUBLISH/);
  const pages=["community-rules.js","community-packs.js","admin-community-guides.js"];
  for(const page of pages){
    const client=read("public/assets/"+page);
    assert.doesNotThrow(()=>new Function(client));
    assert.match(client,/textContent/);
    assert.doesNotMatch(client,/discord\.com\/api|RCON_PASSWORD|STRIPE_SECRET/);
  }
  assert.doesNotMatch(read("server/services/communityGuides.js"),/creditWallet|CommandBridge|\.run\("DELETE FROM/);
});
