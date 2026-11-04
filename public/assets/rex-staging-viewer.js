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

const surfaceGLSL = `
varying vec3 hv_position;
varying vec3 hv_normal;
uniform float hv_male;
uniform float hv_surfaceMode;
${colours.map(k => `uniform vec3 hv_${k};`).join('\n')}
vec3 hv_hash(vec3 p) {
  p = vec3(dot(p,vec3(127.1,311.7,74.7)),dot(p,vec3(269.5,183.3,246.1)),dot(p,vec3(113.5,271.9,124.6)));
  return fract(sin(p)*43758.5453);
}
float hv_noise(vec3 p) {
  vec3 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hv_hash(i).x,hv_hash(i+vec3(1,0,0)).x,f.x),mix(hv_hash(i+vec3(0,1,0)).x,hv_hash(i+vec3(1,1,0)).x,f.x),f.y),mix(mix(hv_hash(i+vec3(0,0,1)).x,hv_hash(i+vec3(1,0,1)).x,f.x),mix(hv_hash(i+vec3(0,1,1)).x,hv_hash(i+vec3(1,1,1)).x,f.x),f.y),f.z);
}
// Continuous object-space cells: scale relief crosses UV seams without a painted grid.
float hv_scales(vec3 p) {
  vec3 i=floor(p),f=fract(p);float first=8.0,second=8.0;
  for(int z=-1;z<=1;z++)for(int y=-1;y<=1;y++)for(int x=-1;x<=1;x++) {
    vec3 o=vec3(float(x),float(y),float(z));
    vec3 r=o+0.25+0.5*hv_hash(i+o)-f;
    float d=dot(r,r);
    if(d<first){second=first;first=d;}else{second=min(second,d);}
  }
  float edge=second-first;
  float aa=max(fwidth(edge),0.015);
  return smoothstep(0.015-aa,0.16+aa,edge);
}
`;

function bodyMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: 'white', roughness: .84, metalness: 0 });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 hv_position; varying vec3 hv_normal;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nhv_position=position; hv_normal=normal;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n'+surfaceGLSL);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 p=hv_position,n=normalize(hv_normal);
      float head=smoothstep(2.2,3.5,p.z);
      float belly=(1.0-smoothstep(-0.55,0.12,n.y))*smoothstep(0.65,1.5,p.y);
      float flank=smoothstep(0.25,0.8,abs(n.x))*(1.0-belly)*0.65;
      vec3 pigment=mix(hv_body,hv_flank,flank);
      pigment=mix(pigment,hv_underbelly,belly*0.85);
      float broad=hv_noise(p*2.8);
      float stripes=sin(p.z*5.4+p.y*2.2+hv_noise(p*1.7)*3.8);
      float marking=smoothstep(0.35,0.85,stripes)*(1.0-belly)*mix(.32,.12,head);
      pigment=mix(pigment,hv_markings,marking);
      float dorsal=smoothstep(.45,.85,n.y)*(1.0-smoothstep(.12,.40,abs(p.x)));
      pigment=mix(pigment,hv_detail1,dorsal*.38);
      float crest=smoothstep(3.65,4.05,p.y)*head;
      pigment=mix(pigment,hv_maleDisplay,crest*hv_male*.6);
      float claws=(1.0-smoothstep(.07,.23,p.y))*smoothstep(.1,.4,p.z);
      pigment=mix(pigment,hv_claws,claws);
      // Inward-facing jaw surfaces: local cross-section, not a UV mask from another mesh.
      float inside=(1.0-smoothstep(.07,.16,abs(p.x)))*head*(1.0-smoothstep(3.0,3.25,p.y))*smoothstep(2.3,2.5,p.y);
      inside*=smoothstep(.05,.25,-n.x*sign(p.x));
      pigment=mix(pigment,hv_mouth,inside*.9);
      float frequency=mix(32.0,65.0,head);
      float scales=hv_scales(p*frequency);
      float micro=hv_noise(p*160.0);
      float relief=mix(.82,1.04,scales)*mix(.94,1.03,micro);
      pigment*=relief*mix(.88,1.10,broad);
      if(hv_surfaceMode>0.5) pigment=vec3(.32)*relief;
      diffuseColor.rgb=pigment;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      // Subtle derived relief. Geometry and native normals remain unchanged.
      float height=hv_scales(hv_position*mix(48.0,85.0,smoothstep(2.2,3.5,hv_position.z)))*0.0012;
      vec3 q0=dFdx(-vViewPosition), q1=dFdy(-vViewPosition);
      vec3 r1=cross(q1,normal),r2=cross(normal,q0);
      float det=dot(q0,r1);
      vec3 grad=sign(det)*(dFdx(height)*r1+dFdy(height)*r2);
      normal=normalize(abs(det)*normal-grad);
    `);
  };
  material.customProgramCacheKey = () => 'hv-supplied-rex-staging-surface-v1';
  return material;
}

function applyPalette() {
  for(const k of colours) {
    const hex=latest.skin?.[k];
    if(/^#[0-9a-f]{6}$/i.test(hex||'')) uniforms[`hv_${k}`].value.set(hex);
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
  model=gltf.scene;
  model.traverse(child=>{
    if(!child.isMesh)return;
    const source=child.material;
    let material;
    if(/Eye/.test(source.name)) {
      material=new THREE.MeshPhysicalMaterial({color:0xbca46b,roughness:.2,metalness:0,clearcoat:1,clearcoatRoughness:.12});material.userData.zone='eyes';
      material.onBeforeCompile=shader=>{
        shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 hv_eyePosition;').replace('#include <begin_vertex>','#include <begin_vertex>\nhv_eyePosition=position;');
        shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 hv_eyePosition;').replace('#include <color_fragment>','#include <color_fragment>\nfloat pupil=1.0-smoothstep(.85,1.05,length((hv_eyePosition.yz-vec2(3.670,3.882))/vec2(.020,.019))); diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.003),pupil);');
      };
    } else if(/Teeth/.test(source.name)) {
      material=new THREE.MeshStandardMaterial({color:0xd0c5ac,roughness:.43,metalness:0});material.userData.zone='teeth';
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
  $('hv-viewer-status').textContent='Supplied T-rex · detailed studio material';
  $('hv-viewer-title').textContent='Your supplied Tyrannosaurus mesh';
  $('hv-viewer-detail').textContent='Original mesh and UVs. Preview-authored scale relief and anatomical colour regions; game textures were not supplied. In-game pattern matching remains unverified.';
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
