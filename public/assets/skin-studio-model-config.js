export const MASKED_SKIN_MODELS = Object.freeze({
  tyrannosaurus: {
    enabled: false,
    speciesKey: "Tyrannosaurus",
    modelUrl: "/assets/skin-models/tyrannosaurus/rex.glb",
    baseMeshName: null,
    masks: [
      "/assets/skin-models/tyrannosaurus/mask0-body-markings-flank-underbelly.png",
      "/assets/skin-models/tyrannosaurus/mask1-detail-eyes-teeth-mouth.png",
      "/assets/skin-models/tyrannosaurus/mask2-claws-display.png",
    ],
    notes: "Enable only after the self-hosted GLB and three UV-aligned mask atlases are present.",
  },
});
