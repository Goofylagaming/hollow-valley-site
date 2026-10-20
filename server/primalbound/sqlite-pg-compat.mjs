import fs from "node:fs";
import path from "node:path";
import {DatabaseSync} from "node:sqlite";

const CREATE_SCHEMA=`
CREATE TABLE IF NOT EXISTS pb_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pb_users (
 id TEXT PRIMARY KEY, username TEXT NOT NULL, username_lower TEXT NOT NULL UNIQUE,
 password_hash TEXT NOT NULL, failed_attempts INTEGER NOT NULL DEFAULT 0,
 locked_until TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS pb_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES pb_users(id) ON DELETE CASCADE,
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS pb_sessions_user ON pb_sessions(user_id);
CREATE INDEX IF NOT EXISTS pb_sessions_expiry ON pb_sessions(expires_at);
CREATE TABLE IF NOT EXISTS pb_saves (
 user_id TEXT PRIMARY KEY REFERENCES pb_users(id) ON DELETE CASCADE,
 save_data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS pb_save_history (
 user_id TEXT NOT NULL REFERENCES pb_users(id) ON DELETE CASCADE, revision INTEGER NOT NULL,
 save_data TEXT NOT NULL, saved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(user_id,revision)
);
CREATE INDEX IF NOT EXISTS pb_save_history_recency ON pb_save_history(user_id, revision DESC);
`;
const now=()=>new Date().toISOString();
const row=(record)=>record?{...record,
  ...(typeof record.save_data==="string"?{save_data:JSON.parse(record.save_data)}:{})
}:record;
const result=(records)=>({rows:records,rowCount:records.length});
const stmt=(db,sql,args=[])=>db.prepare(sql).all(...args).map(row);
const one=(db,sql,args=[])=>row(db.prepare(sql).get(...args));
const run=(db,sql,args=[])=>db.prepare(sql).run(...args).changes;

