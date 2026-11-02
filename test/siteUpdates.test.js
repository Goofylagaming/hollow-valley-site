"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");

const root=path.join(__dirname,"..");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"hv-ux03-updates-"));
process.env.DB_PATH=path.join(temp,"website.sqlite");
delete process.env.PUBLIC_SITE_URL;
const {db}=require("../server/db");
const updates=require("../server/services/siteUpdates");
const route=require("../server/routes/siteUpdates");
const admin={id:1,is_admin:1,steam_id:"76561198000000001",username:"Website Staff"};
const player={id:2,is_admin:0,steam_id:"76561198000000002"};
const SHA="a".repeat(40);
const SECRET="test-only-private-site-updates-token-0123456789";
test.after(()=>{
  db.close();
  fs.rmSync(temp,{recursive:true,force:true});
});
function sample(title="Hollow Valley roadmap update") {
  return {
    category:"website",stage:"building",milestone:"HV-UX03",
    title, summary:"The Hollow Valley development milestone is drafted and waiting for its staging verification and production approval.",
    referenceUrl:"https://github.com/Goofylagaming/hollow-valley-site/pull/240",
    actorSteamId:player.steam_id, verifiedLive:true,
  };
}
function app(){
  const server=express();
  server.use(express.json());
  server.use((req,_res,next)=>{
    const role=req.get("X-Test-Role");
    req.user=role==="admin"?admin:role==="player"?player:null;
    next();
  });
  server.use("/api/site-updates",route);
  return server;
}
async function withApp(action){
  const server=app().listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  const base="http://127.0.0.1:"+server.address().port;
  try {return await action(base);}
  finally {await new Promise(resolve=>server.close(resolve));}
}
function send(base,url,payload,{method="POST",role="admin",origin=base,token=null}={}){
  return fetch(base+url,{
    method,
    headers:{"Content-Type":"application/json", ...(role?{"X-Test-Role":role}:{}),
      ...(origin?{Origin:origin}:{}), ...(token?{Authorization:"Bearer "+token}:{})},
    body:JSON.stringify(payload),
  });
}

test("public changelog starts empty and cannot expose private drafts or private Steam IDs",async()=>{
  const direct=updates.listPublic();
  assert.deepEqual(direct.updates,[]);
  assert.equal(direct.hasMore,false);
  await withApp(async base=>{
    const publicResponse=await fetch(base+"/api/site-updates");
    assert.equal(publicResponse.status,200);
    assert.match(publicResponse.headers.get("cache-control"),/no-store/);
    assert.deepEqual((await publicResponse.json()).updates,[]);
    assert.equal((await fetch(base+"/api/site-updates/admin")).status,401);
    assert.equal((await fetch(base+"/api/site-updates/admin",{headers:{"X-Test-Role":"player"}})).status,403);
  });
});

test("staff cannot manually create Live/Fix Released posts and all update fields are validated",()=>{
  assert.throws(()=>updates.validateStaffPayload({...sample(),stage:"live"}),{code:"STAGE_RESTRICTED"});
  assert.throws(()=>updates.validateStaffPayload({...sample(),stage:"fixed"}),{code:"STAGE_RESTRICTED"});
  assert.throws(()=>updates.validateStaffPayload({...sample(),title:"short"}),{code:"INVALID_UPDATE"});
  assert.throws(()=>updates.validateStaffPayload({...sample(),summary:"short"}),{code:"INVALID_UPDATE"});
  assert.throws(()=>updates.validateStaffPayload({...sample(),category:"payment"}),{code:"INVALID_UPDATE"});
  assert.throws(()=>updates.validateReference("javascript:alert(1)",true),{code:"INVALID_UPDATE"});
  assert.throws(()=>updates.validateReference("https://github.com/other/repo/pull/2",true),{code:"INVALID_UPDATE"});
  assert.throws(()=>updates.validateReference("https://evil.example/phishing",true),{code:"INVALID_UPDATE"});
  assert.equal(updates.validateReference(sample().referenceUrl,true),sample().referenceUrl);
  const model=updates.validateStaffPayload(sample());
  assert.equal("actorSteamId" in model,false);
  assert.equal("verifiedLive" in model,false);
});

