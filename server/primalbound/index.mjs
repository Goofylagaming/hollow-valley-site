import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {Pool} from "pg";
import {openSqlitePool} from "./sqlite-pg-compat.mjs";
import {backupConfig,s3BackingStore,preserveLegacyDisk,snapshotPrimalbound} from "./offsite-backups.mjs";
import {
 validUsername,validPassword,normaliseUsername,newUserId,hashPassword,checkPassword,
 newSessionToken,hashSession,setSessionCookie,clearSessionCookie,tokenFromCookie,
 safeOrigin,validateCloudSave,parseJsonPayload,checkSaveRevision,rateLimit,SESSION_SECONDS
} from "./account-core.mjs";

const __dirname=path.dirname(fileURLToPath(import.meta.url));
const publicDir=path.resolve(__dirname,"../../public");
const port=Number(process.env.PORT||3000);
// Never fall back to storing passwords or game saves in ephemeral process memory.
const sqliteMode=process.env.PRIMALBOUND_DB_ENGINE==="sqlite";
const diskRoot=process.env.PRIMALBOUND_DATA_ROOT||"/app/data";
const sqliteDir=path.join(diskRoot,"primalbound-cloud");
const sqliteFilename=path.join(sqliteDir,"primalbound.sqlite");
const pool=sqliteMode?openSqlitePool(sqliteFilename):
  process.env.DATABASE_URL?new Pool({
   connectionString:process.env.DATABASE_URL,max:5,idleTimeoutMillis:15000,connectionTimeoutMillis:10000,
   ssl:process.env.DATABASE_SSL==="require"?{rejectUnauthorized:true}:undefined
  }):null;
if(pool&&!sqliteMode)await pool.query(fs.readFileSync(path.join(__dirname,"schema.sql"),"utf8"));
let backupVerified=!sqliteMode;
let backupError=sqliteMode?"Off-site backup verification is required.":"";
let backingStore=null;
let backupSettings=null;
async function verifyDiskBackup(){
 if(!sqliteMode)return;
 backupVerified=false;
 try{
  backupSettings=backupConfig();
  if(!backupSettings)throw Error("Encrypted off-site object storage is not configured");
  backingStore=await s3BackingStore(backupSettings);
  await preserveLegacyDisk(diskRoot,sqliteDir,backingStore,backupSettings);
  await snapshotPrimalbound(pool,backingStore,backupSettings);
  backupVerified=true;
  backupError="";
  console.log("Primalbound SQLite database and legacy disk protected by verified off-site backups");
 }catch(e){
  backupError=String(e?.message||"backup unavailable");
  console.error("Cloud accounts locked: encrypted off-site backup verification did not pass",backupError);
 }
}
if(sqliteMode)await verifyDiskBackup();
const backupTimer=sqliteMode?setInterval(()=>{void verifyDiskBackup()},15*60*1000):null;
if(backupTimer)backupTimer.unref();
const configured=Boolean(pool)&&backupVerified;
const loginLimit=rateLimit(18,10*60*1000);
const signupLimit=rateLimit(6,60*60*1000);
const contentTypes={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".webp":"image/webp",".svg":"image/svg+xml",".ico":"image/x-icon",".json":"application/json; charset=utf-8",".woff2":"font/woff2"};
function secure(res){
 res.setHeader("X-Content-Type-Options","nosniff");
 res.setHeader("Referrer-Policy","strict-origin-when-cross-origin");
 res.setHeader("X-Frame-Options","DENY");
 res.setHeader("Permissions-Policy","camera=(), microphone=(), geolocation=()");
 res.setHeader("Content-Security-Policy","default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; form-action 'self';");
}
function json(res,status,data,extra={}){
 res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...extra});
 res.end(JSON.stringify(data));
}
function fail(res,status,message){json(res,status,{error:message});}
async function readBody(req){
 const parts=[];let length=0;
 for await (const part of req){
  length+=part.length;
  if(length>270000)throw Object.assign(new Error("Request too large."),{status:413});
  parts.push(part);
 }
 return parseJsonPayload(Buffer.concat(parts).toString("utf8"));
}
function requireJson(req){
 return (req.headers["content-type"]||"").toLowerCase().split(";")[0]==="application/json";
}
function getIp(req){
 const header=req.headers["x-forwarded-for"];
 const first=typeof header==="string"?header.split(",")[0].trim():"";
 return first.length<=65&&/^[0-9a-f:.]+$/i.test(first)?first:req.socket.remoteAddress||"unknown";
}
function authCookie(res,token){res.setHeader("Set-Cookie",setSessionCookie(token));}
async function issueSession(userId,res){
 const token=newSessionToken();
 await pool.query("INSERT INTO pb_sessions(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '14 days')",[hashSession(token),userId]);
 authCookie(res,token);
}
async function getAuthenticated(req){
 const token=tokenFromCookie(req.headers.cookie);
 if(!token)return null;
 const result=await pool.query(
  "SELECT u.id,u.username FROM pb_sessions s JOIN pb_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() LIMIT 1",
  [hashSession(token)]);
 return result.rows[0]||null;
}
const publicUser=u=>({id:u.id,username:u.username});

