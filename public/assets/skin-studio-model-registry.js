// Hollow Valley Skin Studio species-model registry.
// One entry exists for every species exposed by the website. A species only
// receives live colour painting after a high-quality model AND its EVRIMA zone
// map have been calibrated. Low-detail placeholder models are deliberately not
// used; a realistic reference embed is preferred until a suitable local mesh exists.

const pendingModel = (key, displayName, aliases = []) => Object.freeze({
  key,
  aliases: Object.freeze([key, displayName, ...aliases]),
  displayName,
  capability: "pending",
  patternMax: null,
  loader: null,
  credit: null,
  camera: Object.freeze({ yaw: 0.26, targetHeight: 0.48, distanceScale: 0.62 }),
});

const referenceModel = ({
  key,
  displayName,
  aliases = [],
  embedUrl,
  assetUrl,
  creditLabel,
}) => Object.freeze({
  key,
  aliases: Object.freeze([key, displayName, ...aliases]),
  displayName,
  capability: "reference",
  patternMax: null,
  loader: Object.freeze({ type: "reference-embed", url: embedUrl }),
  credit: Object.freeze({
    label: creditLabel,
    url: assetUrl,
  }),
  camera: Object.freeze({ yaw: 0.26, targetHeight: 0.48, distanceScale: 0.62 }),
});

const shapeModel = ({
  key,
  displayName,
  aliases = [],
  modelUrl,
  assetUrl,
  creditLabel = null,
  yaw = 0.26,
  targetHeight = 0.48,
  distanceScale = 0.62,
}) => Object.freeze({
  key,
  aliases: Object.freeze([key, displayName, ...aliases]),
  displayName,
  capability: "shape",
  patternMax: null,
  loader: Object.freeze({ type: "url", url: modelUrl }),
  credit: Object.freeze({
    label: creditLabel || `${displayName} preview model`,
    url: assetUrl,
  }),
  camera: Object.freeze({ yaw, targetHeight, distanceScale }),
});

const calibratedModel = ({
  key,
  displayName,
  aliases = [],
  modelUrl,
  maskUrl,
  assetUrl,
  creditLabel = null,
  yaw = 0.26,
  targetHeight = 0.48,
  distanceScale = 0.62,
}) => Object.freeze({
  key,
  aliases: Object.freeze([key, displayName, ...aliases]),
  displayName,
  capability: "zones",
  patternMax: null,
  loader: Object.freeze({ type: "url", url: modelUrl }),
  maskUrl,
  credit: Object.freeze({
    label: creditLabel || `${displayName} preview model`,
    url: assetUrl,
  }),
  camera: Object.freeze({ yaw, targetHeight, distanceScale }),
});

