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
