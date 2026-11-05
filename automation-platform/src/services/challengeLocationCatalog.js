"use strict";
const {createHash}=require('node:crypto');
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const identifier=value=>{if(typeof value!=='string'||! /^[a-z0-9][a-z0-9_.-]{0,79}$/.test(value))fail('Invalid location catalog identity');return value;};
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const on=(a,b,p)=>cross(a,b,p)===0&&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);
function intersects(a,b,c,d){const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);return (abC*abD<0&&cdA*cdB<0)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);}
function inside(polygon,point){
  const p=[point.x,point.y];let result=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[j],b=polygon[i];if(on(a,b,p))return true;
    if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])result=!result;
  }
  return result;
}
function validate(input){
  if(!input||input.units!=='unreal-centimetres')fail('Reviewed Unreal-centimetre map rules are required');
  const version=identifier(input.version),mapVersion=identifier(input.mapVersion),bounds={};
  for(const key of ['minX','maxX','minY','maxY']){const n=input.bounds?.[key];if(!Number.isSafeInteger(n)||Math.abs(n)>1e7)fail('Invalid reviewed map bounds');bounds[key]=n;}
  if(bounds.minX>=bounds.maxX||bounds.minY>=bounds.maxY)fail('Invalid reviewed map bounds');
  const polygon=input.highlands?.polygon;
  if(!Array.isArray(polygon)||polygon.length<3||polygon.length>100)fail('A reviewed Highlands polygon is required');
  const seen=new Set();
  for(const p of polygon){if(!Array.isArray(p)||p.length!==2||!p.every(Number.isSafeInteger)||p[0]<bounds.minX||p[0]>bounds.maxX||p[1]<bounds.minY||p[1]>bounds.maxY||seen.has(p.join(',')))fail('Invalid or repeated Highlands vertex');seen.add(p.join(','));}
  let area=0n;
  for(let i=0;i<polygon.length;i++){
    const a=polygon[i],b=polygon[(i+1)%polygon.length];area+=BigInt(a[0])*BigInt(b[1])-BigInt(b[0])*BigInt(a[1]);
    for(let j=i+1;j<polygon.length;j++){
      if(j===i+1||(i===0&&j===polygon.length-1))continue;
      if(intersects(a,b,polygon[j],polygon[(j+1)%polygon.length]))fail('Highlands polygon must not intersect itself');
    }
  }
  if(area===0n)fail('Highlands polygon must enclose an area');
  if(typeof input.reviewNote!=='string'||input.reviewNote.trim().length<20||input.reviewNote.length>2000||/[\x00-\x1f]/.test(input.reviewNote))fail('Map review evidence is required');
  return {version,mapVersion,units:'unreal-centimetres',bounds,highlands:{name:'Highlands',polygon:polygon.map(p=>[...p])},reviewNote:input.reviewNote.trim()};
}
function createChallengeLocationCatalog(db,{now=Date.now}={}){
  db.exec(`CREATE TABLE IF NOT EXISTS dc_location_catalogs(version TEXT PRIMARY KEY,digest TEXT NOT NULL,payload TEXT NOT NULL,reviewed_by TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS dc_location_active(id INTEGER PRIMARY KEY CHECK(id=1),version TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS dc_location_catalog_audit(id INTEGER PRIMARY KEY,version TEXT NOT NULL,digest TEXT NOT NULL,previous_version TEXT,actor TEXT NOT NULL,at INTEGER NOT NULL);`);
  const actor=id=>{if(typeof id!=='string'||!/^\d{17}$/.test(id))fail('A reviewing operator Steam identity is required');};
  function register(input,reviewedBy){actor(reviewedBy);const rules=validate(input),payload=JSON.stringify(rules),digest=createHash('sha256').update(payload).digest('hex');
    db.exec('BEGIN IMMEDIATE');try{const old=db.prepare('SELECT digest FROM dc_location_catalogs WHERE version=?').get(rules.version);if(old&&old.digest!==digest)fail('Catalog rules changed; use a new version',409);if(!old)db.prepare('INSERT INTO dc_location_catalogs VALUES (?,?,?,?,?)').run(rules.version,digest,payload,reviewedBy,now());db.exec('COMMIT');return {version:rules.version,digest,duplicate:Boolean(old)};}catch(error){db.exec('ROLLBACK');throw error;}}
  function get(version){identifier(version);const row=db.prepare('SELECT digest,payload FROM dc_location_catalogs WHERE version=?').get(version);return row?{...JSON.parse(row.payload),digest:row.digest}:null;}
  function active(){const row=db.prepare('SELECT version FROM dc_location_active WHERE id=1').get();return row?get(row.version):null;}
  function activate({version,digest,expectedVersion,actorSteamId}){actor(actorSteamId);identifier(version);if(expectedVersion!==null)identifier(expectedVersion);const rules=get(version);if(!rules||rules.digest!==digest)fail('Review the exact catalog digest before activation',409);
    db.exec('BEGIN IMMEDIATE');try{const previous=active()?.version||null;if(previous!==expectedVersion)fail('Active map rules changed; review again',409);if(previous!==version){db.prepare('INSERT INTO dc_location_active VALUES (1,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version').run(version);db.prepare('INSERT INTO dc_location_catalog_audit(version,digest,previous_version,actor,at) VALUES (?,?,?,?,?)').run(version,digest,previous,actorSteamId,now());}db.exec('COMMIT');return {version,digest,duplicate:previous===version};}catch(error){db.exec('ROLLBACK');throw error;}}
  return {register,get,active,activate};
}
module.exports={validate,inside,createChallengeLocationCatalog};
