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

window.HV_SKIN_MODEL_ORDER = Object.freeze([
  "tyrannosaurus",
  "triceratops",
  "deinosuchus",
  "allosaurus",
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
  "beipiaosaurus",
]);
