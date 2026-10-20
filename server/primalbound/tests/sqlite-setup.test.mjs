import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {setTimeout as pause} from "node:timers/promises";
import {DatabaseSync} from "node:sqlite";

async function awaitServer(port,child){
 for(let i=0;i<40;i++){
  if(child.exitCode!==null)throw Error("Server exited before health check");
  try{
   const response=await fetch("http://127.0.0.1:"+port+"/api/health");
   return {response,body:await response.json()};
  }catch{await pause(100);}
 }
 throw Error("Server did not start within timeout");
}
test("paid SQLite account server refuses writes if off-site storage is unverified, preserving original DB",async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"pb-sqlite-setup-"));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const legacy=path.join(root,"hollowvalley.sqlite");
 const old=new DatabaseSync(legacy);
 old.exec("CREATE TABLE territory(id INTEGER); INSERT INTO territory VALUES(49)");old.close();
 const port=23000+Math.floor(Math.random()*9000);
 const child=spawn(process.execPath,["index.mjs"],{
  cwd:path.resolve(new URL("../",import.meta.url).pathname),
  env:{...process.env,PORT:String(port),PRIMALBOUND_DB_ENGINE:"sqlite",PRIMALBOUND_DATA_ROOT:root,
   DATABASE_URL:"",PRIMALBOUND_BACKUP_BUCKET:"",PRIMALBOUND_BACKUP_REGION:"",PRIMALBOUND_BACKUP_KEY:""},
  stdio:"ignore"
 });
 t.after(()=>{if(child.exitCode===null)child.kill("SIGTERM")});
 const health=await awaitServer(port,child);
 assert.equal(health.response.status,200);
 assert.equal(health.body.storage,"sqlite");
 assert.equal(health.body.accountsConfigured,false);
 const url="http://127.0.0.1:"+port;
 const cap=await fetch(url+"/api/capabilities").then(r=>r.json());
 assert.equal(cap.accounts,false);
 assert.equal(cap.cloudSaves,false);
 assert.match(cap.warning,/backups/i);
 const signup=await fetch(url+"/api/auth/register",{method:"POST",headers:{"Content-Type":"application/json",Origin:"https://test.example"},
  body:JSON.stringify({username:"DinoPlayer",password:"Superlong-unique-password-12345"})});
 assert.equal(signup.status,503);
 const original=new DatabaseSync(legacy,{readOnly:true});
 assert.equal(original.prepare("SELECT id FROM territory").get().id,49);
 original.close();
 const cloud=new DatabaseSync(path.join(root,"primalbound-cloud","primalbound.sqlite"),{readOnly:true});
 assert.equal(cloud.prepare("SELECT count(*) AS n FROM pb_users").get().n,0);
 cloud.close();
});
