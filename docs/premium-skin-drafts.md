# Premium palette drafts

These are repository drafts, not published shop items or subscription entitlements.
The separate `public/assets/premium-skin-drafts.json` pack contains Ashfall,
Moonlit Marsh and Valley Royalty. It deliberately does not replace the older
20-pack, including that pack's existing Moonlit Marsh. Its distinct pack ID keeps
the existing import workflow's idempotency keys separate.

## Supported implementation

Each draft contains ten six-digit HEX colours and native patternIndex,
themeIndex and skinVariation values of 0 (the editor defaults). The existing
pack importer converts HEX to normalized RGBA, with alpha 1. No textures,
custom masks, emission, metallic effects, geometry or new patterns are included.
Universal is the existing compatibility field, not a verified appearance claim.

The current `/skins` page loads the legacy pack importer. Its External Library
supports JSON packs and explicit draft creation through POST /api/skins/studio.
The newer `/skin-studio/` workspace uses the same native fields. Backend creation
in skinPresetService starts records at published=0, is_premium=0 and price=0.
Publishing and exclusive grants are separate operations. The marketing term
premium here does not set the database is_premium flag or create monthly claims.

## Preview and preservation

Open `/premium-skin-preview.html` on a local or staging build of this revision.
It validates palettes with Skin Studio's core and shows all channels as labelled
swatches. It only fetches the static JSON; there are no API writes, local-storage
writes, imports on load, save, wear, grant or publish controls. The External
Library has a link to this preview. Existing packs, player records, ownership,
prices, grants and live dinosaur data are unchanged. No database migration or
production configuration change is part of this work.

The JSON download is compatible with the existing Choose JSON pack workflow,
but has not been imported into any live account. Keep it as a file until testing
is arranged. Existing staging safety blocks all skin mutations, including wear
reconciliation; do not disable that guard on a staging service connected to live
data. A remote staging deployment is separate from these repository changes.

## Required in-game verification before release

1. Use a dedicated test environment and account with isolated game/data access.
   Import as new drafts; do not find or overwrite records by display name.
2. Check pattern/theme/variation 0 on each intended species; restrict compatibility
   if some species are unsuitable. Check both sexes and relevant growth stages.
3. Inspect body, flank, underside, markings, detail and male display placement in
   daylight, shade and wet/night conditions. Verify eyes, teeth, mouth and claws;
   browser swatches cannot establish game colour conversion or channel mapping.
4. Apply through the supported workflow and confirm returned native values,
   visible appearance, and reconnect persistence on the same dinosaur life.
5. Record game version, species, sex, growth, screenshots and any adjustments.
   Recheck changed palettes before choosing prices, eligibility or grants.
6. Only after verification, explicitly decide how these should enter the premium
   catalogue. No production publication or automatic subscriber reward is enabled.
