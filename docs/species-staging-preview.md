# Additional supplied dinosaur previews

Staging-only companion page: `/species-skin-preview.html`. It presents Ashfall, Moonlit Marsh and Valley Royalty on the 21 additional supplied PSK models. Tyrannosaurus links to its existing calibrated page. Palette buttons retain the original native values, and changing dinosaur retains the selected palette.

Sources: user-supplied `Downloads/models/SK_*.psk`; installed game build 24664737. Converted geometry retains UVs, normals and material slots. Each species uses its own adult overlay, normal, roughness/albedo/cavity and body-zone texture from its material instance. Shared detail and eye textures use explicit material references where available. Missing eye/detail overrides use documented preview defaults (iris2, pupil3, detail5), not a claim about resolved inherited game material parameters.

Rebuild: run `skin_studio_psk_to_glb.py` against the supplied folder into a private extraction directory's `models` subfolder, then `build_species_previews.py <private extraction directory> public/assets/skin-models/species-staging <DT_SectionsData.json>`. The builder requires decoded texture raw data/metadata and material JSON in that private directory; it fails if a required asset is absent or has unsupported pixels. The public catalog records hashes, dimensions, material names and pending verification state. Private archive keys, raw exports and source PSKs are excluded from the release.

Scope: static adult default-pattern preview, all three unpublished palettes. The RGB/CYM layer interpretation comes from the common material convention; it is NOT independently verified in game for these 21 species. Material defaults differ for some species. Eye shading, body-zone interpretation, horns/plates/feathers, female behaviour, growth, alternate patterns, export channel order and lighting still need per-species comparisons using `skin-verification-workflow.md`. No unverified game import codes are offered. Do not use the Rex verification status for these species.

No production pages, player data, saved skins, draft JSON or write APIs are changed. Staging preview has only static asset reads and local palette controls.
