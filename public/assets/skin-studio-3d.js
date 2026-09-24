import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const MODEL_URL = "https://cdn.3dassets.dev/assets/1682/v1/model.glb";
const canvas = document.getElementById("skin-model-canvas");
const stage = document.getElementById("skin-preview-stage");
const loaderEl = document.getElementById("skin-model-loader");
const statusEl = document.getElementById("skin-model-status");
const statusDot = document.getElementById("skin-model-status-dot");
const lightInput = document.getElementById("skin-model-light");
const autoButton = document.getElementById("skin-model-auto");
const resetButton = document.getElementById("skin-model-reset");
const zoneStrip = document.getElementById("skin-model-zone-strip");

if (!canvas || !stage) {
  throw new Error("Skin Studio 3D stage is missing");
}

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x06110d, 0.032);

const camera = new THREE.PerspectiveCamera(33, 1, 0.01, 100);
camera.position.set(9.4, 2.7, 0.85);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.enablePan = false;
controls.minDistance = 4.8;
controls.maxDistance = 16.5;
controls.minPolarAngle = Math.PI * 0.18;
controls.maxPolarAngle = Math.PI * 0.72;
controls.target.set(0, 0.9, 0);
controls.autoRotate = false;
controls.autoRotateSpeed = 0.42;

const hemi = new THREE.HemisphereLight(0xc8f1d9, 0x06110d, 1.1);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xffefd3, 3.6);
key.position.set(6, 8, 6);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
scene.add(key);

const rim = new THREE.DirectionalLight(0x5cffad, 1.7);
rim.position.set(-8, 4, -6);
scene.add(rim);

const fill = new THREE.DirectionalLight(0x7fa8bf, 0.65);
fill.position.set(0, 2, 8);
scene.add(fill);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(9.4, 64),
  new THREE.MeshStandardMaterial({
    color: 0x07110d,
    roughness: 0.94,
    metalness: 0.02,
    transparent: true,
    opacity: 0.72,
  })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -1.05;
ground.receiveShadow = true;
scene.add(ground);

let model = null;
let modelMaterials = [];
let home = null;
let lastPalette = {
  body: "#6f7652",
  markings: "#232713",
  flank: "#59613d",
  underbelly: "#b7ae8d",
  detail1: "#9c7b46",
  eyes: "#b7ff35",
};

function blendColor(base, tint, amount = 0.56) {
  return base.clone().lerp(new THREE.Color(tint), amount);
}

function rememberMaterial(mesh, material, materialIndex = 0) {
  const copy = material.clone();
  mesh.material = Array.isArray(mesh.material)
    ? mesh.material.map((entry, index) => index === materialIndex ? copy : entry)
    : copy;

  modelMaterials.push({
    mesh,
    material: copy,
    baseColor: copy.color ? copy.color.clone() : new THREE.Color(0xffffff),
    name: ((mesh.name || "") + " " + (copy.name || "")).toLowerCase(),
    index: modelMaterials.length,
  });
}

function captureMaterials(root) {
  modelMaterials = [];
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;

    if (Array.isArray(child.material)) {
      const originals = child.material.slice();
      child.material = originals.map((mat) => mat.clone());
      child.material.forEach((mat) => {
        modelMaterials.push({
          mesh: child,
          material: mat,
          baseColor: mat.color ? mat.color.clone() : new THREE.Color(0xffffff),
          name: ((child.name || "") + " " + (mat.name || "")).toLowerCase(),
          index: modelMaterials.length,
        });
      });
    } else if (child.material) {
      rememberMaterial(child, child.material, 0);
    }
  });
}

function paletteTarget(entry) {
  const name = entry.name;
  if (/eye|pupil/.test(name)) return ["eyes", 0.86];
  if (/belly|under|throat|chest/.test(name)) return ["underbelly", 0.74];
  if (/stripe|mark|pattern|spot/.test(name)) return ["markings", 0.74];
  if (/flank|side/.test(name)) return ["flank", 0.7];
  if (/detail|crest|scar|accent/.test(name)) return ["detail1", 0.7];

  const fallback = ["body", "markings", "flank", "underbelly", "detail1"];
  return [fallback[entry.index % fallback.length], entry.index === 0 ? 0.5 : 0.42];
}

function applyPalette(palette = lastPalette) {
  lastPalette = { ...lastPalette, ...palette };
  for (const entry of modelMaterials) {
    const mat = entry.material;
    if (!mat?.color) continue;

    const [keyName, amount] = paletteTarget(entry);
    const tint = lastPalette[keyName] || lastPalette.body;
    mat.color.copy(blendColor(entry.baseColor, tint, amount));

    if (keyName === "eyes" && "emissive" in mat) {
      mat.emissive = new THREE.Color(lastPalette.eyes);
      mat.emissiveIntensity = 0.34;
    }
    mat.needsUpdate = true;
  }
}

