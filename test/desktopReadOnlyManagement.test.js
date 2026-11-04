"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
process.env.DB_PATH=":memory:";
process.env.OWNER_STEAM_ID="76561198038977506";
process.env.SESSION_SECRET="test-desktop-readonly-session";
process.env.HV_MANAGEMENT_ENABLED="1";
process.env.HV_MANAGEMENT_AGENT_TOKEN="test-management-agent-key-must-never-be-reused";
process.env.HV_DESKTOP_READONLY_ENABLED="1";
process.env.HV_DESKTOP_READONLY_TOKEN="test-separate-readonly-desktop-token-1234567890abcde";
const {createApp}=require("../server/index");
const {receiveHeartbeat}=require("../server/services/serverManagement");
function listen(){return new Promise(resolve=>{const server=createApp().listen(0,"127.0.0.1",()=>resolve(server));});}
test("read-only desktop token never authorizes agent writes and omits privileged data",async t=>{
 const server=await listen();t.after(()=>new Promise(resolve=>server.close(resolve)));
 const base="http://127.0.0.1:"+server.address().port;
 const endpoint=base+"/api/hvs-desktop-readonly/status";
 const auth={Authorization:"Bearer "+process.env.HV_DESKTOP_READONLY_TOKEN};
 assert.equal((await fetch(endpoint)).status,401);
 assert.equal((await fetch(endpoint,{headers:{Authorization:"Bearer "+process.env.HV_MANAGEMENT_AGENT_TOKEN}})).status,401);
 assert.equal((await fetch(base+"/api/binarylane-management/probe",{headers:auth})).status,401);
 assert.equal((await fetch(base+"/api/binarylane-management/status",{method:"POST",headers:{...auth,"Content-Type":"application/json"},body:"{}"})).status,401);
 assert.equal((await fetch(base+"/api/admin/server-management",{headers:auth})).status,404);
 receiveHeartbeat({server:{pid:9999,processCount:1,rconOwnedByGame:true},allowTaskWrites:true,
  tasks:{watchdog:"Running",scanner:"Ready",command_bridge:"Running"},
  logs:{restart:["secret-do-not-expose"]}});
 const response=await fetch(endpoint,{headers:auth});assert.equal(response.status,200);
 assert.match(response.headers.get("cache-control"),/no-store/);
 const status=await response.json();
 assert.equal(status.readOnly,true);assert.equal(status.server.processCount,1);
 assert.equal(status.tasks.watchdog,"Running");
 assert.equal(status.connected,true);
 for(const forbidden of ["9999","secret-do-not-expose","allowTaskWrites","writeGates","leaseToken","jobs","ownerSteamId"])
  assert.equal(JSON.stringify(status).includes(forbidden),false,forbidden);
 assert.equal((await fetch(endpoint,{method:"POST",headers:auth})).status,405);
 assert.equal((await fetch(base+"/api/hvs-desktop-readonly/unknown",{headers:auth})).status,405);
});
test("feature disabled or token equal to agent token fails closed",async t=>{
 const server=await listen();t.after(()=>new Promise(resolve=>server.close(resolve)));
 const endpoint="http://127.0.0.1:"+server.address().port+"/api/hvs-desktop-readonly/status";
 const token=process.env.HV_DESKTOP_READONLY_TOKEN;
 process.env.HV_DESKTOP_READONLY_ENABLED="0";
 try{assert.equal((await fetch(endpoint,{headers:{Authorization:"Bearer "+token}})).status,404);}
 finally{process.env.HV_DESKTOP_READONLY_ENABLED="1";}
 process.env.HV_DESKTOP_READONLY_TOKEN=process.env.HV_MANAGEMENT_AGENT_TOKEN;
 try{assert.equal((await fetch(endpoint,{headers:{Authorization:"Bearer "+process.env.HV_MANAGEMENT_AGENT_TOKEN}})).status,404);}
 finally{process.env.HV_DESKTOP_READONLY_TOKEN=token;}
});
