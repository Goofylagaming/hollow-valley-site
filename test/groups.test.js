const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const temp=fs.mkdtempSync(path.join(os.tmpdir(),"hv-groups-test-"));
process.env.DB_PATH=path.join(temp,"groups-test.sqlite");
const {db}=require("../server/db");
const groups=require("../server/groupsStore");
const A="76561198000000001",B="76561198000000002",C="76561198000000003",D="76561198000000004";
for(const [id,name] of [[A,"Alpha"],[B,"Bravo"],[C,"Charlie"],[D,"Delta"]])db.prepare("INSERT INTO users(steam_id,username) VALUES(?,?)").run(id,name);
function expectFail(fn,status){assert.throws(fn,e=>{assert.equal(e.status,status);return true;});}
test("Steam-linked creator can create a persistent website group",()=>{
 const g=groups.createGroup(A," Valley Wanderers ").current;
 assert.equal(g.name,"Valley Wanderers");assert.equal(g.role,"owner");
 assert.equal(g.members.length,1);assert.equal(g.members[0].username,"Alpha");
 assert.equal(groups.getState(A).current.name,g.name);
 expectFail(()=>groups.createGroup(A,"Another Group"),409);
 expectFail(()=>groups.createGroup(D,"valley wanderers"),409);
 expectFail(()=>groups.createGroup(D,"a"),400);
 expectFail(()=>groups.createGroup("bad","Valid Group"),400);
});
test("only owner invites; recipient must exist and accepts their own invite",()=>{
 expectFail(()=>groups.invite(B,A),403);
 expectFail(()=>groups.invite(A,"76561198000000999"),404);
 groups.invite(A,B);
 const incoming=groups.getState(B).incoming;
 assert.equal(incoming.length,1);assert.equal(incoming[0].groupName,"Valley Wanderers");
 expectFail(()=>groups.actOnInvite(C,incoming[0].id,"accept"),404);
 expectFail(()=>groups.invite(A,B),409);
 const b=groups.actOnInvite(B,incoming[0].id,"accept");
 assert.equal(b.current.members.length,2);assert.equal(b.current.role,"member");
 assert.equal(groups.getState(A).current.members.length,2);
 expectFail(()=>groups.createGroup(B,"Other"),409);
 expectFail(()=>groups.invite(B,C),403);
});
test('Headquarters descriptions enforce owner authority, stale revisions and atomic edit history',()=>{
 const headquarters=require('../server/services/groupHeadquarters').createGroupHeadquarters(db,groups);
 assert.equal(headquarters.get(A).revision,0);
 expectFail(()=>headquarters.get(C),404);
 expectFail(()=>headquarters.update(B,{description:'Unauthorized',expectedRevision:0}),403);
 expectFail(()=>headquarters.update(A,{description:'Bad emblem',emblem:'arbitrary-url',expectedRevision:0}),400);
 const saved=headquarters.update(A,{description:' Valley explorers ',emblem:'mountain',expectedRevision:0});
 assert.equal(saved.description,'Valley explorers');assert.equal(saved.revision,1);
 assert.equal(saved.emblem,'mountain');assert.equal(saved.edits[0].emblem,'mountain');
 assert.equal(headquarters.get(B).canEdit,false);assert.equal(headquarters.get(B).edits.length,1);
 expectFail(()=>headquarters.update(A,{description:'Stale',expectedRevision:0}),409);
 db.exec("CREATE TRIGGER fail_group_profile_edit BEFORE INSERT ON hv_group_profile_edits BEGIN SELECT RAISE(ABORT,'fixture audit failure'); END");
 assert.throws(()=>headquarters.update(A,{description:'Rollback',expectedRevision:1}));
 db.exec('DROP TRIGGER fail_group_profile_edit');
 assert.equal(headquarters.get(A).description,'Valley explorers');assert.equal(headquarters.get(A).revision,1);
});

