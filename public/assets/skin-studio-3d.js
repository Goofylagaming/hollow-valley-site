import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

const canvas = document.getElementById("skin-model-canvas");
const referenceFrame = document.getElementById("skin-model-reference-frame");
const stage = document.getElementById("skin-preview-stage");
const loaderEl = document.getElementById("skin-model-loader");
const statusEl = document.getElementById("skin-model-status");
const statusDot = document.getElementById("skin-model-status-dot");
const lightInput = document.getElementById("skin-model-light");
const resetButton = document.getElementById("skin-model-reset");
const zoneStrip = document.getElementById("skin-model-zone-strip");
const modelTools = document.querySelector(".skin-model-tools");
const modelNameEl = document.getElementById("skin-model-name");
const modelSourceEl = document.getElementById("skin-model-source");
const modelCapabilityEl = document.getElementById("skin-model-capability");
const modelHelpEl = document.getElementById("skin-model-help");
const modelCreditEl = document.getElementById("skin-model-credit");
const zoneHintEl = document.getElementById("skin-model-zone-hint");
const speciesSelect = document.getElementById("skin-species");
const calibrationPanel = document.getElementById("skin-calibration-panel");
const calibrationSpeciesEl = document.getElementById("skin-calibration-species");
const calibrationZoneEl = document.getElementById("skin-calibration-zone");
const calibrationBrushEl = document.getElementById("skin-calibration-brush");
const calibrationBrushValueEl = document.getElementById("skin-calibration-brush-value");
const calibrationFlipVEl = document.getElementById("skin-calibration-flip-v");
const calibrationToggleEl = document.getElementById("skin-calibration-toggle");
const calibrationIslandFillEl = document.getElementById("skin-calibration-island-fill");
const calibrationUndoEl = document.getElementById("skin-calibration-undo");
const calibrationRedoEl = document.getElementById("skin-calibration-redo");
const calibrationClearZoneEl = document.getElementById("skin-calibration-clear-zone");
const calibrationClearAllEl = document.getElementById("skin-calibration-clear-all");
const calibrationDiagnosticEl = document.getElementById("skin-calibration-diagnostic");
const calibrationCopyEl = document.getElementById("skin-calibration-copy");
const calibrationStatusEl = document.getElementById("skin-calibration-status");
const calibrationCoverageEl = document.getElementById("skin-calibration-coverage");
const calibrationImportEl = document.getElementById("skin-calibration-import");
const calibrationImportButtonEl = document.getElementById("skin-calibration-import-button");
const calibrationClearImportEl = document.getElementById("skin-calibration-clear-import");
const calibrationOutputEl = document.getElementById("skin-calibration-output");
const MODEL_REGISTRY = window.HV_SKIN_MODELS || {};

if (!canvas || !stage) throw new Error("Skin Studio 3D stage is missing");

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
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const gameFog = new THREE.FogExp2(0x06110d, 0.035);
scene.fog = null;

const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
camera.position.set(9.5, 2.5, 1.8);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.enablePan = false;
controls.minDistance = 4.2;
controls.maxDistance = 20;
controls.minPolarAngle = Math.PI * 0.13;
controls.maxPolarAngle = Math.PI * 0.82;
controls.autoRotate = false;

const hemi = new THREE.HemisphereLight(0xffffff, 0x555555, 1.0);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(6, 8, 5);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
scene.add(key);

const rim = new THREE.DirectionalLight(0xffffff, 0.0);
rim.position.set(-7, 5, -6);
scene.add(rim);

const fill = new THREE.DirectionalLight(0xffffff, 0.0);
fill.position.set(4, 2, -8);
scene.add(fill);

const groundMaterial = new THREE.MeshStandardMaterial({
  color: 0x171717,
  roughness: 0.95,
  metalness: 0.01,
  transparent: true,
  opacity: 0.72,
});
const ground = new THREE.Mesh(new THREE.CircleGeometry(10, 72), groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

let model = null;
let currentModelDef = null;
let currentSpeciesLabel = "";
let currentLoadToken = 0;
let homeCamera = null;
let shaderControllers = [];
let materialBindings = [];
let shapeTintMaterials = [];
let maskAtlases = [];
let currentMaskData = null;
let zoneLookup = null;
let currentPalette = { ...FALLBACKS };
let currentSex = "male";
let previewMode = "accurate";
let accurateButton = null;
let gameButton = null;
let autoRotateButton = null;
let cleanViewButton = null;
let ultraButton = null;
let spinInput = null;
let ultraEnabled = false;
let calibrationActive = false;
let calibrationPointerDown = false;
let calibrationSaveTimer = null;
let calibrationCoverageTimer = null;
let calibrationIslandFillMode = false;
let uvCoverage = null;
let calibrationUndoStack = [];
let calibrationRedoStack = [];
const CALIBRATION_HISTORY_LIMIT = 30;
const CALIBRATION_SIZE = 256;
const ZONE_KEYS = Object.freeze(["body","markings","flank","underbelly","detail1","eyes","teeth","mouth","claws","maleDisplay"]);
const ZONE_CHANNELS = Object.freeze({
  body:[0,0], markings:[0,1], flank:[0,2], underbelly:[0,3],
  detail1:[1,0], eyes:[1,1], teeth:[1,2], mouth:[1,3],
  claws:[2,0], maleDisplay:[2,1],
});

const CALIBRATION_DIAGNOSTIC_PALETTE = Object.freeze({
  maleDisplay:"#ff00ff",
  markings:"#00ff00",
  body:"#ff0000",
  flank:"#0000ff",
  underbelly:"#ffff00",
  detail1:"#00ffff",
  eyes:"#ffffff",
  teeth:"#ff8800",
  mouth:"#8000ff",
  claws:"#00ff88",
});

// Skin Studio / FNF HEX values serialize EVRIMA FLinearColor components as
// 8-bit channel values. They are NOT CSS/sRGB display colours. THREE.Color
// assumes hexadecimal strings are sRGB and would gamma-decode them, making the
// preview darker than the raw floats Wear Live writes to pawn.CustomizerData.
// Parse the bytes ourselves and mark them as already-linear working-space RGB.
function engineChannelsFromHex(value) {
  const raw = String(value || "").replace("#", "").trim();
  const safe = /^[0-9a-f]{6}$/i.test(raw) ? raw : "000000";
  return [
    parseInt(safe.slice(0,2),16)/255,
    parseInt(safe.slice(2,4),16)/255,
    parseInt(safe.slice(4,6),16)/255,
  ];
}

function engineColorFromHex(value, target = new THREE.Color()) {
  const [r,g,b] = engineChannelsFromHex(value);
  return target.setRGB(r, g, b, THREE.LinearSRGBColorSpace);
}

function normalizedSpecies(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function resolveModelDefinition(value) {
  const wanted = normalizedSpecies(value);
  if (!wanted || wanted === "universal" || wanted.includes("any species")) return null;
  for (const def of Object.values(MODEL_REGISTRY)) {
    const aliases = Array.isArray(def?.aliases) ? def.aliases : [];
    if (aliases.some((alias) => normalizedSpecies(alias) === wanted)) return def;
  }
  return null;
}

function installModeControls() {
  if (!modelTools || document.getElementById("skin-model-accurate")) return;

  accurateButton = document.createElement("button");
  accurateButton.className = "small-button";
  accurateButton.id = "skin-model-accurate";
  accurateButton.type = "button";
  accurateButton.textContent = "EVRIMA colour";
  accurateButton.title = "Show the exact linear colour components Wear Live writes to EVRIMA on a calibrated species zone map.";

  gameButton = document.createElement("button");
  gameButton.className = "small-button";
  gameButton.id = "skin-model-game";
  gameButton.type = "button";
  gameButton.textContent = "Game preview";
  gameButton.title = "Show a calibrated model with Hollow Valley atmospheric lighting and texture shading.";

  autoRotateButton = document.createElement("button");
  autoRotateButton.className = "small-button";
  autoRotateButton.id = "skin-model-auto-rotate";
  autoRotateButton.type = "button";
  autoRotateButton.textContent = "Auto-rotate";
  autoRotateButton.title = "Slowly rotate the selected species model.";

  cleanViewButton = document.createElement("button");
  cleanViewButton.className = "small-button";
  cleanViewButton.id = "skin-model-clean-view";
  cleanViewButton.type = "button";
  cleanViewButton.textContent = "Clean view";
  cleanViewButton.title = "Hide the model HUD and side rail for an unobstructed preview.";

  ultraButton = document.createElement("button");
  ultraButton.className = "small-button";
  ultraButton.id = "skin-model-ultra";
  ultraButton.type = "button";
  ultraButton.textContent = "Ultra";
  ultraButton.title = "Increase preview resolution and shadow quality on stronger devices.";

  const spinLabel = document.createElement("label");
  spinLabel.className = "skin-model-spin-control";
  spinLabel.textContent = "Spin ";
  spinInput = document.createElement("input");
  spinInput.id = "skin-model-spin";
  spinInput.type = "range";
  spinInput.min = "-180";
  spinInput.max = "180";
  spinInput.step = "1";
  spinInput.value = "0";
  spinInput.setAttribute("aria-label", "Rotate species model");
  spinLabel.append(spinInput);

  modelTools.prepend(cleanViewButton);
  modelTools.prepend(ultraButton);
  modelTools.prepend(spinLabel);
  modelTools.prepend(autoRotateButton);
  modelTools.prepend(gameButton);
  modelTools.prepend(accurateButton);

  accurateButton.addEventListener("click", () => applyPreviewMode("accurate"));
  gameButton.addEventListener("click", () => applyPreviewMode("game"));
  autoRotateButton.addEventListener("click", () => {
    controls.autoRotate = !controls.autoRotate;
    controls.autoRotateSpeed = 0.85;
    autoRotateButton.classList.toggle("green", controls.autoRotate);
    autoRotateButton.setAttribute("aria-pressed", controls.autoRotate ? "true" : "false");
  });
  cleanViewButton.addEventListener("click", () => {
    const enabled = !stage.classList.contains("skin-model-clean");
    stage.classList.toggle("skin-model-clean", enabled);
    cleanViewButton.classList.toggle("green", enabled);
    cleanViewButton.setAttribute("aria-pressed", enabled ? "true" : "false");
  });

  ultraButton.addEventListener("click", () => {
    ultraEnabled = !ultraEnabled;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ultraEnabled ? 3 : 2));
    key.shadow.mapSize.set(ultraEnabled ? 2048 : 1024, ultraEnabled ? 2048 : 1024);
    if (key.shadow.map) {
      key.shadow.map.dispose();
      key.shadow.map = null;
    }
    ultraButton.classList.toggle("green", ultraEnabled);
    ultraButton.setAttribute("aria-pressed", ultraEnabled ? "true" : "false");
    resize();
  });

  spinInput.addEventListener("input", () => {
    if (!model) return;
    model.rotation.y = THREE.MathUtils.degToRad(Number(spinInput.value) || 0);
  });
}

