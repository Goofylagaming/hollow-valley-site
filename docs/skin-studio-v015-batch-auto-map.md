# Skin Studio v015 — automatic 20-species UV-mask batch

Date: 2026-10-28
Status: **automatic provisional geometry maps**, not EVRIMA-verified patterns.

## Goal

The owner no longer manually paints UV regions for each dinosaur.

### Admin workflow

1. Sign in to /skins as admin. In Admin · Zone Calibration, select **all 20 converted GLBs** in Private Model Preview. GLBs remain browser-local; the private model bundle stays outside GitHub.
2. **Auto-map every selected model immediately** is enabled by default. The viewer processes each model sequentially, shows progress, and saves distinct UV masks under that model's SHA-256 fingerprint.
3. **Auto-map all loaded models** re-runs without selecting files again. Clicking during a batch requests cancellation after the current species. Completed masks remain saved.
4. **Export all masks** downloads one JSON pack of locally saved masks and fingerprints. Nothing is sent to Steam, game servers or the website database. Local-storage errors are reported instead of silently erasing an old mask.
5. To inspect a particular species, select it then click **Start mapping** to display its saved mask. No painting is required.

The proposal uses Body, Flank, Underbelly and a rough dorsal Markings region. Independent Eye materials are coloured separately to avoid recolouring the entire body. UV texels present only in the Eye atlas receive neutral Body fallback, not eye paint. Teeth, claws, mouth and in-game pattern indices cannot be reliably inferred from untextured mesh geometry.

### Draft preservation

- SHA-256-scoped keys prevent accidental cross-model UV mask reuse.
- Draft format v2 stores only manual texels as compact RLE, instead of saving a 65,536-character ownership string on each of 20 models.
- Old v1 drafts migrate safely. Imported masks lacking ownership metadata remain protected as manual edits. Erased pixels remain erased.
- Automatic updates never overwrite manually owned pixels. All output remains marked verified:false and shape-only rather than promoting a species to a production-calibrated preview.
- No third-party model bytes, converted GLBs, original game texture assets, player data, Valley Coins or UE4SS code are changed.

### Private 20-species validation

The owner-provided 20 PSK models were converted to local GLB in the earlier release. A private Python/Numpy/Numba geometry pass produced 20 non-overlapping 256x256 RLE masks with exact GLB SHA-256 fingerprints and per-species zone statistics.

For Deinosuchus, 40,087 Body-mesh texels are directly classified. Eye-mesh coverage adds another 17,332 neutral Body fallback texels, giving 57,419 assigned UV texels in the model's full reported footprint. These values are geometric measurements, **not** in-game colour accuracy scores.

Website code uses the existing HVSkinAutoMap classifier and saves each generated mask on bulk import. Regression tests cover ownership, migration, malformed masks, script load order, browser-only imports and batch controls.

### Still unavailable from meshes alone

Actual EVRIMA masks, material shader graphs, detailed marking patterns, sex/juvenile variations, teeth/mouth/claws native customizer mapping and game-side persistence cannot be inferred solely from PSK vertex positions and UVs. These need separate game-side evidence and tests (Issue #248); the tool does not claim exact skin accuracy.
