# Roadmap #22 — profile skin collections

Local branch: `feature/hv-roadmap-collections-20261105`, stacked on the local
gallery branch. The prepared achievements branch remains unchanged.

## Implemented

My Profile now groups the existing membership skin catalogue by collection key,
shows owned/visible counts, names, species, palette swatches and ownership source.
Created designs, permanent unlocks and active personal grants count once per
preset. Revoked grants do not count. General catalogue availability does not
establish ownership. The display distinguishes revocable grants from permanent
unlocks and identifies palette previews rather than claiming an in-game render.

Published active skins are visible; archived, previously published active skins
remain visible only to their owner/unlocked or granted account. Private drafts,
unpublished review copies, full skin payloads, share codes and admin verification
notes are omitted. Unknown rarity tiers are not inferred from membership status.

The website reads collections for the session's linked Steam account, ignoring
identity supplied in the URL. Its automation request uses the existing website
credential and no-store responses. The service performs reads only; viewing a
profile does not create a wallet, claim a skin, grant an entitlement or modify
progression. The profile handles disabled, empty and unavailable collections
separately and keeps its other sections available.

## Verification

24 premium-skin service, concurrency and website-route tests passed. Added
checks cover session identity, guests, private drafts, no database writes,
active/revoked grants and retaining archived owned skins without exposing them
to other accounts. The existing profile browser fixture passed at 1440px and
390px with collection counts, owned/locked labels, safe text rendering, outage
handling, guest hiding and layout bounds. Mobile collection cards were inspected.

## Remaining roadmap work

Broader rarity classification, additional collection curation, real in-game
verification of starter palettes, gifting/trading integrations, authenticated
staging and production verification remain outstanding. No production settings,
skin entitlements, purchases or game commands were changed.
