const {createHash}=require('node:crypto');
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
const identifier=value=>{if(typeof value!=='string'||! /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value))fail('Invalid discovery identifier');return value;};
const label=value=>{if(typeof value!=='string'||!value.trim()||value.length>120||/[\x00-\x1f]/.test(value))fail('Invalid discovery label');return value.trim();};
function validateCatalog(input) {
  if(!input||typeof input!=='object')fail('Discovery catalog required');
  const version=identifier(input.version),mapVersion=input.mapVersion;
  if(typeof mapVersion!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(mapVersion))fail('Invalid discovery map version');
  const bounds={};
  for(const key of ['minX','maxX','minY','maxY']) {
    const value=input.bounds?.[key];
    if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e7)fail('Invalid discovery map bounds');bounds[key]=value;
  }
  if(bounds.minX>=bounds.maxX||bounds.minY>=bounds.maxY)fail('Invalid discovery map bounds');
  if(!Array.isArray(input.regions)||!input.regions.length||input.regions.length>100)fail('Discovery regions required');
  const regionIds=new Set();
  const regions=input.regions.map(r=>{const id=identifier(r?.id);if(regionIds.has(id))fail('Duplicate discovery region');regionIds.add(id);return {id,name:label(r.name)};}).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  if(!Array.isArray(input.points)||!input.points.length||input.points.length>500)fail('Discovery points required');
  const ids=new Set(),categories=new Set(['waterfall','cave','nesting_area','landmark','territory']);
  const points=input.points.map(p=>{
    const id=identifier(p?.id);if(ids.has(id))fail('Duplicate discovery point');ids.add(id);
    if(!categories.has(p.category)||!regionIds.has(p.regionId)||typeof p.enabled!=='boolean')fail('Invalid discovery category, region or enablement');
    const {x,y,radiusMetres}=p;
    if(![x,y,radiusMetres].every(v=>typeof v==='number'&&Number.isFinite(v))||x<bounds.minX||x>bounds.maxX||y<bounds.minY||y>bounds.maxY||radiusMetres<1||radiusMetres>500)fail('Invalid discovery visit area');
    // Explicit circular visit areas use raw Unreal centimetres. A display label
    // or a cave path is never implicitly converted into gameplay geometry.
    return {id,name:label(p.name),category:p.category,regionId:p.regionId,enabled:p.enabled,x,y,radiusMetres};
  }).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
  return {version,mapVersion,bounds,regions,points};
}
function createDiscoveryCatalogStore(db) {
  db.exec('CREATE TABLE IF NOT EXISTS discovery_catalogs(version TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,payload TEXT NOT NULL)');
  function register(input) {
    const catalog=validateCatalog(input),payload=JSON.stringify(catalog),fingerprint=createHash('sha256').update(payload).digest('hex');
    db.exec('BEGIN IMMEDIATE');
    try {
      const old=db.prepare('SELECT fingerprint FROM discovery_catalogs WHERE version=?').get(catalog.version);
      if(old&&old.fingerprint!==fingerprint)throw Object.assign(new Error('Catalog version already has different visit rules; use a new version'),{status:409});
      if(!old)db.prepare('INSERT INTO discovery_catalogs VALUES (?,?,?)').run(catalog.version,fingerprint,payload);
      db.exec('COMMIT');return {version:catalog.version,fingerprint,duplicate:Boolean(old)};
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function get(version){identifier(version);const row=db.prepare('SELECT payload FROM discovery_catalogs WHERE version=?').get(version);return row?JSON.parse(row.payload):null;}
  return {register,get};
}
module.exports={validateCatalog,createDiscoveryCatalogStore};