window.HV_SKIN_MODELS = Object.freeze({
  tyrannosaurus: Object.freeze({
    key: "tyrannosaurus",
    aliases: Object.freeze(["tyrannosaurus", "tyrannosaurus rex", "tyra", "rex"]),
    displayName: "Tyrannosaurus rex",
    capability: "zones",
    patternMax: 2,
    loader: Object.freeze({
      type: "chunked-base64",
      root: "/assets/skin-models/tyrannosaurus/chunks",
      count: 22,
      prefix: "rex-",
      extension: ".b64",
      version: "1",
    }),
    maskGlobal: "HV_REX_MASK_RLE",
    credit: Object.freeze({
      label: "3D model by Nobilis the Palaeovespa · CC BY",
      url: "https://sketchfab.com/3d-models/tyrannosaurus-rex-939e5dd6af554fccb986db94a85116a1",
    }),
    camera: Object.freeze({ yaw: 0.24, targetHeight: 0.50, distanceScale: 0.60 }),
  }),

  triceratops: shapeModel({
    key: "triceratops",
    displayName: "Triceratops",
    aliases: ["tric", "trike"],
    modelUrl: "https://raw.githubusercontent.com/s010s/prehistoric-animal-museum/3b8adfd3838b2f3fa5dae2e19fee9bc5764c232c/src/content/animals/triceratops/model/model.glb",
    assetUrl: "https://sketchfab.com/3d-models/triceratops-dinosaur-87527079bad44917ab1b98a456b46c7e",
    creditLabel: "Triceratops dinosaur by wojciechmiedziocha · CC BY 4.0 · web-prepared by Prehistoric Animal Museum",
    yaw: -0.28,
    targetHeight: 0.48,
    distanceScale: 0.62,
  }),

  deinosuchus: Object.freeze({
    key: "deinosuchus",
    aliases: Object.freeze(["deinosuchus", "deino"]),
    displayName: "Deinosuchus",
    capability: "pending",
    loader: null,
    credit: Object.freeze({
      label: "Candidate Deinosuchus model by hidsf · CC BY",
      url: "https://sketchfab.com/3d-models/deinosuchus-f953eaa748534fb39a2eaba0c5463af2",
    }),
    camera: Object.freeze({ yaw: 0.26, targetHeight: 0.38, distanceScale: 0.64 }),
  }),

  allosaurus: pendingModel("allosaurus", "Allosaurus", ["allo"]),
  austroraptor: pendingModel("austroraptor", "Austroraptor", ["austro"]),
  carnotaurus: pendingModel("carnotaurus", "Carnotaurus", ["carno"]),
  ceratosaurus: pendingModel("ceratosaurus", "Ceratosaurus", ["cera"]),
  dilophosaurus: pendingModel("dilophosaurus", "Dilophosaurus", ["dilo"]),
  herrerasaurus: pendingModel("herrerasaurus", "Herrerasaurus", ["herra"]),
  omniraptor: pendingModel("omniraptor", "Omniraptor", ["omni"]),
  troodon: pendingModel("troodon", "Troodon"),
  pteranodon: pendingModel("pteranodon", "Pteranodon", ["ptera"]),
  diabloceratops: pendingModel("diabloceratops", "Diabloceratops", ["diablo"]),
  dryosaurus: pendingModel("dryosaurus", "Dryosaurus", ["dryo"]),
  tenontosaurus: pendingModel("tenontosaurus", "Tenontosaurus", ["teno"]),
  maiasaura: pendingModel("maiasaura", "Maiasaura", ["maia"]),
  pachycephalosaurus: pendingModel("pachycephalosaurus", "Pachycephalosaurus", ["pachy"]),
  stegosaurus: pendingModel("stegosaurus", "Stegosaurus", ["stego"]),
  deinocheirus: pendingModel("deinocheirus", "Deinocheirus"),
  gallimimus: pendingModel("gallimimus", "Gallimimus", ["galli"]),
  hypsilophodon: pendingModel("hypsilophodon", "Hypsilophodon", ["hypsi"]),
  kentrosaurus: pendingModel("kentrosaurus", "Kentrosaurus", ["kentro"]),
  beipiaosaurus: pendingModel("beipiaosaurus", "Beipiaosaurus", ["beipi"]),
});

// Promotion path for a newly calibrated species:
// 1) save its exported RLE JSON at /assets/skin-models/<species>/mask-rle.json
// 2) switch its registry entry from shapeModel(...) to calibratedModel(...)
// 3) provide maskUrl. The renderer then enables Accurate/Game paint modes
//    and click-to-paint automatically; no renderer changes are required.
window.HV_SKIN_MODEL_ORDER = Object.freeze([
  "tyrannosaurus",
  "triceratops",
  "deinosuchus",
  "allosaurus",
  "austroraptor",
  "carnotaurus",
  "ceratosaurus",
  "dilophosaurus",
  "herrerasaurus",
  "omniraptor",
  "troodon",
  "pteranodon",
  "diabloceratops",
  "dryosaurus",
  "tenontosaurus",
  "maiasaura",
  "pachycephalosaurus",
  "stegosaurus",
  "deinocheirus",
  "gallimimus",
  "hypsilophodon",
  "kentrosaurus",
  "beipiaosaurus",
]);