function setStatus(ok, message) {
  if (loaderEl) loaderEl.hidden = ok;
  if (statusEl) statusEl.textContent = message;
  statusDot?.classList.toggle("ready", ok);
}

function setRail(def, label = "") {
  const display = def?.displayName || label || "Choose a species";
  if (modelNameEl) modelNameEl.textContent = display;

  if (!def) {
    if (modelCapabilityEl) modelCapabilityEl.textContent = "SPECIES 3D MODEL";
    if (modelSourceEl) modelSourceEl.textContent = "No dedicated model selected";
    if (modelHelpEl) {
      modelHelpEl.textContent = label
        ? `There is no dedicated Hollow Valley 3D model configured for ${label} yet. Skin colours still save and Wear Live normally; the 3D stage is disabled rather than showing the wrong dinosaur.`
        : "Choose a species-specific compatibility to load its dedicated 3D model. Universal designs intentionally do not pretend one dinosaur model represents every species.";
    }
    if (modelCreditEl) modelCreditEl.hidden = true;
    return;
  }

  if (def.capability === "zones") {
    if (modelCapabilityEl) modelCapabilityEl.textContent = "CALIBRATED 3D MODEL";
    if (modelSourceEl) modelSourceEl.textContent = "Species mesh + Hollow Valley colour-zone map";
    if (modelHelpEl) {
      modelHelpEl.textContent = "This species has a calibrated Hollow Valley zone map. EVRIMA colour interprets Studio/FNF HEX as the same linear components Wear Live writes in game; Game preview adds atmospheric lighting and texture shading.";
    }
  } else if (def.capability === "shape") {
    if (modelCapabilityEl) modelCapabilityEl.textContent = "SPECIES PAINT MESH";
    if (modelSourceEl) modelSourceEl.textContent = "Realistic species mesh · provisional Body tint · EVRIMA zone calibration pending";
    if (modelHelpEl) {
      modelHelpEl.textContent = "This realistic mesh is rendered directly by Hollow Valley. Body colour tints the whole model immediately as a provisional preview; markings, flank, underbelly and the other EVRIMA channels stay unmapped until their UV zones are calibrated.";
    }
  } else if (def.capability === "reference") {
    if (modelCapabilityEl) modelCapabilityEl.textContent = "REALISTIC REFERENCE MODEL";
    if (modelSourceEl) modelSourceEl.textContent = "High-detail species reference · colour preview intentionally disabled";
    if (modelHelpEl) {
      modelHelpEl.textContent = "This is a realistic species reference model, not the Hollow Valley paint mesh. Use it to judge anatomy and proportions; EVRIMA colour painting stays disabled until an equally good local mesh is installed and calibrated.";
    }
  } else {
    if (modelCapabilityEl) modelCapabilityEl.textContent = "MODEL PENDING";
    if (modelSourceEl) modelSourceEl.textContent = "Dedicated species model not installed yet";
    if (modelHelpEl) {
      modelHelpEl.textContent = "A dedicated species model is queued for this dinosaur. The 3D preview stays disabled until the mesh and colour-zone mapping are verified.";
    }
  }

  if (modelCreditEl && def.credit?.url) {
    modelCreditEl.href = def.credit.url;
    modelCreditEl.textContent = def.credit.label || "Model credit";
    modelCreditEl.hidden = false;
  } else if (modelCreditEl) {
    modelCreditEl.hidden = true;
  }
}

function paletteFromEditor() {
  const get = (key) => document.getElementById("skin-color-" + key)?.value || FALLBACKS[key];
  return {
    body: get("body"),
    markings: get("markings"),
    flank: get("flank"),
    underbelly: get("underbelly"),
    detail1: get("detail1"),
    eyes: get("eyes"),
    teeth: get("teeth"),
    mouth: get("mouth"),
    claws: get("claws"),
    maleDisplay: get("maleDisplay"),
  };
}

function unpackZone(zoneName, target, channel) {
  const runs = currentMaskData?.zones?.[zoneName];
  if (!Array.isArray(runs)) return;
  const total = currentMaskData.size * currentMaskData.size;
  for (let i = 0; i < runs.length; i += 2) {
    const start = Math.max(0, runs[i] | 0);
    const end = Math.min(total, start + (runs[i + 1] | 0));
    for (let pixel = start; pixel < end; pixel += 1) target[pixel * 4 + channel] = 255;
  }
}

function disposeMaskAtlases() {
  for (const texture of maskAtlases) {
    try { texture.dispose(); } catch {}
  }
  maskAtlases = [];
}