async function persistCloudSave(userId,revision,data){
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  let saved;
  if(revision===0){
   saved=await client.query("INSERT INTO pb_saves(user_id,save_data,revision) VALUES($1,$2::jsonb,1) ON CONFLICT(user_id) DO NOTHING RETURNING revision,updated_at",[userId,JSON.stringify(data)]);
  }else{
   const before=await client.query("SELECT revision,save_data FROM pb_saves WHERE user_id=$1 FOR UPDATE",[userId]);
   if(!before.rowCount||before.rows[0].revision!==revision){await client.query("ROLLBACK");return null;}
   saved=await client.query("UPDATE pb_saves SET save_data=$3::jsonb,revision=revision+1,updated_at=now() WHERE user_id=$1 AND revision=$2 RETURNING revision,updated_at",[userId,revision,JSON.stringify(data)]);
   if(saved.rowCount){
    await client.query("INSERT INTO pb_save_history(user_id,revision,save_data) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING",[userId,revision,JSON.stringify(before.rows[0].save_data)]);
    await client.query("DELETE FROM pb_save_history WHERE user_id=$1 AND revision NOT IN (SELECT revision FROM pb_save_history WHERE user_id=$1 ORDER BY revision DESC LIMIT 10)",[userId]);
   }
  }
  await client.query("COMMIT");return saved.rows[0]||null;
 }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}
 finally{client.release();}
}

