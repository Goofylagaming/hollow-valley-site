/* Hollow Valley v015: portable, browser-local UV mask drafts.
 * Safe for generated previews; NOT a claim of EVRIMA texture accuracy.
 */
(function(root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.HVSkinBatchMap = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function() {
  "use strict";
  const SIZE = 256;
  const ZONES = Object.freeze(["body", "markings", "flank", "underbelly", "detail1",
    "eyes", "teeth", "mouth", "claws", "maleDisplay"]);
  const LENGTH = SIZE * SIZE;
  const MAX_DRAFT_CHARS = 1000000;

  function checkedLookup(values) {
    if (!values || values.length !== LENGTH) throw new Error("Mask must contain exactly 65536 UV pixels.");
    const lookup = new Uint8Array(LENGTH);
    for (let i = 0; i < LENGTH; i++) {
      const value = Number(values[i]);
      if (!Number.isInteger(value) || value < 0 || value > ZONES.length) {
        throw new Error("Mask contains an invalid colour-zone index.");
      }
      lookup[i] = value;
    }
    return lookup;
  }

  function rleForValue(values, value) {
    const result = [];
    let start = -1;
    for (let i = 0; i <= values.length; i++) {
      const selected = i < values.length && values[i] === value;
      if (selected && start < 0) start = i;
      if (!selected && start >= 0) {
        result.push(start, i - start);
        start = -1;
      }
    }
    return result;
  }

  function writeRuns(values, pairs, mark, failOnOverlap = false) {
    if (!Array.isArray(pairs) || pairs.length % 2) throw new Error("Invalid calibration RLE pairs.");
    let previousEnd = -1;
    for (let i = 0; i < pairs.length; i += 2) {
      const start = pairs[i], length = pairs[i + 1];
      if (!Number.isInteger(start) || !Number.isInteger(length) || length <= 0 ||
          start < 0 || start + length > LENGTH || start < previousEnd) {
        throw new Error("Calibration RLE is malformed, overlapping or out of range.");
      }
      for (let pixel = start; pixel < start + length; pixel++) {
        if (failOnOverlap && values[pixel]) throw new Error("Overlapping UV colour-zone assignments.");
        values[pixel] = mark;
      }
      previousEnd = start + length;
    }
  }

  function encode(lookup) {
    const values = checkedLookup(lookup);
    const zones = {};
    for (let index = 0; index < ZONES.length; index++) {
      const runs = rleForValue(values, index + 1);
      if (runs.length) zones[ZONES[index]] = runs;
    }
    return { size: SIZE, zones };
  }

  function decode(mask) {
    if (!mask || Number(mask.size) !== SIZE || !mask.zones ||
        typeof mask.zones !== "object" || Array.isArray(mask.zones)) {
      throw new Error("Unsupported calibration mask.");
    }
    const lookup = new Uint8Array(LENGTH);
    for (const [name, runs] of Object.entries(mask.zones)) {
      const index = ZONES.indexOf(name);
      if (index < 0) throw new Error("Unknown UV zone " + name + ".");
      writeRuns(lookup, runs, index + 1, true);
    }
    return lookup;
  }

  function ownersFromDraft(lookup, meta) {
    const owner = Uint8Array.from(lookup, zone => zone ? 2 : 0);
    if (meta?.version === 1 && typeof meta.owners === "string") {
      if (meta.owners.length !== LENGTH || !/^[012]+$/.test(meta.owners)) {
        throw new Error("Old calibration ownership metadata is damaged.");
      }
      for (let i = 0; i < LENGTH; i++) {
        owner[i] = Number(meta.owners[i]);
        if (lookup[i] && !owner[i]) owner[i] = 2;
      }
    } else if (meta?.version === 2) {
      owner.set(Uint8Array.from(lookup, zone => zone ? 1 : 0));
      writeRuns(owner, meta.manualRuns || [], 2, false);
    }
    return owner;
  }

  function serialize(lookup, owner, flipV = false, details = {}) {
    const values = checkedLookup(lookup);
    if (!owner || owner.length !== LENGTH) throw new Error("Invalid calibration ownership mask.");
    for (const value of owner) if (value > 2) throw new Error("Invalid calibration ownership flag.");
    const payload = encode(values);
    payload.calibration = {
      version: 2,
      manualRuns: rleForValue(owner, 2),
      flipV: Boolean(flipV),
      autoMap: "geometry-v015",
      verified: false,
    };
    if (details.modelFingerprint) payload.calibration.modelFingerprint = String(details.modelFingerprint);
    return payload;
  }

  function merge(existingRaw, proposedLookup, { flipV = false, modelFingerprint = "", rebuildAll = false } = {}) {
    const proposal = checkedLookup(proposedLookup);
    let original = new Uint8Array(LENGTH), owner = new Uint8Array(LENGTH);
    if (existingRaw) {
      if (typeof existingRaw === "string" && existingRaw.length > MAX_DRAFT_CHARS) {
        throw new Error("Existing mask exceeds the safe local-storage limit.");
      }
      const parsed = typeof existingRaw === "string" ? JSON.parse(existingRaw) : existingRaw;
      original = decode(parsed);
      owner = ownersFromDraft(original, parsed.calibration);
      if (typeof parsed.calibration?.flipV === "boolean") flipV = parsed.calibration.flipV;
    }

    let changed = 0, preserved = 0;
    for (let i = 0; i < LENGTH; i++) {
      if (!rebuildAll && owner[i] === 2) { preserved++; continue; }
      const next = proposal[i];
      const newOwner = next ? 1 : 0;
      if (original[i] !== next || owner[i] !== newOwner) changed++;
      original[i] = next;
      owner[i] = newOwner;
    }
    return { payload: serialize(original, owner, flipV, { modelFingerprint }), changed, preserved };
  }

  return Object.freeze({ SIZE, ZONES, encode, decode, serialize, merge, ownersFromDraft, rleForValue });
});
