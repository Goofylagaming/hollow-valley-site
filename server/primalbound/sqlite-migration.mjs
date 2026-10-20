import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Pool} from "pg";
import {openSqlitePool} from "./sqlite-pg-compat.mjs";
import {backupConfig,s3BackingStore,preserveLegacyDisk,snapshotPrimalbound} from "./offsite-backups.mjs";

const strTime=v=>v instanceof Date?v.toISOString():typeof v==="string"?v:new Date().toISOString();
function serialise(value){
 if(typeof value==="string"){JSON.parse(value);return value;}
 return JSON.stringify(value);
}
export async function readPostgresSnapshot(client){
 await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
 try{
  const [users,sessions,saves,history]=await Promise.all([
   client.query("SELECT id,username,username_lower,password_hash,failed_attempts,locked_until,created_at FROM pb_users ORDER BY id"),
   client.query("SELECT token_hash,user_id,expires_at,created_at FROM pb_sessions ORDER BY user_id"),
   client.query("SELECT user_id,save_data,revision,updated_at FROM pb_saves ORDER BY user_id"),
   client.query("SELECT user_id,revision,save_data,saved_at FROM pb_save_history ORDER BY user_id,revision")
  ]);
  await client.query("COMMIT");
  return {users:users.rows,sessions:sessions.rows,saves:saves.rows,history:history.rows};
 }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}
}
/**
 * New database only. Do not replace an existing Primalbound db, a legacy Hollow Valley
 * db, or an existing migration output. Copy all rows atomically through a temp SQLite
 * file, then verify before creating the destination hard link.
 */
export async function importSnapshotIntoNewSqlite(snapshot,target,{beforePublish}={}){
 if(typeof target!=="string"||!path.isAbsolute(target)||!target.endsWith(".sqlite"))throw Error("Target must be a dedicated absolute .sqlite file");
 if(fs.existsSync(target))throw Error("Primalbound SQLite target already exists; refusing to overwrite");
 for(const name of ["users","sessions","saves","history"]){
  if(!Array.isArray(snapshot?.[name]))throw Error("Missing PostgreSQL snapshot collection: "+name);
 }
 const directory=path.dirname(target);
 fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const temp=path.join(directory,"import-"+process.pid+"-"+Date.now()+"-"+Math.random().toString(36).slice(2)+".sqlite");
 let pool;
 try{
  pool=openSqlitePool(temp);
  const d=pool.raw;
  d.exec("BEGIN IMMEDIATE");
  try{
   for(const r of snapshot.users){
    d.prepare("INSERT INTO pb_users(id,username,username_lower,password_hash,failed_attempts,locked_until,created_at) VALUES(?,?,?,?,?,?,?)")
     .run(String(r.id),r.username,r.username_lower,r.password_hash,r.failed_attempts||0,r.locked_until?strTime(r.locked_until):null,strTime(r.created_at));
   }
   for(const r of snapshot.sessions){
    d.prepare("INSERT INTO pb_sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)")
     .run(r.token_hash,String(r.user_id),strTime(r.expires_at),strTime(r.created_at));
   }
   for(const r of snapshot.saves){
    if(!Number.isInteger(r.revision)||r.revision<1)throw Error("Invalid PostgreSQL save revision");
    d.prepare("INSERT INTO pb_saves(user_id,save_data,revision,updated_at) VALUES(?,?,?,?)")
     .run(String(r.user_id),serialise(r.save_data),r.revision,strTime(r.updated_at));
   }
   for(const r of snapshot.history){
    d.prepare("INSERT INTO pb_save_history(user_id,revision,save_data,saved_at) VALUES(?,?,?,?)")
     .run(String(r.user_id),r.revision,serialise(r.save_data),strTime(r.saved_at));
   }
   d.exec("COMMIT");
  }catch(error){d.exec("ROLLBACK");throw error;}
  if(!pool.integrityCheck())throw Error("Imported database failed integrity_check");
  for(const [name,table] of [["users","pb_users"],["sessions","pb_sessions"],["saves","pb_saves"],["history","pb_save_history"]]){
   const actual=d.prepare("SELECT count(*) AS total FROM "+table).get().total;
   if(actual!==snapshot[name].length)throw Error("PostgreSQL migration row count mismatch: "+name);
  }
  const receipt=beforePublish?await beforePublish(pool):null;
  await pool.end();pool=null;
  if(fs.existsSync(target))throw Error("SQLite target appeared during migration; refusing to overwrite");
  fs.linkSync(temp,target); // Atomic create that fails if the destination already exists
  fs.unlinkSync(temp);
  const opened=openSqlitePool(target,{create:false});
  try{
   if(!opened.integrityCheck()||opened.countUsers()!==snapshot.users.length)throw Error("Published SQLite database verification failed");
  }finally{await opened.end();}
  return {users:snapshot.users.length,sessions:snapshot.sessions.length,
   saves:snapshot.saves.length,history:snapshot.history.length,receipt};
 }finally{
  if(pool)await pool.end().catch(()=>{});
  for(const suffix of ["","-wal","-shm"])if(fs.existsSync(temp+suffix))fs.unlinkSync(temp+suffix);
 }
}
export async function runMigration(env=process.env){
 const root=env.PRIMALBOUND_DATA_ROOT||"/app/data";
 const dir=path.join(root,"primalbound-cloud");
 const target=path.join(dir,"primalbound.sqlite");
 if(fs.existsSync(target))throw Error("Existing Primalbound database found; a second migration is forbidden");
 if(!env.DATABASE_URL)throw Error("Source PostgreSQL connection is required for the one-time migration");
 const backupSettings=backupConfig(env);
 if(!backupSettings)throw Error("Verified off-site backup destination must be configured before migration");
 const store=await s3BackingStore(backupSettings);
 // Preserve both legacy Hollow Valley DB and recovery copies FIRST.
 await preserveLegacyDisk(root,dir,store,backupSettings);
 const postgres=new Pool({connectionString:env.DATABASE_URL,max:1});
 let snapshot;
 try{const client=await postgres.connect();try{snapshot=await readPostgresSnapshot(client)}finally{client.release()}}
 finally{await postgres.end();}
 const result=await importSnapshotIntoNewSqlite(snapshot,target,{
  beforePublish:async(pool)=>await snapshotPrimalbound(pool,store,backupSettings)
 });
 // New SQLite is now independent, PostgreSQL remains unchanged and available for rollback.
 console.log("Primalbound SQLite import verified. Imported counts:",JSON.stringify({
  users:result.users,sessions:result.sessions,saves:result.saves,history:result.history}));
 return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 runMigration().catch(err=>{console.error("SQLite import blocked:",err.message);process.exitCode=1});
}
