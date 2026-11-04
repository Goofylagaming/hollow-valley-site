# Supplied T-rex staging renderer — 4 November 2026

Scope: only `/premium-skin-preview.html` on the membership staging branch. Production `/skins`, the older model registry, all skin palettes, databases, APIs and live game code remain unchanged.

## Asset

Converted the owner's `Downloads/models/SK_Tyrannosaurus.psk` using the existing PSK converter and `scripts/build_rex_preview.py`. Source SHA-256 and output hash are recorded in `public/assets/skin-models/rex-staging/tyrannosaurus.json`. All 18,800 triangles, original normals and UV coordinates remain. Disconnected tooth components are assigned a dedicated material; the original separate eye group is retained. The conversion is guarded by the exact reviewed source hash.

The supplied PSK has no texture images, normal map or game skin masks. This release therefore does not claim to restore the game's original textures. It replaces the unrelated older textured Rex only in this staging preview.

## Rendering changes

- New isolated `rex-staging-viewer.js`: supplied mesh, authored continuous object-space scales, subtle derivative-based surface relief, soft anatomical body/flank/underside/display regions and restrained reference striping. These are preview materials, not native game pattern implementations.
- Separate non-metal skin, smoother teeth, glossy eyes with pupils.
- Studio colour swatches are interpreted as sRGB for display. Stored RGBA/native values are not changed; in-game colour equivalence remains unverified.
- Soft environment illumination, controlled warm key/cool fill/rim lights, contact shadows, adjustable brightness and closer framing that adapts to viewport width.
- Neutral material study, palette selection, male/female display, orbit, zoom, pan and reset. No persistence or game operations.
- Reduced page clutter and collapsible palette values.

## Validation

Eight focused tests passed: pack validation, preview read-only behavior, three-way palette switching, model hash/triangle/UV checks, anatomical primitive bounds and renderer isolation. Local browser review covered all three palettes, model loading and shader compilation. Browser has no new rendering errors after reducing environment-filter width.

Exact game textures, native pattern/theme correspondence, species/growth calibration and live application remain separate in-game verification work. Do not publish the skins based solely on this preview.

## Extracted game textures - 2026-11-04

Read-only source: installed Evrima Steam build 24664737, TheIsle/Content/Paks. CUE4Parse 1.2.2.202611 with UE5.6 mappings read the archives; no installation files were modified. Extraction tools, archive key, original exports and full material JSON stay outside the commit under release-evidence/rex-extraction.

Staging now uses Adult_Pattern_1, Tyrannosaurus_N, Tyrannosaurus_RAC, Mask_TMC, DinoSkinDetail_5_N, AnimalEyes_Iris_2 and AnimalEyes_Pupil_3. The manifest records original dimensions, preview dimensions and SHA256 hashes. Original 4K maps are retained locally; web copies are limited to 2K. Original supplied mesh/UVs and all draft data remain unchanged.

The procedural pattern and scale relief were removed. UV textures use no sRGB conversion, a DirectX normal Y correction, the material's detail scale 12 and intensity 2, and RAC channels for roughness/albedo/cavity. Palette values now enter the renderer as linear native numbers, matching the existing importer rather than decoding those values as display sRGB.

Recovered material references confirm six RGB/CYM layers, TMC zones, and eye texture scales. Cooked assets omit the material graph: RGB/CYM decomposition, field-to-layer assignment (red display, green belly, blue body, cyan flank, magenta markings, yellow detail), female fallback, eye blending and lighting remain provisional. Pattern index 0 to Adult_Pattern_1 also requires in-game confirmation. No claim of pixel-identical rendering, original shader reconstruction, subsurface scattering, animations or weather matching.

Required acceptance: compare adult male and female with identical native palette and pattern 0, under neutral dry daylight; change one channel at a time to confirm layer assignments, verify teeth/mouth/claws and eyes, then compare all three themes. Do not publish premium skins before that comparison. No player database, skin save/wear/grant route or production deployment is involved.
