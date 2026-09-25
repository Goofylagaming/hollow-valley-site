import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const canvas = document.getElementById("skin-model-canvas");
const stage = document.getElementById("skin-preview-stage");
const loaderEl = document.getElementById("skin-model-loader");
const statusEl = document.getElementById("skin-model-status");
const statusDot = document.getElementById("skin-model-status-dot");
const lightInput = document.getElementById("skin-model-light");
const resetButton = document.getElementById("skin-model-reset");
const zoneStrip = document.getElementById("skin-model-zone-strip");
const maskData = window.HV_REX_MASK_RLE;

if (!canvas || !stage) throw new Error("Skin Studio 3D stage is missing");

const CHUNK_COUNT = 22;
const CHUNK_ROOT = "/assets/skin-models/tyrannosaurus/chunks";
const FALLBACKS = Object.freeze({
  body: "#6f7652",
  markings: "#232713",
  flank: "#59613d",
  underbelly: "#b7ae8d",
  detail1: "#9c7b46",
  eyes: "#b7ff35",
  teeth: "#ded6b8",
  mouth: "#6d2e34",
  claws: "#28251e",
  maleDisplay: "#a6732b",
});

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x06110d, 0.035);

const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 100);
camera.position.set(9.5, 2.5, 0.8);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.enablePan = false;
controls.minDistance = 4.5;
controls.maxDistance = 18;
controls.minPolarAngle = Math.PI * 0.13;
controls.maxPolarAngle = Math.PI * 0.82;
controls.autoRotate = false;

const hemi = new THREE.HemisphereLight(0xc6e9d4, 0x07100c, 1.05);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xffedd2, 3.5);
key.position.set(6, 8, 5);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
scene.add(key);

const rim = new THREE.DirectionalLight(0x5cffad, 1.6);
rim.position.set(-7, 5, -6);
scene.add(rim);

const fill = new THREE.DirectionalLight(0x8eb2c4, 0.65);
fill.position.set(4, 2, -8);
scene.add(fill);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(10, 72),
  new THREE.MeshStandardMaterial({ color: 0x07110d, roughness: 0.95, metalness: 0.01, transparent: true, opacity: 0.72 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

let model = null;
let homeCamera = null;
let shaderControllers = [];
let maskAtlases = [];
let currentPalette = { ...FALLBACKS };

function setStatus(ok, message) {
  if (loaderEl) loaderEl.hidden = ok;
  if (statusEl) statusEl.textContent = message;
  statusDot?.classList.toggle("ready", ok);
}

function paletteFromEditor() {
  const get = (key) => document.getElementById("skin-color-" + key)?.value || FALLBACKS[key];
  return {
    body: get("body"), markings: get("markings"), flank: get("flank"), underbelly: get("underbelly"),
    detail1: get("detail1"), eyes: get("eyes"), teeth: get("teeth"), mouth: get("mouth"),
    claws: get("claws"), maleDisplay: get("maleDisplay"),
  };
}

function unpackZone(zoneName, target, channel) {
  const runs = maskData?.zones?.[zoneName];
  if (!Array.isArray(runs)) return;
  const total = maskData.size * maskData.size;
  for (let i = 0; i < runs.length; i += 2) {
    const start = Math.max(0, runs[i] | 0);
    const end = Math.min(total, start + (runs[i + 1] | 0));
    for (let pixel = start; pixel < end; pixel += 1) target[pixel * 4 + channel] = 255;
  }
}

function buildMaskAtlases() {
  if (!maskData?.size || !maskData?.zones) throw new Error("Rex UV mask data is unavailable");
  const size = maskData.size;
  const make = () => new Uint8Array(size * size * 4);
  const atlas0 = make();
  const atlas1 = make();
  const atlas2 = make();

  unpackZone("body", atlas0, 0);
  unpackZone("markings", atlas0, 1);
  unpackZone("flank", atlas0, 2);
  unpackZone("underbelly", atlas0, 3);
  unpackZone("detail1", atlas1, 0);
  unpackZone("eyes", atlas1, 1);
  unpackZone("teeth", atlas1, 2);
  unpackZone("mouth", atlas1, 3);
  unpackZone("claws", atlas2, 0);
  unpackZone("maleDisplay", atlas2, 1);

  const makeTexture = (data) => {
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = false;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.needsUpdate = true;
    return texture;
  };
  return [makeTexture(atlas0), makeTexture(atlas1), makeTexture(atlas2)];
}

function injectMaskShader(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <common>",
    `#include <common>
uniform sampler2D hvMask0;
uniform sampler2D hvMask1;
uniform sampler2D hvMask2;
uniform vec3 hvBody;
uniform vec3 hvMarkings;
uniform vec3 hvFlank;
uniform vec3 hvUnderbelly;
uniform vec3 hvDetail;
uniform vec3 hvEyes;
uniform vec3 hvTeeth;
uniform vec3 hvMouth;
uniform vec3 hvClaws;
uniform vec3 hvMaleDisplay;`
  );

  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <map_fragment>",
    `#include <map_fragment>
vec4 hvM0 = texture2D(hvMask0, vMapUv);
vec4 hvM1 = texture2D(hvMask1, vMapUv);
vec4 hvM2 = texture2D(hvMask2, vMapUv);
float hvLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
float hvShade = clamp(0.34 + hvLuma * 1.06, 0.28, 1.22);
diffuseColor.rgb = mix(diffuseColor.rgb, hvBody * hvShade, clamp(hvM0.r * 0.90, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, hvMarkings * hvShade, clamp(hvM0.g * 0.96, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, hvFlank * hvShade, clamp(hvM0.b * 0.92, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, hvUnderbelly * hvShade, clamp(hvM0.a * 0.94, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, hvDetail * hvShade, clamp(hvM1.r * 0.96, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, hvEyes * max(hvShade, 0.72), clamp(hvM1.g, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, hvTeeth * max(hvShade, 0.72), clamp(hvM1.b, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, hvMouth * max(hvShade, 0.62), clamp(hvM1.a, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, hvClaws * max(hvShade, 0.68), clamp(hvM2.r, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, hvMaleDisplay * hvShade, clamp(hvM2.g * 0.98, 0.0, 1.0));`
  );
}

