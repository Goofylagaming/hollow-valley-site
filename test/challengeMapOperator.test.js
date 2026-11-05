"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite'),{randomUUID}=require('node:crypto');
const {main}=require('../scripts/review-challenge-map.cjs');
const {createLegacyStore}=require('../automation-platform/src/services/valleyLegacyStore');
const ACTOR='76561198000000001';
function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hv-map-operator-')),database=path.join(dir,'automation.sqlite'),file=path.join(dir,'rules.json');
  const rules={version:'synthetic-v1',mapVersion:'synthetic-map',units:'unreal-centimetres',bounds:{minX:-200000,maxX:200000,minY:-200000,maxY:200000},highlands:{polygon:[[-10000,-10000],[10000,-10000],[10000,10000],[-10000,10000]]},reviewNote:'Synthetic local review only <img src=x>; not real Highlands geometry.'};
  fs.writeFileSync(file,JSON.stringify(rules));const db=new DatabaseSync(database);db.exec('PRAGMA journal_mode=WAL');
  let clock=Date.parse('2026-11-05T08:00:00+10:00');const s=createLegacyStore(db,{now:()=>clock});
  db.exec('CREATE TABLE operator_test_wallet(balance INTEGER); INSERT INTO operator_test_wallet VALUES (1234)');
  t.after(()=>{db.close();const target=path.resolve(dir);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('hv-map-operator-'));fs.rmSync(target,{recursive:true,force:true});});
  const reviewed=()=>main(['review','--file',file]);
  const stage=(write=false)=>main(['stage','--file',file,'--database',database,'--reviewer',ACTOR,'--digest',reviewed().digest,...(write?['--write']:[])]);
  const activate=(write=false,expected='none')=>main(['activate','--database',database,'--version',rules.version,'--digest',reviewed().digest,'--active-version',expected,'--reviewer',ACTOR,...(write?['--write']:[])]);
  const deactivate=(write=false)=>main(['deactivate','--database',database,'--version',rules.version,'--digest',reviewed().digest,'--reviewer',ACTOR,...(write?['--write']:[])]);
  return {dir,database,file,rules,db,s,reviewed,stage,activate,deactivate,advance:n=>clock+=n,at:()=>clock};
}
test('review produces an escaped offline artifact without opening a database or overwriting files',t=>{
  const x=setup(t),artifact=path.join(x.dir,'review.html');const result=main(['review','--file',x.file,'--preview',artifact]);
  assert.equal(result.databaseOpened,false);assert.equal(result.activated,false);
  const html=fs.readFileSync(artifact,'utf8');assert.match(html,/&lt;img src=x&gt;/);assert.equal(html.includes('<img src=x>'),false);assert.match(html,/default-src 'none'/);assert.match(html,/Raw X increases right/);assert.match(html,new RegExp(result.digest));
  assert.throws(()=>main(['review','--file',x.file,'--preview',artifact]),/EEXIST/);
  assert.throws(()=>main(['review','--file',x.file,'--preview',x.file]),/separate new/);
  assert.equal(x.db.prepare('SELECT count(*) n FROM dc_location_catalogs').get().n,0);
  fs.writeFileSync(x.file,'\uFEFF'+JSON.stringify(x.rules));assert.equal(x.reviewed().digest,result.digest);
});
test('stage and activation require explicit writes, reviewed digests and an exact active version',t=>{
  const x=setup(t);assert.equal(x.stage().written,false);assert.equal(x.db.prepare('SELECT count(*) n FROM dc_location_catalogs').get().n,0);
  x.stage(true);assert.equal(x.s.challenges.locations.catalogs.active(),null);assert.equal(x.activate().written,false);assert.equal(x.s.challenges.locations.catalogs.active(),null);
  x.activate(true);assert.equal(x.s.challenges.locations.catalogs.active().version,x.rules.version);
  assert.throws(()=>x.activate(true),/Active map version changed/);
  assert.equal(x.activate(true,x.rules.version).duplicate,true);assert.equal(x.db.prepare('SELECT count(*) n FROM dc_location_catalog_audit').get().n,1);
  assert.equal(x.db.prepare('SELECT balance FROM operator_test_wallet').get().balance,1234);
});
test('read-only inspection preserves schema and refuses missing or unrelated databases',t=>{
  const x=setup(t);x.stage(true);
  x.db.exec('DROP TABLE dc_location_catalog_audit; CREATE TABLE dc_location_catalog_audit(id INTEGER PRIMARY KEY,version TEXT NOT NULL,digest TEXT NOT NULL,previous_version TEXT,actor TEXT NOT NULL,at INTEGER NOT NULL)');
  const schema=JSON.stringify(x.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all());
  const inspected=main(['inspect','--database',x.database,'--version',x.rules.version]);assert.equal(inspected.written,false);assert.equal(inspected.selected.digest,x.reviewed().digest);
  assert.equal(JSON.stringify(x.db.prepare('SELECT type,name,sql FROM sqlite_master ORDER BY name').all()),schema);
  const missing=path.join(x.dir,'typo.sqlite');assert.throws(()=>main(['inspect','--database',missing]),/ENOENT/);assert.equal(fs.existsSync(missing),false);
  const otherFile=path.join(x.dir,'unrelated.sqlite'),other=new DatabaseSync(otherFile);other.exec('CREATE TABLE keep(value INTEGER); INSERT INTO keep VALUES (7)');other.close();
  assert.throws(()=>main(['stage','--file',x.file,'--database',otherFile,'--reviewer',ACTOR,'--digest',x.reviewed().digest,'--write']),/not an initialized/);
  const verify=new DatabaseSync(otherFile,{readOnly:true});try{assert.deepEqual(verify.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name),['keep']);assert.equal(verify.prepare('SELECT value FROM keep').get().value,7);}finally{verify.close();}
});
test('changed input, unknown options and duplicate write flags fail before changing catalog state',t=>{
  const x=setup(t),digest=x.reviewed().digest;
  fs.writeFileSync(x.file,JSON.stringify({...x.rules,reviewNote:'Changed geometry review evidence after the review'}));
  assert.throws(()=>main(['stage','--file',x.file,'--database',x.database,'--reviewer',ACTOR,'--digest',digest,'--write']),/changed after review/);
  assert.throws(()=>main(['review','--file',x.file,'--write']),/allowed once/);
  assert.throws(()=>main(['stage','--file',x.file,'--write','--write']),/allowed once/);
  assert.throws(()=>main(['inspect','--database',x.database,'--extra','oops']),/Unknown/);
  assert.equal(x.db.prepare('SELECT count(*) n FROM dc_location_catalogs').get().n,0);
});
test('deactivation is audited and an unobserved stop/restart cannot reuse a position baseline',t=>{
  const x=setup(t),keys=['DYNAMIC_CHALLENGES_ENABLED','DYNAMIC_CHALLENGES_LOCATION_ENABLED','DYNAMIC_CHALLENGES_LOCATION_MAP_VERSION'],saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  Object.assign(process.env,{DYNAMIC_CHALLENGES_ENABLED:'1',DYNAMIC_CHALLENGES_LOCATION_ENABLED:'1',DYNAMIC_CHALLENGES_LOCATION_MAP_VERSION:'synthetic-map'});
  t.after(()=>{for(const[k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;});
  x.stage(true);x.activate(true);x.s.challenges.change(ACTOR,{selected:true,expectedRevision:0,requestKey:randomUUID()});x.s.challenges.locations.change(ACTOR,{selected:true,expectedRevision:0,requestKey:randomUUID()});
  const snap=()=>x.s.snapshot([{steamId:ACTOR,species:'rex',growth:0.5,location:{x:0,y:0}}],x.at());
  x.advance(30000);snap();assert.equal(x.db.prepare('SELECT count(*) n FROM dc_location_last').get().n,1);
  assert.equal(x.deactivate().written,false);assert.equal(x.db.prepare('SELECT count(*) n FROM dc_location_last').get().n,1);
  x.deactivate(true);assert.equal(x.s.challenges.locations.catalogs.active(),null);assert.equal(x.db.prepare('SELECT count(*) n FROM dc_location_last').get().n,0);
  x.activate(true);x.advance(30000);snap();assert.equal(x.s.challenges.locations.status(ACTOR).highlandsVisited,false);
  assert.deepEqual(x.db.prepare('SELECT action FROM dc_location_catalog_audit ORDER BY id').all().map(r=>r.action),['activate','deactivate','activate']);
});
test('catalog integrity failure blocks inspection and collection but exact deactivation remains possible',t=>{
  const x=setup(t);x.stage(true);x.activate(true);
  x.db.prepare('UPDATE dc_location_catalogs SET payload=?').run(JSON.stringify({...x.rules,reviewNote:'Unexpected altered saved map rules'}));
  assert.throws(()=>main(['inspect','--database',x.database,'--version',x.rules.version]),/integrity/);
  assert.throws(()=>x.s.challenges.locations.catalogs.active(),/integrity/);
  x.deactivate(true);assert.equal(x.s.challenges.locations.catalogs.active(),null);
});
test('adding explicit audit actions preserves older activation history without rewriting its rows',t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec("CREATE TABLE dc_location_catalog_audit(id INTEGER PRIMARY KEY,version TEXT NOT NULL,digest TEXT NOT NULL,previous_version TEXT,actor TEXT NOT NULL,at INTEGER NOT NULL); INSERT INTO dc_location_catalog_audit VALUES (1,'old-version','old-digest',NULL,'old-actor',123)");
  require('../automation-platform/src/services/challengeLocationCatalog').createChallengeLocationCatalog(db);
  assert.deepEqual({...db.prepare('SELECT * FROM dc_location_catalog_audit').get()},{id:1,version:'old-version',digest:'old-digest',previous_version:null,actor:'old-actor',at:123,action:'activate'});
});
