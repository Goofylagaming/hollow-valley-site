"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const {createLegacyStore}=require('../automation-platform/src/services/valleyLegacyStore');
const {validate,inside}=require('../automation-platform/src/services/challengeLocationCatalog');
const A='76561198000000001',B='76561198000000002',OPERATOR='76561198000000003';
const rules=()=>({version:'synthetic-v1',mapVersion:'synthetic-map',units:'unreal-centimetres',bounds:{minX:-2000000,maxX:2000000,minY:-2000000,maxY:2000000},highlands:{polygon:[[-10000,-10000],[10000,-10000],[10000,10000],[-10000,10000]]},reviewNote:'Synthetic geometry for local tests only, never a production Highlands boundary.'});
function setup(t,date='2026-11-05T08:00:00+10:00'){
  const keys=['DYNAMIC_CHALLENGES_ENABLED','DYNAMIC_CHALLENGES_LOCATION_ENABLED','DYNAMIC_CHALLENGES_LOCATION_MAP_VERSION'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  Object.assign(process.env,{DYNAMIC_CHALLENGES_ENABLED:'1',DYNAMIC_CHALLENGES_LOCATION_ENABLED:'1',DYNAMIC_CHALLENGES_LOCATION_MAP_VERSION:'synthetic-map'});
  let time=Date.parse(date);const db=new DatabaseSync(':memory:'),s=createLegacyStore(db,{now:()=>time}),c=s.challenges,l=c.locations;
  c.change(A,{selected:true,expectedRevision:0,requestKey:randomUUID()});
  t.after(()=>{db.close();for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;});
  const activate=(input=rules())=>{const reg=l.catalogs.register(input,OPERATOR);l.catalogs.activate({version:reg.version,digest:reg.digest,expectedVersion:l.catalogs.active()?.version||null,actorSteamId:OPERATOR});return reg;};
  const consent=(selected=true)=>l.change(A,{selected,expectedRevision:l.status(A).revision,requestKey:randomUUID()});
  const snap=(x=0,y=0,species='rex')=>s.snapshot([{steamId:A,species,growth:0.5,location:x===null?null:{x,y}}],time);
  return {db,s,c,l,activate,consent,snap,advance:n=>time+=n,at:()=>time,status:()=>l.status(A)};
}
test('reviewed polygons reject unknown units, repeated vertices and intersecting or empty regions',()=>{
  const a=rules();assert.equal(validate(a).highlands.name,'Highlands');assert.equal(inside(a.highlands.polygon,{x:0,y:0}),true);assert.equal(inside(a.highlands.polygon,{x:10000,y:0}),true);assert.equal(inside(a.highlands.polygon,{x:10001,y:0}),false);
  for(const change of [{units:'metres'},{highlands:{polygon:[[0,0],[1,0],[0,0]]}},{highlands:{polygon:[[0,0],[100,100],[0,100],[100,0]]}},{highlands:{polygon:[[0,0],[1,0],[2,0]]}},{bounds:{...a.bounds,maxX:0}},{reviewNote:'unknown'}])assert.throws(()=>validate({...a,...change}));
});
test('catalogs are immutable and exact digest/revision review gates activation',t=>{
  const x=setup(t);assert.equal(x.status().available,false);const reg=x.activate();assert.equal(x.l.catalogs.register(rules(),OPERATOR).duplicate,true);
  assert.throws(()=>x.l.catalogs.register({...rules(),reviewNote:'Different reviewed geometry evidence'},OPERATOR),{status:409});
  assert.throws(()=>x.l.catalogs.activate({...reg,digest:'0'.repeat(64),expectedVersion:reg.version,actorSteamId:OPERATOR}),{status:409});
  assert.throws(()=>x.l.catalogs.activate({...reg,expectedVersion:null,actorSteamId:OPERATOR}),{status:409});
  assert.equal(x.db.prepare('SELECT count(*) n FROM dc_location_catalog_audit').get().n,1);
  const next=x.l.catalogs.register({...rules(),version:'synthetic-v2'},OPERATOR);
  x.db.exec("CREATE TRIGGER fail_map_audit BEFORE INSERT ON dc_location_catalog_audit BEGIN SELECT RAISE(ABORT,'map audit unavailable'); END");
  assert.throws(()=>x.l.catalogs.activate({...next,expectedVersion:reg.version,actorSteamId:OPERATOR}),/map audit unavailable/);
  assert.equal(x.l.catalogs.active().version,reg.version);x.db.exec('DROP TRIGGER fail_map_audit');
});
test('general challenge participation never implies location consent or reuses private routes',t=>{
  const x=setup(t);x.activate();x.advance(30000);x.snap();x.advance(30000);x.snap(100,100);
  assert.equal(x.status().enabled,false);assert.equal(x.db.prepare('SELECT count(*) n FROM dc_location_last').get().n,0);assert.equal(x.db.prepare('SELECT count(*) n FROM dc_location_receipts').get().n,0);
  assert.equal(x.db.prepare('SELECT count(*) n FROM journey_points').get().n,0);assert.equal(x.db.prepare('SELECT count(*) n FROM discovery_visits').get().n,0);
});
test('12 km uses connected accepted displacement and Highlands requires two inside observations',t=>{
  const x=setup(t);x.activate();x.consent();x.advance(30000);x.snap();assert.equal(x.status().highlandsVisited,false);
  x.advance(30000);x.snap(100,100);assert.equal(x.status().highlandsVisited,true);
  for(let n=1;n<=6;n++){x.advance(50000);x.snap(100+n*200000,100);}
  assert.equal(x.status().distanceMetres,12000);assert.equal(x.c.status(A).challenges.find(c=>c.id==='travel-12km').completed,true);
  const view=JSON.stringify(x.c.status(A));for(const secret of ['"x":','"y":','polygon','reviewNote',A])assert.equal(view.includes(secret),false);
});
test('life changes, missing positions, excessive gaps, impossible speed and bounds break travel continuity',t=>{
  for(const kind of ['life','position','gap','speed','bounds']){
    const x=setup(t);x.activate();x.consent();x.advance(30000);x.snap();
    x.advance(kind==='gap'?121000:30000);
    if(kind==='life')x.snap(100,100,'tenonto');
    if(kind==='position')x.snap(null);
    if(kind==='gap')x.snap(100,100);
    if(kind==='speed')x.snap(1000000,0);
    if(kind==='bounds')x.snap(2000001,0);
    assert.equal(x.status().distanceMetres,0,kind);assert.equal(x.status().highlandsVisited,false,kind);
  }
});
test('location opt-out erases raw position and receipts; stale requests cannot restore consent',t=>{
  const x=setup(t);x.activate();const choice={selected:true,expectedRevision:0,requestKey:randomUUID()};x.l.change(A,choice);
  x.advance(30000);x.snap();x.advance(30000);x.snap(100,100);assert.equal(x.status().highlandsVisited,true);
  x.consent(false);assert.equal(x.db.prepare('SELECT count(*) n FROM dc_location_last').get().n,0);assert.equal(x.db.prepare('SELECT count(*) n FROM dc_location_receipts').get().n,0);
  assert.equal(x.l.change(A,choice).enabled,false);assert.throws(()=>x.l.change(A,{...choice,requestKey:randomUUID()}),{status:409});
  x.consent();assert.equal(x.status().distanceMetres,0);assert.equal(x.status().highlandsVisited,false);
});
test('stopping general challenges erases location evidence and blocks delayed opt-in after rejoining',t=>{
  const x=setup(t);x.activate();const old={selected:true,expectedRevision:0,requestKey:randomUUID()};
  x.c.change(A,{selected:false,expectedRevision:1,requestKey:randomUUID()});
  x.c.change(A,{selected:true,expectedRevision:2,requestKey:randomUUID()});
  assert.throws(()=>x.l.change(A,old),{status:409});assert.equal(x.status().enabled,false);
});
test('tracking pause, map mismatch and catalog changes cannot join position pairs',t=>{
  const x=setup(t);x.activate();x.consent();x.advance(30000);x.snap();
  process.env.DYNAMIC_CHALLENGES_ENABLED='0';x.advance(30000);x.snap(100,100);
  process.env.DYNAMIC_CHALLENGES_ENABLED='1';x.advance(30000);x.snap(200,200);assert.equal(x.status().distanceMetres,0);
  process.env.DYNAMIC_CHALLENGES_LOCATION_MAP_VERSION='unknown';x.l.prune();assert.equal(x.status().available,false);
  process.env.DYNAMIC_CHALLENGES_LOCATION_MAP_VERSION='synthetic-map';x.advance(30000);x.snap(300,300);assert.equal(x.status().distanceMetres,0);
  x.activate({...rules(),version:'synthetic-v2'});x.advance(30000);x.snap(400,400);assert.equal(x.status().distanceMetres,0);assert.equal(x.status().highlandsVisited,false);
});
test('late deaths invalidate crossing displacement/visit receipts and opt-out prevents recreation',t=>{
  const x=setup(t);x.activate();x.consent();x.advance(30000);x.snap();const first=x.at();
  x.advance(30000);x.snap(100,100);assert.equal(x.status().highlandsVisited,true);
  x.s.ingest({id:'location-death',type:'combat_death',steamId:A,at:first+15000});assert.equal(x.status().distanceMetres,0);assert.equal(x.status().highlandsVisited,false);
  assert.equal(x.db.prepare('SELECT valid FROM dc_location_receipts').get().valid,0);x.consent(false);assert.equal(x.db.prepare('SELECT count(*) n FROM dc_location_receipts').get().n,0);
});
test('snapshot storage failure rolls back location collection with the enclosing accepted observation',t=>{
  const x=setup(t);x.activate();x.consent();x.advance(30000);x.snap();x.advance(30000);
  x.db.exec("CREATE TRIGGER fail_location BEFORE INSERT ON dc_location_receipts BEGIN SELECT RAISE(ABORT,'location evidence unavailable'); END");
  assert.throws(()=>x.snap(100,100),/location evidence unavailable/);assert.equal(x.db.prepare('SELECT at FROM dc_location_last').get().at,x.at()-30000);
  x.db.exec('DROP TRIGGER fail_location');x.snap(100,100);assert.equal(x.status().highlandsVisited,true);
});
test('raw coordinates expire independently during outages; retained receipts contain no route',t=>{
  const x=setup(t);x.activate();x.consent();x.advance(30000);x.snap();x.advance(30000);x.snap(100,100);
  x.advance(121000);x.l.prune();assert.equal(x.db.prepare('SELECT count(*) n FROM dc_location_last').get().n,0);
  const columns=x.db.prepare('PRAGMA table_info(dc_location_receipts)').all().map(c=>c.name);assert.equal(columns.includes('x'),false);assert.equal(columns.includes('y'),false);
  x.advance(36*86400000);x.l.prune();assert.equal(x.db.prepare('SELECT count(*) n FROM dc_location_receipts').get().n,0);
});
test('Brisbane rollover does not interpolate cross-midnight travel or visit credit',t=>{
  const x=setup(t,'2026-11-05T23:59:00+10:00');x.activate();x.consent();x.advance(30000);x.snap();
  x.advance(60000);x.snap(100,0);assert.equal(x.status().distanceMetres,0);assert.equal(x.status().highlandsVisited,false);
  x.advance(30000);x.snap(200,0);assert.equal(x.status().distanceMetres,1);assert.equal(x.status().highlandsVisited,true);
});
