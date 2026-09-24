export const SKIN_ZONE_DEFINITIONS = Object.freeze([
  { key: "body", label: "Body", atlas: 0, channel: "r" },
  { key: "markings", label: "Markings", atlas: 0, channel: "g" },
  { key: "flank", label: "Flank", atlas: 0, channel: "b" },
  { key: "underbelly", label: "Underbelly", atlas: 0, channel: "a" },

  { key: "detail1", label: "Detail", atlas: 1, channel: "r" },
  { key: "eyes", label: "Eyes", atlas: 1, channel: "g" },
  { key: "teeth", label: "Teeth", atlas: 1, channel: "b" },
  { key: "mouth", label: "Mouth", atlas: 1, channel: "a" },

  { key: "claws", label: "Claws", atlas: 2, channel: "r" },
  { key: "maleDisplay", label: "Male display", atlas: 2, channel: "g" },
]);

export const SKIN_MASK_ATLASES = Object.freeze([
  {
    file: "mask0-body-markings-flank-underbelly.png",
    channels: ["body", "markings", "flank", "underbelly"],
  },
  {
    file: "mask1-detail-eyes-teeth-mouth.png",
    channels: ["detail1", "eyes", "teeth", "mouth"],
  },
  {
    file: "mask2-claws-display.png",
    channels: ["claws", "maleDisplay", null, null],
  },
]);

export const DEFAULT_SKIN_PALETTE = Object.freeze({
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
