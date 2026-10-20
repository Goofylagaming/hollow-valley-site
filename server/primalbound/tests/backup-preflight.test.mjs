import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomBytes} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {performBackupPreflight} from "../backup-preflight.mjs";
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"pb-r2-preflight-"));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const db=new DatabaseSync(path.join(root,"hollowvalley.sqlite"));
 db.exec("CREATE TABLE existing_hollowvalley_events(id INTEGER PRIMARY KEY); INSERT INTO existing_hollowvalley_events VALUES(2026)");db.close();
 fs.writeFileSync(path.join(root,"old-recovery.bak"),"RECOVERY DATA - MUST NOT BE ALTERED");
 const env={PRIMALBOUND_DATA_ROOT:root,PRIMALBOUND_BACKUP_BUCKET:"primalbound-backups",
  PRIMALBOUND_BACKUP_REGION:"auto",PRIMALBOUND_BACKUP_ACCESS_KEY:"test",
  PRIMALBOUND_BACKUP_SECRET_KEY:"test",
  PRIMALBOUND_BACKUP_KEY:randomBytes(32).toString("base64")};
 const objects=new Map();
 const store={
  async put(k,v){objects.set(k,Buffer.from(v))},
  async get(k){if(!objects.has(k))throw Error("missing remote object");return Buffer.from(objects.get(k))}
 };
 return {root,env,objects,store};
}
test("safe backup preflight encrypts all old disk artifacts, verifies storage and never alters original DB",async t=>{
 const f=fixture(t);
 const before=fs.readFileSync(path.join(f.root,"hollowvalley.sqlite"));
 const recovered=fs.readFileSync(path.join(f.root,"old-recovery.bak"));
 const messages=[];
 const verified=await performBackupPreflight({env:f.env,store:f.store,logger:{info:m=>messages.push(m)}});
 assert.equal(verified.ok,true);assert.equal(verified.files,2);
 assert.equal(f.objects.size,2);
 assert.deepEqual(fs.readFileSync(path.join(f.root,"hollowvalley.sqlite")),before);
 assert.deepEqual(fs.readFileSync(path.join(f.root,"old-recovery.bak")),recovered);
 const original=new DatabaseSync(path.join(f.root,"hollowvalley.sqlite"),{readOnly:true});
 assert.equal(original.prepare("SELECT id FROM existing_hollowvalley_events").get().id,2026);original.close();
 assert.ok(messages.some(m=>m.includes("VERIFIED")));
 assert.equal(fs.existsSync(path.join(f.root,"primalbound-cloud","primalbound.sqlite")),false);
 await performBackupPreflight({env:f.env,store:f.store,logger:{info:()=>{}}});
 assert.equal(f.objects.size,2,"repeat preflight must not create unbounded backup duplicates");
});
test("preflight fails closed on missing credentials, remote failure, or missing disk files",async t=>{
 const f=fixture(t);
 await assert.rejects(performBackupPreflight({env:{PRIMALBOUND_DATA_ROOT:f.root},store:f.store}),/incomplete/);
 const broken={put:async()=>{},get:async()=>{throw Error("R2 read failed")}};
 await assert.rejects(performBackupPreflight({env:f.env,store:broken}),/R2 read failed/);
 assert.equal(fs.existsSync(path.join(f.root,"primalbound-cloud","legacy-backup-verified.json")),false);
 const onlyDb=fs.mkdtempSync(path.join(os.tmpdir(),"pb-empty-disk-"));
 t.after(()=>fs.rmSync(onlyDb,{recursive:true,force:true}));
 await assert.rejects(performBackupPreflight({env:{...f.env,PRIMALBOUND_DATA_ROOT:onlyDb},store:f.store}),/No legacy/);
});
