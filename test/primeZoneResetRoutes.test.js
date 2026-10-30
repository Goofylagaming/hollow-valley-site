"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");
const vm=require("node:vm");
const express=require("express");
const root=path.join(__dirname,".."),dir=fs.mkdtempSync(path.join(os.tmpdir(),"hv-prime-reset-website-"));
process.env.DB_PATH=path.join(dir,"site.sqlite");
delete process.env.PUBLIC_SITE_URL;
const automation=require("../server/services/automationWebsiteClient");
const router=require("../server/routes/mydinos");
const own="76561198000000001",other="76561198000000002";
const lifeId="2f23eceb-93a1-4ab6-92b6-96b5207ced31";
const requestId="6751720a-f29f-4e1c-8796-535a1c225715";
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));

function app(){
  const x=express();x.use(express.json());
  x.use((req,_res,next)=>{
    const role=req.get("X-Test-Role");
    req.user=role==="owner"?{id:1,steam_id:own,is_admin:0}:
      role==="other"?{id:2,steam_id:other,is_admin:0}:
      role==="discord"?{id:3,steam_id:null,is_admin:0}:null;
    next();
  });
  x.use("/api/mydinos",router);
  return x;
}
async function withServer(action){
  const server=app().listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  const base="http://127.0.0.1:"+server.address().port;
  try{return await action(base);}
  finally{await new Promise(resolve=>server.close(resolve));}
}
function send(base,body,options={}){
  const {role="owner",origin=base,contentType="application/json"}=options;
  return fetch(base+"/api/mydinos/prime-tracker/reset-zones",{
    method:"POST",
    headers:{...(role?{"X-Test-Role":role}:{}),
      ...(origin?{Origin:origin}:{}),
      "Content-Type":contentType},
    body:contentType==="application/json"?JSON.stringify(body):"test",
  });
}
function request(){return{lifeId,requestId,confirm:"RESET ZONES",steamId:other};}

test("website blocks guests, Discord-only logins, missing origin and hostile cross-site requests",async()=>{
  await withServer(async base=>{
    assert.equal((await send(base,request(),{role:null})).status,401);
    assert.equal((await send(base,request(),{role:"discord"})).status,400);
    assert.equal((await send(base,request(),{origin:null})).status,403);
    assert.equal((await send(base,request(),{origin:"https://attacker.example"})).status,403);
    assert.equal((await send(base,request(),{contentType:"text/plain"})).status,415);
  });
});
test("reset uses the authenticated player's Steam ID, never a forged request body identity",async()=>{
  const old=automation.resetPrimeZones;
  let received=null;
  automation.resetPrimeZones=async payload=>{
    received=payload;
    return {ok:true,duplicate:false,lifeId,resetAt:new Date().toISOString(),clearedZones:3};
  };
  try{
    await withServer(async base=>{
      const r=await send(base,request());
      assert.equal(r.status,200);
      assert.match(r.headers.get("cache-control"),/no-store/);
      const result=await r.json();
      assert.equal(result.ok,true);
      assert.equal(result.clearedZones,3);
      assert.deepEqual(received,{steamId:own,lifeId,requestId,confirm:"RESET ZONES"});
      assert.equal(result.steamId,undefined);
    });
  }finally{automation.resetPrimeZones=old;}
});
test("website propagates stale-life conflicts instead of performing a fallback reset",async()=>{
  const old=automation.resetPrimeZones;
  automation.resetPrimeZones=async()=>{
    const error=new Error("The active dinosaur has changed. Refresh and try again.");
    error.status=409;
    throw error;
  };
  try{
    await withServer(async base=>{
      const r=await send(base,request());
      assert.equal(r.status,409);
      assert.match((await r.json()).error,/active dinosaur has changed/);
    });
  }finally{automation.resetPrimeZones=old;}
});

