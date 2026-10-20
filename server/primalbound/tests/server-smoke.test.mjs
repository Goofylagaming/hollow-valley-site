import test from "node:test";
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {setTimeout as sleep} from "node:timers/promises";

test("account server starts safely without database credentials and never creates ephemeral accounts",async(t)=>{
 const port=24000+Math.floor(Math.random()*20000);
 const child=spawn(process.execPath,["index.mjs"],{
  cwd:new URL("../",import.meta.url).pathname,
  env:{...process.env,PORT:String(port),DATABASE_URL:"",TEMP_DATABASE:"true"},
  stdio:["ignore","pipe","pipe"]
 });
 t.after(()=>{if(child.exitCode===null)child.kill("SIGTERM")});
 let ready=false;
 for(let i=0;i<35;i++){
  try{
   const health=await fetch("http://127.0.0.1:"+port+"/api/health");
   const data=await health.json();
   assert.equal(health.status,200);
   assert.equal(data.accountsConfigured,false);
   ready=true;break;
  }catch{await sleep(100);}
 }
 assert.equal(ready,true,"Cloud server should start without DB, in protected setup-only mode");
 const capabilities=await fetch("http://127.0.0.1:"+port+"/api/capabilities").then(x=>x.json());
 assert.equal(capabilities.accounts,false);
 assert.equal(capabilities.cloudSaves,false);
 assert.equal(capabilities.pendingDatabaseConnection,true);
 const attempted=await fetch("http://127.0.0.1:"+port+"/api/auth/register",{
  method:"POST",headers:{"Content-Type":"application/json",Origin:"https://example.com"},
  body:JSON.stringify({username:"Explorer",password:"StrongPassphrase_2026"})
 });
 assert.equal(attempted.status,503,"Never accept fake registrations or temporary in-process saves");
 const save=await fetch("http://127.0.0.1:"+port+"/api/cloud-save");
 assert.equal(save.status,503);
});
