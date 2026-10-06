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
3. Open **ADMIN · ZONE CALIBRATION** and choose **Start mapping**.
4. Select a zone and paint directly over the 3D dinosaur. Adjust brush size or UV flip when needed.
5. Draft progress auto-saves in the browser for that species.
6. Use **Copy mask** when the mapping is ready.
7. Save the exported JSON as:
   `public/assets/skin-models/<species>/mask-rle.json`
8. Change the species registry entry to `calibratedModel(...)` and set:
   `maskUrl: "/assets/skin-models/<species>/mask-rle.json"`
9. Run the Skin Studio validation workflow.
10. Compare the preview against the same skin in EVRIMA before calling the species calibrated.

Do not promote a species to `zones` just because the mask looks plausible. The purpose of the calibrated state is to tell players that the preview has been compared against actual EVRIMA colour placement.
