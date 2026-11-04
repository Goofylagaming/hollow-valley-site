# Extracted models in Skin Studio

The main /skins page and /skin-studio/index.html use 22 supplied dinosaur meshes with extracted texture maps through a shared preview-only material adapter. The registry preserves existing species aliases and fallback definitions.

Palette changes update per-model shader uniforms; native colour values, serialization, saved skins, purchase, wear and publishing paths are unchanged. No premium draft records or server/database code are part of this release. Model switches dispose textures and guard against stale asynchronous loads.

All previews remain labelled approximate. Rex adult colour channels and patterns have reference checks; lighting, growth and sex differences still need comparison. The other 21 species use provisional shared colour mapping and their default adult texture pattern. Species-specific in-game checks are required before claiming exact fidelity. Unverified live pattern switching remains disabled.

Validation: 55 targeted tests passed, covering registry assets, isolated materials, colour preservation, disposal and existing Skin Studio safety/core/calibration behavior. All 22 species loaded in both integrated editors; the main staging page produced no browser errors during the species sweep. Unsaved colour edits were visually checked and restored.

Rollback: revert the frontend integration commit and redeploy. There is no data migration to reverse. The asset directories retain their original staging names to preserve tested asset URLs; they contain static model and texture files only.
