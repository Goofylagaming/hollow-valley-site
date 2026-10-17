const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hollow-group-progress-"));
process.env.DB_PATH=path.join(dir,"group-progress.sqlite");
const {db}=require("../server/db");
const groups=require("../server/groupsStore");
const progress=require("../server/groupProgress");
const A="76561198000000101",B="76561198000000102",C="76561198000000103",D="76561198000000104";
for(const [steamId,username] of [[A,"Alpha"],[B,"Bravo"],[C,"Charlie"],[D,"Delta"]]){
 db.prepare("INSERT INTO users(steam_id,username) VALUES(?,?)").run(steamId,username);
}
const completion=(items,id)=>items.find(item=>item.id===id);
test("groups begin with real, permanent group-only achievement XP",()=>{
 const created=groups.createGroup(A,"The Pack");
 assert.equal(created.current.members.length,1);
 const state=progress.getProgress(A);
 assert.equal(state.group.name,"The Pack");
 assert.equal(state.groupXp,100);
 assert.equal(state.weeklyXp,0);
 assert.equal(completion(state.achievements,"founding-pack").completed,true);
 assert.equal(completion(state.achievements,"first-recruit").completed,false);
 assert.equal(completion(state.quests,"welcome-one").completed,false);
 assert.equal(progress.getProgress(A).groupXp,100,"GET cannot duplicate awards");
});
test("accepted invitations award exact milestones automatically once",()=>{
 groups.invite(A,B);
 assert.equal(progress.getProgress(A).groupXp,100,"pending invitations do not count");
 const invite=groups.getState(B).incoming[0];
 groups.actOnInvite(B,invite.id,"accept");
 const state=progress.getProgress(A);
 assert.equal(state.groupXp,325,"founder 100 + first recruit 150 + weekly newcomer 75");
 assert.equal(state.weeklyXp,75);
 assert.equal(completion(state.quests,"welcome-one").completed,true);
 assert.equal(completion(state.quests,"welcome-two").completed,false);
 assert.equal(completion(state.achievements,"first-recruit").completed,true);
 assert.equal(progress.getProgress(B).groupXp,325,"XP shared by current group members");
 assert.equal(progress.getProgress(A).groupXp,325,"repeated reads do not re-award");
});
test("declined invites never complete quests or gain XP",()=>{
 groups.invite(A,D);
 const inv=groups.getState(D).incoming[0];
 groups.actOnInvite(D,inv.id,"decline");
 assert.equal(progress.getProgress(A).groupXp,325);
});
test("second distinct recruit triggers both team-size and weekly quests",()=>{
 groups.invite(A,C);
 groups.actOnInvite(C,groups.getState(C).incoming[0].id,"accept");
 const state=progress.getProgress(A);
 assert.equal(state.group.activeMembers,3);
 assert.equal(state.groupXp,825,"325 + three-member badge 250 + second recruit 150 + trio quest 100");
 assert.equal(state.weeklyXp,325);
 assert.equal(completion(state.quests,"trio").completed,true);
 assert.equal(completion(state.quests,"welcome-two").completed,true);
 assert.equal(completion(state.achievements,"three-strong").completed,true);
});
test("member departure cannot revoke a completed quest or duplicate rewards",()=>{
 groups.exitGroup(C);
 const state=progress.getProgress(A);
 assert.equal(state.group.activeMembers,2);
 assert.equal(completion(state.quests,"trio").completed,true);
 assert.equal(completion(state.achievements,"three-strong").completed,true);
 assert.equal(state.groupXp,825);
 assert.equal(progress.getProgress(C).group,null);
 assert.equal(progress.getProgress(C).groupXp,0);
});
test("quest windows reset Monday midnight in Australia/Brisbane",()=>{
 const before=progress.getProgress(A);
 const startNextWeek=Date.parse(before.resetAt)+1000;
 const later=progress.getProgress(A,startNextWeek);
 assert.notEqual(progress.weekWindow(startNextWeek).period,progress.weekWindow(Date.now()).period);
 assert.equal(completion(later.quests,"welcome-one").completed,false);
 assert.equal(completion(later.quests,"welcome-two").completed,false);
 assert.equal(completion(later.quests,"trio").completed,false,"new period current size only");
 assert.equal(later.weeklyXp,0);
 assert.equal(later.groupXp,825,"earned prior-week XP persists");
 assert.equal(completion(later.achievements,"three-strong").completed,true,"permanent badges persist");
 const monday=progress.weekWindow(Date.parse("2026-10-18T13:59:59Z"));
 const next=progress.weekWindow(Date.parse("2026-10-18T14:00:00Z"));
 assert.notEqual(monday.period,next.period,"Monday 00:00 Brisbane is Sunday 14:00 UTC");
});
test("no individual wallet updates, self-reported metrics or Territory Wars code",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../server/groupProgress.js"),"utf8");
 assert.doesNotMatch(source,/UPDATE wallets|INSERT INTO wallet_transactions|creditWallet|territoryWars|\/api\/territory/i);
 assert.doesNotMatch(source,/req\.body|playerSubmitted|rewardCoin/i);
});
test("group progress endpoint requires authenticated Steam and never accepts posted progress",async()=>{
 const express=require("express");
 const router=require("../server/routes/groups");
 const app=express();
 app.use(express.json());
 app.use((req,_res,next)=>{
   if(req.headers["x-test-steam"])req.user={steam_id:req.headers["x-test-steam"]};
   next();
 });
 app.use("/api/groups",router);
 const server=await new Promise(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
 const url="http://127.0.0.1:"+server.address().port+"/api/groups/progress";
 try{
   let res=await fetch(url);
   assert.equal(res.status,401);
   res=await fetch(url,{headers:{"x-test-steam":"invalid"}});
   assert.equal(res.status,403);
   res=await fetch(url,{headers:{"x-test-steam":A}});
   assert.equal(res.status,200);
   const body=await res.json();
   assert.equal(body.group.name,"The Pack");
   assert.ok(Array.isArray(body.quests));
   res=await fetch(url,{method:"POST",headers:{"x-test-steam":A,"content-type":"application/json"},body:JSON.stringify({progress:99999})});
   assert.equal(res.status,404);
 }finally{await new Promise(resolve=>server.close(resolve));}
});