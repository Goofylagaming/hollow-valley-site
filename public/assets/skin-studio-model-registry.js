// Hollow Valley Skin Studio species-model registry.
// One entry exists for every species exposed by the website. A species only
// receives live colour painting after its model AND its EVRIMA zone map have
// been calibrated. This prevents a generic Rex from masquerading as every dino.

const pendingModel = (key, displayName, aliases = []) => Object.freeze({
  key,
  aliases: Object.freeze([key, displayName, ...aliases]),
  displayName,
  capability: "pending",
  loader: null,
  credit: null,
  camera: Object.freeze({ yaw: 0.26, targetHeight: 0.48, distanceScale: 0.62 }),
});

const shapeModel = ({
  key,
  displayName,
  aliases = [],
  modelUrl,
  assetUrl,
  yaw = 0.26,
  targetHeight = 0.48,
  distanceScale = 0.62,
}) => Object.freeze({
  key,
  aliases: Object.freeze([key, displayName, ...aliases]),
  displayName,
  capability: "shape",
  loader: Object.freeze({ type: "url", url: modelUrl }),
  credit: Object.freeze({
    label: `${displayName} preview model · CC0`,
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

  triceratops: Object.freeze({
    key: "triceratops",
    aliases: Object.freeze(["triceratops", "tric", "trike"]),
    displayName: "Triceratops",
    capability: "shape",
    loader: Object.freeze({
      type: "url",
      url: "https://cdn.3dassets.dev/assets/4900/v1/model.glb",
    }),
    credit: Object.freeze({
      label: "Triceratops model by 3D Assets · CC0",
      url: "https://3dassets.dev/assets/dinosaurs-and-prehistoric-life-triceratops-5c18d8d2",
    }),
    camera: Object.freeze({ yaw: 0.30, targetHeight: 0.47, distanceScale: 0.62 }),
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

  allosaurus: shapeModel({
    key: "allosaurus",
    displayName: "Allosaurus",
    aliases: ["allo"],
    modelUrl: "https://cdn.3dassets.dev/assets/1683/v1/model.glb",
    assetUrl: "https://3dassets.dev/assets/primeval-frontier-allosaurus-bc6c0128",
    yaw: 0.24,
    targetHeight: 0.49,
  }),
  austroraptor: pendingModel("austroraptor", "Austroraptor", ["austro"]),
  carnotaurus: shapeModel({
    key: "carnotaurus",
    displayName: "Carnotaurus",
    aliases: ["carno"],
    modelUrl: "https://cdn.3dassets.dev/assets/1686/v1/model.glb",
    assetUrl: "https://3dassets.dev/assets/primeval-frontier-carnotaurus-545e46a9",
    yaw: 0.24,
    targetHeight: 0.49,
  }),
  ceratosaurus: shapeModel({
    key: "ceratosaurus",
    displayName: "Ceratosaurus",
    aliases: ["cera"],
    modelUrl: "https://cdn.3dassets.dev/assets/1689/v1/model.glb",
    assetUrl: "https://3dassets.dev/assets/primeval-frontier-ceratosaurus-ad5f8d8a",
    yaw: 0.24,
    targetHeight: 0.49,
  }),
  dilophosaurus: shapeModel({
    key: "dilophosaurus",
    displayName: "Dilophosaurus",
    aliases: ["dilo"],
    modelUrl: "https://cdn.3dassets.dev/assets/1694/v1/model.glb",
    assetUrl: "https://3dassets.dev/assets/primeval-frontier-dilophosaurus-2a1eced1",
    yaw: 0.25,
    targetHeight: 0.49,
  }),
  herrerasaurus: pendingModel("herrerasaurus", "Herrerasaurus", ["herra"]),
  omniraptor: pendingModel("omniraptor", "Omniraptor", ["omni"]),
  troodon: pendingModel("troodon", "Troodon"),
  pteranodon: shapeModel({
    key: "pteranodon",
    displayName: "Pteranodon",
    aliases: ["ptera"],
    modelUrl: "https://cdn.3dassets.dev/assets/4912/v1/model.glb",
    assetUrl: "https://3dassets.dev/assets/dinosaurs-and-prehistoric-life-pteranodon-soaring-53b9c4c3",
    yaw: 0.20,
    targetHeight: 0.47,
    distanceScale: 0.68,
  }),
  diabloceratops: pendingModel("diabloceratops", "Diabloceratops", ["diablo"]),
  dryosaurus: pendingModel("dryosaurus", "Dryosaurus", ["dryo"]),
  tenontosaurus: pendingModel("tenontosaurus", "Tenontosaurus", ["teno"]),
  maiasaura: pendingModel("maiasaura", "Maiasaura", ["maia"]),
  pachycephalosaurus: shapeModel({
    key: "pachycephalosaurus",
    displayName: "Pachycephalosaurus",
    aliases: ["pachy"],
    modelUrl: "https://cdn.3dassets.dev/assets/4904/v1/model.glb",
    assetUrl: "https://3dassets.dev/assets/dinosaurs-and-prehistoric-life-pachycephalosaurus-f8596236",
    yaw: 0.28,
    targetHeight: 0.50,
  }),
  stegosaurus: shapeModel({
    key: "stegosaurus",
    displayName: "Stegosaurus",
    aliases: ["stego"],
    modelUrl: "https://cdn.3dassets.dev/assets/4901/v1/model.glb",
    assetUrl: "https://3dassets.dev/assets/dinosaurs-and-prehistoric-life-stegosaurus-afd95818",
    yaw: 0.26,
    targetHeight: 0.46,
    distanceScale: 0.66,
  }),
  deinocheirus: pendingModel("deinocheirus", "Deinocheirus"),
  gallimimus: shapeModel({
    key: "gallimimus",
    displayName: "Gallimimus",
    aliases: ["galli"],
    modelUrl: "https://cdn.3dassets.dev/assets/4892/v1/model.glb",
    assetUrl: "https://3dassets.dev/assets/dinosaurs-and-prehistoric-life-gallimimus-1f1ea141",
    yaw: 0.24,
    targetHeight: 0.50,
  }),
  hypsilophodon: pendingModel("hypsilophodon", "Hypsilophodon", ["hypsi"]),
  kentrosaurus: shapeModel({
    key: "kentrosaurus",
    displayName: "Kentrosaurus",
    aliases: ["kentro"],
    modelUrl: "https://cdn.3dassets.dev/assets/4907/v1/model.glb",
    assetUrl: "https://3dassets.dev/assets/dinosaurs-and-prehistoric-life-kentrosaurus-79c955dd",
    yaw: 0.27,
    targetHeight: 0.45,
    distanceScale: 0.66,
  }),
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
