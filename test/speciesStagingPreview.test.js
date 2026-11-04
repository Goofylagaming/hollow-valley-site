const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.join(__dirname,'../public'),dir=path.join(root,'assets/skin-models/species-staging');
const catalog=JSON.parse(fs.readFileSync(path.join(dir,'catalog.json')));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
test('all 21 additional supplied species have distinct valid geometry and complete own texture references',()=>{
 assert.equal(catalog.species.length,21);assert.equal(new Set(catalog.species.map(s=>s.id)).size,21);assert.equal(catalog.published,false);
 for(const s of catalog.species){
  const b=fs.readFileSync(path.join(root,s.model));assert.equal(hash(b),s.modelSha256);assert.equal(b.readUInt32LE(0),0x46546c67);assert.equal(b.readUInt32LE(8),b.length);
  const json=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));let count=0;
  for(const m of json.meshes)for(const p of m.primitives){assert.ok(p.attributes.TEXCOORD_0!==undefined);assert.ok(p.attributes.NORMAL!==undefined);count+=json.accessors[p.indices].count/3;}
  assert.equal(count,s.triangles);assert.deepEqual(json.materials.map(m=>m.name),s.materials);assert.equal(s.verifiedInGame,false);
  for(const k of ['pattern','normal','surface','zones','detail-normal','iris','pupil'])assert.ok(fs.existsSync(path.join(root,s.maps[k])),s.name+' '+k);
 }
 assert.equal(new Set(catalog.species.map(s=>s.maps.pattern)).size,21,'never substitute the Rex pattern for another species');
});
test('staging texture hashes and dimensions match the conversion manifest',()=>{
 for(const t of Object.values(catalog.textures)){const b=fs.readFileSync(path.join(dir,t.file));assert.equal(hash(b),t.sha256);assert.equal(b.readUInt32BE(16),t.previewSize[0]);assert.equal(b.readUInt32BE(20),t.previewSize[1]);assert.ok(Math.max(...t.previewSize)<=2048);}
});
test('additional species previews cannot save, publish or invent unverified game codes',()=>{
 for(const file of ['species-skin-preview.js','species-staging-viewer.js']){const s=fs.readFileSync(path.join(root,'assets',file),'utf8');assert.doesNotMatch(s,/\/api\/|localStorage|sessionStorage|sendBeacon|XMLHttpRequest|gameCode\(/);}
 for(const file of ['skins.html','skin-studio/index.html'])assert.doesNotMatch(fs.readFileSync(path.join(root,file),'utf8'),/species-staging-viewer/);
});
