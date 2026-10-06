# Hollow Valley Skin Studio model calibration

Skin Studio uses one registry entry per species.

A model has one of three capabilities:

- `pending`: no approved exact-species preview mesh yet.
- `shape`: correct species mesh is available, but the EVRIMA colour regions have not been mapped.
- `zones`: mesh + calibrated Hollow Valley UV zone mask. Accurate Colour, Game Preview and click-to-paint are enabled.

## Zone mask format

Calibrated species use a compact JSON file:

```json
{
  "size": 256,
  "zones": {
    "body": [0, 12, 28, 4],
    "markings": [100, 20]
  }
}
```

Each zone value is run-length encoded as repeating `[startPixel, length]` pairs over a `size × size` UV map.

Supported zones:

- `maleDisplay`
- `markings`
- `body`
- `flank`
- `underbelly`
- `detail1`
- `eyes`
- `teeth`
- `mouth`
- `claws`

## Calibrating a shape model

1. Sign in as a Hollow Valley website admin.
2. Open Skin Studio and select a species whose preview says **SPECIES SHAPE MODEL**.
3. Open **ADMIN · ZONE CALIBRATION**. Use **Load diagnostic colours** if you want a deliberately loud one-colour-per-channel palette for EVRIMA comparison, then choose **Start mapping**.
4. Select a zone and paint directly over the 3D dinosaur. Adjust brush size or UV flip when needed. Watch the UV coverage readout while you work; it reports total mapped/unmapped area plus each zone's share.
5. Draft progress auto-saves in the browser for that species.
6. To move work to another browser or another admin, use **Copy mask**, paste the JSON into **Import / resume a mask** on the other browser, start mapping, then choose **Load mask**. Imports are rejected if they contain unknown zones, malformed RLE pairs, out-of-bounds runs, or overlapping UV pixels.
7. Use **Copy mask** when the mapping is ready.
8. Save the exported JSON as:
   `public/assets/skin-models/<species>/mask-rle.json`
9. Change the species registry entry to `calibratedModel(...)` and set:
   `maskUrl: "/assets/skin-models/<species>/mask-rle.json"`
10. Run the Skin Studio validation workflow.
11. Compare the preview against the same skin in EVRIMA before calling the species calibrated.

Do not promote a species to `zones` just because the mask looks plausible. The purpose of the calibrated state is to tell players that the preview has been compared against actual EVRIMA colour placement.