function maskedMaterial(source) {
  const material = source.clone();
  const uniforms = {
    hvMask0: { value: maskAtlases[0] }, hvMask1: { value: maskAtlases[1] }, hvMask2: { value: maskAtlases[2] },
    hvBody: { value: new THREE.Color(currentPalette.body) },
    hvMarkings: { value: new THREE.Color(currentPalette.markings) },
    hvFlank: { value: new THREE.Color(currentPalette.flank) },
    hvUnderbelly: { value: new THREE.Color(currentPalette.underbelly) },
    hvDetail: { value: new THREE.Color(currentPalette.detail1) },
    hvEyes: { value: new THREE.Color(currentPalette.eyes) },
    hvTeeth: { value: new THREE.Color(currentPalette.teeth) },
    hvMouth: { value: new THREE.Color(currentPalette.mouth) },
    hvClaws: { value: new THREE.Color(currentPalette.claws) },
    hvMaleDisplay: { value: new THREE.Color(currentPalette.maleDisplay) },
  };
  material.onBeforeCompile = (shader) => injectMaskShader(shader, uniforms);
  material.customProgramCacheKey = () => "hollow-valley-rex-live-zones-v2";
  material.needsUpdate = true;
  shaderControllers.push({
    setPalette(palette) {
      uniforms.hvBody.value.set(palette.body);
      uniforms.hvMarkings.value.set(palette.markings);
      uniforms.hvFlank.value.set(palette.flank);
      uniforms.hvUnderbelly.value.set(palette.underbelly);
      uniforms.hvDetail.value.set(palette.detail1);
      uniforms.hvEyes.value.set(palette.eyes);
      uniforms.hvTeeth.value.set(palette.teeth);
      uniforms.hvMouth.value.set(palette.mouth);
      uniforms.hvClaws.value.set(palette.claws);
      uniforms.hvMaleDisplay.value.set(palette.maleDisplay);
    },
  });
  return material;
}

function applyMaterials(root) {
  shaderControllers = [];
  root.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.uv || !child.material) return;
    child.castShadow = true;
    child.receiveShadow = true;
    child.material = Array.isArray(child.material)
      ? child.material.map((mat) => maskedMaterial(mat))
      : maskedMaterial(child.material);
  });
}

