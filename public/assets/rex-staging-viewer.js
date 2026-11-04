/* Staging-only supplied PSK Rex renderer. No skin API, save or game operations. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const $ = id => document.getElementById(id);
const canvas = $('hv-viewer-canvas');
const colours = ['body','markings','flank','underbelly','detail1','eyes','teeth','mouth','claws','maleDisplay'];
const uniforms = Object.fromEntries(colours.map(key => [`hv_${key}`, { value: new THREE.Color('#777766') }]));
uniforms.hv_male = { value: 1 };
uniforms.hv_surfaceMode = { value: 0 };
let latest = window.__HV_STUDIO_PREVIEW || {};
let scene, renderer, camera, controls, model, key, fill, rim, home;
let frame = 0, visible = true;
const materials = [];

// Extracted maps retain their original UV layout. Data maps must not undergo sRGB decoding.
const maps = {};
async function loadMaps() {
  const loader = new THREE.TextureLoader();
  await Promise.all(['pattern','normal','surface','zones','detail-normal','iris','pupil'].map(async name => {
    const t = await loader.loadAsync(`/assets/skin-models/rex-staging/textures/${name}.png?v=2`);
    t.flipY=false; t.colorSpace=THREE.NoColorSpace;
    t.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    if(name==='detail-normal') t.wrapS=t.wrapT=THREE.RepeatWrapping;
    maps[name]=t;
  }));
}
function bodyMaterial() {
  const material = new THREE.MeshStandardMaterial({color:'white',roughness:1,metalness:0,normalMap:maps.normal,normalScale:new THREE.Vector2(1,-1)});
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms, {
      hv_pattern:{value:maps.pattern},hv_surface:{value:maps.surface},hv_zones:{value:maps.zones},hv_detailNormal:{value:maps['detail-normal']}
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
      // Assignment to native skin fields remains pending a controlled in-game comparison.
      float red=max(mask.r-max(mask.g,mask.b),0.0);
      float green=max(mask.g-max(mask.r,mask.b),0.0);
      float blue=max(mask.b-max(mask.r,mask.g),0.0);
      float cyan=max(min(mask.g,mask.b)-mask.r,0.0);
      float magenta=max(min(mask.r,mask.b)-mask.g,0.0);
      float yellow=max(min(mask.r,mask.g)-mask.b,0.0);
      float total=red+green+blue+cyan+magenta+yellow;
      vec3 pigment=(mix(hv_body,hv_maleDisplay,hv_male)*red+hv_underbelly*green+hv_body*blue+hv_flank*cyan+hv_markings*magenta+hv_detail1*yellow)/max(total,.001);
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
      vec3 detailN=texture2D(hv_detailNormal,hv_uv*12.0).xyz*2.0-1.0;
      baseN=normalize(vec3(baseN.xy+detailN.xy*2.0,baseN.z*detailN.z));
      baseN.xy*=normalScale;
      normal=normalize(tbn*baseN);
      #endif`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <aomap_fragment>','#include <aomap_fragment>\nreflectedLight.indirectDiffuse*=texture2D(hv_surface,hv_uv).b;');
  };
  material.customProgramCacheKey=()=> 'hv-extracted-rex-v2';
  return material;
}

function applyPalette() {
  for(const k of colours) {
    const hex=latest.skin?.[k];
    if(/^#[0-9a-f]{6}$/i.test(hex||'')) uniforms[`hv_${k}`].value.setRGB(parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255,THREE.LinearSRGBColorSpace);
  }
  uniforms.hv_male.value=latest.sex==='female'?0:1;
  for(const material of materials) {
    if(material.userData.zone) material.color.copy(uniforms[`hv_${material.userData.zone}`].value);
  }
}

function lighting() {
  if(!key)return;
  const f=Math.max(.35,Math.min(1.8,Number($('hv-viewer-light').value)/100));
  key.intensity=2.4*f;fill.intensity=.55*f;rim.intensity=1.8*f;
}
function resize() {
  if(!renderer)return;
  const rect=canvas.parentElement.getBoundingClientRect();
  renderer.setSize(rect.width,rect.height,false);
  const oldAspect=camera.aspect;
  camera.aspect=rect.width/Math.max(1,rect.height);camera.updateProjectionMatrix();
  if(home && Math.abs(oldAspect-camera.aspect)>.01) fitCamera();
}
function fitCamera() {
  const target=new THREE.Vector3(0,1.32,.35);
  const distance=Math.max(7.6,6.8/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*camera.aspect)*1.12);
  const direction=new THREE.Vector3(6.8,.6,3.05).normalize();
  camera.position.copy(target).addScaledVector(direction,distance);
  controls.target.copy(target);controls.maxDistance=distance*2.4;controls.update();
  home={position:camera.position.clone(),target:target.clone()};
}
function animate() {
  frame=0;if(!visible||document.hidden)return;
  controls.update();renderer.render(scene,camera);frame=requestAnimationFrame(animate);
}
function resume(){if(!frame&&renderer)animate();}
async function init() {
  $('hv-viewer-status').textContent='Loading supplied T-rex…';
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.75));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  scene=new THREE.Scene();
  const pmrem=new THREE.PMREMGenerator(renderer), room=new RoomEnvironment();
  scene.environment=pmrem.fromScene(room,.025).texture;
  scene.environmentIntensity=.22;room.dispose();pmrem.dispose();
  camera=new THREE.PerspectiveCamera(32,1,.03,100);
  controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.enablePan=true;
  controls.minDistance=2;controls.maxDistance=18;controls.maxPolarAngle=Math.PI*.49;controls.autoRotateSpeed=.6;
  key=new THREE.DirectionalLight(0xfff1df,3.2);key.position.set(4,7,5);key.castShadow=true;
  key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-5,right:5,top:5,bottom:-5,near:.1,far:25});key.shadow.normalBias=.015;key.shadow.bias=-.0001;key.shadow.radius=3;
  fill=new THREE.DirectionalLight(0xdce8ff,.8);fill.position.set(-4,3,2);
  rim=new THREE.DirectionalLight(0xd9e6ff,2);rim.position.set(-3,5,-5);
  scene.add(key,fill,rim,new THREE.HemisphereLight(0xf1f3ec,0x323a32,.3));
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(100,100),new THREE.ShadowMaterial({color:0x030706,opacity:.24}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;floor.position.y=-.015;scene.add(floor);
  const gltf=await new GLTFLoader().loadAsync('/assets/skin-models/rex-staging/tyrannosaurus.glb?v=1');
  await loadMaps();
  model=gltf.scene;
  model.traverse(child=>{
    if(!child.isMesh)return;
    const source=child.material;
    let material;
    if(/Eye/.test(source.name)) {
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
    } else if(/Teeth/.test(source.name)) {
      material=bodyMaterial();
    } else material=bodyMaterial();
    material.name=source.name;materials.push(material);child.material=material;source.dispose();
    child.castShadow=true;child.receiveShadow=true;
  });
  const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3());
  const scale=7/Math.max(size.x,size.y,size.z);model.scale.setScalar(scale);
  model.position.y=-box.min.y*scale;model.position.z=-(box.min.z+box.max.z)*.5*scale;
  scene.add(model);resize();
  fitCamera();
  applyPalette();lighting();
  $('hv-viewer-empty').hidden=true;
  $('hv-viewer-status').textContent='T-rex - extracted game textures';
  $('hv-viewer-title').textContent='Your supplied Tyrannosaurus mesh';
  $('hv-viewer-detail').textContent='Original game pattern, normal and surface maps on your supplied mesh. Colour-layer assignment, sex behaviour and lighting still require an in-game comparison.';
  $('hv-viewer-credit').hidden=true;
  new ResizeObserver(resize).observe(canvas.parentElement);
  new IntersectionObserver(([e])=>{visible=e.isIntersecting;if(!visible&&frame){cancelAnimationFrame(frame);frame=0;}resume();}).observe(canvas);
  resume();
}
$('hv-viewer-reset').addEventListener('click',()=>{if(home){camera.position.copy(home.position);controls.target.copy(home.target);controls.update();}});
$('hv-viewer-rotate').addEventListener('click',()=>{if(controls){controls.autoRotate=!controls.autoRotate;$('hv-viewer-rotate').setAttribute('aria-pressed',String(controls.autoRotate));}});
$('hv-viewer-light').addEventListener('input',lighting);
$('premium-material-mode')?.addEventListener('change',e=>{uniforms.hv_surfaceMode.value=e.target.value==='clay'?1:0;});
document.addEventListener('hds:skin-preview-change',e=>{latest=e.detail||{};applyPalette();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&frame){cancelAnimationFrame(frame);frame=0;}resume();});
canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();if(frame)cancelAnimationFrame(frame);frame=0;visible=false;$('hv-viewer-status').textContent='Graphics paused — reload to restore the preview.';});
init().catch(error=>{$('hv-viewer-status').textContent='T-rex preview unavailable';$('hv-viewer-empty').hidden=false;$('hv-viewer-empty').textContent='Could not load the supplied T-rex. Reload to retry.';console.error(error);});
