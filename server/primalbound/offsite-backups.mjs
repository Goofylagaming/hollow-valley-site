import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createCipheriv,createDecipheriv,randomBytes,createHash} from "node:crypto";
import {DatabaseSync,backup} from "node:sqlite";

const hash=b=>createHash("sha256").update(b).digest("hex");
const MAX_LEGACY_BYTES=256*1024*1024;
const encrypt=(bytes,key)=>{
 const nonce=randomBytes(12);
 const cipher=createCipheriv("aes-256-gcm",key,nonce);
 const content=Buffer.concat([cipher.update(bytes),cipher.final()]);
 return Buffer.concat([Buffer.from("PB-BACKUP-V1\n"),nonce,cipher.getAuthTag(),content]);
};
const decrypt=(bytes,key)=>{
 if(!bytes.subarray(0,13).equals(Buffer.from("PB-BACKUP-V1\n")))throw Error("Invalid backup format");
 const nonce=bytes.subarray(13,25),tag=bytes.subarray(25,41),content=bytes.subarray(41);
 const cipher=createDecipheriv("aes-256-gcm",key,nonce);
 cipher.setAuthTag(tag);
 return Buffer.concat([cipher.update(content),cipher.final()]);
};
export function backupConfig(env=process.env){
 const required=["PRIMALBOUND_BACKUP_BUCKET","PRIMALBOUND_BACKUP_REGION","PRIMALBOUND_BACKUP_ACCESS_KEY","PRIMALBOUND_BACKUP_SECRET_KEY","PRIMALBOUND_BACKUP_KEY"];
 if(required.some(x=>!env[x]))return null;
 const key=Buffer.from(env.PRIMALBOUND_BACKUP_KEY,"base64");
 if(key.length!==32)throw Error("PRIMALBOUND_BACKUP_KEY must decode to 32 bytes");
 const endpoint=env.PRIMALBOUND_BACKUP_ENDPOINT||undefined;
 if(endpoint&&new URL(endpoint).protocol!=="https:")throw Error("Backup endpoint must use HTTPS");
 return {bucket:env.PRIMALBOUND_BACKUP_BUCKET,region:env.PRIMALBOUND_BACKUP_REGION,
  accessKeyId:env.PRIMALBOUND_BACKUP_ACCESS_KEY,secretAccessKey:env.PRIMALBOUND_BACKUP_SECRET_KEY,
  endpoint,key,prefix:env.PRIMALBOUND_BACKUP_PREFIX||"primalbound/sqlite"};
}
/** No backup credentials are logged or placed in the backup metadata file. */
export async function s3BackingStore(config){
 const {S3Client,PutObjectCommand,GetObjectCommand}=await import("@aws-sdk/client-s3");
 const s3=new S3Client({region:config.region,endpoint:config.endpoint,forcePathStyle:Boolean(config.endpoint),
  credentials:{accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey}});
 return {
  async put(key,data){await s3.send(new PutObjectCommand({Bucket:config.bucket,Key:key,Body:data,ContentType:"application/octet-stream",Metadata:{sha256:hash(data)}}));},
  async get(key){const obj=await s3.send(new GetObjectCommand({Bucket:config.bucket,Key:key}));return Buffer.from(await obj.Body.transformToByteArray());}
 };
}
function examineSqliteBytes(data,{requirePrimalbound=false}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"pb-restore-"));
 const file=path.join(dir,"restore.sqlite");
 try{
  fs.writeFileSync(file,data,{mode:0o600,flag:"wx"});
  const db=new DatabaseSync(file,{readOnly:true});
  try{
   const result=db.prepare("PRAGMA integrity_check").get();
   if(result?.integrity_check!=="ok")throw Error("Restored SQLite integrity check failed");
   if(requirePrimalbound&&db.prepare("SELECT value FROM pb_meta WHERE key='application'").get()?.value!=="primalbound-cloud-v1")
    throw Error("Restored backup has wrong Primalbound database marker");
  }finally{db.close();}
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
}
export async function encryptedVerifiedUpload(store,config,remoteKey,data,{sqlite=false}={}){
 if(!config?.key||!store?.put||!store?.get)throw Error("Off-site backup destination is missing");
 const beforeHash=hash(data);
 const ciphertext=encrypt(data,config.key);
 await store.put(remoteKey,ciphertext);
 const returned=await store.get(remoteKey);
 if(hash(returned)!==hash(ciphertext))throw Error("Off-site backup upload did not verify");
 const restored=decrypt(returned,config.key);
 if(hash(restored)!==beforeHash)throw Error("Off-site backup failed encrypted restore verification");
 if(sqlite)examineSqliteBytes(restored,{requirePrimalbound:true});
 return {remoteKey,sha256:beforeHash,bytes:data.length,verifiedAt:new Date().toISOString()};
}
export async function snapshotPrimalbound(pool,store,config){
 if(!pool?.raw||!pool?.filename)throw Error("No active Primalbound SQLite DB");
 const tmpDir=fs.mkdtempSync(path.join(os.tmpdir(),"pb-snapshot-"));
 const dest=path.join(tmpDir,"snapshot.sqlite");
 try{
  await backup(pool.raw,dest);
  const bytes=fs.readFileSync(dest);
  const objectKey=config.prefix+"/cloud/"+new Date().toISOString().replace(/[:.]/g,"-")+"-"+randomBytes(6).toString("hex")+".sqlite.aesgcm";
  return await encryptedVerifiedUpload(store,config,objectKey,bytes,{sqlite:true});
 }finally{fs.rmSync(tmpDir,{recursive:true,force:true})}
}
function legacyCandidates(root,primalboundDir){
 const found=[];
 const walk=(dir,depth)=>{
  if(depth>3)return;
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
   const name=path.join(dir,ent.name);
   if(name===primalboundDir||ent.isSymbolicLink())continue;
   if(ent.isDirectory()){walk(name,depth+1);continue;}
   if(!ent.isFile())continue;
   if(/\.(sqlite|sqlite3|db|db3|bak|backup|zip)$/i.test(ent.name)){
    if(fs.statSync(name).size>MAX_LEGACY_BYTES)throw Error("Legacy backup exceeds safe per-file size limit");
    found.push(name);
   }
  }
 };
 walk(root,0);
 return found;
}
/**
 * Back up every legacy SQLite or recovery artifact found outside the new PB dir.
 * All remote encrypted objects must be read back and checked before the site is repurposed.
 */