test('Headquarters rank assignments enforce owner authority and revisions',()=>{
 const hq=require('../server/services/groupHeadquarters').createGroupHeadquarters(db,groups);
 expectFail(()=>hq.setRank(B,{memberSteamId:B,rank:'officer',expectedRevision:0}),403);
 expectFail(()=>hq.setRank(A,{memberSteamId:C,rank:'officer',expectedRevision:0}),404);
 expectFail(()=>hq.setRank(A,{memberSteamId:A,rank:'member',expectedRevision:0}),409);
 const result=hq.setRank(A,{memberSteamId:B,rank:'officer',expectedRevision:0});
 assert.equal(result.members.find(m=>m.steamId===B).rank,'officer');
 expectFail(()=>hq.setRank(A,{memberSteamId:B,rank:'veteran',expectedRevision:0}),409);
 expectFail(()=>groups.invite(B,C),403);
});

test("invites can be declined or cancelled with proper ownership checks",()=>{
 groups.invite(A,C);let inv=groups.getState(C).incoming[0];
 groups.actOnInvite(C,inv.id,"decline");
 assert.equal(groups.getState(C).incoming.length,0);
 groups.invite(A,C);inv=groups.getState(C).incoming[0];
 expectFail(()=>groups.cancelInvite(B,inv.id),403);
 groups.cancelInvite(A,inv.id);
 assert.equal(groups.getState(C).incoming.length,0);
});
test("owner removal writes previous group history and allows re-inviting",()=>{
 groups.exitGroup(A,B);
 assert.equal(groups.getState(B).current,null);
 const h=groups.getState(B).previous;
 assert.equal(h[0].groupName,"Valley Wanderers");
 assert.equal(h[0].outcome,"removed");
 assert.ok(h[0].members.includes("Alpha"));
 groups.invite(A,B);
 groups.actOnInvite(B,groups.getState(B).incoming[0].id,"accept");
 assert.equal(groups.getState(B).current.role,"member");
 const hq=require('../server/services/groupHeadquarters').createGroupHeadquarters(db,groups);
 assert.equal(hq.get(B).members.find(m=>m.steamId===B).rank,'member');
});
test("leader leaving automatically transfers ownership; no unwanted disband",()=>{
 expectFail(()=>groups.exitGroup(B,A),403);
 groups.exitGroup(A);
 assert.equal(groups.getState(A).current,null);
 const g=groups.getState(B).current;
 assert.equal(g.ownerSteamId,B);
 assert.equal(g.role,"owner");
 assert.equal(g.members.length,1);
 assert.equal(groups.getState(A).previous[0].outcome,"left");
});
test("new owner can disband group and record every member's outcome",()=>{
 groups.invite(B,C);
 groups.actOnInvite(C,groups.getState(C).incoming[0].id,"accept");
 expectFail(()=>groups.disband(C),403);
 const result=groups.disband(B);
 assert.equal(result.current,null);
 assert.equal(groups.getState(C).current,null);
 assert.equal(groups.getState(C).previous[0].outcome,"disbanded");
 assert.equal(groups.getState(B).previous[0].outcome,"disbanded");
 const replacement=groups.createGroup(A,"Valley Wanderers");
 assert.equal(replacement.current.members.length,1);
});
test("pending invites expire on group closure; sole owner departure closes group",()=>{
 groups.invite(A,D);
 groups.exitGroup(A);
 assert.equal(groups.getState(D).incoming.length,0);
 assert.equal(groups.getState(A).current,null);
 const again=groups.createGroup(D,"Next Pack");
 assert.equal(again.current.name,"Next Pack");
});
test("groups routes require sessions and Steam identities",async()=>{
 const express=require("express");
 const router=require("../server/routes/groups");
 const app=express();app.use(express.json());
 app.use((req,_res,next)=>{
   const steam=req.headers["x-test-steam"];
   if(steam)req.user={steam_id:steam};
   next();
 });app.use("/api/groups",router);
 const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
 const base="http://127.0.0.1:"+server.address().port;
 try{
   let res=await fetch(base+"/api/groups");assert.equal(res.status,401);
   res=await fetch(base+"/api/groups",{headers:{"x-test-steam":"bad"}});assert.equal(res.status,403);
   res=await fetch(base+"/api/groups",{headers:{"x-test-steam":A}});
   assert.equal(res.status,200);assert.equal((await res.json()).current,null);
   res=await fetch(base+"/api/groups",{method:"POST",headers:{"content-type":"application/json","x-test-steam":B},body:JSON.stringify({name:"New Group"})});
   assert.equal(res.status,200);
   assert.equal((await res.json()).current.name,"New Group");
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('Headquarters HTTP binds actors and follows membership succession',async()=>{
 const keys=['GROUP_HQ_ENABLED','GROUP_HQ_READ_ONLY','SKIN_STUDIO_READ_ONLY','RENDER_SERVICE_ID','RENDER_EXTERNAL_URL','PUBLIC_SITE_URL','STEAM_REALM','STEAM_RETURN_URL'];
 const saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));for(const key of keys)delete process.env[key];
 const express=require('express'),app=express();app.use(express.json());
 app.use((req,_res,next)=>{if(req.get('x-user'))req.user={steam_id:req.get('x-user')};next();});app.use('/hq',require('../server/routes/groupHeadquarters'));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});const base='http://127.0.0.1:'+server.address().port;
 const read=user=>fetch(base+'/hq',{headers:{'x-user':user||''}});
 const write=(user,body,origin=base)=>fetch(base+'/hq',{method:'POST',headers:{'x-user':user,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await read(B)).status,503);process.env.GROUP_HQ_ENABLED='1';
  assert.equal((await read()).status,401);assert.equal((await read('bad')).status,403);assert.equal((await read(A)).status,404);
  groups.invite(B,C);groups.actOnInvite(C,groups.getState(C).incoming[0].id,'accept');
  const response=await read(C);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal((await response.json()).canEdit,false);
  assert.equal((await write(C,{description:'Forbidden',expectedRevision:0,steamId:B})).status,403);
  assert.equal((await write(B,{description:'Wrong origin',expectedRevision:0},'https://other.invalid')).status,403);
  assert.equal((await write(B,{description:'Our Headquarters',expectedRevision:0,steamId:D})).status,200);
  process.env.GROUP_HQ_READ_ONLY='1';assert.equal((await write(B,{description:'Blocked',expectedRevision:1})).status,403);delete process.env.GROUP_HQ_READ_ONLY;
  assert.equal((await write(B,{description:'Stale',expectedRevision:0})).status,409);
  groups.exitGroup(B);assert.equal((await read(B)).status,404);
  assert.equal((await write(C,{description:'New owner',expectedRevision:1})).status,200);
  assert.equal((await (await read(D)).json()).description,'');const profile=await (await read(C)).json();assert.equal(profile.revision,2);assert.equal(profile.edits.length,2);
  groups.disband(C);assert.equal((await read(C)).status,404);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM hv_group_profile_edits WHERE group_id=?').get(profile.groupId).n,2);
 }finally{await new Promise(resolve=>server.close(resolve));for(const[key,value]of Object.entries(saved))if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

test("no Territory Wars dependency exists in website Groups",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../server/groupsStore.js"),"utf8");
 const routes=fs.readFileSync(path.join(__dirname,"../server/routes/groups.js"),"utf8");
 const page=fs.readFileSync(path.join(__dirname,"../public/groups.html"),"utf8");
 assert.doesNotMatch(source+routes,/api\/territory-wars|\/routes\/territoryWars|\/territory-wars\//);
 assert.doesNotMatch(page,/href=["']\/groups\/territory-wars/);
});
test("live Groups page searches verified website players, not test-site users",()=>{
 const html=fs.readFileSync(path.join(__dirname,"../public/groups.html"),"utf8");
 const js=fs.readFileSync(path.join(__dirname,"../public/assets/groups.js"),"utf8");
 assert.match(html,/Find a player already registered on Hollow Valley/);
 assert.match(html,/accounts from the live hollowvalleyisle\.com website/);
 assert.doesNotMatch(html,/signed into this test website/i);
 assert.match(html,/id="groups-player-search-results"/);
 assert.match(js,/api\/friends\/search\?q=/);
 assert.match(js,/data-action="invite-found"/);
 assert.match(js,/action\("\/invites",\{steamId:target\.dataset\.steam\}\)/);
});
