import * as THREE from 'three';
const colours=['body','markings','flank','underbelly','detail1','eyes','teeth','mouth','claws','maleDisplay'];
export async function installExtractedMaterial(root,species,renderer){
 const maps={},materials=[],sources=[];
 const uniforms=Object.fromEntries(colours.map(k=>['hv_'+k,{value:new THREE.Color(.3,.3,.3)}]));
 uniforms.hv_male={value:1};uniforms.hv_surfaceMode={value:0};uniforms.hv_pattern={value:null};
 const results=await Promise.allSettled(Object.entries(species.maps).map(async([name,url])=>{
  const t=await new THREE.TextureLoader().loadAsync(url);t.flipY=false;t.colorSpace=THREE.NoColorSpace;t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  if(name==='detail-normal')t.wrapS=t.wrapT=THREE.RepeatWrapping;maps[name]=t;
 }));
 const failure=results.find(r=>r.status==='rejected');if(failure){Object.values(maps).forEach(t=>t.dispose());throw failure.reason;}
 uniforms.hv_pattern.value=maps.pattern;
function bodyMaterial() {
  const material = new THREE.MeshStandardMaterial({color:'white',roughness:1,metalness:0,normalMap:maps.normal,normalScale:new THREE.Vector2(1,-1)});
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms, {
      hv_surface:{value:maps.surface},hv_zones:{value:maps.zones},hv_detailNormal:{value:maps['detail-normal']}
    });
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 hv_uv;').replace('#include <begin_vertex>','#include <begin_vertex>\nhv_uv=uv;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec2 hv_uv;
      uniform sampler2D hv_pattern,hv_surface,hv_zones,hv_detailNormal;
      uniform float hv_surfaceMode,hv_male;
      ${colours.map(k=>`uniform vec3 hv_${k};`).join('\n')}
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      vec3 mask=texture2D(hv_pattern,hv_uv).rgb;
      // RGB/CYM decomposition follows the extracted six-layer material naming.
      // Body/flank assignment corrected using the exported game palette and labelled swatches.
      float red=max(mask.r-max(mask.g,mask.b),0.0);
      float green=max(mask.g-max(mask.r,mask.b),0.0);
      float blue=max(mask.b-max(mask.r,mask.g),0.0);
      float cyan=max(min(mask.g,mask.b)-mask.r,0.0);
      float magenta=max(min(mask.r,mask.b)-mask.g,0.0);
      float yellow=max(min(mask.r,mask.g)-mask.b,0.0);
      float total=red+green+blue+cyan+magenta+yellow;
      vec3 pigment=(mix(hv_body,hv_maleDisplay,hv_male)*red+hv_underbelly*green+hv_flank*blue+hv_body*cyan+hv_markings*magenta+hv_detail1*yellow)/max(total,.001);
      pigment=mix(hv_body,pigment,step(.001,total));
      vec3 zones=texture2D(hv_zones,hv_uv).rgb;
      pigment=mix(pigment,hv_teeth,zones.r);
      pigment=mix(pigment,hv_mouth,zones.g);
      pigment=mix(pigment,hv_claws,zones.b);
      vec3 rac=texture2D(hv_surface,hv_uv).rgb;
      if(hv_surfaceMode>.5) pigment=vec3(.32);
      diffuseColor.rgb=pigment*rac.g;
    `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(texture2D(hv_surface,hv_uv).r,.18,1.0);');
    shader.fragmentShader=shader.fragmentShader.replace('#include <normal_fragment_maps>',`#ifdef USE_NORMALMAP_TANGENTSPACE
      vec3 baseN=texture2D(normalMap,vNormalMapUv).xyz*2.0-1.0;
      vec3 detailN=texture2D(hv_detailNormal,hv_uv*${Number(species.detailScale).toFixed(3)}).xyz*2.0-1.0;
      baseN=normalize(vec3(baseN.xy+detailN.xy*${Number(species.detailStrength).toFixed(3)},baseN.z*detailN.z));
      baseN.xy*=normalScale;
      normal=normalize(tbn*baseN);
      #endif`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <aomap_fragment>','#include <aomap_fragment>\nreflectedLight.indirectDiffuse*=texture2D(hv_surface,hv_uv).b;');
  };
  material.customProgramCacheKey=()=> 'hv-extracted-v1-'+species.id+'-'+species.detailScale+'-'+species.detailStrength;
  return material;
}

 root.traverse(child=>{
  if(!child.isMesh)return;
  const source=child.material;let material;
  if(/Eye/.test(source.name)){
      material=new THREE.MeshPhysicalMaterial({color:0xbca46b,roughness:.2,metalness:0,clearcoat:1,clearcoatRoughness:.12});material.userData.zone='eyes';
      material.onBeforeCompile=shader=>{
        shader.uniforms.hv_iris={value:maps.iris};shader.uniforms.hv_pupil={value:maps.pupil};
        shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 hv_eyeUV;').replace('#include <begin_vertex>','#include <begin_vertex>\nhv_eyeUV=uv;');
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 hv_eyeUV; uniform sampler2D hv_iris,hv_pupil;').replace('#include <color_fragment>',`#include <color_fragment>
          vec2 irisUV=(hv_eyeUV-.5)*2.0+.5;
          vec2 pupilUV=(hv_eyeUV-.5)*4.0+.5;
          float irisDetail=texture2D(hv_iris,clamp(irisUV,0.0,1.0)).r;
          float pupilMask=texture2D(hv_pupil,clamp(pupilUV,0.0,1.0)).r;
          diffuseColor.rgb*=mix(.25,1.0,irisDetail);
          diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.003),pupilMask);
        `);
      };

  }else material=bodyMaterial();
  material.name=source.name;materials.push(material);sources.push(source);child.material=material;
 });
 return {
  setPalette(palette){for(const k of colours){const hex=palette[k];if(/^#[0-9a-f]{6}$/i.test(hex||''))uniforms['hv_'+k].value.setRGB(...[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),THREE.LinearSRGBColorSpace);}for(const m of materials)if(m.userData.zone)m.color.copy(uniforms['hv_'+m.userData.zone].value);},
  setSex(sex){uniforms.hv_male.value=sex==='female'?0:1;},
  setPattern(index){uniforms.hv_pattern.value=maps[['pattern','pattern2','pattern3','pattern4','pattern5'][index]]||maps.pattern;},
  dispose(){Object.values(maps).forEach(t=>t.dispose());sources.forEach(m=>m.dispose());}
 };
}
export function fitExtractedCamera(THREE,root,camera,controls,id){
 const box=new THREE.Box3().setFromObject(root),target=box.getCenter(new THREE.Vector3());
 const direction=(id==='pteranodon'?new THREE.Vector3(1,3,6):new THREE.Vector3(-6.8,.6,3.05)).normalize();
 const right=new THREE.Vector3().crossVectors(camera.up,direction).normalize(),up=new THREE.Vector3().crossVectors(direction,right).normalize();
 const tanV=Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),tanH=tanV*camera.aspect;let distance=0;
 for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){const offset=new THREE.Vector3(x,y,z).sub(target);distance=Math.max(distance,offset.dot(direction)+Math.max(Math.abs(offset.dot(right))/tanH,Math.abs(offset.dot(up))/tanV));}
 distance*=1.12;camera.position.copy(target).addScaledVector(direction,distance);controls.target.copy(target);controls.minDistance=distance*.3;controls.maxDistance=distance*2.4;controls.update();
 return {position:camera.position.clone(),target:target.clone()};
}
