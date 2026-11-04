const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const dir=path.join(__dirname,'../public/assets/skin-models/rex-staging');
const b=fs.readFileSync(path.join(dir,'tyrannosaurus.glb'));
const n=b.readUInt32LE(12),json=JSON.parse(b.subarray(20,20+n));
const report=JSON.parse(fs.readFileSync(path.join(dir,'tyrannosaurus.json')));

test('staging Rex matches converted supplied asset and retains all geometry and UVs',()=>{
 assert.equal(b.readUInt32LE(0),0x46546c67);
 assert.equal(b.readUInt32LE(8),b.length);
 assert.equal(crypto.createHash('sha256').update(b).digest('hex'),report.converted_sha256);
 assert.equal(report.source_sha256,'47208def239a5c1cce66f4645a8e68a4cbed0360d901a5f368cf736296d7ab45');
 let triangles=0;
 for(const mesh of json.meshes)for(const p of mesh.primitives){
  assert.ok(p.attributes.TEXCOORD_0!==undefined);
  assert.ok(p.attributes.NORMAL!==undefined);
  triangles+=json.accessors[p.indices].count/3;
 }
 assert.equal(triangles,18800);
 assert.equal(report.triangles,triangles);
 assert.deepEqual(json.materials.map(m=>m.name),['MI_Tyrannosaurus_Body','MI_Tyrannosaurus_Eye','HV_Teeth']);
 assert.equal(json.images,undefined,'do not claim recovered game textures');
});

test('eye and tooth primitives stay inside their reviewed anatomical bounds',()=>{
 for(const mesh of json.meshes)for(const p of mesh.primitives){
  if(p.material===0)continue;
  const a=json.accessors[p.indices],v=json.bufferViews[a.bufferView];
  const pa=json.accessors[p.attributes.POSITION],pv=json.bufferViews[pa.bufferView];
  for(let i=0;i<a.count;i++){
   const id=b.readUInt16LE(28+n+(v.byteOffset||0)+(a.byteOffset||0)+i*2);
   const off=28+n+(pv.byteOffset||0)+(pa.byteOffset||0)+id*12;
   const y=b.readFloatLE(off+4),z=b.readFloatLE(off+8);
   assert.ok(z>3.8&&z<4.9);
   assert.ok(p.material===1 ? y>3.6&&y<3.8 : y>2.3&&y<3.2);
  }
 }
});

test('new renderer is isolated to the staging preview and cannot write skins',()=>{
 const viewer=fs.readFileSync(path.join(__dirname,'../public/assets/rex-staging-viewer.js'),'utf8');
 assert.doesNotMatch(viewer,/\/api\/|localStorage|sessionStorage|sendBeacon|XMLHttpRequest/);
 const preview=fs.readFileSync(path.join(__dirname,'../public/premium-skin-preview.html'),'utf8');
 assert.match(preview,/rex-staging-viewer\.js/);
 assert.doesNotMatch(preview,/src="\/assets\/skin-studio-viewer\.js/);
 for(const page of ['skins.html','skin-studio/index.html']){
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'../public',page),'utf8'),/rex-staging-viewer/);
 }
});

test('extracted staging textures match the recorded game build and retain usable resolution',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'game-materials.json')));
 assert.equal(manifest.gameBuild,'24664737');
 assert.equal(manifest.verifiedInGame,false);
 for(const [name,item] of Object.entries(manifest.textures)){
  const png=fs.readFileSync(path.join(dir,'textures',name+'.png'));
  assert.equal(crypto.createHash('sha256').update(png).digest('hex'),item.sha256);
  assert.equal(png.readUInt32BE(16),item.previewSize[0]);
  assert.equal(png.readUInt32BE(20),item.previewSize[1]);
  assert.ok(item.previewSize[0]>=512);
 }
 const viewer=fs.readFileSync(path.join(__dirname,'../public/assets/rex-staging-viewer.js'),'utf8');
 assert.match(viewer,/t\.flipY=false; t\.colorSpace=THREE\.NoColorSpace/);
 assert.match(viewer,/THREE\.LinearSRGBColorSpace/);
 assert.doesNotMatch(viewer,/hv_scales|hv_noise/);
});
