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

const MUSEUM_REVISION = "dbdb0a3fc1ec82c586f8aaa45667aac76c424669";
const museumModelUrl = (species) =>
  `https://raw.githubusercontent.com/s010s/prehistoric-animal-museum/${MUSEUM_REVISION}/src/content/animals/${species}/model/model.glb`;

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
    modelUrl: museumModelUrl("triceratops"),
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
  dilophosaurus: shapeModel({
    key: "dilophosaurus",
    displayName: "Dilophosaurus",
    aliases: ["dilo"],
    modelUrl: museumModelUrl("dilophosaurus"),
    assetUrl: "https://sketchfab.com/3d-models/dilophosaurus-d09b3aa874db4e1cbf29a14797ca351f",
    creditLabel: "Dilophosaurus by Marcel Schanz · CC BY 4.0 · web-prepared by Prehistoric Animal Museum",
    yaw: 0.22,
    targetHeight: 0.49,
    distanceScale: 0.61,
  }),
  herrerasaurus: pendingModel("herrerasaurus", "Herrerasaurus", ["herra"]),
  omniraptor: pendingModel("omniraptor", "Omniraptor", ["omni"]),
  troodon: pendingModel("troodon", "Troodon"),
  pteranodon: shapeModel({
    key: "pteranodon",
    displayName: "Pteranodon",
    aliases: ["ptera"],
    modelUrl: museumModelUrl("pteranodon"),
    assetUrl: "https://sketchfab.com/3d-models/pteranodon-animated-7d7683df41d1405283f160e81a5dff1b",
    creditLabel: "Pteranodon by Oscar López Riviello · CC BY 4.0 · web-prepared by Prehistoric Animal Museum",
    yaw: 0.18,
    targetHeight: 0.47,
    distanceScale: 0.69,
  }),
  diabloceratops: pendingModel("diabloceratops", "Diabloceratops", ["diablo"]),
  dryosaurus: pendingModel("dryosaurus", "Dryosaurus", ["dryo"]),
  tenontosaurus: pendingModel("tenontosaurus", "Tenontosaurus", ["teno"]),
  maiasaura: shapeModel({
    key: "maiasaura",
    displayName: "Maiasaura",
    aliases: ["maia"],
    modelUrl: museumModelUrl("maiasaura"),
    assetUrl: "https://sketchfab.com/3d-models/maiasaura-with-rig-3da9f211ae304bd0afd1d15a290eabbd",
    creditLabel: "Maiasaura With Rig by Dino Dan · CC BY 4.0 · web-prepared by Prehistoric Animal Museum",
    yaw: 0.23,
    targetHeight: 0.48,
    distanceScale: 0.62,
  }),
  pachycephalosaurus: shapeModel({
    key: "pachycephalosaurus",
    displayName: "Pachycephalosaurus",
    aliases: ["pachy"],
    modelUrl: museumModelUrl("pachycephalosaurus"),
    assetUrl: "https://sketchfab.com/3d-models/pbr-pachycephalasaurus-animated-6eea5cee4afa4730bf75c6329a43e56d",
    creditLabel: "PBR Pachycephalosaurus by Ferocious Industries · CC BY 4.0 · web-prepared by Prehistoric Animal Museum",
    yaw: 0.24,
    targetHeight: 0.50,
    distanceScale: 0.61,
  }),
  stegosaurus: shapeModel({
    key: "stegosaurus",
    displayName: "Stegosaurus",
    aliases: ["stego"],
    modelUrl: museumModelUrl("stegosaurus"),
    assetUrl: "https://sketchfab.com/3d-models/pbr-stegasaurus-animated-ec254ea1554941fe8a131f62db0faf3d",
    creditLabel: "PBR Stegosaurus by Ferocious Industries · CC BY 4.0 · web-prepared by Prehistoric Animal Museum",
    yaw: 0.25,
    targetHeight: 0.46,
    distanceScale: 0.66,
  }),
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