test("guests and non-admins cannot create drafts or spoof another actor; same-origin JSON required",async()=>{
  await withApp(async base=>{
    assert.equal((await send(base,"/api/site-updates/admin",sample(),{role:null})).status,401);
    assert.equal((await send(base,"/api/site-updates/admin",sample(),{role:"player"})).status,403);
    assert.equal((await send(base,"/api/site-updates/admin",sample(),{origin:"https://attacker.example"})).status,403);
    assert.equal((await send(base,"/api/site-updates/admin",sample(),{origin:null})).status,403);
    const badType=await fetch(base+"/api/site-updates/admin",{
      method:"POST",headers:{"X-Test-Role":"admin",Origin:base,"Content-Type":"text/plain"},
      body:JSON.stringify(sample()),
    });
    assert.equal(badType.status,415);
    const manual=await send(base,"/api/site-updates/admin",{...sample(),stage:"live"});
    assert.equal(manual.status,400);
    assert.equal((await manual.json()).code,"STAGE_RESTRICTED");
  });
});

let draftId=null;
test("admin drafting and publishing is explicit; public sees no unpublished data",async()=>{
  await withApp(async base=>{
    const created=await send(base,"/api/site-updates/admin",sample());
    assert.equal(created.status,201);
    const body=await created.json();
    draftId=body.update.id;
    assert.equal(body.update.createdBySteamId,admin.steam_id);
    assert.equal(body.update.source,"staff");
    assert.equal(body.update.publishedAt,null);
    const publicBody=await (await fetch(base+"/api/site-updates")).json();
    assert.equal(publicBody.updates.length,0);
    const adminResponse=await fetch(base+"/api/site-updates/admin",{headers:{"X-Test-Role":"admin"}});
    assert.match(adminResponse.headers.get("cache-control"),/private/);
    assert.equal((await adminResponse.json()).updates[0].title,sample().title);
    const audit=await (await fetch(base+"/api/site-updates/admin/"+draftId+"/history",{
      headers:{"X-Test-Role":"admin"},
    })).json();
    assert.equal(audit.events[0].eventType,"draft_created");
    const unauthorized=await fetch(base+"/api/site-updates/admin/"+draftId+"/history",{
      headers:{"X-Test-Role":"player"},
    });
    assert.equal(unauthorized.status,403);
  });
});

test("draft revision conflict and immutable publication history are preserved",async()=>{
  await withApp(async base=>{
    const change={...sample("Hollow Valley UI layout improvements"),stage:"testing"};
    const updated=await send(base,"/api/site-updates/admin/"+draftId,{
      update:change,expectedRevision:1,
    },{method:"PUT"});
    assert.equal(updated.status,200);
    assert.equal((await updated.json()).update.revision,2);
    const conflict=await send(base,"/api/site-updates/admin/"+draftId,{
      update:sample(),expectedRevision:1,
    },{method:"PUT"});
    assert.equal(conflict.status,409);
    const noConfirm=await send(base,"/api/site-updates/admin/"+draftId+"/publish",{
      confirm:"YES",expectedRevision:2,
    });
    assert.equal(noConfirm.status,400);
    const stale=await send(base,"/api/site-updates/admin/"+draftId+"/publish",{
      confirm:"PUBLISH",expectedRevision:1,
    });
    assert.equal(stale.status,409);
    const published=await send(base,"/api/site-updates/admin/"+draftId+"/publish",{
      confirm:"PUBLISH",expectedRevision:2,
    });
    assert.equal(published.status,200);
    const released=(await published.json()).update;
    assert.equal(released.stage,"testing");
    assert.equal(released.verifiedLive,false);
    assert.equal("publishedBySteamId" in released,false);
    assert.equal("createdBySteamId" in released,false);
    const publicBody=await (await fetch(base+"/api/site-updates")).json();
    assert.equal(publicBody.updates.length,1);
    assert.equal(publicBody.updates[0].title,change.title);
    assert.equal(JSON.stringify(publicBody).includes(admin.steam_id),false);
    assert.equal(JSON.stringify(publicBody).includes(player.steam_id),false);
    assert.equal((await send(base,"/api/site-updates/admin/"+draftId+"/publish",{
      confirm:"PUBLISH",expectedRevision:2,
    })).status,409);
    assert.equal((await send(base,"/api/site-updates/admin/"+draftId,{
      update:sample(),expectedRevision:2,
    },{method:"PUT"})).status,409);
    const audit=await (await fetch(base+"/api/site-updates/admin/"+draftId+"/history",{
      headers:{"X-Test-Role":"admin"},
    })).json();
    assert.deepEqual(audit.events.map(x=>x.eventType),["draft_created","draft_updated","staff_published"]);
  });
});

