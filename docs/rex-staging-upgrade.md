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

## In-game export comparison - 2026-11-04

User supplied a labelled game screenshot (Pattern1 / Medium / Default) and export `Tyrannosaurus010D3B48BFF897559FF594A35FF352F2AFF6C3729FF`. A read-only screenshot of the open game also showed the adult preview with 3D background disabled. No game palette was edited, saved or confirmed.

Verified from screenshot labels and export: underbelly D3B48B, body 897559, flank 594A35, markings 352F2A, male display 6C3729. Cross-checking extracted material defaults establishes green=underbelly, cyan=body, blue=flank, magenta=markings, red=male display. The earlier blue=body/cyan=flank assignment was wrong and is now corrected. Yellow/detail and female fallback are still unverified.

The exported hex values are display sRGB: e.g. 897559 decodes to approximately (.250,.178,.100), matching the extracted cyan material parameter (.25,.17751,.1). Added a staging-only explicit reference fixture and colour-space conversion. The premium pack's native float semantics and colours are unchanged. This is deliberately not a general native-code importer: one example cannot establish the complete format or index semantics.

Lighting: reduced the excessive rim, neutralised the daylight key, adjusted fill/exposure, and added a separately labelled approximate background-off game-menu mode. Camera now faces the same side as the reference. These are visual adjustments, not a recovered Unreal lighting rig or measured pixel match. Screenshots have different poses, framing, surface quality and environments; no claim of exact image equivalence.

Reference contains only five exported colours. Eye/teeth/mouth/claw values use explicit preview/material defaults. Pattern variation and full shader blending remain unverified. All three premium drafts remain unpublished; production paths and player records are unchanged.
