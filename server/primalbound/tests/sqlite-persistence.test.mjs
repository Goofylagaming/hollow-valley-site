import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {randomBytes} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {openSqlitePool} from "../sqlite-pg-compat.mjs";
import {encryptedVerifiedUpload,snapshotPrimalbound,preserveLegacyDisk,testDecrypt} from "../offsite-backups.mjs";

function setup(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"primalbound-sqlite-"));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return {root:dir,dir:path.join(dir,"primalbound-cloud"),filename:path.join(dir,"primalbound-cloud","primalbound.sqlite")};
}
const cfg=()=>({key:randomBytes(32),prefix:"test"});
function memoryStore(){
 const objects=new Map();
 return {objects,
  async put(key,data){objects.set(key,Buffer.from(data));},
  async get(key){if(!objects.has(key))throw Error("missing remote object");return Buffer.from(objects.get(key));}
 };
}
test("new SQLite db persists accounts, sessions, dinosaur saves and revisions after restart",async t=>{
 const {filename}=setup(t);
 const pool=openSqlitePool(filename);
 await pool.query("INSERT INTO pb_users(id,username,username_lower,password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT(username_lower) DO NOTHING RETURNING id,username",["u1","Dino","dino","hash"]);
 await pool.query("INSERT INTO pb_sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '14 days')",["secret","u1"]);
 const auth=await pool.query("SELECT u.id,u.username FROM pb_sessions s JOIN pb_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() LIMIT 1",["secret"]);
 assert.equal(auth.rows[0].username,"Dino");
 const save={version:7,stage:152,bones:13927,dinos:[{id:"rex",level:75}],active:["rex"]};
 const one=await pool.query("INSERT INTO pb_saves(user_id,save_data,revision) VALUES($1,$2::jsonb,1) ON CONFLICT (user_id) DO NOTHING RETURNING revision,updated_at",["u1",JSON.stringify(save)]);
 assert.equal(one.rows[0].revision,1);
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const old=await client.query("SELECT revision,save_data FROM pb_saves WHERE user_id=$1 FOR UPDATE",["u1"]);
  const updated=await client.query("UPDATE pb_saves SET save_data=$3::jsonb,revision=revision+1,updated_at=now() WHERE user_id=$1 AND revision=$2 RETURNING revision,updated_at",["u1",1,JSON.stringify({...save,stage:203})]);
  assert.equal(updated.rows[0].revision,2);
  await client.query("INSERT INTO pb_save_history(user_id,revision,save_data) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING",["u1",1,JSON.stringify(old.rows[0].save_data)]);
  await client.query("COMMIT");
 }finally{client.release();}
 assert.equal(pool.integrityCheck(),true);
 await pool.end();
 const restarted=openSqlitePool(filename,{create:false});
 const state=await restarted.query("SELECT save_data,revision,updated_at FROM pb_saves WHERE user_id=$1",["u1"]);
 assert.equal(state.rows[0].save_data.stage,203);
 assert.equal(state.rows[0].revision,2);
 const history=await restarted.query("SELECT revision,saved_at,save_data->>'stage' AS stage,save_data->>'bones' AS bones,save_data->>'wins' AS wins FROM pb_save_history WHERE user_id=$1 ORDER BY revision DESC LIMIT 10",["u1"]);
 assert.equal(history.rows[0].stage,152);
 assert.equal(restarted.countUsers(),1);
 await restarted.end();
});
test("serial transactions prevent two concurrent stale-revision writes from succeeding",async t=>{
 const {filename}=setup(t),pool=openSqlitePool(filename);
 await pool.query("INSERT INTO pb_users(id,username,username_lower,password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT(username_lower) DO NOTHING RETURNING id,username",["u2","Rex","rex","hashed"]);
 await pool.query("INSERT INTO pb_saves(user_id,save_data,revision) VALUES($1,$2::jsonb,1) ON CONFLICT (user_id) DO NOTHING RETURNING revision,updated_at",["u2",'{"stage":1}']);
 async function update(n){
  const c=await pool.connect();
  try{
   await c.query("BEGIN");
   const before=await c.query("SELECT revision,save_data FROM pb_saves WHERE user_id=$1 FOR UPDATE",["u2"]);
   if(before.rows[0].revision!==1){await c.query("ROLLBACK");return false;}
   await new Promise(resolve=>setTimeout(resolve,n===1?30:0));
   const committed=await c.query("UPDATE pb_saves SET save_data=$3::jsonb,revision=revision+1,updated_at=now() WHERE user_id=$1 AND revision=$2 RETURNING revision,updated_at",["u2",1,JSON.stringify({stage:n})]);
   await c.query("COMMIT");return committed.rowCount>0;
  }finally{c.release();}
 }
 const done=await Promise.all([update(1),update(2)]);
 assert.equal(done.filter(Boolean).length,1);
 assert.equal((await pool.query("SELECT save_data,revision,updated_at FROM pb_saves WHERE user_id=$1",["u2"])).rows[0].revision,2);
 await pool.end();
});
test("an unrelated Hollow Valley database can never become Primalbound's save file",async t=>{
 const {filename}=setup(t);
 fs.mkdirSync(path.dirname(filename),{recursive:true});
 const foreign=new DatabaseSync(filename);
 foreign.exec("CREATE TABLE hollowvalley_events(id INTEGER PRIMARY KEY); INSERT INTO hollowvalley_events VALUES(100);");
 foreign.close();
 assert.throws(()=>openSqlitePool(filename),/not owned by Primalbound/);
 const untouched=new DatabaseSync(filename,{readOnly:true});
 assert.equal(untouched.prepare("SELECT count(*) AS n FROM hollowvalley_events").get().n,1);
 untouched.close();
});
test("encrypted offsite snapshot restores with integrity and rejects tampering",async t=>{
 const {filename}=setup(t),pool=openSqlitePool(filename),store=memoryStore(),config=cfg();
 await pool.query("INSERT INTO pb_users(id,username,username_lower,password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT(username_lower) DO NOTHING RETURNING id,username",["u3","Hatch","hatch","hash"]);
 const receipt=await snapshotPrimalbound(pool,store,config);
 assert.ok(receipt.bytes>0);
 assert.match(receipt.sha256,/^[a-f0-9]{64}$/);
 const ciphertext=store.objects.get(receipt.remoteKey);
 assert.equal(ciphertext.includes(Buffer.from("Hatch")),false);
 assert.notEqual(ciphertext.toString("utf8",0,13),"SQLite format");
 assert.ok(testDecrypt(ciphertext,config.key).subarray(0,16).equals(Buffer.from("SQLite format 3\u0000")));
 const broken=memoryStore();
 broken.put=async(key,data)=>{const b=Buffer.from(data);b[b.length-1]^=0x01;broken.objects.set(key,b)};
 await assert.rejects(snapshotPrimalbound(pool,broken,config),/did not verify/);
 await pool.end();
});
test("legacy Hollow Valley DB and recovery copy are backed up and verified before repurpose",async t=>{
 const {root,dir}=setup(t),store=memoryStore(),config=cfg();
 const main=path.join(root,"hollowvalley.sqlite");
 const recovery=path.join(root,"old-recovery.sqlite");
 for(const file of [main,recovery]){
  const db=new DatabaseSync(file);db.exec("CREATE TABLE legacy_items(id INTEGER PRIMARY KEY); INSERT INTO legacy_items VALUES(7)");db.close();
 }
 const first=fs.readFileSync(main);
 const manifest=await preserveLegacyDisk(root,dir,store,config);
 assert.equal(manifest.files.length,2);
 assert.ok(manifest.files.every(x=>x.sha256&&x.remoteKey));
 assert.deepEqual(fs.readFileSync(main),first,"No legacy data altered");
 const second=await preserveLegacyDisk(root,dir,store,config);
 assert.deepEqual(second.files,manifest.files);
 const damaged=manifest.files[0].remoteKey;
 store.objects.get(damaged)[45]^=1;
 await assert.rejects(preserveLegacyDisk(root,dir,store,config),/failed verification|Unsupported state|authenticate/i);
});
test("legacy disk backup refuses missing files and never writes a misleading success marker",async t=>{
 const {root,dir}=setup(t),store=memoryStore(),config=cfg();
 await assert.rejects(preserveLegacyDisk(root,dir,store,config),/No legacy/);
 assert.equal(fs.existsSync(path.join(dir,"legacy-backup-verified.json")),false);
});
test("verify remote snapshot cannot be forged by a failed or unavailable store",async t=>{
 const {filename}=setup(t),pool=openSqlitePool(filename),config=cfg();
 await assert.rejects(snapshotPrimalbound(pool,{put:async()=>{},get:async()=>{throw Error("offline")}},config),/offline/);
 await pool.end();
});
