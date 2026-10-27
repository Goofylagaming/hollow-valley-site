"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const express=require("express");
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"hv-ux06-activity-"));
process.env.DB_PATH=path.join(dir,"activity.sqlite");
delete process.env.PUBLIC_SITE_URL;
const {db}=require("../server/db");
const groups=require("../server/groupsStore");
const status=require("../server/services/serverStatus");
const automation=require("../server/services/automationWebsiteClient");
const activity=require("../server/services/communityActivity");
const router=require("../server/routes/communityActivity");
const A="76561198000000001",B="76561198000000002";
db.prepare("INSERT INTO users(steam_id,username,is_admin) VALUES (?,'Staff',1)").run(A);
db.prepare("INSERT INTO users(steam_id,username,is_admin) VALUES (?,'Player',0)").run(B);
const staff={steam_id:A,is_admin:1},player={steam_id:B,is_admin:0};
test.after(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true});});
function app(){
  const server=express();server.use(express.json());
  server.use((req,_res,next)=>{
    const role=req.get("X-Test-Role");
    req.user=role==="staff"?staff:role==="player"?player:null;next();
  });
  server.use("/api/community-activity",router);return server;
}
async function withServer(work){
  const server=app().listen(0,"127.0.0.1");
  await new Promise(r=>server.once("listening",r));
  const base="http://127.0.0.1:"+server.address().port;
  try{return await work(base);}
  finally{await new Promise(r=>server.close(r));}
}
function post(base,url,body,{role="staff",origin=base}={}){
  return fetch(base+url,{method:"POST",headers:{"Content-Type":"application/json",
    ...(role?{"X-Test-Role":role}:{}),...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
}
function resultPayload(){
  return {
    eventKey:"fightnight_20261027",title:"Valley Fight Night Finals",
    eventAt:new Date(Date.now()-3600000).toISOString(),
    summary:"Hollow Valley staff reviewed the community event and are publishing a manual summary of the match results.",
    winners:["Survivor One","Survivor Two"],confirm:"PUBLISH",
  };
}

test("stale server status cannot be called offline based on an old snapshot",()=>{
  const old=status.getDisplayState;
  try{
    status.getDisplayState=()=>({
      configured:true,online:true,stale:false,lastChecked:new Date(Date.now()-900000).toISOString(),
      playerCount:99,maxPlayers:100,players:[{steamId:A}],characters:[{coords:[1,2]}],
    });
    const state=activity.verifiedServer();
    assert.equal(state.state,"delayed");
    assert.equal(state.playersOnline,null);
    assert.doesNotMatch(JSON.stringify(state),/7656119|coords|characters/);
    status.getDisplayState=()=>({
      configured:true,online:false,stale:false,lastChecked:new Date().toISOString(),playerCount:0,maxPlayers:100,
    });
    assert.equal(activity.verifiedServer().state,"offline");
    status.getDisplayState=()=>({
      configured:false,stale:true,lastChecked:null,players:[{steamId:A}],
    });
    assert.equal(activity.verifiedServer().state,"unconfigured");
  }finally{status.getDisplayState=old;}
});

test("analytics with no verified samples never invents activity; present samples are sanitized",()=>{
  const noData=activity.sanitizeActivity({
    trackingEnabled:true,sampleCount:0,uniquePlayers:999,
    topPlayers:[{steamId:A,name:"private"}],
  });
  assert.equal(noData.available,false);
  assert.equal(noData.uniquePlayers,null);
  const now=Date.now();
  const good=activity.sanitizeActivity({
    trackingEnabled:true,sampleCount:4,uniquePlayers:3,sessions:5,
    averageOnline:2.5,peakConcurrent:4,lastVerifiedAt:new Date(now-1000).toISOString(),
    topPlayers:[{steamId:A,name:"Secret",coords:{x:1,y:2}}],
    topSpecies:[{species:"Tyrannosaurus",samplePlayerCount:6,steamId:A}],
    activityTrend:[{startedAt:new Date(now-1000).toISOString(),averagePlayers:2,peakPlayers:4,
      samples:4,playerNames:["Secret"]}],
  },now);
  assert.equal(good.available,true);
  assert.equal(good.stale,false);
  assert.equal(good.topSpecies[0].species,"Tyrannosaurus");
  assert.equal(good.activityTrend.length,1);
  assert.doesNotMatch(JSON.stringify(good),/Secret|steamId|coords|playerNames/);
  const delayed=activity.sanitizeActivity({
    trackingEnabled:true,sampleCount:2,
    lastVerifiedAt:new Date(now-86400000).toISOString(),
  },now);
  assert.equal(delayed.stale,true);
});

test("event feed is freshness-checked and strips Discord IDs, RSVP identities and unsafe links",()=>{
  const now=Date.now();
  const e={
    configured:true,stale:false,syncedAt:new Date(now).toISOString(),
    events:[
      {id:"111111111111111111",title:"Valley Migration",startTime:new Date(now+3600000).toISOString(),
        location:"Gateway",attendees:[{steamId:A}],privateNotes:"Moderator test",
        url:"https://discord.com/events/123456789012345678/111111111111111111"},
      {title:"Old event",startTime:new Date(now-3600000).toISOString()},
      {title:"Unsafe link",startTime:new Date(now+7200000).toISOString(),url:"https://evil.example/link"},
    ],
  };
  const result=activity.sanitizeEvents(e,now);
  assert.equal(result.available,true);
  assert.equal(result.upcoming.length,2);
  assert.equal(result.upcoming[0].title,"Valley Migration");
  assert.equal(result.upcoming[1].url,null);
  assert.doesNotMatch(JSON.stringify(result),/attendees|steamId|Moderator|privateNotes|111111111111111111","title/);
  const stale=activity.sanitizeEvents({...e,stale:true},now);
  assert.equal(stale.available,false);
  assert.deepEqual(stale.upcoming,[]);
});

test("public read-only API hides raw presence and reports independently unavailable integrations",async()=>{
  const oldStatus=status.getDisplayState,oldActivity=automation.getMapActivity;
  const oldEvents=automation.getDiscordScheduledEvents;
  try{
    status.getDisplayState=()=>({configured:true,stale:false,online:true,playerCount:3,
      maxPlayers:100,lastChecked:new Date().toISOString(),players:[{steamId:A}]});
    automation.getMapActivity=async()=>({
      trackingEnabled:true,sampleCount:1,uniquePlayers:2,averageOnline:1,peakConcurrent:3,sessions:4,
      lastVerifiedAt:new Date().toISOString(),topPlayers:[{steamId:A,name:"TOP_SECRET"}],
      topSpecies:[{species:"Triceratops",samplePlayerCount:2}],
    });
    automation.getDiscordScheduledEvents=async()=>{throw new Error("Discord unavailable");};
    await withServer(async base=>{
      const reply=await fetch(base+"/api/community-activity");
      assert.equal(reply.status,200);
      assert.match(reply.headers.get("cache-control"),/no-store/);
      const data=await reply.json();
      assert.equal(data.server.state,"online");
      assert.equal(data.server.playersOnline,3);
      assert.equal(data.activity.available,true);
      assert.equal(data.events.available,false);
      assert.equal(data.inGamePartyVerificationAvailable,false);
      assert.doesNotMatch(JSON.stringify(data),/TOP_SECRET|steamId|coords|password/);
      const detail=await fetch(base+"/api/community-activity/pack-context");
      assert.equal(detail.status,401);
    });
  }finally{
    status.getDisplayState=oldStatus;
    automation.getMapActivity=oldActivity;automation.getDiscordScheduledEvents=oldEvents;
  }
});

test("personal pack context reports website membership and only the player's own dinosaur, never compliance",()=>{
  groups.createGroup(A,"Forest Wanderers");
  const previous=status.getState;
  try{
    status.getState=()=>({
      configured:true,stale:false,online:true,lastChecked:new Date().toISOString(),
      characters:[
        {steamId:A,species:"BP_Tyrannosaurus_C",coords:{x:111,y:222}},
        {steamId:B,species:"Deinosuchus",coords:{x:333,y:444},playerName:"private"},
      ],
    });
    const data=activity.packContext(staff);
    assert.equal(data.websiteGroup.name,"Forest Wanderers");
    assert.equal(data.websiteGroup.members,1);
    assert.equal(data.myLiveSpecies,"BP_Tyrannosaurus_C");
    assert.equal(data.verification,"unavailable");
    assert.equal(data.publishedSingleSpeciesLimit,null);
    assert.doesNotMatch(JSON.stringify(data),/333|444|Deinosuchus|steamId|coords|playerName/);
    assert.throws(()=>activity.packContext({steam_id:"not-steam"}),{code:"STEAM_REQUIRED"});
  }finally{status.getState=previous;}
});

test("manual event results validate date, winner names and explicit staff publication",async()=>{
  assert.throws(()=>activity.validateEventResult({...resultPayload(),eventAt:"2099-01-01T00:00:00Z"}),{code:"INVALID_EVENT_RESULT"});
  assert.throws(()=>activity.validateEventResult({...resultPayload(),summary:"short"}),{code:"INVALID_EVENT_RESULT"});
  assert.throws(()=>activity.validateEventResult({...resultPayload(),winners:[A]}),{code:"INVALID_EVENT_RESULT"});
  await withServer(async base=>{
    assert.equal((await post(base,"/api/community-activity/admin/event-results",resultPayload(),{role:"player"})).status,403);
    assert.equal((await post(base,"/api/community-activity/admin/event-results",resultPayload(),{role:null})).status,401);
    assert.equal((await post(base,"/api/community-activity/admin/event-results",resultPayload(),{origin:"https://evil.example"})).status,403);
    assert.equal((await post(base,"/api/community-activity/admin/event-results",{...resultPayload(),confirm:"YES"})).status,400);
    const created=await post(base,"/api/community-activity/admin/event-results",resultPayload());
    assert.equal(created.status,201);
    const value=(await created.json()).result;
    assert.equal(value.source,"staff-published");
    assert.equal(value.automaticallyVerified,false);
    assert.equal(value.automaticPayout,false);
    assert.equal((await post(base,"/api/community-activity/admin/event-results",resultPayload())).status,409);
    const publicData=await (await fetch(base+"/api/community-activity/event-results")).json();
    assert.equal(publicData.results.length,1);
    assert.equal(publicData.results[0].winners.length,2);
    assert.doesNotMatch(JSON.stringify(publicData),new RegExp(A+"|steam_id|publishedBySteamId|payment|payout:true"));
    assert.equal(db.prepare("SELECT published_by_steam_id FROM hv_event_results_public").get().published_by_steam_id,A);
  });
});

test("UX06 UI and routes preserve the existing game/wallet safety boundary",()=>{
  const read=f=>fs.readFileSync(path.join(__dirname,"..",f),"utf8");
  const index=read("server/index.js");
  const nav=read("public/partials/nav.html");
  assert.match(index,/app\.use\("\/api\/community-activity", communityActivityRouter\)/);
  assert.match(index,/"activity"/);
  assert.match(index,/adminactivity: "adminactivity\.html"/);
  assert.match(nav,/href="\/activity"/);
  assert.match(nav,/href="\/adminactivity"/);
  assert.match(read("public/activity.html"),/in-game Evrima parties are separate/);
  assert.match(read("public/adminactivity.html"),/noindex, nofollow/);
  for(const f of ["public/assets/community-activity.js","public/assets/admin-community-activity.js"]){
    const source=read(f);assert.doesNotThrow(()=>new Function(source));
    assert.match(source,/textContent/);
    assert.doesNotMatch(source,/\.innerHTML\s*=/);
  }
  const service=read("server/services/communityActivity.js");
  assert.doesNotMatch(service,/RCON_PASSWORD|CommandBridge|creditWallet|stripe|wallet_transactions/);
  assert.match(service,/inGamePartyVerificationAvailable:false/);
});
