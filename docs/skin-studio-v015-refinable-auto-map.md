# Skin Studio v015 — refinable automatic masks

Auto-map now refreshes its own suggestions while retaining manual brush, island-fill and erase decisions. Ownership is saved with browser-local drafts and restored by Undo/Redo. Legacy/imported masks remain protected because they contain no reliable provenance; the explicit **Rebuild all zones** action replaces them in one undoable step. Copy mask retains the existing interoperable `{size,zones}` format, so reimported copies are protected as manual masks.

Automatic output uses only directly sampled body geometry; it no longer fills unrelated material UV footprints with Body. Conflicting votes without a 60% majority fall back to Body. Full-atlas triangles preserve their exact 0/1 UV edges, and raster bounds no longer reject a valid 256 × 256 triangle because of extra padding.

Invalid imports validate before touching history. Zone picking samples only the rendered atlas orientation instead of falling back to the opposite row. The calibration Flip V control continues to control where painting and automatic proposals are written; picking follows the renderer's unflipped, clamped atlas sampling.

Validation: behavioral tests cover repeated proposals, legacy preservation/rebuild, manual erasures, draft reload, Undo/Redo provenance, invalid-import history, UV picking, ambiguous votes, and full-atlas triangles. An isolated Edge/WebGL staging run exercised the actual viewer using synthetic geometry, including a real page reload, with no page errors. No private geometry or user masks are bundled.

These are provisional geometry-based suggestions, not verified EVRIMA texture/pattern masks. A matched in-game comparison still requires the original private GLB and skin capture. No saved player skins, game services, databases or model registry entries are changed.
