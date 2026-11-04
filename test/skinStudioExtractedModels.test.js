const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'../public');
test('all 22 supplied species override only preview models and preserve aliases',()=>{
 const context={window:{}};vm.createContext(context);
 for(const f of ['skin-studio-model-registry.js','skin-studio-extracted-registry.js'])vm.runInContext(fs.readFileSync(path.join(root,'assets',f),'utf8'),context);
 const entries=Object.values(context.window.HV_SKIN_MODELS).filter(s=>s.extracted);assert.equal(entries.length,22);
 for(const s of entries){assert.equal(s.capability,'extracted');assert.ok(fs.existsSync(path.join(root,s.loader.url)));for(const url of Object.values(s.extracted.maps))assert.ok(fs.existsSync(path.join(root,url)));}
 assert.ok(context.window.HV_SKIN_MODELS.tyrannosaurus.aliases.includes('rex'));
});
test('material palette updates are isolated, linear and never mutate skin data; resources dispose',async()=>{
 class Color{setRGB(...v){this.rgb=v;return this;}copy(c){this.rgb=c.rgb;return this;}}
 class Material{constructor(o){Object.assign(this,o);this.color=new Color();this.userData={};}dispose(){this.disposed=true;}}
 const textures=[];
 const THREE={Color,MeshStandardMaterial:Material,MeshPhysicalMaterial:Material,Vector2:class{},NoColorSpace:'data',LinearSRGBColorSpace:'linear',TextureLoader:class{async loadAsync(url){const t={url,dispose(){this.disposed=true;}};textures.push(t);return t;}}};
 const context={THREE,Promise};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'assets/skin-studio-extracted-material.js'),'utf8').replace(/^import [^\n]*\n/,'').replaceAll('export ',''),context);
 const make=()=>{const mesh={isMesh:true,material:{name:'Body',dispose(){}}};return {mesh,traverse:f=>f(mesh)};};
 const species={id:'test',detailScale:8,detailStrength:2,maps:{pattern:'p',pattern2:'p2',normal:'n',surface:'s',zones:'z','detail-normal':'d',iris:'i',pupil:'pupil'}};
 const a=make(),b=make(),renderer={capabilities:{getMaxAnisotropy:()=>8}};
 const ca=await context.installExtractedMaterial(a,species,renderer),cb=await context.installExtractedMaterial(b,species,renderer);
 const shader=()=>({uniforms:{},vertexShader:'#include <common>\n#include <begin_vertex>',fragmentShader:'#include <common>\n#include <color_fragment>'});
 const sa=shader(),sb=shader();a.mesh.material.onBeforeCompile(sa);b.mesh.material.onBeforeCompile(sb);
 const skin=Object.freeze({body:'#804020'});ca.setPalette(skin);ca.setPattern(1);assert.equal(sa.uniforms.hv_body.value.rgb[0],128/255);assert.equal(sb.uniforms.hv_body.value.rgb,undefined);assert.equal(sa.uniforms.hv_pattern.value.url,'p2');assert.equal(sb.uniforms.hv_pattern.value.url,'p');assert.equal(skin.body,'#804020');
 ca.dispose();cb.dispose();assert.ok(textures.every(t=>t.disposed));
});
test('shared loader has no write endpoints and both editors load it through preview adapters',()=>{
 const s=fs.readFileSync(path.join(root,'assets/skin-studio-extracted-material.js'),'utf8');assert.doesNotMatch(s,/\/api\/|localStorage|sessionStorage|sendBeacon/);
 for(const f of ['skins.html','skin-studio/index.html'])assert.match(fs.readFileSync(path.join(root,f),'utf8'),/skin-studio-extracted-registry/);
});
