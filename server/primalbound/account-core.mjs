import {randomBytes,randomUUID,scrypt as cryptoScrypt,timingSafeEqual,createHash} from "node:crypto";
import {promisify} from "node:util";
const scrypt=promisify(cryptoScrypt);
export const USERNAME_PATTERN=/^[A-Za-z][A-Za-z0-9_]{2,23}$/;
export const SESSION_SECONDS=14*24*60*60;
export const MAX_SAVE_BYTES=250_000;
export const ACCOUNT_COOKIE="__Host-primalbound_session";
export const ALLOWED_SAVE_VERSION=7;
export function validUsername(value){return typeof value==="string"&&USERNAME_PATTERN.test(value);}
export function validPassword(value){
 if(typeof value!=="string"||value.length<12||value.length>128)return false;
 return !["password123456","123456789012","qwerty123456","letmein123456","primalbound123"].includes(value.toLowerCase());
}
export function normaliseUsername(name){return name.toLowerCase();}
export function newUserId(){return randomUUID();}
export async function hashPassword(password){
 if(!validPassword(password))throw new Error("Password must be 12–128 characters, and not common.");
 const salt=randomBytes(16).toString("hex");
 const key=await scrypt(password,Buffer.from(salt,"hex"),64,{N:16384,r:8,p:1,maxmem:32*1024*1024});
 return "scrypt$16384$8$1$"+salt+"$"+Buffer.from(key).toString("hex");
}
export async function checkPassword(password,stored){
 if(typeof password!=="string"||typeof stored!=="string")return false;
 const parts=stored.split("$");
 if(parts.length!==6||parts[0]!=="scrypt")return false;
 const [_,n,r,p,salt,expected]=parts;
 if(!/^([0-9a-f]{32})$/.test(salt)||!/^([0-9a-f]{128})$/.test(expected))return false;
 const key=await scrypt(password,Buffer.from(salt,"hex"),64,{N:Number(n),r:Number(r),p:Number(p),maxmem:32*1024*1024});
 return timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(key));
}
export function newSessionToken(){return randomBytes(32).toString("base64url");}
export function hashSession(token){return createHash("sha256").update(token).digest("hex");}
export function setSessionCookie(token){
 return ACCOUNT_COOKIE+"="+encodeURIComponent(token)+"; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age="+SESSION_SECONDS;
}
export function clearSessionCookie(){
 return ACCOUNT_COOKIE+"=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}
export function tokenFromCookie(raw){
 if(typeof raw!=="string")return null;
 const prefix=ACCOUNT_COOKIE+"=";
 const entry=raw.split(";").map(x=>x.trim()).find(x=>x.startsWith(prefix));
 if(!entry)return null;
 const token=entry.slice(prefix.length);
 return /^[A-Za-z0-9_-]{43}$/.test(token)?token:null;
}
export function safeOrigin(origin,host){
 if(typeof origin!=="string"||typeof host!=="string")return false;
 return origin==="https://"+host.toLowerCase();
}
export function validateCloudSave(save,expectedVersion=ALLOWED_SAVE_VERSION){
 if(!save||typeof save!=="object"||Array.isArray(save))return "Save must be a JSON object.";
 if(save.version>expectedVersion)return "Newer save version is not supported by this server.";
 if(!Number.isFinite(save.stage)||save.stage<1||save.stage>751)return "Invalid campaign stage.";
 if(!Array.isArray(save.dinos)||save.dinos.length<49||save.dinos.length>69)return "Invalid dinosaur roster.";
 if(!Array.isArray(save.active)||save.active.length<1||save.active.length>3)return "Invalid battle party.";
 if(!save.inventory||typeof save.inventory!=="object")return "Missing inventory.";
 if(!save.hatchery||typeof save.hatchery!=="object")return "Missing hatchery data.";
 if(typeof save.bones!=="number"||!Number.isFinite(save.bones)||save.bones<0)return "Invalid Bones balance.";
 const serialized=JSON.stringify(save);
 if(Buffer.byteLength(serialized,"utf8")>MAX_SAVE_BYTES)return "Cloud save exceeds 250 KB.";
 return null;
}
export function parseJsonPayload(raw){
 if(Buffer.byteLength(raw,"utf8")>MAX_SAVE_BYTES+10_000)throw Object.assign(new Error("Request too large"),{status:413});
 try{return JSON.parse(raw);}catch{throw Object.assign(new Error("Invalid JSON"),{status:400});}
}
export function checkSaveRevision(revision){
 return Number.isInteger(revision)&&revision>=0&&revision<2147483647;
}
export function rateLimit(max=12,windowMs=10*60*1000){
 const counts=new Map();
 return (key,now=Date.now())=>{
  if(counts.size>5000){for(const [k,v] of counts)if(v.reset<=now)counts.delete(k);}
  const v=counts.get(key);
  if(!v||v.reset<=now){counts.set(key,{count:1,reset:now+windowMs});return false;}
  v.count++;
  return v.count>max;
 };
}
