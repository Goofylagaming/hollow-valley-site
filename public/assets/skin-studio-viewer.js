/* Hollow Valley Skin Studio · independent, optional 3D reference viewer.
 * The editor owns the original floating-point skin data. This viewer receives
 * display HEX values only and never writes to a skin, a preset, or an API.
 * Third-party meshes and the fixed Rex mask are visual guides, not game assets.
 */

const elements = Object.fromEntries([
  "canvas", "empty", "status", "title", "detail", "credit", "reset", "rotate", "light",
].map((name) => [name, document.getElementById(`hv-viewer-${name}`)]));

const COLOURS = Object.freeze({
  body: "#6F7652", markings: "#232713", flank: "#59613D", underbelly: "#B7AE8D",
  detail1: "#9C7B46", eyes: "#B7FF35", teeth: "#DED6B8", mouth: "#6D2E34",
  claws: "#28251E", maleDisplay: "#A6732B",
});
const ZONES = Object.keys(COLOURS);
const normalise = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

let latest = window.__HV_STUDIO_PREVIEW || {};
let engine = null;
let enginePromise = null;
let requestedKey = null;
let loadNumber = 0;
let loading = false;
let requestController = null;
let visible = true;
let animationFrame = 0;
let currentDefinition = null;

function modelDefinition(species) {
  const wanted = normalise(species);
  if (!wanted) return null;
  return Object.values(window.HV_SKIN_MODELS || {}).find((entry) =>
    [entry.key, entry.displayName, ...(entry.aliases || [])].some((alias) => normalise(alias) === wanted)
  ) || null;
}

function palette() {
  return Object.fromEntries(ZONES.map((zone) => {
    const value = String(latest.skin?.[zone] || "").trim();
    return [zone, /^#[0-9a-f]{6}$/i.test(value) ? value : COLOURS[zone]];
  }));
}

function showStatus(state, capability, message) {
  if (elements.status) {
    elements.status.textContent = message;
    elements.status.dataset.state = state;
  }
  document.dispatchEvent(new CustomEvent("hv:skin-viewer-status", {
    detail: { state, capability, species: currentDefinition?.key || latest.species || "", message },
  }));
}

function showEmpty(heading, description, retry = false) {
  if (!elements.empty) return;
  const title = document.createElement("strong");
  const detail = document.createElement("span");
  title.textContent = heading;
  detail.textContent = description;
  elements.empty.replaceChildren(title, detail);
  elements.empty.hidden = false;
  if (retry) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hv-button hv-button-quiet";
    button.textContent = "Retry 3D preview";
    button.addEventListener("click", () => { requestedKey = null; refreshPreview(); });
    elements.empty.append(button);
  }
}

function setControls(enabled) {
  for (const name of ["reset", "rotate", "light"]) {
    if (elements[name]) elements[name].disabled = !enabled;
  }
}

function updateMetadata(definition, capability) {
  if (elements.title) elements.title.textContent = definition?.displayName || latest.species || "Choose a preview species";
  if (elements.canvas) elements.canvas.setAttribute("aria-label", `${definition?.displayName || latest.species || "Dinosaur"} 3D reference. Drag to rotate and scroll to zoom.`);
  if (elements.detail) {
    elements.detail.textContent = capability === "guide"
      ? "Colour guide on a licensed reference model. The pattern is fixed; in-game colours, markings and growth can look different."
      : capability === "shape"
        ? "Shape reference with its original texture. Your palette is saved separately; this model does not show your skin colours."
        : "Use the palette to edit this species. A matching 3D reference is not available yet.";
  }
  if (elements.credit) {
    const url = definition?.credit?.url;
    elements.credit.hidden = !url;
    if (url) {
      elements.credit.href = url;
      elements.credit.textContent = definition.credit.label || "Model credit";
      elements.credit.target = "_blank";
      elements.credit.rel = "noopener noreferrer";
    } else {
      elements.credit.removeAttribute("href");
    }
  }
}

