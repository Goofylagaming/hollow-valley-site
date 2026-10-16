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
   assert.equal(res.status,201===res.status?201:200);
   assert.equal((await res.json()).current.name,"New Group");
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test("no Territory Wars dependency exists in website Groups",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../server/groupsStore.js"),"utf8");
 const routes=fs.readFileSync(path.join(__dirname,"../server/routes/groups.js"),"utf8");
 const page=fs.readFileSync(path.join(__dirname,"../public/groups.html"),"utf8");
 assert.doesNotMatch(source+routes,/api\/territory-wars|\/routes\/territoryWars|\/territory-wars\//);
 assert.doesNotMatch(page,/href=["']\/groups\/territory-wars/);
});