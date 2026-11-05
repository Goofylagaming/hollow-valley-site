const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {validateCatalog,createDiscoveryCatalogStore}=require('../src/services/discoveryCatalog');
const fixture=()=>({version:'fixture-v1',mapVersion:'gateway-fixture',bounds:{minX:-100000,maxX:100000,minY:-100000,maxY:100000},regions:[{id:'north',name:'North'}],points:[{id:'cave-a',name:'Same cave name',category:'cave',regionId:'north',enabled:false,x:100,y:200,radiusMetres:50},{id:'cave-b',name:'Same cave name',category:'cave',regionId:'north',enabled:false,x:300,y:400,radiusMetres:50}]});
test('explicit catalog identities preserve separate same-named locations and reject invalid geometry',()=>{
  assert.equal(validateCatalog(fixture()).points.length,2);
  for(const mutate of [c=>c.points[1].id='cave-a',c=>c.points[0].radiusMetres=0,c=>c.points[0].x='100',c=>c.points[0].y=Infinity,c=>c.points[0].x=200000,c=>c.points[0].regionId='missing',c=>delete c.points[0].enabled,c=>c.bounds.maxX=c.bounds.minX,c=>c.regions.push({...c.regions[0]})]) {
    const c=fixture();mutate(c);assert.throws(()=>validateCatalog(c),{status:400});
  }
});
test('catalog versions are immutable, canonical retries survive reopening and new versions preserve old rules',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    let store=createDiscoveryCatalogStore(db);const original=fixture(),first=store.register(original);
    original.points.reverse();assert.equal(store.register(original).duplicate,true);
    store=createDiscoveryCatalogStore(db);const changed=fixture();changed.points[0].radiusMetres=75;
    assert.throws(()=>store.register(changed),{status:409});assert.equal(store.get('fixture-v1').points[0].radiusMetres,50);
    changed.version='fixture-v2';store.register(changed);assert.equal(store.get('fixture-v2').points[0].radiusMetres,75);
    assert.equal(store.register(fixture()).fingerprint,first.fingerprint);assert.equal(store.get('absent'),null);
  }finally{db.close();}
});
