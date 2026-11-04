# Repeatable dinosaur skin verification (staging only)

## Rex observations — 4 November 2026

Game build 24664737; adult growth; Default theme; background off; paused animation; fixed imported colours. Five isolated channel tests confirmed Underbelly, Body, Flank, Markings and Male Display on Pattern1. An additional isolated test confirmed Pattern4 Accents over the back and muzzle. Mask layers: green=underbelly, cyan=body, blue=flank, magenta=markings, red=male display, yellow=accents.

All 15 pattern/variation combinations were inspected in the game menu. Patterns 1–3 export five colours in order: underbelly, body, flank, markings, male display. Pattern4 exports six: accents FIRST, then those five. Pattern5 exports three: underbelly, body, flank. Small/Medium/Large changed the export header but showed no visible adult pattern change with fixed imported colours. This is a bounded visual observation, not proof that variation never matters at other ages, themes or default palettes. The viewer deliberately adds no invented UV scaling.

Evidence: local release-evidence/rex-inspection/channel-*.jpg and pattern-{0..4}-variation-{0..2}.jpg. Original reference code restored and animation resumed. No game Save or main Confirm was used. Premium draft JSON is unchanged. Full material parity remains unverified: eyes, mouth, teeth, claws, female behaviour, growth transitions, other themes, animation and outdoor lighting.

## Repeat for each species

1. Record installed game build, mesh/material names and hashes. Export the mesh with UVs/normals, adult pattern masks, normal, roughness/albedo/cavity, zone masks and referenced detail/eye textures. Retain material-instance parameters privately. Use the existing PSK conversion script; never replace a species with a generic mesh.
2. Inspect the game's pattern menu and export a reference for EACH pattern. Record exact species prefix, header digits, channel count and order. Do not assume Rex layouts apply. Create a profile following rex-verification-profile.json only after checking those fields.
3. Run `node scripts/skin-verification-cases.js docs/rex-verification-profile.json output.json` (substitute the new profile). Output creation refuses to overwrite existing evidence. Every generated case starts pending. This generator supports the observed three-digit header format only; adapt and test it if another species differs.
4. In the unsaved game editor select the target pattern FIRST, wait for textures, then import. Pattern changes can reset colours or reject a code against the previous channel count. Check every swatch after importing; repeat only after confirming the correct target pattern. Never press Save or the main Confirm.
5. Capture fixed side and head views for each one-channel diagnostic and all three variations; record sex, growth, theme, background and graphics settings. Compare the same palette on staging. Keep game and staging screenshots, exact code and outcome together; failed/missing evidence stays pending.
6. Compare the three premium palettes, neutral and dark palettes. Verify export round-trips and linear/sRGB conversion separately from lighting. Do not compensate a wrong mask with brighter lights. Test female/growth/theme separately before claiming support.
7. Run calibration, asset-integrity, workflow and draft-isolation tests. Confirm staging is read-only. Deploy ONLY the staging service/branch; keep drafts unpublished and do not run imports against live databases. Restore the user's original unsaved reference when finished.

Rex staging controls generate pattern-specific import codes without writing data. Pattern4 uses the draft detail1 as Accents for exploration; this does not change its stored Pattern1 draft. Unsupported channels are omitted from game codes. Browser-only eye/mouth/tooth/claw colours are not claimed to be exported game controls.