test("public filters and pagination include only published records, with explicit stages",async()=>{
  await withApp(async base=>{
    const first=await send(base,"/api/site-updates/admin",{
      ...sample("Community calendar release pending"),stage:"ready",category:"community",
    });
    const id=(await first.json()).update.id;
    const posted=await send(base,"/api/site-updates/admin/"+id+"/publish",{
      confirm:"PUBLISH",expectedRevision:1,
    });
    assert.equal(posted.status,200);
    const pending=await send(base,"/api/site-updates/admin",sample("Another private website draft"));
    assert.equal(pending.status,201);
    const publicAll=(await (await fetch(base+"/api/site-updates?limit=1")).json());
    assert.equal(publicAll.updates.length,1);
    assert.equal(publicAll.hasMore,true);
    const second=(await (await fetch(base+"/api/site-updates?limit=1&page=1")).json());
    assert.equal(second.updates.length,1);
    assert.equal(second.hasMore,false);
    const community=(await (await fetch(base+"/api/site-updates?category=community&stage=ready")).json());
    assert.equal(community.updates.length,1);
    assert.equal(community.updates[0].title,"Community calendar release pending");
    assert.equal(community.updates[0].verifiedLive,false);
    const q=(await (await fetch(base+"/api/site-updates?q=layout")).json());
    assert.equal(q.updates.length,1);
    const hidden=(await (await fetch(base+"/api/site-updates?q=Another%20private")).json());
    assert.equal(hidden.updates.length,0);
  });
});

test("verified-release endpoint is disabled and requires a separate strong bearer secret",async()=>{
  await withApp(async base=>{
    assert.equal((await send(base,"/api/site-updates/release",{sha:SHA},{role:null})).status,503);
    const oldFlag=process.env.SITE_UPDATES_AUTO_RELEASE_ENABLED;
    const oldToken=process.env.HV_SITE_UPDATES_TOKEN;
    process.env.SITE_UPDATES_AUTO_RELEASE_ENABLED="true";
    process.env.HV_SITE_UPDATES_TOKEN=SECRET;
    try {
      assert.equal((await send(base,"/api/site-updates/release",{sha:SHA},{role:null})).status,401);
      assert.equal((await send(base,"/api/site-updates/release",{sha:SHA},{role:null,token:"wrong-token"})).status,401);
    } finally {
      if(oldFlag===undefined)delete process.env.SITE_UPDATES_AUTO_RELEASE_ENABLED;
      else process.env.SITE_UPDATES_AUTO_RELEASE_ENABLED=oldFlag;
      if(oldToken===undefined)delete process.env.HV_SITE_UPDATES_TOKEN;
      else process.env.HV_SITE_UPDATES_TOKEN=oldToken;
    }
  });
});

