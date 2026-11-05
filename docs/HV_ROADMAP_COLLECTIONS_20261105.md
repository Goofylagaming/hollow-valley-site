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

Additional collection curation, real in-game
verification of starter palettes, gifting/trading integrations, authenticated
staging and production verification remain outstanding. No production settings,
skin entitlements, purchases or game commands were changed.

## Admin rarity classification

Admins can explicitly classify catalogue skins as Common, Rare, Epic, Legendary
or Event, or clear a classification. Existing skins remain unclassified until
a decision is recorded. Each change requires a reason, the current revision and
a retry identifier. The session supplies the reviewer identity. Conflicting or
stale decisions are rejected, and replaying an earlier request cannot overwrite
a later decision. The admin panel shows the latest 20 audit entries; public cards
and profile collections show only the rarity label.

Classification does not change palette data, publication verification, prices,
wallets or entitlements. Same-origin JSON and admin authentication are required;
read-only preview sessions cannot submit changes.

Validation: 26 premium service, concurrency and route tests passed. The isolated
rarity browser fixture passed at 1440px and 390px, covering failed-save retries,
preserved reasons, escaped audit text, read-only controls, guest isolation and
layout bounds. These checks use synthetic data; no live skins were classified.