function disposeObject(root, extraMaterials = [], extraTextures = []) {
  if (!root) return;
  const geometries = new Set();
  const materials = new Set(extraMaterials);
  const textures = new Set(extraTextures);
  root.traverse((child) => {
    if (child.geometry) geometries.add(child.geometry);
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      if (material) materials.add(material);
    }
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
}

function clearModel() {
  if (!engine) return;
  if (engine.model) {
    engine.scene.remove(engine.model);
    disposeObject(engine.model, engine.sourceMaterials, engine.maskTextures);
  }
  engine.model = null;
  engine.home = null;
  engine.sourceMaterials = [];
  engine.maskTextures = [];
  engine.paletteUniforms = [];
  engine.controls.autoRotate = false;
  if (elements.rotate) elements.rotate.setAttribute("aria-pressed", "false");
}

function resize() {
  if (!engine) return;
  const rect = elements.canvas.parentElement.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  engine.renderer.setSize(width, height, false);
  engine.camera.aspect = width / height;
  engine.camera.updateProjectionMatrix();
}

function animate() {
  animationFrame = 0;
  if (!engine || !visible || document.hidden || engine.contextLost) return;
  engine.controls.update();
  engine.renderer.render(engine.scene, engine.camera);
  animationFrame = requestAnimationFrame(animate);
}

function resumeAnimation() {
  if (!animationFrame && engine && visible && !document.hidden) animate();
}

function updateLighting() {
  if (!engine) return;
  const value = Number(elements.light?.value || 100);
  const factor = Math.max(0.25, Math.min(2, value / 100));
  engine.key.intensity = 2.8 * factor;
  engine.fill.intensity = 1.2 * factor;
  engine.hemisphere.intensity = 1.8 * Math.max(0.5, factor);
}

async function initialiseEngine() {
  if (engine) return engine;
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    // Dynamic imports keep the rest of the studio usable if the CDN is blocked.
    // The page's import map pins all four modules to Three.js 0.169.0.
    const [THREE, { OrbitControls }, { GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
      import("three"),
      import("three/addons/controls/OrbitControls.js"),
      import("three/addons/loaders/GLTFLoader.js"),
      import("three/addons/libs/meshopt_decoder.module.js"),
    ]);
    const renderer = new THREE.WebGLRenderer({ canvas: elements.canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.05, 120);
    camera.position.set(9, 3, 5);
    const controls = new OrbitControls(camera, elements.canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.autoRotateSpeed = 0.55;
    controls.minPolarAngle = Math.PI * 0.12;
    controls.maxPolarAngle = Math.PI * 0.49;
    const hemisphere = new THREE.HemisphereLight(0xf7faf5, 0x45504a, 1.8);
    const key = new THREE.DirectionalLight(0xfff9ef, 2.8);
    key.position.set(4, 8, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -6;
    key.shadow.camera.right = 6;
    key.shadow.camera.top = 6;
    key.shadow.camera.bottom = -6;
    key.shadow.normalBias = 0.025;
    const fill = new THREE.DirectionalLight(0xe3ecf5, 1.2);
    fill.position.set(-5, 4, -5);
    scene.add(hemisphere, key, fill);
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(8, 64),
      new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.24 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.position.y = -0.012;
    const grid = new THREE.GridHelper(16, 32, 0x34443c, 0x26332c);
    grid.material.transparent = true;
    grid.material.opacity = 0.32;
    grid.material.depthWrite = false;
    grid.position.y = -0.02;
    scene.add(floor, grid);
    engine = {
      THREE, renderer, scene, camera, controls, GLTFLoader, MeshoptDecoder,
      hemisphere, key, fill, model: null, home: null, contextLost: false,
      sourceMaterials: [], maskTextures: [], paletteUniforms: [],
    };
    new ResizeObserver(resize).observe(elements.canvas.parentElement);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (!visible && animationFrame) { cancelAnimationFrame(animationFrame); animationFrame = 0; }
        resumeAnimation();
      }).observe(elements.canvas.parentElement);
    }
    elements.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      engine.contextLost = true;
      showStatus("error", "palette", "3D paused · palette remains available");
      showEmpty("3D preview paused", "The graphics context was interrupted. Your design is still available in the editor.");
    });
    elements.canvas.addEventListener("webglcontextrestored", () => {
      engine.contextLost = false;
      requestedKey = null;
      refreshPreview();
      resumeAnimation();
    });
    resize();
    updateLighting();
    resumeAnimation();
    return engine;
  })();
  try { return await enginePromise; }
  finally { enginePromise = null; }
}

