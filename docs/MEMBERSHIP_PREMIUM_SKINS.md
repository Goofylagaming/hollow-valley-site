# Premium Skin Studio collections

## What this change adds

- A **Premium collections** tab at `/skins#premium-collection` with palette-only previews, membership choice allowances, permanent ownership and pending-claim retries.
- An admin collection workshop to prepare **Ashfall**, **Moonlit Marsh** and **Valley Royalty** as private drafts, or clone an existing design owned by the signed-in admin.
- Draft editing through the existing Skin Studio colour controls. The save button explicitly says **Save premium draft** while editing a catalogue draft.
- A separate in-game verification step recording the tested species, admin Steam identity and notes, followed by an explicit publication step.
- A fingerprint check rejects verification of a draft that changed since its review panel was loaded.
- Reviewed/published palette snapshots are immutable. Create a new draft version for changes. Archiving removes a skin from new choices while preserving its existing unlocks.

These are colour-palette previews, not simulated screenshots or guaranteed 3D colour matches. No drafts are seeded, verified, published, or applied to a dinosaur automatically by deployment.

## Activation

1. Deploy the matching website and automation code to the appropriate validated environment.
2. Sign in as a Steam-linked admin. Open **Skin Studio → Premium collections**.
3. Select **Prepare starter palettes**, or clone one of your own saved designs with **Create premium draft**. These operations create private records and do not send game commands.
4. Edit a draft in Studio if needed. Use the existing **My Skins → Wear live** or parked-dinosaur application only when you are ready to perform an authorized in-game test.
5. Return to the workshop and select **Record in-game check**. List each concrete species checked and the results. Universal compatibility is not accepted as a substitute for specific tested species.
6. Select **Publish to collection** for a reviewed skin. Publication makes its palette card visible; claiming remains disabled until rollout is enabled.
7. Enable `MEMBERSHIP_PREMIUM_SKINS_ENABLED=true` on automation together with the website membership rewards rollout described in the membership setup documentation. Existing `SKIN_SYSTEM_ENABLED` must also remain enabled.

Read-only staging identities remain read-only under the existing `skinMutationGuard`. Do not disable this guard or connect staging writes to the production automation database to test the feature. Isolated local integration tests exercise write behavior against temporary or in-memory databases.

## Entitlement and API contract

The website owns paid-period quota reservations. Browser callers never supply their Steam identity, tier, quota, claim ID or admin identity as authority.

- `GET /api/skins/premium`: safe published cards; no raw skin JSON, share code or private review notes.
- `GET /api/skins/premium/admin`: Steam-linked admins only; includes drafts and review data.
- Admin mutations under `/api/skins/premium/admin/*`: session-authenticated admin only and blocked on read-only previews.
- `POST /api/supporter/rewards/skins/:skinId/claim`: website membership route reserves a paid-period choice and calls the trusted automation endpoint.
- Trusted `POST /api/website/premium-skins/fulfill`: existing website bearer token required; `{claimId,steamId,skinId}` permanently inserts an existing `economy_skin_unlocks` record and receipt in one SQLite transaction.

`premiumSkinClient.listCatalog(steamId)` returns `{enabled, skins, publishedCount}`. Cards contain `id`, `presetId`, `name`, `description`, `collectionKey`, `state`, `published`, `owned`, `swatches`, `verifiedSpecies`, `premium` and `previewType`.

`premiumSkinClient.fulfillClaim(...)` returns `{claimId,skinId,presetId,duplicate,alreadyOwned,preset?}`. Replaying the same successful claim returns `duplicate:true, alreadyOwned:false`, including after a collection is archived or the rollout is disabled. If a different claim selects an already-owned skin, it returns `alreadyOwned:true` without creating a receipt, allowing the website to release that reservation.

The legacy `isPremium` flag means free/public access in the old skin code and is deliberately not reused. Membership catalogue presets use a separate `membership_premium` marker and remain private, exclusive, unpublished in the ordinary shop, and without share codes. Generic publishing, grant, edit and delete paths reject these managed records. Existing public skins, private designs and exclusive grants retain their current behavior.

Subscribers can apply a catalogue skin only to the concrete species recorded in its verification list. The draft creator can test it on other species before publication. Subscription expiry does not delete or revoke the permanent unlock.

## Verification

`automation-platform/test/premiumSkins.test.js` covers draft privacy, idempotent preparation, publication gates, version checks, entitlement bypass attempts, permanent unlocks, replays, conflicting receipts, existing ownership, verified species and rollback flags.

`test/premiumSkinsRoute.test.js` covers guest/member authorization, server-derived admin identity and read-only preview mutation blocking. Existing skin preset, live-wear, share-code, preview-safety and client regressions are included in the targeted test run.