async function handleApi(req,res,pathname){
 if(pathname==="/api/health"&&req.method==="GET"){
  if(!pool)return json(res,200,{ok:true,accountsConfigured:false});
  await pool.query("SELECT 1");
  return json(res,200,{ok:true,accountsConfigured:!sqliteMode||backupVerified,storage:sqliteMode?"sqlite":"postgres"});
 }
 if(pathname==="/api/capabilities"&&req.method==="GET"){
  if(!pool||!backupVerified)return json(res,200,{accounts:false,cloudSaves:false,pendingDatabaseConnection:true,
   warning:sqliteMode?"Verified encrypted off-site backups are required before Primalbound accounts can open.":"Database connection must be configured."});
  return json(res,200,{accounts:true,cloudSaves:true,
   temporaryDatabase:!sqliteMode&&process.env.TEMP_DATABASE==="true",
   warning:!sqliteMode&&process.env.TEMP_DATABASE==="true"?
    "Preview only: this free Render database expires after 30 days and has no backups. Keep a JSON export.":null});
 }
 if(!pool||!backupVerified)return fail(res,503,sqliteMode?"Cloud accounts are protected while verified off-site backups are unavailable.":"Cloud accounts are not configured yet. Database connection required.");
 if(req.method==="POST"||req.method==="PUT"){
  if(!requireJson(req))return fail(res,415,"JSON content type required.");
  if(!safeOrigin(req.headers.origin,req.headers.host))return fail(res,403,"Invalid request origin.");
 }
 if(pathname==="/api/auth/register"&&req.method==="POST"){
  if(signupLimit("register:"+getIp(req)))return fail(res,429,"Too many registration attempts. Try again later.");
  const body=await readBody(req);
  const username=body?.username?.trim(),password=body?.password;
  if(!validUsername(username))return fail(res,400,"Username must be 3–24 characters, starting with a letter; letters, numbers and underscores only.");
  if(!validPassword(password))return fail(res,400,"Password must be 12–128 characters and not be a common password.");
  const hash=await hashPassword(password);
  const result=await pool.query("INSERT INTO pb_users(id,username,username_lower,password_hash) VALUES ($1,$2,$3,$4) ON CONFLICT(username_lower) DO NOTHING RETURNING id,username",
   [newUserId(),username,normaliseUsername(username),hash]);
  if(!result.rowCount)return fail(res,409,"This username is already registered.");
  await issueSession(result.rows[0].id,res);
  return json(res,201,{user:publicUser(result.rows[0]),newAccount:true});
 }
 if(pathname==="/api/auth/login"&&req.method==="POST"){
  if(loginLimit("login:"+getIp(req)))return fail(res,429,"Too many login attempts. Try again later.");
  const body=await readBody(req);
  const username=body?.username?.trim(),password=body?.password;
  if(!validUsername(username)||typeof password!=="string"||password.length>128)return fail(res,401,"Invalid username or password.");
  const found=await pool.query("SELECT id,username,password_hash,failed_attempts,locked_until FROM pb_users WHERE username_lower=$1",[normaliseUsername(username)]);
  const u=found.rows[0];
  if(!u){return fail(res,401,"Invalid username or password.");}
  if(u.locked_until&&new Date(u.locked_until).getTime()>Date.now())return fail(res,429,"Account temporarily locked due to failed attempts. Try again later.");
  const verified=await checkPassword(password,u.password_hash);
  if(!verified){
   await pool.query("UPDATE pb_users SET failed_attempts=failed_attempts+1,locked_until=CASE WHEN failed_attempts+1>=8 THEN now()+interval '15 minutes' ELSE locked_until END WHERE id=$1",[u.id]);
   return fail(res,401,"Invalid username or password.");
  }
  await pool.query("UPDATE pb_users SET failed_attempts=0,locked_until=NULL WHERE id=$1",[u.id]);
  await issueSession(u.id,res);
  return json(res,200,{user:publicUser(u)});
 }
 if(pathname==="/api/auth/me"&&req.method==="GET"){
  const user=await getAuthenticated(req);
  return json(res,200,{user:user?publicUser(user):null});
 }
 if(pathname==="/api/auth/logout"&&req.method==="POST"){
  const token=tokenFromCookie(req.headers.cookie);
  if(token)await pool.query("DELETE FROM pb_sessions WHERE token_hash=$1",[hashSession(token)]);
  res.setHeader("Set-Cookie",clearSessionCookie());
  return json(res,200,{ok:true});
 }
 if(pathname==="/api/cloud-save"&&(req.method==="GET"||req.method==="PUT")){
  const user=await getAuthenticated(req);
  if(!user)return fail(res,401,"Sign in before accessing cloud saves.");
  if(req.method==="GET"){
   const result=await pool.query("SELECT save_data,revision,updated_at FROM pb_saves WHERE user_id=$1",[user.id]);
   return json(res,200,result.rowCount?{data:result.rows[0].save_data,revision:result.rows[0].revision,updatedAt:result.rows[0].updated_at}:{data:null,revision:0,updatedAt:null});
  }
  const body=await readBody(req);
  if(!checkSaveRevision(body?.revision))return fail(res,400,"Invalid cloud save revision.");
  const problem=validateCloudSave(body.data);
  if(problem)return fail(res,400,problem);
  const committed=await persistCloudSave(user.id,body.revision,body.data);
  if(!committed)return fail(res,409,"Your cloud save changed on another device. Reload it before saving again.");
  return json(res,200,{revision:committed.revision,updatedAt:committed.updated_at});
 }

 if(pathname==="/api/cloud-save/history"&&req.method==="GET"){
  const user=await getAuthenticated(req);
  if(!user)return fail(res,401,"Sign in before viewing cloud save history.");
  const rows=await pool.query("SELECT revision,saved_at,save_data->>'stage' AS stage,save_data->>'bones' AS bones,save_data->>'wins' AS wins FROM pb_save_history WHERE user_id=$1 ORDER BY revision DESC LIMIT 10",[user.id]);
  return json(res,200,{history:rows.rows.map(r=>({revision:r.revision,savedAt:r.saved_at,stage:Number(r.stage)||1,bones:Number(r.bones)||0,wins:Number(r.wins)||0}))});
 }
 if(pathname==="/api/cloud-save/restore"&&req.method==="POST"){
  const user=await getAuthenticated(req);
  if(!user)return fail(res,401,"Sign in before restoring a cloud backup.");
  const body=await readBody(req);
  if(!checkSaveRevision(body?.revision)||!checkSaveRevision(body?.restoreRevision)||body.restoreRevision===0)return fail(res,400,"Invalid cloud recovery revision.");
  const found=await pool.query("SELECT save_data FROM pb_save_history WHERE user_id=$1 AND revision=$2",[user.id,body.restoreRevision]);
  if(!found.rowCount)return fail(res,404,"That cloud backup was not found.");
  const saved=found.rows[0].save_data;
  const problem=validateCloudSave(saved);
  if(problem)return fail(res,409,"That backup is not compatible with this game version.");
  const restored=await persistCloudSave(user.id,body.revision,saved);
  if(!restored)return fail(res,409,"Cloud progress changed on another device. Reload before recovering.");
  return json(res,200,{data:saved,revision:restored.revision,updatedAt:restored.updated_at});
 }
 return fail(res,404,"API route not found.");
}
function serveStatic(req,res,pathname){
 if(req.method!=="GET"&&req.method!=="HEAD")return fail(res,405,"Method not allowed.");
 let filename=decodeURIComponent(pathname);
 if(filename==="/")filename="/index.html";
 const resolved=path.resolve(publicDir,"."+filename);
 if(!resolved.startsWith(publicDir+path.sep))return fail(res,403,"Forbidden.");
 let file=resolved;
 if(!fs.existsSync(file)||!fs.statSync(file).isFile()){
  if(pathname.includes("."))return fail(res,404,"File not found.");
  file=path.join(publicDir,"index.html");
 }
 const type=contentTypes[path.extname(file).toLowerCase()]||"application/octet-stream";
 res.writeHead(200,{"Content-Type":type,"Cache-Control":path.basename(file)==="index.html"?"no-cache":"public, max-age=3600"});
 if(req.method==="HEAD")return res.end();
 fs.createReadStream(file).on("error",()=>res.destroy()).pipe(res);
}
const server=http.createServer(async(req,res)=>{
 secure(res);
 try{
  const url=new URL(req.url||"/","https://"+(req.headers.host||"localhost"));
  if(url.pathname.startsWith("/api/"))return await handleApi(req,res,url.pathname);
  return serveStatic(req,res,url.pathname);
 }catch(error){
  if(!res.headersSent){
   const status=error.status||500;
   if(status===500)console.error("Request failed:",error?.message);
   return fail(res,status,status===500?"Unexpected server error.":error.message);
  }
  res.end();
 }
});
server.listen(port,"0.0.0.0",()=>console.log("Primalbound cloud preview listening on "+port));
process.on("SIGTERM",async()=>{if(backupTimer)clearInterval(backupTimer);server.close();if(pool)await pool.end();});