function linearColour(hex, target) {
  const value = hex.replace("#", "");
  return target.setRGB(
    parseInt(value.slice(0, 2), 16) / 255,
    parseInt(value.slice(2, 4), 16) / 255,
    parseInt(value.slice(4, 6), 16) / 255,
    engine.THREE.LinearSRGBColorSpace
  );
}

function updateGuidePalette() {
  if (!engine) return;
  const colours = palette();
  for (const uniforms of engine.paletteUniforms) {
    for (const zone of ZONES) linearColour(colours[zone], uniforms[`hv_${zone}`].value);
    uniforms.hv_maleVisible.value = latest.sex === "female" ? 0 : 1;
  }
}

function installRexGuide(root, definition) {
  const mask = window[definition.maskGlobal];
  if (!mask || !Number.isInteger(mask.size) || mask.size < 1 || mask.size > 1024 || !mask.zones) return false;
  const { THREE } = engine;
  const channels = {
    body: [0, "r"], markings: [0, "g"], flank: [0, "b"], underbelly: [0, "a"],
    detail1: [1, "r"], eyes: [1, "g"], teeth: [1, "b"], mouth: [1, "a"],
    claws: [2, "r"], maleDisplay: [2, "g"],
  };
  const arrays = Array.from({ length: 3 }, () => new Uint8Array(mask.size * mask.size * 4));
  for (const zone of ZONES) {
    const runs = mask.zones[zone] || [];
    const [atlas, channel] = channels[zone];
    const offset = "rgba".indexOf(channel);
    if (!Array.isArray(runs) || runs.length % 2) return false;
    for (let index = 0; index < runs.length; index += 2) {
      const start = runs[index], length = runs[index + 1];
      if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 0 || start + length > mask.size * mask.size) return false;
      for (let pixel = start; pixel < start + length; pixel++) arrays[atlas][pixel * 4 + offset] = 255;
    }
  }
  engine.maskTextures = arrays.map((data) => {
    const texture = new THREE.DataTexture(data, mask.size, mask.size, THREE.RGBAFormat);
    texture.colorSpace = THREE.NoColorSpace;
    texture.flipY = false;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
    return texture;
  });
  root.traverse((child) => {
    if (!child.isMesh || !child.geometry?.attributes?.uv) return;
    const replace = (source) => {
      if (!source?.map) return source;
      const material = source.clone();
      const uniforms = {
        hv_mask0: { value: engine.maskTextures[0] },
        hv_mask1: { value: engine.maskTextures[1] },
        hv_mask2: { value: engine.maskTextures[2] },
        hv_maleVisible: { value: latest.sex === "female" ? 0 : 1 },
      };
      for (const zone of ZONES) uniforms[`hv_${zone}`] = { value: new THREE.Color() };
      material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader = shader.fragmentShader.replace("#include <common>", `#include <common>
          uniform sampler2D hv_mask0; uniform sampler2D hv_mask1; uniform sampler2D hv_mask2;
          uniform float hv_maleVisible;
          ${ZONES.map((zone) => `uniform vec3 hv_${zone};`).join("\n")}`);
        shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>
          vec4 hv_masks0 = texture2D(hv_mask0, vMapUv);
          vec4 hv_masks1 = texture2D(hv_mask1, vMapUv);
          vec4 hv_masks2 = texture2D(hv_mask2, vMapUv);
          float hv_surface = clamp(0.5 + dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) * 0.8, 0.45, 1.15);
          ${ZONES.map((zone) => {
            const [atlas, channel] = channels[zone];
            const alpha = zone === "maleDisplay" ? " * hv_maleVisible" : "";
            return `diffuseColor.rgb = mix(diffuseColor.rgb, hv_${zone} * hv_surface, hv_masks${atlas}.${channel}${alpha});`;
          }).join("\n")}`);
      };
      material.customProgramCacheKey = () => "hv-new-studio-rex-colour-guide-v1";
      material.needsUpdate = true;
      engine.sourceMaterials.push(source);
      engine.paletteUniforms.push(uniforms);
      return material;
    };
    child.material = Array.isArray(child.material) ? child.material.map(replace) : replace(child.material);
  });
  updateGuidePalette();
  return engine.paletteUniforms.length > 0;
}

async function parseModelBuffer(buffer, resourcePath = "") {
  const loader = new engine.GLTFLoader();
  loader.setMeshoptDecoder(engine.MeshoptDecoder);
  // Allosaurus uses compressed KTX2 textures. Meshopt handles geometry only;
  // detect the embedded extension so a valid model does not silently fail.
  const header = new DataView(buffer);
  if (buffer.byteLength >= 20 && header.getUint32(0, true) === 0x46546c67) {
    const jsonLength = header.getUint32(12, true);
    if (jsonLength <= buffer.byteLength - 20) {
      const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLength)));
      if (manifest.extensionsUsed?.includes("KHR_texture_basisu")) {
        if (!engine.ktx2Loader) {
          const { KTX2Loader } = await import("three/addons/loaders/KTX2Loader.js");
          engine.ktx2Loader = new KTX2Loader()
            .setTranscoderPath("https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/libs/basis/")
            .setWorkerLimit(2)
            .detectSupport(engine.renderer);
        }
        loader.setKTX2Loader(engine.ktx2Loader);
      }
    }
  }
  return loader.parseAsync(buffer, resourcePath);
}

async function loadAsset(definition, signal) {
  const source = definition.loader;
  if (source.type === "chunked-base64") {
    const chunks = await Promise.all(Array.from({ length: source.count }, async (_, index) => {
      const url = `${source.root}/${source.prefix}${String(index).padStart(2, "0")}${source.extension}?v=${encodeURIComponent(source.version || "1")}`;
      const response = await fetch(url, { signal, cache: "force-cache" });
      if (!response.ok) throw new Error(`Model download returned ${response.status}.`);
      return (await response.text()).replace(/\s+/g, "");
    }));
    if (signal.aborted) throw new DOMException("Preview changed", "AbortError");
    const binary = atob(chunks.join(""));
    const buffer = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) buffer[index] = binary.charCodeAt(index);
    return parseModelBuffer(buffer.buffer);
  }
  if (source.type !== "url") throw new Error("This model format is not available in the studio.");
  const response = await fetch(source.url, { signal, cache: "force-cache" });
  if (!response.ok) throw new Error(`Model download returned ${response.status}.`);
  const buffer = await response.arrayBuffer();
  const resourcePath = new URL(".", new URL(source.url, location.href)).href;
  return parseModelBuffer(buffer, resourcePath);
}

function frameModel(root, definition) {
  const { THREE, camera, controls } = engine;
  root.updateMatrixWorld(true);
  const initialBox = new THREE.Box3().setFromObject(root);
  const initialSize = initialBox.getSize(new THREE.Vector3());
  const longest = Math.max(initialSize.x, initialSize.y, initialSize.z);
  if (!Number.isFinite(longest) || longest <= 0) throw new Error("Model has no visible geometry.");
  root.scale.multiplyScalar(7 / longest);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  root.position.y -= box.min.y;
  root.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3());
  const target = new THREE.Vector3(0, size.y * (definition.camera?.targetHeight || 0.48), 0);
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const widthFit = Math.max(size.x, size.z) / (2 * Math.tan(halfFov) * Math.max(0.6, camera.aspect));
  const heightFit = size.y / (2 * Math.tan(halfFov));
  const distance = Math.max(7.8, widthFit * 1.15, heightFit * 1.25);
  camera.position.set(distance, target.y + size.y * 0.25 + 0.8, distance * (definition.camera?.yaw || 0.24));
  controls.target.copy(target);
  controls.minDistance = Math.max(2, distance * 0.35);
  controls.maxDistance = distance * 2.4;
  controls.update();
  engine.home = { position: camera.position.clone(), target: target.clone() };
}

async function refreshPreview() {
  if (!elements.canvas) return;
  const definition = modelDefinition(latest.species);
  const key = definition?.key || normalise(latest.species) || "palette";
  if (key === requestedKey && (loading || engine?.model)) {
    updateGuidePalette();
    return;
  }
  requestedKey = key;
  currentDefinition = definition;
  const thisLoad = ++loadNumber;
  requestController?.abort();
  requestController = new AbortController();
  clearModel();
  setControls(false);
  const canLoad = definition?.loader && ["url", "chunked-base64"].includes(definition.loader.type);
  if (!canLoad) {
    loading = false;
    updateMetadata(definition, "palette");
    showStatus("palette", "palette", "Palette only");
    showEmpty("Your palette, every species", "Choose a species with a 3D reference, or keep creating with the colour palette.");
    return;
  }
  loading = true;
  updateMetadata(definition, definition.key === "tyrannosaurus" ? "guide" : "shape");
  showStatus("loading", "palette", `Loading ${definition.displayName}…`);
  showEmpty("Loading species reference", "Your palette stays editable while the model loads.");
  try {
    await initialiseEngine();
    if (thisLoad !== loadNumber) return;
    const gltf = await loadAsset(definition, requestController.signal);
    if (thisLoad !== loadNumber) { disposeObject(gltf.scene); return; }
    engine.model = gltf.scene;
    engine.model.traverse((child) => {
      if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
    });
    const guide = definition.key === "tyrannosaurus" && installRexGuide(engine.model, definition);
    engine.scene.add(engine.model);
    resize();
    frameModel(engine.model, definition);
    updateGuidePalette();
    if (elements.empty) elements.empty.hidden = true;
    setControls(true);
    updateMetadata(definition, guide ? "guide" : "shape");
    showStatus("ready", guide ? "guide" : "shape", guide ? "Colour guide · fixed pattern" : "Shape reference · original colours");
    resumeAnimation();
  } catch (error) {
    if (thisLoad !== loadNumber || error?.name === "AbortError") return;
    clearModel();
    setControls(false);
    showStatus("error", "palette", "3D unavailable · palette still works");
    showEmpty("Keep creating with your palette", "This 3D reference could not load. You can still edit, save and apply your skin.", true);
    console.warn("Hollow Valley optional 3D preview:", error?.message || error);
  } finally {
    if (thisLoad === loadNumber) loading = false;
  }
}

elements.reset?.addEventListener("click", () => {
  if (!engine?.home) return;
  engine.camera.position.copy(engine.home.position);
  engine.controls.target.copy(engine.home.target);
  engine.controls.update();
});
elements.rotate?.addEventListener("click", () => {
  if (!engine?.model) return;
  engine.controls.autoRotate = !engine.controls.autoRotate;
  elements.rotate.setAttribute("aria-pressed", String(engine.controls.autoRotate));
});
elements.light?.addEventListener("input", updateLighting);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && animationFrame) { cancelAnimationFrame(animationFrame); animationFrame = 0; }
  resumeAnimation();
});
document.addEventListener("hds:skin-preview-change", (event) => {
  latest = event.detail || {};
  refreshPreview();
});

setControls(false);
refreshPreview();
