"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const express=require("express");
const workdir=fs.mkdtempSync(path.join(os.tmpdir(),"hv-group-recruitment-"));
process.env.DB_PATH=path.join(workdir,"groups.sqlite");
delete process.env.PUBLIC_SITE_URL;
const {db}=require("../server/db");
const groups=require("../server/groupsStore");
const recruit=require("../server/services/groupRecruitment");
const router=require("../server/routes/groupRecruitment");
const A="76561198000000001",B="76561198000000002",C="76561198000000003";
for(const [steam,name]of [[A,"Founder"],[B,"Applicant"],[C,"Friend"]])db.prepare(
  "INSERT INTO users(steam_id,username) VALUES (?,?)"
).run(steam,name);
const actors={owner:{steam_id:A},applicant:{steam_id:B},friend:{steam_id:C}};
let groupId=null;
test.after(()=>{db.close();fs.rmSync(workdir,{recursive:true,force:true});});
function app(){
  const a=express();a.use(express.json());
  a.use((req,_res,next)=>{req.user=actors[req.get("X-Test-Role")]||null;next();});
  a.use("/api/group-recruitment",router);return a;
}
async function withApp(job){
  const srv=app().listen(0,"127.0.0.1");
  await new Promise(done=>srv.once("listening",done));
  const base="http://127.0.0.1:"+srv.address().port;
  try{return await job(base);}
  finally{await new Promise(done=>srv.close(done));}
}
const listing=()=>({active:true,style:"nesting",focus:"herbivores",
  description:"We enjoy nesting and exploration, and are looking for more friends."});
