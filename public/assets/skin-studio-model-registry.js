// Hollow Valley Skin Studio species-model registry.
// Add a species here once its model and zone calibration are ready.
// "zones" means the model has a calibrated colour-zone mask.
// "shape" means the species mesh is available but colour zones are intentionally
// not painted yet, so Skin Studio does not pretend the preview matches EVRIMA.

window.HV_SKIN_MODELS = Object.freeze({
  tyrannosaurus: Object.freeze({
    key: "tyrannosaurus",
    aliases: ["tyrannosaurus", "tyrannosaurus rex", "tyra", "rex"],
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
    aliases: ["triceratops", "tric", "trike"],
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
    aliases: ["deinosuchus", "deino"],
    displayName: "Deinosuchus",
    capability: "pending",
    loader: null,
    credit: Object.freeze({
      label: "Deinosuchus species model pending calibration",
      url: "https://sketchfab.com/3d-models/deinosuchus-f953eaa748534fb39a2eaba0c5463af2",
    }),
    camera: Object.freeze({ yaw: 0.26, targetHeight: 0.38, distanceScale: 0.64 }),
  }),
});

window.HV_SKIN_MODEL_ORDER = Object.freeze(["tyrannosaurus", "triceratops", "deinosuchus"]);