export class SqlitePgCompat {
 constructor(filename,{create=true}={}){
  if(typeof filename!=="string"||!path.isAbsolute(filename)||!filename.endsWith(".sqlite"))throw Error("SQLite location must be a dedicated absolute .sqlite path");
  this.filename=path.resolve(filename);
  if(!fs.existsSync(this.filename)&&!create)throw Error("Existing Primalbound SQLite file not found");
  if(!fs.existsSync(path.dirname(this.filename)))fs.mkdirSync(path.dirname(this.filename),{recursive:true,mode:0o700});
  if(fs.existsSync(this.filename)&&fs.statSync(this.filename).size){
   const probe=new DatabaseSync(this.filename,{readOnly:true});
   try{
    const meta=probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='pb_meta'").get();
    if(!meta||probe.prepare("SELECT value FROM pb_meta WHERE key='application'").get()?.value!=="primalbound-cloud-v1"){
      throw Error("Refusing to open an existing SQLite file not owned by Primalbound");
    }
   }finally{probe.close();}
  }
  this.db=new DatabaseSync(this.filename);
  this.db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
  this.db.exec(CREATE_SCHEMA);
  this.db.prepare("INSERT OR IGNORE INTO pb_meta(key,value) VALUES('application','primalbound-cloud-v1')").run();
  if(this.db.prepare("PRAGMA quick_check").get()?.quick_check!=="ok")throw Error("SQLite quick_check failed");
  this.tail=Promise.resolve();
  this.open=true;
 }
 _queue(fn){
  const work=this.tail.then(fn,fn);
  this.tail=work.then(()=>{},()=>{});
  return work;
 }
 query(sql,args=[]){
  return this._queue(()=>this._query(sql,args));
 }
 acquireConnection(){
  if(!this.open)throw Error("SQLite connection closed");
  const before=this.tail;
  let unlock;
  const gate=new Promise(resolve=>unlock=resolve);
  this.tail=before.then(()=>gate,()=>gate);
  let freed=false;
  const instance=this;
  return before.then(()=>({
   query(sql,args=[]){if(freed)throw Error("SQLite connection already released");return Promise.resolve(instance._query(sql,args));},
   release(){if(!freed){freed=true;unlock();}}
  }));
 }
 _query(sql,args=[]){
  if(!this.open)throw Error("SQLite connection closed");
  const s=String(sql).trim().replace(/\s+/g," ").toUpperCase();
  const d=this.db;
  if(s==="BEGIN"){d.exec("BEGIN IMMEDIATE");return result([]);}
  if(s==="COMMIT"){d.exec("COMMIT");return result([]);}
  if(s==="ROLLBACK"){if(d.isTransaction)d.exec("ROLLBACK");return result([]);}
  if(s==="SELECT 1")return result([{ "?column?":1 }]);
  if(s.startsWith("INSERT INTO PB_SESSIONS(")){
   run(d,"INSERT INTO pb_sessions(token_hash,user_id,expires_at) VALUES(?,?,?)",[args[0],args[1],new Date(Date.now()+14*86400000).toISOString()]);
   return result([]);
  }
  if(s.startsWith("SELECT U.ID,U.USERNAME FROM PB_SESSIONS")){
   const v=one(d,"SELECT u.id,u.username FROM pb_sessions s JOIN pb_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? LIMIT 1",[args[0],now()]);
   return result(v?[v]:[]);
  }
  if(s.startsWith("INSERT INTO PB_USERS(")){
   const changed=run(d,"INSERT OR IGNORE INTO pb_users(id,username,username_lower,password_hash) VALUES(?,?,?,?)",args);
   return result(changed?[{id:args[0],username:args[1]}]:[]);
  }
  if(s.startsWith("SELECT ID,USERNAME,PASSWORD_HASH,FAILED_ATTEMPTS,LOCKED_UNTIL FROM PB_USERS")){
   const v=one(d,"SELECT id,username,password_hash,failed_attempts,locked_until FROM pb_users WHERE username_lower=?",[args[0]]);
   return result(v?[v]:[]);
  }
  if(s.startsWith("UPDATE PB_USERS SET FAILED_ATTEMPTS=FAILED_ATTEMPTS+1")){
   run(d,"UPDATE pb_users SET failed_attempts=failed_attempts+1,locked_until=CASE WHEN failed_attempts+1>=8 THEN ? ELSE locked_until END WHERE id=?",[new Date(Date.now()+15*60000).toISOString(),args[0]]);
   return result([]);
  }
  if(s.startsWith("UPDATE PB_USERS SET FAILED_ATTEMPTS=0")){
   run(d,"UPDATE pb_users SET failed_attempts=0,locked_until=NULL WHERE id=?",[args[0]]);
   return result([]);
  }
  if(s.startsWith("DELETE FROM PB_SESSIONS WHERE TOKEN_HASH")){
   run(d,"DELETE FROM pb_sessions WHERE token_hash=?",[args[0]]);return result([]);
  }
  if(s.startsWith("SELECT SAVE_DATA,REVISION,UPDATED_AT FROM PB_SAVES")){
   const v=one(d,"SELECT save_data,revision,updated_at FROM pb_saves WHERE user_id=?",[args[0]]);
   return result(v?[v]:[]);
  }
  if(s.startsWith("INSERT INTO PB_SAVES(")){
   const changed=run(d,"INSERT OR IGNORE INTO pb_saves(user_id,save_data,revision) VALUES(?,?,1)",[args[0],args[1]]);
   if(!changed)return result([]);
   const v=one(d,"SELECT revision,updated_at FROM pb_saves WHERE user_id=?",[args[0]]);
   return result([v]);
  }
  if(s.startsWith("SELECT REVISION,SAVE_DATA FROM PB_SAVES")){
   const v=one(d,"SELECT revision,save_data FROM pb_saves WHERE user_id=?",[args[0]]);
   return result(v?[v]:[]);
  }
  if(s.startsWith("UPDATE PB_SAVES SET SAVE_DATA")){
   const changed=run(d,"UPDATE pb_saves SET save_data=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=?",[args[2],now(),args[0],args[1]]);
   if(!changed)return result([]);
   const v=one(d,"SELECT revision,updated_at FROM pb_saves WHERE user_id=?",[args[0]]);
   return result([v]);
  }
  if(s.startsWith("INSERT INTO PB_SAVE_HISTORY(")){
   run(d,"INSERT OR IGNORE INTO pb_save_history(user_id,revision,save_data) VALUES(?,?,?)",[args[0],args[1],args[2]]);
   return result([]);
  }
  if(s.startsWith("DELETE FROM PB_SAVE_HISTORY WHERE USER_ID")){
   run(d,"DELETE FROM pb_save_history WHERE user_id=? AND revision NOT IN (SELECT revision FROM pb_save_history WHERE user_id=? ORDER BY revision DESC LIMIT 10)",[args[0],args[0]]);return result([]);
  }
  if(s.startsWith("SELECT REVISION,SAVED_AT,SAVE_DATA->>")){
   const values=stmt(d,"SELECT revision,saved_at,json_extract(save_data,'$.stage') AS stage,json_extract(save_data,'$.bones') AS bones,json_extract(save_data,'$.wins') AS wins FROM pb_save_history WHERE user_id=? ORDER BY revision DESC LIMIT 10",[args[0]]);
   return result(values);
  }
  if(s.startsWith("SELECT SAVE_DATA FROM PB_SAVE_HISTORY")){
   const v=one(d,"SELECT save_data FROM pb_save_history WHERE user_id=? AND revision=?",[args[0],args[1]]);
   return result(v?[v]:[]);
  }
  throw Error("Unsupported Primalbound SQLite operation: "+s.slice(0,74));
 }
 async end(){
  await this.tail;
  if(this.open){this.open=false;this.db.close();}
 }
 integrityCheck(){return this.db.prepare("PRAGMA integrity_check").get()?.integrity_check==="ok";}
 countUsers(){return this.db.prepare("SELECT count(*) AS total FROM pb_users").get().total;}
}
export function openSqlitePool(filename,options){
 const compat=new SqlitePgCompat(filename,options);
 return {
  query:(sql,args)=>compat.query(sql,args),
  connect:()=>compat.acquireConnection(),
  end:()=>compat.end(),
  integrityCheck:()=>compat.integrityCheck(),
  countUsers:()=>compat.countUsers(),
  raw:compat.db,
  filename:compat.filename
 };
}