function frameModel(root) {
  const first = new THREE.Box3().setFromObject(root);
  const size = first.getSize(new THREE.Vector3());
  const longest = Math.max(size.x, size.y, size.z) || 1;
  root.scale.multiplyScalar(7.5 / longest);

  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.sub(center);

  let centered = new THREE.Box3().setFromObject(root);
  root.position.y += -centered.min.y + 0.04;
  centered = new THREE.Box3().setFromObject(root);
  const finalSize = centered.getSize(new THREE.Vector3());
  const target = new THREE.Vector3(0, centered.min.y + finalSize.y * 0.52, 0);
  ground.position.y = centered.min.y - 0.035;

  const rect = stage.getBoundingClientRect();
  const aspect = Math.max(0.7, rect.width / Math.max(1, rect.height));
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const length = Math.max(finalSize.x, finalSize.z);
  const distance = Math.max(
    7.8,
    (length * 0.57) / Math.tan(hfov / 2),
    (finalSize.y * 0.62) / Math.tan(vfov / 2)
  );

  camera.position.set(distance, target.y + finalSize.y * 0.10, distance * 0.075);
  controls.target.copy(target);
  controls.update();
  homeCamera = { position: camera.position.clone(), target: controls.target.clone() };
}

function updatePalette(palette) {
  currentPalette = { ...currentPalette, ...(palette || {}) };
  for (const controller of shaderControllers) controller.setPalette(currentPalette);
  syncZoneStrip();
}

function syncZoneStrip() {
  if (!zoneStrip) return;
  const inputs = [...document.querySelectorAll("#skin-colors .skin-color-control input[type=color]")];
  if (!inputs.length) return;
  zoneStrip.innerHTML = inputs.map((input) => {
    const label = input.closest(".skin-color-control")?.querySelector("span")?.textContent || input.id;
    return '<button type="button" class="skin-model-zone skin-zone-live" data-input="' + input.id + '">' +
      '<i style="background:' + input.value + '"></i><span>' + label + '</span><b>' + input.value.toUpperCase() + '</b></button>';
  }).join("");
  zoneStrip.querySelectorAll(".skin-model-zone").forEach((button) => {
    button.addEventListener("click", () => document.getElementById(button.dataset.input)?.click());
  });
  document.querySelectorAll("#skin-colors .skin-color-control").forEach((control) => {
    control.classList.add("skin-zone-live-control");
    control.classList.remove("skin-zone-saved-only");
    control.title = "Live on the self-hosted 3D Tyrannosaurus.";
  });
}

async function loadChunkedGlb() {
  let completed = 0;
  const urls = Array.from({ length: CHUNK_COUNT }, (_, index) =>
    `${CHUNK_ROOT}/rex-${String(index).padStart(2, "0")}.b64?v=1`
  );
  const chunks = await Promise.all(urls.map(async (url) => {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Model chunk failed: ${response.status} ${url}`);
    const text = (await response.text()).replace(/\s+/g, "");
    completed += 1;
    if (loaderEl) loaderEl.textContent = `Loading Tyrannosaurus… ${Math.round((completed / CHUNK_COUNT) * 72)}%`;
    return text;
  }));
  const base64 = chunks.join("");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function loadModel() {
  try {
    setStatus(false, "Tyrannosaurus rex · loading self-hosted model");
    maskAtlases = buildMaskAtlases();
    currentPalette = paletteFromEditor();
    syncZoneStrip();

    const buffer = await loadChunkedGlb();
    if (loaderEl) loaderEl.textContent = "Loading Tyrannosaurus… 80%";
    const gltf = await new GLTFLoader().parseAsync(buffer, "");
    model = gltf.scene;
    applyMaterials(model);
    scene.add(model);
    frameModel(model);
    updatePalette(paletteFromEditor());
    if (loaderEl) loaderEl.textContent = "Loading Tyrannosaurus… 100%";
    setStatus(true, "Tyrannosaurus rex · self-hosted 10-zone live skin");
  } catch (error) {
    console.error("Failed to load self-hosted Skin Studio rex", error);
    setStatus(false, "Tyrannosaurus rex · model load failed");
    if (loaderEl) {
      loaderEl.hidden = false;
      loaderEl.innerHTML = "<strong>3D model failed to load</strong><span>Refresh the page to retry the Hollow Valley model.</span>";
    }
  }
}

document.addEventListener("hds:skin-preview-change", (event) => updatePalette(event.detail?.skin || paletteFromEditor()));
document.addEventListener("input", (event) => {
  if (event.target?.matches?.("#skin-colors input[type=color]")) updatePalette(paletteFromEditor());
});

resetButton?.addEventListener("click", () => {
  if (!homeCamera) return;
  camera.position.copy(homeCamera.position);
  controls.target.copy(homeCamera.target);
  controls.update();
});

lightInput?.addEventListener("input", () => {
  const factor = Number(lightInput.value || 105) / 105;
  key.intensity = 3.5 * factor;
  hemi.intensity = 1.05 * Math.max(0.55, factor);
  rim.intensity = 1.6 * Math.max(0.6, factor);
});

function resize() {
  const rect = stage.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

function animate() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();
loadModel();