test("one confirmed running production SHA creates exactly one live entry and audit event",async()=>{
  const previous=Object.fromEntries(["NODE_ENV","SITE_UPDATES_AUTO_RELEASE_ENABLED",
    "HV_SITE_UPDATES_TOKEN","RENDER_GIT_COMMIT"].map(k=>[k,process.env[k]]));
  Object.assign(process.env,{
    NODE_ENV:"production",SITE_UPDATES_AUTO_RELEASE_ENABLED:"true",
    HV_SITE_UPDATES_TOKEN:SECRET,RENDER_GIT_COMMIT:SHA,
  });
  try {
    await withApp(async base=>{
      const mismatch=await send(base,"/api/site-updates/release",{sha:"b".repeat(40)},{role:null,token:SECRET});
      assert.equal(mismatch.status,400);
      assert.equal((await mismatch.json()).code,"REVISION_MISMATCH");
      const before=updates.listPublic({stage:"live"});
      assert.equal(before.updates.length,0);
      const created=await send(base,"/api/site-updates/release",{sha:SHA},{role:null,token:SECRET});
      assert.equal(created.status,202);
      const release=(await created.json()).update;
      assert.equal(release.verifiedLive,true);
      assert.equal(release.releaseSha,SHA);
      assert.equal(release.source,"verified-release");
      assert.equal(release.stage,"live");
      assert.match(release.referenceUrl,/\/commit\/[a-f0-9]{40}$/);
      const again=await send(base,"/api/site-updates/release",{sha:SHA},{role:null,token:SECRET});
      assert.equal(again.status,202);
      assert.equal((await again.json()).update.id,release.id);
      const history=updates.auditHistory(release.id);
      assert.deepEqual(history.map(x=>x.eventType),["verified_release"]);
      const list=updates.listPublic({stage:"live"});
      assert.equal(list.updates.length,1);
      assert.equal(JSON.stringify(list).includes(SECRET),false);
      const fake=await send(base,"/api/site-updates/admin",{...sample(),stage:"live"});
      assert.equal(fake.status,400);
    });
  }finally{
    for(const [key,value] of Object.entries(previous)){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});

test("the GitHub release publisher skips unconfigured channels and checks trusted deployment receipt",async()=>{
  const publish=require("../scripts/publish-hv-site-update.cjs").publishVerifiedSiteRelease;
  assert.equal((await publish({token:""})).skipped,true);
  await assert.rejects(publish({
    token:SECRET,repository:"not-owned/repo",sha:SHA,
  }),/Unexpected release repository/);
  let calls=0;
  const output=await publish({
    token:SECRET,repository:"Goofylagaming/hollow-valley-site",sha:SHA,
    fetchImpl:async (url,options)=>{
      calls++;
      assert.equal(url.toString(),"https://hollow-valley-site.onrender.com/api/site-updates/release");
      assert.equal(options.method,"POST");
      assert.equal(options.headers.Authorization,"Bearer "+SECRET);
      assert.deepEqual(JSON.parse(options.body),{sha:SHA});
      return Response.json({update:{id:"deploy-"+SHA,verifiedLive:true,releaseSha:SHA}},{status:202});
    },
  });
  assert.equal(calls,1);
  assert.equal(output.published,true);
});

test("public and admin pages, homepage preview and workflows are properly wired and parse",()=>{
  const read=file=>fs.readFileSync(path.join(root,file),"utf8");
  const app=read("server/index.js");
  const nav=read("public/partials/nav.html");
  const home=read("public/index.html");
  const publicPage=read("public/updates.html");
  const adminPage=read("public/adminupdates.html");
  const css=read("public/assets/site-updates.css");
  const workflow=read(".github/workflows/hv-verified-site-updates.yml");
  assert.match(app,/app\.use\("\/api\/site-updates", siteUpdatesRouter\)/);
  assert.match(app,/"packs", "updates"/);
  assert.match(app,/adminupdates: "adminupdates\.html"/);
  assert.match(nav,/href="\/updates"/);
  assert.match(nav,/href="\/adminupdates"/);
  assert.match(nav,/id="admin-nav-group" hidden/);
  assert.match(home,/id="home-updates-list"/);
  assert.match(home,/\/assets\/home-updates\.js\?v=1/);
  assert.match(publicPage,/id="hv-updates-list"/);
  assert.match(publicPage,/Ready to Deploy/);
  assert.match(adminPage,/noindex, nofollow/);
  assert.match(adminPage,/PUBLISH/);
  assert.match(css,/@media\(max-width:620px\)/);
  for(const name of ["site-updates.js","home-updates.js","admin-site-updates.js"]){
    const js=read("public/assets/"+name);
    assert.doesNotThrow(()=>new Function(js));
    assert.match(js,/textContent/);
    assert.doesNotMatch(js,/\.innerHTML\s*=/);
  }
  assert.match(workflow,/scripts\/verify-readiness\.cjs/);
  assert.match(workflow,/HV_SITE_UPDATES_TOKEN/);
  assert.match(workflow,/hollow-valley-automation\.onrender\.com/);
  assert.doesNotMatch(workflow,/DISCORD_BOT_TOKEN|discord\.com\/api/);
  assert.match(read(".env.example"),/SITE_UPDATES_AUTO_RELEASE_ENABLED=false/);
});