export async function preserveLegacyDisk(root,primalboundDir,store,config){
 if(!root||!path.isAbsolute(root))throw Error("Legacy disk must be an absolute path");
 const realRoot=fs.realpathSync(root),newDir=path.resolve(primalboundDir);
 if(!newDir.startsWith(realRoot+path.sep))throw Error("Primalbound storage must be a child of the paid disk");
 const marker=path.join(newDir,"legacy-backup-verified.json");
 if(fs.existsSync(marker)){
  const earlier=JSON.parse(fs.readFileSync(marker,"utf8"));
  if(!Array.isArray(earlier.files)||earlier.files.length===0)throw Error("Legacy backup marker is invalid");
  // Re-verify remote objects, not only the local marker.
  for(const entry of earlier.files){
   const remote=await store.get(entry.remoteKey);
   const recovered=decrypt(remote,config.key);
   if(hash(recovered)!==entry.sha256)throw Error("Legacy off-site backup failed verification");
  }
  return earlier;
 }
 const existing=legacyCandidates(realRoot,newDir);
 if(existing.length===0)throw Error("No legacy Hollow Valley database or recovery file detected; aborting repurpose");
 const files=[];
 for(const file of existing){
  const bytes=fs.readFileSync(file);
  const relative=path.relative(realRoot,file);
  const remoteKey=config.prefix+"/preserved-hollow-valley/"+relative.replace(/[^A-Za-z0-9_.\/-]/g,"_")+"-"+hash(bytes).slice(0,16)+".aesgcm";
  const receipt=await encryptedVerifiedUpload(store,config,remoteKey,bytes);
  files.push({relative,remoteKey,sha256:receipt.sha256,bytes:receipt.bytes});
 }
 fs.mkdirSync(newDir,{recursive:true,mode:0o700});
 const manifest={verifiedAt:new Date().toISOString(),files};
 fs.writeFileSync(marker,JSON.stringify(manifest),{mode:0o600,flag:"wx"});
 return manifest;
}
export function testDecrypt(encrypted,key){return decrypt(encrypted,key);}
