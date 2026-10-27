# Skin Studio v014 — automatic UV zone suggestions

Date: 2026-10-28
Status: development; geometry-based estimates, **not verified EVRIMA textures or pattern masks**

## Objective

The admin should not have to paint 256 × 256 UV texels on 20 models by hand. Open /skins as an admin, load one or more previously converted private GLBs, select a species, then click **Auto-map zones** under **Admin · Zone Calibration**.

The tool starts calibration if necessary and fills only *unpainted* UV regions. Existing hand-painted underbelly and other work are preserved. **Undo** restores the previous mask in a single action, and **Copy mask** exports RLE JSON; browser-local drafts still auto-save under the correct source-model fingerprint.

## Method and limitations

The new engine at public/assets/skin-studio-auto-map.js rasterises primary UV triangles. It uses 3D position, orientation and material identities to propose:

- Underbelly: lower downward-facing surfaces.
- Flank: side-facing surfaces.
- Dorsal Markings: a narrow suggested upward-facing region, NOT an actual EVRIMA pattern.
- Body: remaining geometry.
- Eyes: separate material tint, **not UV masking**. PSK Body and Eye surfaces overlap substantially in UV space; treating eye triangles as an ordinary UV mask would recolour large body areas.

It honours the UV-flip option, supports mirrored UV seams, votes deterministically for overlapping surfaces, and limits face count and per-triangle work.

This cannot infer the true game-specific markings, colour masks, patterns, sex variants, detail accents or juvenile appearance from a bare skeletal mesh. Do NOT promote these geometric proposals to a verified calibrated model until compared with matching in-game evidence.

## Private 20-species geometry test

All 20 privately converted PSK-to-GLB models were processed locally without fatal auto-map errors.

Representative approximate body-area UV classifications:
- Deinosuchus: 40,087 UV pixels directly sampled; 15,085 underbelly, 10,582 flank.
- Tyrannosaurus: 50,084 directly sampled; 15,986 underbelly, 19,702 flank.
- Triceratops: 48,112 directly sampled; 13,736 underbelly, 19,449 flank.

Eye UVs are excluded from the shared atlas because the separate Eye mesh reuses large portions of the body map; the renderer colours Eye material independently. This protects the body from eye-mask bleed.

These are *algorithm outputs*, not measured accuracy against EVRIMA.

## Safety

- The new button is confined to the existing admin-only calibration controls.
- Old painted pixels are retained. One Undo restores the previous map.
- No third-party mesh or derivative binary is uploaded, committed to GitHub or distributed via Render.
- No player skin, saved skin library, Steam identity, Marketplace, Wallet, CommandBridge, UE4SS, domain or database changes.
- All suggestions explicitly remain unverified; no automatic promotion to a production calibrated zone map.

## Follow-up acceptance

- Verify the Deinosuchus auto-map visually with a matching in-game skin and SkinInspector capture.
- Review all 20 species with local GLBs and validate Browser Undo, Copy mask, reload and recovery.
- Continue baby-skin/reconnect test matrix and pattern-index safety as tracked in GitHub Issue #248.
- Confirm source rights before considering model hosting for ordinary players.