function frameModel(root) {
  // Preserve the CC0 model's proportions and frame it from a broad side/three-quarter
  // angle so the deep skull, barrel chest, muscular hips and long counterbalancing tail
  // read much closer to the Hollow Valley reference silhouette.
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = 7.8 / maxDim;
  root.scale.setScalar(scale);

  const scaledBox = new THREE.Box3().setFromObject(root);
  const center = scaledBox.getCenter(new THREE.Vector3());
  root.position.sub(center);
  root.position.y += 0.16;
  root.rotation.y = -0.12;

  const finalBox = new THREE.Box3().setFromObject(root);
  const finalSize = finalBox.getSize(new THREE.Vector3());
  ground.position.y = finalBox.min.y - 0.035;

  const target = new THREE.Vector3(
    0,
    finalBox.min.y + finalSize.y * 0.47,
    0
  );

  // This model's long axis is primarily Z, so looking mostly along X creates
  // the strong side-profile presentation the user approved.
  const distance = Math.max(8.8, finalSize.z * 1.03, finalSize.length() * 0.74);
  camera.position.set(
    distance,
    target.y + finalSize.y * 0.13,
    distance * 0.10
  );

  controls.target.copy(target);
  controls.update();

  home = {
    camera: camera.position.clone(),
    target: controls.target.clone(),
  };
}

function setLoaded(ok, message) {
  if (loaderEl) loaderEl.hidden = ok;
  if (statusEl) statusEl.textContent = message;
  if (statusDot) statusDot.classList.toggle("ready", ok);
}

new GLTFLoader().load(
  MODEL_URL,
  (gltf) => {
    model = gltf.scene;
    scene.add(model);
    captureMaterials(model);
    frameModel(model);
    applyPalette(lastPalette);
    setLoaded(true, "Tyrannosaurus rex · accurate-silhouette 3D preview");
  },
  (event) => {
    if (!loaderEl || !event.total) return;
    const pct = Math.min(99, Math.round((event.loaded / event.total) * 100));
    loaderEl.textContent = "Loading Tyrannosaurus… " + pct + "%";
  },
  (error) => {
    console.error("Failed to load Skin Studio T-Rex model", error);
    if (loaderEl) {
      loaderEl.hidden = false;
      loaderEl.innerHTML = "<strong>3D preview unavailable</strong><span>The skin editor still works. Refresh to retry the model.</span>";
    }
    if (statusEl) statusEl.textContent = "Tyrannosaurus · 3D preview unavailable";
  }
);

function resetView() {
  if (!home) return;
  camera.position.copy(home.camera);
  controls.target.copy(home.target);
  controls.update();
}

function syncZoneStrip() {
  if (!zoneStrip) return;
  const inputs = [...document.querySelectorAll("#skin-colors .skin-color-control input[type=color]")];
  if (!inputs.length) return;

  zoneStrip.innerHTML = inputs.map((input) => {
    const label = input.closest(".skin-color-control")?.querySelector("span")?.textContent || input.id;
    return '<button type="button" class="skin-model-zone" data-input="' + input.id + '"><i style="background:' + input.value + '"></i><span>' + label + '</span><b>' + input.value.toUpperCase() + '</b></button>';
  }).join("");

  zoneStrip.querySelectorAll(".skin-model-zone").forEach((button) => {
    button.addEventListener("click", () => {
      const input = document.getElementById(button.dataset.input);
      input?.click();
    });
  });
}

document.addEventListener("hds:skin-preview-change", (event) => {
  const detail = event.detail || {};
  if (detail.skin) applyPalette(detail.skin);
  syncZoneStrip();
});

document.addEventListener("input", (event) => {
  if (event.target?.matches?.("#skin-colors input[type=color]")) {
    syncZoneStrip();
  }
});

autoButton?.addEventListener("click", () => {
  controls.autoRotate = !controls.autoRotate;
  autoButton.classList.toggle("active", controls.autoRotate);
  autoButton.setAttribute("aria-pressed", String(controls.autoRotate));
  autoButton.textContent = controls.autoRotate ? "Auto-rotate" : "Manual orbit";
});

resetButton?.addEventListener("click", resetView);

lightInput?.addEventListener("input", () => {
  const factor = Number(lightInput.value || 100) / 100;
  key.intensity = 3.6 * factor;
  hemi.intensity = 1.1 * Math.max(0.55, factor);
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

window.setTimeout(() => {
  syncZoneStrip();
  const body = document.getElementById("skin-color-body")?.value;
  const markings = document.getElementById("skin-color-markings")?.value;
  const flank = document.getElementById("skin-color-flank")?.value;
  const underbelly = document.getElementById("skin-color-underbelly")?.value;
  const detail1 = document.getElementById("skin-color-detail1")?.value;
  const eyes = document.getElementById("skin-color-eyes")?.value;
  applyPalette({ body, markings, flank, underbelly, detail1, eyes });
}, 500);