function buildMaskAtlases() {
  if (!currentMaskData?.size || !currentMaskData?.zones) {
    throw new Error(`${currentModelDef?.displayName || "Species"} colour-zone mask data is unavailable`);
  }

  const size = currentMaskData.size;
  const make = () => new Uint8Array(size * size * 4);
  const atlas0 = make();
  const atlas1 = make();
  const atlas2 = make();
  const zoneKeys = ["body", "markings", "flank", "underbelly", "detail1", "eyes", "teeth", "mouth", "claws", "maleDisplay"];
  zoneLookup = new Uint8Array(size * size);

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

  zoneKeys.forEach((zoneName, zoneIndex) => {
    const runs = currentMaskData?.zones?.[zoneName];
    if (!Array.isArray(runs)) return;
    const total = size * size;
    for (let i = 0; i < runs.length; i += 2) {
      const start = Math.max(0, runs[i] | 0);
      const end = Math.min(total, start + (runs[i + 1] | 0));
      for (let pixel = start; pixel < end; pixel += 1) {
        if (!zoneLookup[pixel]) zoneLookup[pixel] = zoneIndex + 1;
      }
    }
  });

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

function injectMaskShader(shader, uniforms, accurate) {
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
uniform vec3 hvMaleDisplay;
uniform float hvMaleVisible;`
  );

  const shadeBlock = accurate
    ? "float hvShade = 1.0;"
    : "float hvLuma = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));\nfloat hvShade = clamp(0.34 + hvLuma * 1.06, 0.28, 1.22);";
  const strength = accurate
    ? { body: "1.0", markings: "1.0", flank: "1.0", underbelly: "1.0", detail: "1.0", male: "1.0" }
    : { body: "0.90", markings: "0.96", flank: "0.92", underbelly: "0.94", detail: "0.96", male: "0.98" };

  shader.fragmentShader = shader.fragmentShader.replace(
    "#include <map_fragment>",
    `#include <map_fragment>
vec4 hvM0 = texture2D(hvMask0, vMapUv);
vec4 hvM1 = texture2D(hvMask1, vMapUv);
vec4 hvM2 = texture2D(hvMask2, vMapUv);
${shadeBlock}
diffuseColor.rgb = mix(diffuseColor.rgb, hvBody * hvShade, clamp(hvM0.r * ${strength.body}, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, hvMarkings * hvShade, clamp(hvM0.g * ${strength.markings}, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, hvFlank * hvShade, clamp(hvM0.b * ${strength.flank}, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, hvUnderbelly * hvShade, clamp(hvM0.a * ${strength.underbelly}, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, hvDetail * hvShade, clamp(hvM1.r * ${strength.detail}, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, hvEyes * ${accurate ? "1.0" : "max(hvShade, 0.72)"}, clamp(hvM1.g, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, hvTeeth * ${accurate ? "1.0" : "max(hvShade, 0.72)"}, clamp(hvM1.b, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, hvMouth * ${accurate ? "1.0" : "max(hvShade, 0.62)"}, clamp(hvM1.a, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, hvClaws * ${accurate ? "1.0" : "max(hvShade, 0.68)"}, clamp(hvM2.r, 0.0, 1.0));
diffuseColor.rgb = mix(diffuseColor.rgb, hvMaleDisplay * hvShade, clamp(hvM2.g * ${strength.male} * hvMaleVisible, 0.0, 1.0));`
  );
}

function basicMaterialFrom(source) {
  return new THREE.MeshBasicMaterial({
    color: 0xffffff,
    map: source.map || null,
    alphaMap: source.alphaMap || null,
    transparent: Boolean(source.transparent),
    opacity: Number.isFinite(source.opacity) ? source.opacity : 1,
    alphaTest: source.alphaTest || 0,
    side: source.side,
    vertexColors: Boolean(source.vertexColors),
  });
}

function maskedMaterial(source, accurate) {
  const material = accurate ? basicMaterialFrom(source) : source.clone();
  const uniforms = {
    hvMask0: { value: maskAtlases[0] },
    hvMask1: { value: maskAtlases[1] },
    hvMask2: { value: maskAtlases[2] },
    hvBody: { value: engineColorFromHex(currentPalette.body) },
    hvMarkings: { value: engineColorFromHex(currentPalette.markings) },
    hvFlank: { value: engineColorFromHex(currentPalette.flank) },
    hvUnderbelly: { value: engineColorFromHex(currentPalette.underbelly) },
    hvDetail: { value: engineColorFromHex(currentPalette.detail1) },
    hvEyes: { value: engineColorFromHex(currentPalette.eyes) },
    hvTeeth: { value: engineColorFromHex(currentPalette.teeth) },
    hvMouth: { value: engineColorFromHex(currentPalette.mouth) },
    hvClaws: { value: engineColorFromHex(currentPalette.claws) },
    hvMaleDisplay: { value: engineColorFromHex(currentPalette.maleDisplay) },
    hvMaleVisible: { value: currentSex === "female" ? 0 : 1 },
  };

  material.onBeforeCompile = (shader) => injectMaskShader(shader, uniforms, accurate);
  material.customProgramCacheKey = () => `hollow-valley-${currentModelDef?.key || "species"}-zones-v4-${accurate ? "accurate" : "game"}`;
  material.needsUpdate = true;

  const controller = {
    setPalette(palette) {
      engineColorFromHex(palette.body, uniforms.hvBody.value);
      engineColorFromHex(palette.markings, uniforms.hvMarkings.value);
      engineColorFromHex(palette.flank, uniforms.hvFlank.value);
      engineColorFromHex(palette.underbelly, uniforms.hvUnderbelly.value);
      engineColorFromHex(palette.detail1, uniforms.hvDetail.value);
      engineColorFromHex(palette.eyes, uniforms.hvEyes.value);
      engineColorFromHex(palette.teeth, uniforms.hvTeeth.value);
      engineColorFromHex(palette.mouth, uniforms.hvMouth.value);
      engineColorFromHex(palette.claws, uniforms.hvClaws.value);
      engineColorFromHex(palette.maleDisplay, uniforms.hvMaleDisplay.value);
    },
    setSex(sex) {
      uniforms.hvMaleVisible.value = sex === "female" ? 0 : 1;
    },
  };

  return { material, controller };
}

function applyCalibratedMaterials(root) {
  shaderControllers = [];
  materialBindings = [];

  root.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.uv || !child.material) return;
    child.castShadow = true;
    child.receiveShadow = true;
    const sourceMaterials = Array.isArray(child.material) ? child.material : [child.material];
    const pairs = sourceMaterials.map((source) => {
      const accurate = maskedMaterial(source, true);
      const game = maskedMaterial(source, false);
      shaderControllers.push(accurate.controller, game.controller);
      return { accurate: accurate.material, game: game.material };
    });
    materialBindings.push({ child, pairs, array: Array.isArray(child.material) });
  });

  applyPreviewMode(previewMode);
}

function applyShapeMaterials(root) {
  shaderControllers = [];
  materialBindings = [];
  shapeTintMaterials = [];

  root.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;

    const sources = Array.isArray(child.material) ? child.material : [child.material];
    const clones = sources.map((source) => {
      const material = source?.clone ? source.clone() : source;
      if (material?.color?.isColor) shapeTintMaterials.push(material);
      return material;
    });
    child.material = Array.isArray(child.material) ? clones : clones[0];
  });

  updateShapeBodyTint(currentPalette.body);
  applyPreviewMode("game");
}

function updateShapeBodyTint(hex) {
  if (currentModelDef?.capability !== "shape" || calibrationActive) return;
  for (const material of shapeTintMaterials) {
    if (!material?.color?.isColor) continue;
    engineColorFromHex(hex, material.color);
    material.needsUpdate = true;
  }
}

function calibrated() {
  return (currentModelDef?.capability === "zones" || calibrationActive) && maskAtlases.length === 3;
}

function calibrationAvailable() {
  return Boolean(model && currentModelDef?.capability === "shape");
}

function setCalibrationStatus(message) {
  if (calibrationStatusEl) calibrationStatusEl.textContent = message;
  if (calibrationSpeciesEl) calibrationSpeciesEl.textContent = currentModelDef?.displayName || "Select a shape model";
}

function updateCalibrationHistoryButtons() {
  if (calibrationUndoEl) calibrationUndoEl.disabled = !calibrationActive || calibrationUndoStack.length === 0;
  if (calibrationRedoEl) calibrationRedoEl.disabled = !calibrationActive || calibrationRedoStack.length === 0;
}

function pushCalibrationHistory() {
  if (!calibrationActive || !zoneLookup?.length) return;
  calibrationUndoStack.push(new Uint8Array(zoneLookup));
  if (calibrationUndoStack.length > CALIBRATION_HISTORY_LIMIT) calibrationUndoStack.shift();
  calibrationRedoStack = [];
  updateCalibrationHistoryButtons();
}

function markCalibrationTexturesDirty() {
  for (const texture of maskAtlases) texture.needsUpdate = true;
}

function rebuildMaskAtlasesFromLookup() {
  if (!zoneLookup?.length || maskAtlases.length !== 3) return;
  for (const texture of maskAtlases) texture.image?.data?.fill(0);

  for (let pixel = 0; pixel < zoneLookup.length; pixel += 1) {
    const zoneIndex = zoneLookup[pixel] - 1;
    if (zoneIndex < 0) continue;
    const zoneName = ZONE_KEYS[zoneIndex];
    const channel = ZONE_CHANNELS[zoneName];
    if (!channel) continue;
    const data = maskAtlases[channel[0]].image?.data;
    if (data) data[pixel * 4 + channel[1]] = 255;
  }
  markCalibrationTexturesDirty();
}

function restoreCalibrationSnapshot(snapshot) {
  if (!snapshot || !zoneLookup || snapshot.length !== zoneLookup.length) return;
  zoneLookup.set(snapshot);
  rebuildMaskAtlasesFromLookup();
  saveCalibrationDraftNow();
  scheduleCalibrationCoverage();
}

function undoCalibration() {
  if (!calibrationUndoStack.length || !zoneLookup?.length) return;
  calibrationRedoStack.push(new Uint8Array(zoneLookup));
  const previous = calibrationUndoStack.pop();
  restoreCalibrationSnapshot(previous);
  updateCalibrationHistoryButtons();
  setCalibrationStatus(`${currentModelDef?.displayName || "Species"} · undo`);
}

function redoCalibration() {
  if (!calibrationRedoStack.length || !zoneLookup?.length) return;
  calibrationUndoStack.push(new Uint8Array(zoneLookup));
  const next = calibrationRedoStack.pop();
  restoreCalibrationSnapshot(next);
  updateCalibrationHistoryButtons();
  setCalibrationStatus(`${currentModelDef?.displayName || "Species"} · redo`);
}

function normalizedUv(value) {
  const n = Number(value) || 0;
  return ((n % 1) + 1) % 1;
}

function unwrapTriangleAxis(values) {
  const out = values.map(normalizedUv);
  const min = Math.min(...out);
  const max = Math.max(...out);
  if (max - min > 0.5) {
    return out.map((value) => value < 0.5 ? value + 1 : value);
  }
  return out;
}

function edge2d(ax, ay, bx, by, px, py) {
  return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
}

function rasterizeUvTriangle(coverage, uv0, uv1, uv2) {
  const size = CALIBRATION_SIZE;
  const us = unwrapTriangleAxis([uv0.x, uv1.x, uv2.x]);
  const vs = unwrapTriangleAxis([uv0.y, uv1.y, uv2.y]);
  const ax = us[0], ay = vs[0];
  const bx = us[1], by = vs[1];
  const cx = us[2], cy = vs[2];

  const minX = Math.floor(Math.min(ax, bx, cx) * size) - 1;
  const maxX = Math.ceil(Math.max(ax, bx, cx) * size) + 1;
  const minY = Math.floor(Math.min(ay, by, cy) * size) - 1;
  const maxY = Math.ceil(Math.max(ay, by, cy) * size) + 1;
  const area = edge2d(ax, ay, bx, by, cx, cy);
  if (Math.abs(area) < 1e-10) return;

  for (let y = minY; y <= maxY; y += 1) {
    const py = (y + 0.5) / size;
    for (let x = minX; x <= maxX; x += 1) {
      const px = (x + 0.5) / size;
      const e0 = edge2d(ax, ay, bx, by, px, py);
      const e1 = edge2d(bx, by, cx, cy, px, py);
      const e2 = edge2d(cx, cy, ax, ay, px, py);
      const hasNegative = e0 < -1e-8 || e1 < -1e-8 || e2 < -1e-8;
      const hasPositive = e0 > 1e-8 || e1 > 1e-8 || e2 > 1e-8;
      if (hasNegative && hasPositive) continue;

      const wrappedX = ((x % size) + size) % size;
      const wrappedY = ((y % size) + size) % size;
      coverage[wrappedY * size + wrappedX] = 1;
    }
  }
}

function buildModelUvCoverage(root) {
  const coverage = new Uint8Array(CALIBRATION_SIZE * CALIBRATION_SIZE);
  if (!root) return coverage;

  root.traverse((child) => {
    if (!child.isMesh) return;
    const geometry = child.geometry;
    const uv = geometry?.attributes?.uv;
    const position = geometry?.attributes?.position;
    if (!uv || !position) return;

    const index = geometry.index;
    const triangleCount = index
      ? Math.floor(index.count / 3)
      : Math.floor(position.count / 3);

    for (let triangle = 0; triangle < triangleCount; triangle += 1) {
      const base = triangle * 3;
      const i0 = index ? index.getX(base) : base;
      const i1 = index ? index.getX(base + 1) : base + 1;
      const i2 = index ? index.getX(base + 2) : base + 2;
      rasterizeUvTriangle(
        coverage,
        { x: uv.getX(i0), y: uv.getY(i0) },
        { x: uv.getX(i1), y: uv.getY(i1) },
        { x: uv.getX(i2), y: uv.getY(i2) }
      );
    }
  });
  return coverage;
}

function uvToMaskPoint(uv) {
  if (!uv) return null;
  const size = CALIBRATION_SIZE;
  const x = Math.max(0, Math.min(size - 1, Math.floor(normalizedUv(uv.x) * size)));
  const directY = Math.max(0, Math.min(size - 1, Math.floor(normalizedUv(uv.y) * size)));
  const y = calibrationFlipVEl?.checked ? size - 1 - directY : directY;
  return { x, y };
}

function maskPixelCovered(x, y) {
  if (!uvCoverage?.length) return true;
  const size = CALIBRATION_SIZE;
  if (x < 0 || x >= size || y < 0 || y >= size) return false;
  const geometryY = calibrationFlipVEl?.checked ? size - 1 - y : y;
  return uvCoverage[geometryY * size + x] === 1;
}

function nearestCoveredMaskPoint(point, radius = 5) {
  if (!point) return null;
  if (maskPixelCovered(point.x, point.y)) return point;
  for (let r = 1; r <= radius; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
        const x = point.x + dx, y = point.y + dy;
        if (maskPixelCovered(x, y)) return { x, y };
      }
    }
  }
  return null;
}

function fillCalibrationIsland(uv) {
  if (!calibrationActive || !zoneLookup?.length || !uvCoverage?.length || !uv) return false;
  const size = CALIBRATION_SIZE;
  const seed = nearestCoveredMaskPoint(uvToMaskPoint(uv));
  if (!seed) {
    setCalibrationStatus("No UV island was found under that point.");
    return false;
  }

  pushCalibrationHistory();

  const visited = new Uint8Array(size * size);
  const queue = new Int32Array(size * size);
  let head = 0, tail = 0;
  const seedPixel = seed.y * size + seed.x;
  queue[tail++] = seedPixel;
  visited[seedPixel] = 1;

  const zone = calibrationZoneEl?.value || "body";
  let painted = 0;

  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % size;
    const y = Math.floor(pixel / size);
    if (!maskPixelCovered(x, y)) continue;

    setAtlasPixel(pixel, zone);
    painted += 1;

    const neighbors = [
      [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (nx < 0 || nx >= size || ny < 0 || ny >= size) continue;
      const next = ny * size + nx;
      if (visited[next] || !maskPixelCovered(nx, ny)) continue;
      visited[next] = 1;
      queue[tail++] = next;
    }
  }

  markCalibrationTexturesDirty();
  saveCalibrationDraftSoon();
  scheduleCalibrationCoverage();
  updateCalibrationHistoryButtons();
  setCalibrationStatus(`${currentModelDef.displayName} · filled UV island with ${zone} · ${painted.toLocaleString()} pixels`);
  return true;
}

function updateCalibrationCoverage() {
  if (!calibrationCoverageEl) return;
  if (!zoneLookup?.length) {
    calibrationCoverageEl.textContent = "UV coverage will appear while mapping.";
    return;
  }

  const counts = new Uint32Array(ZONE_KEYS.length + 1);
  let footprint = 0;
  for (let pixel = 0; pixel < zoneLookup.length; pixel += 1) {
    const x = pixel % CALIBRATION_SIZE;
    const y = Math.floor(pixel / CALIBRATION_SIZE);
    if (uvCoverage?.length && !maskPixelCovered(x, y)) continue;
    footprint += 1;
    counts[zoneLookup[pixel]] += 1;
  }

  const total = Math.max(1, footprint || zoneLookup.length);
  const mapped = total - counts[0];
  const pct = (value) => ((value / total) * 100).toFixed(1);
  const zoneSummary = ZONE_KEYS
    .map((zone, index) => `${zone} ${pct(counts[index + 1])}%`)
    .join(" · ");

  const footprintLabel = uvCoverage?.length
    ? ` · UV footprint ${footprint.toLocaleString()} px`
    : "";

  calibrationCoverageEl.innerHTML =
    `<b>Mapped ${pct(mapped)}%</b> · unmapped ${pct(counts[0])}%${footprintLabel} · ${zoneSummary}`;
}

function scheduleCalibrationCoverage() {
  clearTimeout(calibrationCoverageTimer);
  calibrationCoverageTimer = setTimeout(updateCalibrationCoverage, 100);
}

function loadDiagnosticPalette() {
  let lastInput = null;
  for (const [zone, value] of Object.entries(CALIBRATION_DIAGNOSTIC_PALETTE)) {
    const input = document.getElementById(`skin-color-${zone}`);
    if (!input) continue;
    input.value = value;
    lastInput = input;
  }
  lastInput?.dispatchEvent(new Event("input", { bubbles: true }));
  setCalibrationStatus("Diagnostic colours loaded. Each EVRIMA channel now has a deliberately loud test colour; this changes the editor only until you choose Wear Live.");
}

function createBlankCalibrationMask() {
  currentMaskData = { size: CALIBRATION_SIZE, zones: {} };
  maskAtlases = buildMaskAtlases();
  zoneLookup = new Uint8Array(CALIBRATION_SIZE * CALIBRATION_SIZE);
}

function setAtlasPixel(pixel, zoneName) {
  for (const texture of maskAtlases) {
    const data = texture.image?.data;
    if (!data) continue;
    const offset = pixel * 4;
    data[offset] = 0; data[offset+1] = 0; data[offset+2] = 0; data[offset+3] = 0;
  }
  if (!zoneName || zoneName === "erase") {
    zoneLookup[pixel] = 0;
    return;
  }
  const zoneIndex = ZONE_KEYS.indexOf(zoneName);
  const channel = ZONE_CHANNELS[zoneName];
  if (zoneIndex < 0 || !channel) return;
  const data = maskAtlases[channel[0]].image.data;
  data[pixel * 4 + channel[1]] = 255;
  zoneLookup[pixel] = zoneIndex + 1;
}

function paintCalibrationUv(uv) {
  if (!calibrationActive || !uv || !zoneLookup?.length) return;
  const size = CALIBRATION_SIZE;
  const point = uvToMaskPoint(uv);
  if (!point) return;

  const radius = Math.max(1, Number(calibrationBrushEl?.value || 7));
  const zone = calibrationZoneEl?.value || "body";
  let painted = 0;

  for (let dy=-radius;dy<=radius;dy+=1) {
    for (let dx=-radius;dx<=radius;dx+=1) {
      if (dx*dx+dy*dy > radius*radius) continue;
      const x=point.x+dx,y=point.y+dy;
      if(x<0||x>=size||y<0||y>=size) continue;
      if (uvCoverage?.length && !maskPixelCovered(x, y)) continue;
      setAtlasPixel(y*size+x, zone);
      painted += 1;
    }
  }

  if (!painted) return;
  markCalibrationTexturesDirty();
  saveCalibrationDraftSoon();
  scheduleCalibrationCoverage();
  setCalibrationStatus(`${currentModelDef.displayName} · painting ${zone} · brush ${radius}px · UV-clipped · draft auto-saved`);
}

function calibrationStorageKey() {
  return currentModelDef?.key ? `hv-skin-calibration:${currentModelDef.key}:v1` : null;
}

function maskPayloadFromLookup() {
  const zones = {};
  ZONE_KEYS.forEach((key,index) => {
    const runs = rleForZone(index);
    if (runs.length) zones[key] = runs;
  });
  return { size: CALIBRATION_SIZE, zones };
}

function saveCalibrationDraftNow() {
  const key = calibrationStorageKey();
  if (!key || !zoneLookup?.length) return false;
  try {
    localStorage.setItem(key, JSON.stringify(maskPayloadFromLookup()));
    return true;
  } catch {
    return false;
  }
}

function saveCalibrationDraftSoon() {
  clearTimeout(calibrationSaveTimer);
  calibrationSaveTimer = setTimeout(() => {
    if (calibrationActive) saveCalibrationDraftNow();
  }, 250);
}

function rleForZone(zoneIndex) {
  const runs = [];
  let start = -1;
  for (let i=0;i<=zoneLookup.length;i+=1) {
    const on = i < zoneLookup.length && zoneLookup[i] === zoneIndex + 1;
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      runs.push(start, i-start);
      start = -1;
    }
  }
  return runs;
}

function exportCalibrationMask() {
  if (!zoneLookup?.length || !currentModelDef) return "";
  return JSON.stringify(maskPayloadFromLookup(), null, 2);
}

function normalizeCalibrationMaskPayload(value) {
  let parsed = value;
  if (typeof value === "string") {
    if (value.length > 1000000) throw new Error("Calibration mask is too large.");
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error("Calibration mask is not valid JSON.");
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Calibration mask must be a JSON object.");
  }
  if (Number(parsed.size) !== CALIBRATION_SIZE) {
    throw new Error(`Calibration mask size must be ${CALIBRATION_SIZE}.`);
  }
  if (!parsed.zones || typeof parsed.zones !== "object" || Array.isArray(parsed.zones)) {
    throw new Error("Calibration mask zones are missing or invalid.");
  }

  const total = CALIBRATION_SIZE * CALIBRATION_SIZE;
  const occupied = new Uint8Array(total);
  const zones = {};

  for (const [zoneName, runs] of Object.entries(parsed.zones)) {
    if (!ZONE_KEYS.includes(zoneName)) {
      throw new Error(`Unsupported calibration zone: ${zoneName}`);
    }
    if (!Array.isArray(runs) || runs.length % 2 !== 0) {
      throw new Error(`${zoneName} must contain [start,length] RLE pairs.`);
    }

    const cleanRuns = [];
    for (let i = 0; i < runs.length; i += 2) {
      const start = Number(runs[i]);
      const length = Number(runs[i + 1]);
      if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length <= 0 || start + length > total) {
        throw new Error(`${zoneName} contains an invalid or out-of-bounds RLE run.`);
      }

      for (let pixel = start; pixel < start + length; pixel += 1) {
        if (occupied[pixel]) {
          const otherZone = ZONE_KEYS[occupied[pixel] - 1] || "another zone";
          throw new Error(`${zoneName} overlaps ${otherZone} at UV pixel ${pixel}.`);
        }
        occupied[pixel] = ZONE_KEYS.indexOf(zoneName) + 1;
      }
      cleanRuns.push(start, length);
    }

    if (cleanRuns.length) zones[zoneName] = cleanRuns;
  }

  return { size: CALIBRATION_SIZE, zones };
}

function replaceCalibrationMask(value) {
  if (!calibrationActive || !model || !currentModelDef) {
    throw new Error("Start mapping on a shape-only species before importing a mask.");
  }

  const parsed = normalizeCalibrationMaskPayload(value);
  disposeMaskAtlases();
  currentMaskData = parsed;
  maskAtlases = buildMaskAtlases();
  applyCalibratedMaterials(model);
  applyPreviewMode("accurate");
  updatePalette(paletteFromEditor());
  saveCalibrationDraftNow();
  scheduleCalibrationCoverage();
  return parsed;
}

async function loadMaskData(def) {
  if (!def) return null;
  if (def.maskGlobal && window[def.maskGlobal]) return window[def.maskGlobal];
  if (def.maskUrl) {
    const response = await fetch(def.maskUrl, { cache: "no-cache" });
    if (!response.ok) throw new Error(`Zone mask failed: ${response.status} ${def.maskUrl}`);
    const parsed = await response.json();
    if (!parsed || !Number(parsed.size) || !parsed.zones || typeof parsed.zones !== "object") {
      throw new Error(`Invalid zone mask for ${def.displayName}`);
    }
    return parsed;
  }
  return null;
}

function loadCalibrationDraft() {
  const key = calibrationStorageKey();
  if (!key) return false;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    currentMaskData = normalizeCalibrationMaskPayload(raw);
    maskAtlases = buildMaskAtlases();
    return true;
  } catch (error) {
    try { localStorage.removeItem(key); } catch {}
    setCalibrationStatus(`Discarded invalid saved calibration draft: ${error.message}`);
    return false;
  }
}

function startCalibration() {
  if (!calibrationAvailable()) {
    setCalibrationStatus("Load a shape-only species model before starting calibration.");
    return;
  }
  calibrationActive = true;
  calibrationIslandFillMode = false;
  calibrationUndoStack = [];
  calibrationRedoStack = [];
  uvCoverage = buildModelUvCoverage(model);
  const restoredDraft = loadCalibrationDraft();
  if (!restoredDraft) createBlankCalibrationMask();
  applyCalibratedMaterials(model);
  applyPreviewMode("accurate");
  stage.classList.add("skin-calibrating");
  if (calibrationToggleEl) calibrationToggleEl.textContent = "Stop mapping";
  if (calibrationIslandFillEl) {
    calibrationIslandFillEl.disabled = !uvCoverage?.some?.((value) => value === 1);
    calibrationIslandFillEl.textContent = "Island fill: off";
    calibrationIslandFillEl.classList.remove("green");
  }
  updateCalibrationHistoryButtons();
  if (calibrationClearZoneEl) calibrationClearZoneEl.disabled = false;
  if (calibrationClearAllEl) calibrationClearAllEl.disabled = false;
  if (calibrationCopyEl) calibrationCopyEl.disabled = false;
  if (calibrationImportButtonEl) calibrationImportButtonEl.disabled = false;
  if (calibrationOutputEl) { calibrationOutputEl.hidden = true; calibrationOutputEl.value = ""; }
  scheduleCalibrationCoverage();
  const uvPixels = uvCoverage?.reduce?.((sum, value) => sum + (value ? 1 : 0), 0) || 0;
  setCalibrationStatus(restoredDraft
    ? `${currentModelDef.displayName} · restored saved calibration draft · ${uvPixels.toLocaleString()} UV pixels detected.`
    : `${currentModelDef.displayName} · calibration active · ${uvPixels.toLocaleString()} UV pixels detected. Brush or enable Island fill.`);
}

function stopCalibration() {
  clearTimeout(calibrationSaveTimer);
  saveCalibrationDraftNow();
  calibrationActive = false;
  calibrationPointerDown = false;
  calibrationIslandFillMode = false;
  clearTimeout(calibrationCoverageTimer);
  controls.enabled = true;
  stage.classList.remove("skin-calibrating");
  if (calibrationToggleEl) calibrationToggleEl.textContent = "Start mapping";
  if (calibrationIslandFillEl) {
    calibrationIslandFillEl.disabled = true;
    calibrationIslandFillEl.textContent = "Island fill: off";
    calibrationIslandFillEl.classList.remove("green");
  }
  calibrationUndoStack = [];
  calibrationRedoStack = [];
  updateCalibrationHistoryButtons();
  if (calibrationClearZoneEl) calibrationClearZoneEl.disabled = true;
  if (calibrationClearAllEl) calibrationClearAllEl.disabled = true;
  if (calibrationCopyEl) calibrationCopyEl.disabled = true;
  if (calibrationImportButtonEl) calibrationImportButtonEl.disabled = true;
  const label = currentSpeciesLabel;
  currentModelDef = null;
  disposeModel();
  loadModelForSpecies(label);
  setCalibrationStatus("Calibration stopped. Export before stopping if you want to keep the current mapping.");
}

function syncZoneHint() {
  if (zoneHintEl) {
    zoneHintEl.hidden = !calibrated();
    zoneHintEl.textContent = calibrationActive ? "DRAG ON HIDE TO MAP ZONES" : "CLICK ZONE TO PAINT";
  }
}

function applyPreviewMode(mode) {
  if (!calibrated()) {
    previewMode = "game";
  } else {
    previewMode = mode === "game" ? "game" : "accurate";
  }

  const accurate = previewMode === "accurate" && calibrated();
  renderer.toneMapping = accurate ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = accurate ? 1.0 : 1.08;
  scene.fog = accurate ? null : gameFog;

  if (accurate) {
    hemi.color.set(0xffffff);
    hemi.groundColor.set(0x666666);
    hemi.intensity = 1.0;
    key.color.set(0xffffff);
    key.intensity = 2.2;
    rim.color.set(0xffffff);
    rim.intensity = 0.0;
    fill.color.set(0xffffff);
    fill.intensity = 0.0;
    groundMaterial.color.set(0x171717);
  } else {
    const factor = Number(lightInput?.value || 105) / 105;
    hemi.color.set(0xc6e9d4);
    hemi.groundColor.set(0x07100c);
    hemi.intensity = 1.05 * Math.max(0.55, factor);
    key.color.set(0xffedd2);
    key.intensity = 3.5 * factor;
    rim.color.set(0x5cffad);
    rim.intensity = 1.6 * Math.max(0.6, factor);
    fill.color.set(0x8eb2c4);
    fill.intensity = 0.65;
    groundMaterial.color.set(0x07110d);
  }

  if (calibrated()) {
    for (const binding of materialBindings) {
      const materials = binding.pairs.map((pair) => pair[previewMode]);
      binding.child.material = binding.array ? materials : materials[0];
    }
  }

  if (accurateButton) {
    accurateButton.disabled = !calibrated();
    accurateButton.setAttribute("aria-pressed", accurate ? "true" : "false");
    accurateButton.classList.toggle("green", accurate);
  }
  if (gameButton) {
    gameButton.disabled = !calibrated();
    gameButton.setAttribute("aria-pressed", accurate ? "false" : calibrated() ? "true" : "false");
    gameButton.classList.toggle("green", calibrated() && !accurate);
  }
  if (lightInput) lightInput.disabled = accurate;

  syncZoneHint();

  if (statusEl && model && currentModelDef) {
    if (currentModelDef.capability === "zones") {
      statusEl.textContent = `${currentModelDef.displayName} · ${accurate ? "EVRIMA linear colour" : "calibrated game preview"}`;
    } else {
      statusEl.textContent = `${currentModelDef.displayName} · provisional Body tint · zones pending`;
    }
  }
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
  const cameraConfig = currentModelDef?.camera || {};
  const targetHeight = Number(cameraConfig.targetHeight) || 0.50;
  const target = new THREE.Vector3(0, centered.min.y + finalSize.y * targetHeight, 0);
  ground.position.y = centered.min.y - 0.035;

  const rect = stage.getBoundingClientRect();
  const aspect = Math.max(0.7, rect.width / Math.max(1, rect.height));
  const vfov = THREE.MathUtils.degToRad(camera.fov);
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
  const length = Math.max(finalSize.x, finalSize.z);
  const distanceScale = Number(cameraConfig.distanceScale) || 0.60;
  const distance = Math.max(
    7.2,
    (length * distanceScale) / Math.tan(hfov / 2),
    (finalSize.y * 0.68) / Math.tan(vfov / 2)
  );
  const yaw = Number(cameraConfig.yaw) || 0.24;

  camera.position.set(distance, target.y + finalSize.y * 0.13, distance * yaw);
  controls.target.copy(target);
  controls.update();
  homeCamera = { position: camera.position.clone(), target: controls.target.clone() };
}

function updatePalette(palette) {
  currentPalette = { ...currentPalette, ...(palette || {}) };
  for (const controller of shaderControllers) {
    controller.setPalette(currentPalette);
    controller.setSex?.(currentSex);
  }
  updateShapeBodyTint(currentPalette.body);
  syncZoneStrip();
}

function syncZoneStrip() {
  if (!zoneStrip) return;
  const inputs = [...document.querySelectorAll("#skin-colors .skin-color-control input[type=color]")];
  if (!inputs.length) return;

  const isLive = calibrated();
  zoneStrip.innerHTML = inputs.map((input) => {
    const label = input.closest(".skin-color-control")?.querySelector("span")?.textContent || input.id;
    const className = isLive ? "skin-model-zone skin-zone-live" : "skin-model-zone skin-zone-saved-only";
    return '<button type="button" class="' + className + '" data-input="' + input.id + '">' +
      '<i style="background:' + input.value + '"></i><span>' + label + '</span><b>' + input.value.toUpperCase() + '</b></button>';
  }).join("");

  zoneStrip.querySelectorAll(".skin-model-zone").forEach((button) => {
    button.addEventListener("click", () => document.getElementById(button.dataset.input)?.click());
  });

  document.querySelectorAll("#skin-colors .skin-color-control").forEach((control) => {
    control.classList.toggle("skin-zone-live-control", isLive);
    control.classList.toggle("skin-zone-saved-only", !isLive);
    control.title = isLive
      ? `Live on the calibrated ${currentModelDef?.displayName || "species"} 3D model.`
      : "This colour saves and applies in game, but this species 3D model is not zone-calibrated yet.";
  });
}

function disposeModel() {
  if (referenceFrame) {
    referenceFrame.hidden = true;
    referenceFrame.removeAttribute("src");
  }
  stage.classList.remove("skin-reference-mode");

  if (model) {
    scene.remove(model);
    model.traverse((child) => {
      if (!child.isMesh) return;
      try { child.geometry?.dispose?.(); } catch {}
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        try { material?.dispose?.(); } catch {}
      }
    });
  }
  model = null;
  homeCamera = null;
  shaderControllers = [];
  materialBindings = [];
  shapeTintMaterials = [];
  disposeMaskAtlases();
  currentMaskData = null;
  zoneLookup = null;
}

function setLocalModelControlsEnabled(enabled) {
  for (const control of [accurateButton, gameButton, autoRotateButton, ultraButton, spinInput, lightInput]) {
    if (control) control.disabled = !enabled;
  }
  if (resetButton) resetButton.disabled = !enabled;
}

function showReferenceModel(def, label) {
  disposeModel();
  currentModelDef = def;
  currentSpeciesLabel = label || def?.displayName || "";
  setRail(def, label);

  setLocalModelControlsEnabled(false);
  if (calibrationToggleEl) calibrationToggleEl.disabled = true;
  if (calibrationClearZoneEl) calibrationClearZoneEl.disabled = true;
  if (calibrationClearAllEl) calibrationClearAllEl.disabled = true;
  if (calibrationCopyEl) calibrationCopyEl.disabled = true;
  if (calibrationImportButtonEl) calibrationImportButtonEl.disabled = true;

  syncZoneStrip();
  syncZoneHint();

  const src = def?.loader?.url;
  if (!referenceFrame || !src) {
    showNoModel(label, def);
    return;
  }

  stage.classList.add("skin-reference-mode");
  referenceFrame.src = src;
  referenceFrame.hidden = false;
  if (loaderEl) loaderEl.hidden = true;
  setStatus(true, `${def.displayName} · realistic reference model · paint mesh pending`);
  setCalibrationStatus(`${def.displayName} is reference-only. Install a matching high-detail local mesh before UV zone calibration.`);

  document.dispatchEvent(new CustomEvent("hds:skin-model-ready", {
    detail: { species: def.key, capability: def.capability },
  }));
}

async function loadChunkedGlb(def, token) {
  const loader = def.loader || {};
  const count = Number(loader.count) || 0;
  if (!count || !loader.root) throw new Error("Chunked model configuration is incomplete");

  let completed = 0;
  const prefix = loader.prefix || "model-";
  const extension = loader.extension || ".b64";
  const version = loader.version ? `?v=${encodeURIComponent(loader.version)}` : "";
  const urls = Array.from({ length: count }, (_, index) =>
    `${loader.root}/${prefix}${String(index).padStart(2, "0")}${extension}${version}`
  );

  const chunks = await Promise.all(urls.map(async (url) => {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) throw new Error(`Model chunk failed: ${response.status} ${url}`);
    const text = (await response.text()).replace(/\s+/g, "");
    completed += 1;
    if (loaderEl && token === currentLoadToken) {
      loaderEl.textContent = `Loading ${def.displayName}… ${Math.round((completed / count) * 74)}%`;
    }
    return text;
  }));

  if (token !== currentLoadToken) throw new Error("Model load superseded");
  const base64 = chunks.join("");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const gltfLoader = new GLTFLoader();
  gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  return gltfLoader.parseAsync(bytes.buffer, "");
}

async function loadModelResource(def, token) {
  if (!def?.loader) throw new Error("No model loader configured");
  if (def.loader.type === "chunked-base64") return loadChunkedGlb(def, token);
  if (def.loader.type === "url" && def.loader.url) {
    if (loaderEl) loaderEl.textContent = `Loading ${def.displayName}…`;
    const gltfLoader = new GLTFLoader();
    gltfLoader.setMeshoptDecoder(MeshoptDecoder);
    return gltfLoader.loadAsync(def.loader.url);
  }
  throw new Error(`Unsupported model loader for ${def.displayName}`);
}

function showNoModel(label, def = null) {
  disposeModel();
  setLocalModelControlsEnabled(false);
  currentModelDef = def;
  currentSpeciesLabel = label || "";
  setRail(def, label);

  if (accurateButton) accurateButton.disabled = true;
  if (gameButton) gameButton.disabled = true;
  syncZoneStrip();
  syncZoneHint();

  const universal = normalizedSpecies(label).includes("universal") || normalizedSpecies(label).includes("any species");
  const message = universal
    ? "Universal design · choose a species-specific compatibility for an accurate 3D model"
    : def?.capability === "pending"
      ? `${def.displayName} · dedicated model pending`
      : label
        ? `${label} · dedicated model not configured yet`
        : "Choose a species · 3D preview waiting";

  setStatus(false, message);
  if (loaderEl) {
    loaderEl.hidden = false;
    loaderEl.innerHTML = universal
      ? "<strong>Universal skin</strong><span>Select a specific species to preview its real model.</span>"
      : def?.capability === "pending"
        ? `<strong>${def.displayName} model is next</strong><span>The preview is disabled until its mesh and EVRIMA colour zones are verified.</span>`
        : "<strong>No dedicated species model yet</strong><span>Skin values still save and Wear Live normally.</span>";
  }
}

async function loadModelForSpecies(label) {
  const def = resolveModelDefinition(label);
  const normalized = normalizedSpecies(label);
  const sameDefinition = currentModelDef?.key && def?.key === currentModelDef.key;

  if (sameDefinition && (model || (def?.capability === "reference" && referenceFrame?.src))) {
    currentSpeciesLabel = label;
    setRail(def, label);
    return;
  }

  currentLoadToken += 1;
  const token = currentLoadToken;
  disposeModel();
  currentModelDef = def;
  currentSpeciesLabel = label || "";
  setRail(def, label);

  if (!def || def.capability === "pending" || !def.loader) {
    showNoModel(label, def);
    return;
  }

  if (def.capability === "reference" || def.loader.type === "reference-embed") {
    showReferenceModel(def, label);
    return;
  }

  setLocalModelControlsEnabled(true);

  try {
    setStatus(false, `${def.displayName} · loading dedicated model`);
    if (loaderEl) {
      loaderEl.hidden = false;
      loaderEl.textContent = `Loading ${def.displayName}…`;
    }

    currentPalette = paletteFromEditor();
    if (def.capability === "zones") {
      currentMaskData = await loadMaskData(def);
      maskAtlases = buildMaskAtlases();
    }

    const gltf = await loadModelResource(def, token);
    if (token !== currentLoadToken) return;

    model = gltf.scene;
    if (def.capability === "zones") applyCalibratedMaterials(model);
    else applyShapeMaterials(model);

    scene.add(model);
    frameModel(model);
    updatePalette(paletteFromEditor());

    if (def.capability === "zones") {
      applyPreviewMode(previewMode);
      setStatus(true, `${def.displayName} · ${previewMode === "accurate" ? "EVRIMA linear colour" : "calibrated game preview"}`);
    } else {
      applyPreviewMode("game");
      setStatus(true, `${def.displayName} · realistic paint mesh · provisional Body tint · zones pending`);
    }

    if (loaderEl) loaderEl.hidden = true;
    setLocalModelControlsEnabled(true);
    setCalibrationStatus(def.capability === "shape"
      ? `${def.displayName} is inside Hollow Valley's renderer. Body colour is live as a provisional whole-model tint; map the EVRIMA UV zones to unlock accurate per-region colour painting.`
      : `${def.displayName} already has a calibrated zone map.`);
    if (calibrationToggleEl) calibrationToggleEl.disabled = def.capability !== "shape";
    document.dispatchEvent(new CustomEvent("hds:skin-model-ready", {
      detail: { species: def.key, capability: def.capability },
    }));
  } catch (error) {
    if (token !== currentLoadToken || /superseded/i.test(String(error?.message || ""))) return;
    console.error("Failed to load Skin Studio species model", def?.key, error);
    disposeModel();
    currentModelDef = def;
    setRail(def, label);
    setStatus(false, `${def.displayName} · model load failed`);
    if (loaderEl) {
      loaderEl.hidden = false;
      loaderEl.innerHTML = `<strong>${def.displayName} model failed to load</strong><span>Skin values are unaffected. Refresh the page to retry the 3D asset.</span>`;
    }
  }
}

function selectedSpeciesLabel() {
  const option = speciesSelect?.selectedOptions?.[0];
  return option?.textContent || speciesSelect?.value || "";
}

const zoneRaycaster = new THREE.Raycaster();
const zonePointer = new THREE.Vector2();
let pointerDownPosition = null;

function hitUvAt(clientX, clientY) {
  if (!model) return null;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  zonePointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  zonePointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
  zoneRaycaster.setFromCamera(zonePointer, camera);
  return zoneRaycaster.intersectObject(model, true).find((entry) => entry.uv)?.uv || null;
}

function lookupZoneFromUv(uv) {
  if (!calibrated() || !zoneLookup || !currentMaskData?.size || !uv) return null;
  const size = currentMaskData.size;
  const x = Math.max(0, Math.min(size - 1, Math.floor(uv.x * size)));
  const yDirect = Math.max(0, Math.min(size - 1, Math.floor(uv.y * size)));
  const yFlipped = Math.max(0, Math.min(size - 1, Math.floor((1 - uv.y) * size)));
  const zoneKeys = ["body", "markings", "flank", "underbelly", "detail1", "eyes", "teeth", "mouth", "claws", "maleDisplay"];
  const direct = zoneLookup[yDirect * size + x];
  const flipped = zoneLookup[yFlipped * size + x];
  const index = direct || flipped;
  return index ? zoneKeys[index - 1] : null;
}

function selectPaintZoneAt(clientX, clientY) {
  if (!calibrated() || !model) return;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  zonePointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  zonePointer.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
  zoneRaycaster.setFromCamera(zonePointer, camera);

  const hit = zoneRaycaster.intersectObject(model, true).find((entry) => entry.uv);
  const zone = lookupZoneFromUv(hit?.uv);
  if (!zone) return;

  const input = document.getElementById(`skin-color-${zone}`);
  const control = input?.closest?.(".skin-color-control");
  if (!input || !control) return;

  document.querySelectorAll(".skin-color-control.skin-zone-selected").forEach((node) => {
    node.classList.remove("skin-zone-selected");
  });
  control.classList.add("skin-zone-selected");
  control.scrollIntoView({ behavior: "smooth", block: "nearest" });
  input.click();
}

canvas.addEventListener("pointerdown", (event) => {
  pointerDownPosition = { x: event.clientX, y: event.clientY };
  if (calibrationActive && event.button === 0) {
    controls.enabled = false;

    if (calibrationIslandFillMode) {
      calibrationPointerDown = false;
      fillCalibrationIsland(hitUvAt(event.clientX, event.clientY));
      return;
    }

    calibrationPointerDown = true;
    pushCalibrationHistory();
    paintCalibrationUv(hitUvAt(event.clientX, event.clientY));
  }
});

canvas.addEventListener("pointermove", (event) => {
  if (calibrationActive && calibrationPointerDown && !calibrationIslandFillMode) {
    paintCalibrationUv(hitUvAt(event.clientX, event.clientY));
  }
});

canvas.addEventListener("pointerup", (event) => {
  const start = pointerDownPosition;
  pointerDownPosition = null;
  if (calibrationActive) {
    const wasPainting = calibrationPointerDown;
    calibrationPointerDown = false;
    controls.enabled = true;
    if (wasPainting && !calibrationIslandFillMode) {
      paintCalibrationUv(hitUvAt(event.clientX, event.clientY));
      updateCalibrationHistoryButtons();
    }
    return;
  }
  if (!start) return;
  const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
  if (distance <= 5) selectPaintZoneAt(event.clientX, event.clientY);
});

canvas.addEventListener("pointercancel", () => {
  calibrationPointerDown = false;
  controls.enabled = true;
});

calibrationDiagnosticEl?.addEventListener("click", loadDiagnosticPalette);

calibrationBrushEl?.addEventListener("input", () => {
  if (calibrationBrushValueEl) calibrationBrushValueEl.textContent = `${calibrationBrushEl.value} px`;
});
calibrationToggleEl?.addEventListener("click", () => calibrationActive ? stopCalibration() : startCalibration());
calibrationClearZoneEl?.addEventListener("click", () => {
  const zone = calibrationZoneEl?.value || "body";
  if (zone === "erase") return;
  const index = ZONE_KEYS.indexOf(zone) + 1;
  for (let pixel=0;pixel<zoneLookup.length;pixel+=1) {
    if (zoneLookup[pixel] === index) setAtlasPixel(pixel, null);
  }
  for (const texture of maskAtlases) texture.needsUpdate = true;
  saveCalibrationDraftSoon();
  scheduleCalibrationCoverage();
  setCalibrationStatus(`${currentModelDef?.displayName || "Species"} · cleared ${zone} · draft auto-saved`);
});
calibrationClearAllEl?.addEventListener("click", () => {
  if (!calibrationActive) return;
  zoneLookup.fill(0);
  for (const texture of maskAtlases) {
    texture.image.data.fill(0);
    texture.needsUpdate = true;
  }
  saveCalibrationDraftSoon();
  scheduleCalibrationCoverage();
  setCalibrationStatus(`${currentModelDef?.displayName || "Species"} · cleared all mapped zones · draft auto-saved`);
});
calibrationImportButtonEl?.addEventListener("click", () => {
  try {
    const raw = String(calibrationImportEl?.value || "").trim();
    if (!raw) throw new Error("Paste a calibration mask first.");
    const parsed = replaceCalibrationMask(raw);
    const zoneCount = Object.keys(parsed.zones).length;
    setCalibrationStatus(`${currentModelDef.displayName} · imported ${zoneCount} mapped zone${zoneCount === 1 ? "" : "s"} · draft saved locally`);
  } catch (error) {
    setCalibrationStatus(`Mask import rejected: ${error.message}`);
  }
});

calibrationClearImportEl?.addEventListener("click", () => {
  if (calibrationImportEl) calibrationImportEl.value = "";
});

calibrationCopyEl?.addEventListener("click", async () => {
  saveCalibrationDraftNow();
  const output = exportCalibrationMask();
  if (!output) return;
  if (calibrationOutputEl) { calibrationOutputEl.value = output; calibrationOutputEl.hidden = false; }
  try { await navigator.clipboard.writeText(output); setCalibrationStatus(`${currentModelDef.displayName} · JSON mask copied to clipboard`); }
  catch { setCalibrationStatus(`${currentModelDef.displayName} · JSON mask ready below; copy it manually`); }
});

installModeControls();
setRail(null, "");
applyPreviewMode("game");
syncZoneStrip();

speciesSelect?.addEventListener("change", () => {
  loadModelForSpecies(selectedSpeciesLabel());
});

document.addEventListener("hds:skin-preview-change", (event) => {
  currentSex = event.detail?.sex === "female" ? "female" : "male";
  updatePalette(event.detail?.skin || paletteFromEditor());
  const label = event.detail?.species || selectedSpeciesLabel();
  const def = resolveModelDefinition(label);
  if ((def?.key || null) !== (currentModelDef?.key || null) || (!def && model)) {
    loadModelForSpecies(label);
  } else if (!currentSpeciesLabel && label) {
    loadModelForSpecies(label);
  }
});

document.addEventListener("input", (event) => {
  if (event.target?.matches?.("#skin-colors input[type=color]")) {
    updatePalette(paletteFromEditor());
  }
});

resetButton?.addEventListener("click", () => {
  if (model) model.rotation.y = 0;
  if (spinInput) spinInput.value = "0";
  if (!homeCamera) return;
  camera.position.copy(homeCamera.position);
  controls.target.copy(homeCamera.target);
  controls.update();
});

lightInput?.addEventListener("input", () => {
  if (previewMode !== "game") return;
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
loadModelForSpecies(selectedSpeciesLabel());