function resetClient({confirm=true,response=null,stored=null}={}){
  const file=fs.readFileSync(path.join(root,"public/assets/prime-zone-reset.js"),"utf8");
  let clicks,apiCalls=[],events=[],randomCount=0;
  const feedback={textContent:""},zoneMap=new Map(stored||[]);
  const button={
    disabled:false,isConnected:true,textContent:"Reset tracked zones",
    getAttribute:name=>name==="data-prime-zone-reset"?lifeId:null,
    closest:selector=>selector===".prime-reset-controls"
      ? {querySelector:()=>feedback}:null,
  };
  const context={
    document:{addEventListener:(event,fn)=>{if(event==="click")clicks=fn;}},
    window:{
      HDS:{api:async(url,opts)=>{
        apiCalls.push({url,body:JSON.parse(opts.body),method:opts.method});
        if(typeof response==="function")return response();
        return response||{ok:true,lifeId,resetAt:new Date().toISOString(),clearedZones:3};
      }},
      confirm:()=>confirm,
      crypto:{randomUUID:()=>{randomCount++;return requestId;}},
      dispatchEvent:event=>events.push(event),
    },
    localStorage:{
      getItem:key=>zoneMap.get(key)||null,
      setItem:(key,value)=>zoneMap.set(key,value),
    },
    CustomEvent:class{constructor(name,args){this.type=name;this.detail=args.detail;}},
    Number,JSON,Error,
  };
  vm.runInNewContext(file,context);
  const click=()=>clicks({target:{closest:selector=>selector==="[data-prime-zone-reset]"?button:null}});
  return{click,button,feedback,apiCalls,events,zoneMap,get randomCount(){return randomCount;}};
}
test("reset button requires clear confirmation and protects other browser Prime checkboxes",async()=>{
  const key="hollow-valley-prime-checks:"+lifeId;
  const input=new Map([[key,JSON.stringify({sanctuary:true,migration:true,patrol:true,diet:true,healthy:true})]]);
  const denied=resetClient({confirm:false,stored:input});
  await denied.click();
  assert.equal(denied.apiCalls.length,0);
  const client=resetClient({stored:input});
  await client.click();
  assert.equal(client.apiCalls.length,1);
  assert.equal(client.apiCalls[0].url,"/api/mydinos/prime-tracker/reset-zones");
  assert.equal(client.apiCalls[0].body.lifeId,lifeId);
  assert.equal(client.apiCalls[0].body.confirm,"RESET ZONES");
  const saved=JSON.parse(client.zoneMap.get(key));
  assert.equal(saved.sanctuary,undefined);
  assert.equal(saved.migration,undefined);
  assert.equal(saved.patrol,undefined);
  assert.equal(saved.diet,true);
  assert.equal(saved.healthy,true);
  assert.equal(client.events[0].type,"hv-prime-zones-reset");
  assert.equal(client.events[0].detail.lifeId,lifeId);
  assert.equal(client.button.disabled,false);
});
test("network-uncertain reset retries keep the same idempotent request key",async()=>{
  let calls=0;
  const client=resetClient({response:()=>{
    calls++;
    if(calls===1){const e=new Error("Network timeout");e.status=504;throw e;}
    return{ok:true,lifeId,resetAt:new Date().toISOString(),clearedZones:1};
  }});
  await client.click();
  assert.match(client.feedback.textContent,/Network timeout/);
  await client.click();
  assert.equal(client.apiCalls.length,2);
  assert.equal(client.apiCalls[0].body.requestId,client.apiCalls[1].body.requestId);
  assert.equal(client.randomCount,1);
});

test("DinoStorage and Live Map both include reset controls and their cache-busted assets",()=>{
  const read=p=>fs.readFileSync(path.join(root,p),"utf8");
  const storage=read("public/dinostorage/index.html");
  const map=read("public/livemap.html");
  const api=read("automation-platform/src/routes/websiteRoutes.js");
  const website=read("server/routes/mydinos.js");
  const client=read("server/services/automationWebsiteClient.js");
  for(const html of [storage,map]){
    assert.match(html,/prime-zone-reset\.css\?v=1/);
    assert.match(html,/prime-zone-reset\.js\?v=1/);
  }
  assert.match(storage,/mydinos\.js\?v=15/);
  assert.match(map,/livemap-prime-summary\.js\?v=2/);
  assert.match(read("public/assets/mydinos.js"),/data-prime-zone-reset/);
  assert.match(read("public/assets/livemap-prime-summary.js"),/data-prime-zone-reset/);
  assert.match(api,/router\.post\('\/prime\/:steamId\/reset-zones'/);
  assert.match(website,/router\.post\("\/prime-tracker\/reset-zones", requireAuth/);
  assert.match(client,/function resetPrimeZones/);
  assert.match(read("automation-platform/src/services/primeTrackerService.js"),/prime_tracker_zone_resets/);
  assert.doesNotMatch(read("public/assets/prime-zone-reset.js"),/\/api\/wallet|\/api\/dinostorage|\/api\/prime\/grant/);
  for(const file of ["public/assets/mydinos.js","public/assets/livemap-prime-summary.js","public/assets/prime-zone-reset.js"]){
    assert.doesNotThrow(()=>new Function(read(file)));
  }
});