function send(base,url,input,{role="owner",method="POST",origin=base}={}){
  return fetch(base+url,{method,headers:{
    "Content-Type":"application/json",...(origin?{Origin:origin}:{}),
    ...(role?{"X-Test-Role":role}:{}),
  },body:JSON.stringify(input)});
}
test("existing private Groups are not listed until the current owner opts into recruitment",async()=>{
  groupId=groups.createGroup(A,"Valley Wanderers").current.id;
  assert.deepEqual(recruit.browse(),[]);
  await withApp(async base=>{
    const publicList=await fetch(base+"/api/group-recruitment");
    assert.equal(publicList.status,200);
    const data=await publicList.json();
    assert.deepEqual(data.groups,[]);
    assert.equal(data.websiteGroupsOnly,true);
    assert.equal((await fetch(base+"/api/group-recruitment/me")).status,401);
    assert.equal((await send(base,"/api/group-recruitment/me",listing(),{role:null,method:"PUT"})).status,401);
    assert.equal((await send(base,"/api/group-recruitment/me",listing(),{role:"applicant",method:"PUT"})).status,403);
    assert.equal((await send(base,"/api/group-recruitment/me",listing(),{role:"owner",method:"PUT",origin:"https://evil.example"})).status,403);
  });
});
test("owner can advertise one validated listing; public view never exposes members' Steam IDs",async()=>{
  assert.throws(()=>recruit.validateListing({...listing(),description:"Contact 76561198000000001 immediately"}),{code:"INVALID_LISTING"});
  assert.throws(()=>recruit.validateListing({...listing(),description:"https://spam.example/come-join"}),{code:"INVALID_LISTING"});
  assert.throws(()=>recruit.validateListing({...listing(),style:"invalid"}),{code:"INVALID_LISTING"});
  await withApp(async base=>{
    const response=await send(base,"/api/group-recruitment/me",listing(),{method:"PUT"});
    assert.equal(response.status,200);
    const mine=await response.json();
    assert.equal(mine.group.name,"Valley Wanderers");
    assert.equal(mine.listing.active,1);
    const data=await (await fetch(base+"/api/group-recruitment")).json();
    assert.equal(data.groups.length,1);
    assert.equal(data.groups[0].groupId,groupId);
    assert.equal(data.groups[0].members,1);
    assert.equal(data.groups[0].capacity,12);
    assert.equal(data.groups[0].style,"nesting");
    assert.doesNotMatch(JSON.stringify(data),new RegExp(A+"|"+B+"|"+C+"|ownerSteamId|applicantName"));
    assert.equal((await (await fetch(base+"/api/group-recruitment?style=survival")).json()).groups.length,0);
    assert.equal((await (await fetch(base+"/api/group-recruitment?q=Wanderers")).json()).groups.length,1);
  });
});
let requestId;
test("Steam-linked nonmember can privately express interest, without joining or sending a group invite",async()=>{
  await withApp(async base=>{
    assert.equal((await send(base,"/api/group-recruitment/"+groupId+"/interest",{message:"I enjoy weekend nesting."},{role:null})).status,401);
    assert.equal((await send(base,"/api/group-recruitment/"+groupId+"/interest",{message:"I enjoy weekend nesting."},{role:"owner"})).status,409);
    const short=await send(base,"/api/group-recruitment/"+groupId+"/interest",{message:"short"},{role:"applicant"});
    assert.equal(short.status,400);
    const message={message:"I usually play small herbivores and enjoy nesting events together."};
    const applied=await send(base,"/api/group-recruitment/"+groupId+"/interest",message,{role:"applicant"});
    assert.equal(applied.status,201);
    assert.equal((await applied.json()).pending,true);
    assert.equal((await send(base,"/api/group-recruitment/"+groupId+"/interest",message,{role:"applicant"})).status,409);
    assert.equal(groups.getState(B).current,null);
    assert.equal(groups.getState(B).incoming.length,0);
    const guest=await fetch(base+"/api/group-recruitment");
    assert.doesNotMatch(await guest.text(),/usually play|Applicant|76561198000000002/);
    const owner=await (await fetch(base+"/api/group-recruitment/me",{headers:{"X-Test-Role":"owner"}})).json();
    assert.equal(owner.incoming.length,1);
    assert.equal(owner.incoming[0].applicantSteamId,B);
    requestId=owner.incoming[0].id;
    const applicant=await (await fetch(base+"/api/group-recruitment/me",{headers:{"X-Test-Role":"applicant"}})).json();
    assert.equal(applicant.sent[0].status,"pending");
    assert.equal(applicant.incoming.length,0);
    assert.equal(JSON.stringify(applicant).includes(A),false);
  });
});
test("only current group owner can mark a request reviewed, which never auto-invites",async()=>{
  await withApp(async base=>{
    const url="/api/group-recruitment/me/interest/"+requestId+"/decision";
    assert.equal((await send(base,url,{decision:"acknowledged"},{role:"applicant"})).status,403);
    const response=await send(base,url,{decision:"acknowledged"});
    assert.equal(response.status,200);
    assert.equal((await response.json()).incoming.length,0);
    assert.equal(db.prepare("SELECT status FROM hv_group_interest WHERE id=?").get(requestId).status,"acknowledged");
    assert.equal(groups.getState(B).incoming.length,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hv_group_invites WHERE invitee_steam_id=?").get(B).n,0);
    assert.equal((await send(base,url,{decision:"declined"})).status,409);
    const second=await send(base,"/api/group-recruitment/"+groupId+"/interest",{
      message:"I'm interested in joining and attending events.",
    },{role:"applicant"});
    assert.equal(second.status,201);
    const request=recruit.myInfo(actors.applicant).sent[0];
    const cancelled=await send(base,"/api/group-recruitment/me/interest/"+request.id+"/cancel",{}, {role:"applicant"});
    assert.equal(cancelled.status,200);
    assert.equal((await cancelled.json()).sent[0].status,"cancelled");
  });
});
test("closing recruitment and dissolving a group remove visibility without losing group history",async()=>{
  recruit.upsertListing(actors.owner,{...listing(),active:false});
  assert.equal(recruit.browse().length,0);
  recruit.upsertListing(actors.owner,listing());
  groups.disband(A);
  assert.equal(recruit.browse().length,0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM hv_group_recruitment WHERE group_id=?").get(groupId).n,1);
  assert.throws(()=>recruit.upsertListing(actors.owner,listing()),{code:"GROUP_OWNER_REQUIRED"});
});
test("community and recruitment pages preserve privacy and never claim in-game group integration",()=>{
  const read=f=>fs.readFileSync(path.join(__dirname,"..",f),"utf8");
  const app=read("server/index.js"),nav=read("public/partials/nav.html");
  assert.match(app,/app\.use\("\/api\/group-recruitment", groupRecruitmentRouter\)/);
  assert.match(app,/"community", "recruitment"/);
  assert.match(nav,/href="\/recruitment"/);
  assert.match(nav,/href="\/community"/);
  assert.match(read("public/community.html"),/WEBSITE-ONLY|website community features/i);
  assert.match(read("public/recruitment.html"),/doesn't send an invitation/i);
  for(const f of ["public/assets/group-recruitment.js","public/assets/community-hub.js"]){
    const c=read(f);assert.doesNotThrow(()=>new Function(c));
    assert.match(c,/textContent/);
    assert.doesNotMatch(c,/\.innerHTML\s*=/);
  }
  const service=read("server/services/groupRecruitment.js");
  assert.doesNotMatch(service,/RCON_PASSWORD|CommandBridge|creditWallet|Stripe|groupProgress\.observe/);
});
