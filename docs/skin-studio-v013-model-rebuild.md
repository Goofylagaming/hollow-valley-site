# Skin Studio v013 — PSK model rebuild

Date: 2026-10-27  
Status: **v013 development branch; admin-only local model import implemented; public models withheld**

## Objective

Replace the inaccurate shape-only dinosaur previews with a vetted, species-specific model pipeline without risking saved skins, Steam ownership, shop purchases, or Wear Live / CommandBridge / UE4SS operations.

## Confirmed baseline

- Live website route `/skins` currently serves `public/skins.html` and `public/assets/skins.js`.
- The standalone `public/skin-studio/index.html` and `public/assets/skin-studio-app.js` are a separate experimental UI. Do not assume modifying them changes live `/skins`.
- Existing `public/assets/skin-studio-3d.js` loads calibrated meshes using GLTFLoader; model capabilities are `pending`, `shape`, or `zones`.
- Existing Tyrannosaurus is `zones`; several current models are `shape`; other species still need exact-species meshes and calibration.
- The existing skin palette and `skinWearService` are independent of model geometry and must remain the source of truth. No changes to production wear/application/saving here.

## Local-only PSK assessment

Twenty distinct PSK models supplied by the site owner were parsed and converted locally to GLB, preserving triangle geometry, the primary UV map, an optional second UV map, model-normal directions, and two body/eye material sections. The repeated Tyrannosaurus upload was byte-identical and excluded. Each output was independently reloaded and its triangle count and UV presence checked; 20 of 20 succeeded.

The 20 total GLBs occupy approximately 8.6 MiB. They are *reference-pose previews*, not animated skeletal imports. The PSK source includes skinning bones but those are intentionally not exported as animation rigs in this iteration. Original game textures, material graphs, pattern masks, and accurate body-zone mappings are **not included**.

Newly available mesh geometry for previously pending species includes Deinosuchus, Austroraptor, Ceratosaurus, Herrerasaurus, Omniraptor, Beipiaosaurus, Diabloceratops, Dryosaurus, Gallimimus, Hypsilophodon, and Tenontosaurus. The uploaded batch does not include models for Deinocheirus, Kentrosaurus, or Troodon.

### Available comparison page

`public/skin-studio/model-lab.html` is a read-only browser mesh inspector. It loads chosen `.glb` files from the user's device via the File API, renders body and eye material groups, allows orbit/zoom/wireframe/tint, and never calls the website skin APIs. It attempts local model paths only for private HTTP-served test bundles. It does not contain models or licensed game assets.

**Do not automatically enable new models on production.** Source meshes were obtained through a third-party website; public accessibility does not establish permission to republish them or derivatives. The binaries and their locally converted GLBs have not been committed here. Establish provenance and rights before public hosting.

## Integrated admin model preview (v013)

The live `/skins` page's existing **Admin · Zone Calibration** panel now includes a **Private model preview** file picker. It accepts one or up to 25 local glTF 2.0 `.glb` files (the private bundle contains 20), validates their binary headers, identifies the destination species from the canonical filename, and loads them through the existing lazy Three.js GLTFLoader. The website model remains available through **Use website model**.

- Choose all 20 files from the owner's extracted `models/` folder to register all 20 previews for this browser session; switch the regular **Compatibility** species selector to compare them.
- Models are **browser-local** and never sent to the server, linked to a player skin, or shipped in this public repository. A reload clears the model selections.
- Converted PSK meshes preserve separate Unreal Body/Eye material names; shape-only preview now renders the native `eyes` colour on eye meshes and `body` on other meshes.
- Per-model SHA-256 fingerprints scope calibration drafts so a skin zone mask cannot cross between two different model geometries with the same species ID.
- Painting and mask export use the existing admin tools. Even with the new geometry, previews remain **shape-only until the EVRIMA UV zones are calibrated and verified in game**.
- A local model can be changed or reverted only when painting is stopped; existing public mesh/skin paths and Wear Live are untouched.
- The 30 MB per-file limit and 25-species batch bound protect browser performance; no third-party binary is added to Git or Render.
- Legacy site has no automatic access to locally loaded meshes; normal players continue seeing the licensed/current site models.

## How to try on the deployed website

1. Extract the private `hollow-valley-skin-studio-v013-private-model-lab.zip` bundle from the prior chat (not GitHub).
2. Sign in as an admin at `https://hollowvalleyisle.com/skins`, open **Skin Studio**, and find **Admin · Zone Calibration**.
3. Under **Private model preview**, click **Choose files** and select all `models/*.glb` from the extracted bundle.
4. Use the existing species selector; select Deinosuchus to begin. Click **Start mapping**, select a UV zone, paint the model, then **Copy mask** to export its JSON. Compare each mapping to an actual in-game screenshot / SkinInspector capture before declaring it accurate.
5. To return to the standard model, stop mapping and click **Use website model**. A page reload also clears all local meshes; it does not erase the separate local UV drafts.

This is the most we can safely deploy without publishing third-party model binaries or claiming unverified colour accuracy.

## Build stages

1. **Model pipeline (offline proof: complete)** — PSK parse, transform Unreal Z-up/cm to Three.js Y-up/metres, preserve UV seams, material slots, and geometry. Verify 20 species. Keep the owner's private model bundle outside source control.
2. **Source-controlled conversion / validation (initial complete)** — original offline converter is in `scripts/skin_studio_psk_to_glb.py` with five synthetic tests in `scripts/test_skin_studio_psk_to_glb.py`. Next hardening: automation around missing-source detection and site-specific model budget limits.
3. **Accurate colour mapping** — use real validated skin screenshots and SkinInspector captures to map each species's native colour regions to the correct UV islands. Support `underbelly`, `body`, `markings`, `flank`, `maleDisplay`, `detail1`, `eyes`, plus extended channels. Keep `shape` status until actual EVRIMA verification passes; do not label shape-only tints as accurate.
4. **Model registry integration** — add a gated variant to `public/assets/skin-studio-model-registry.js`, loading only one species at a time and keeping a known-safe fallback when model or mask fails. Avoid breaking `/skins`.
5. **Native palette fidelity** — test import/export RGB byte-normalization, six-decimal wear-token precision, zero-valued `underbelly`, and species pattern safety. Never overwrite native index fields without verified species limits.
6. **Persistence and gameplay** — test fresh-spawn juvenile/adult, sex variants, save/edit/reconnect, wear queue status, and birth/respawn isolation. Maintain Steam ID ownership, marketplace exclusives and existing command retry semantics.
7. **Staging review** — visual regression, memory/performance, mobile controls, keyboard/ARIA, error fallbacks, CI and rollback checks. Require explicit approval before merging or deploying.

## Validation performed

- Every source PSK has a readable point/wedge/face table, material slots and UV coordinates.
- All 20 local GLBs were reloaded with a separate GLB parser; mesh triangle counts agree with the PSK inputs, material grouping and vertex UV are present.
- Five synthetic offline converter unit tests passed (GLB signature, material/UV preservation, invalid mesh rejection, malformed data rejection and winding handling).
- Model lab browser module passed `node --check`.
- No live site, database, Steam data, shop data, production Git branch, or game server mod was modified. The feature branch includes a gated local-only viewer and CI checks; model binaries are not committed.

## Remaining blocker

The site owner should only authorise deploying model binaries to a hosted Hollow Valley endpoint once they have permission to redistribute the corresponding meshes. Technical comparison and private prototyping can continue without that public distribution.
