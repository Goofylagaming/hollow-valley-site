# HV-UX05 — Hollow Valley Community, Group Recruitment and Nest Directory
Date: 27 October 2026 (AEST). **Draft only, not deployed.**

Based on UX04 PR #242, UX03 #241, UX02 #240 and UX01 #239.
Independent Player Reports #237 and Discord progress #236 are not merged.

## Delivered in this branch

- /community: portal to website Groups, opt-in recruiting listings, the
  existing Valley Legacy nests (only when enabled), Events, rankings and news.
- /recruitment: public opt-in group search by name, playstyle and species
  focus, plus Steam-authenticated interest messages and owner tools.
- Group owners can publish/unpublish their website-only recruiting card.
  Advertisements require a 20–500-character description; URLs and Steam IDs
  are rejected in public description text to avoid leaking identities.
- A visitor's interest is a **private enquiry** to the current group owner.
  It cannot create group membership, send a group invitation, grant coins,
  read a dinosaur's location or invoke CommandBridge.
- Owners can mark enquiries reviewed or declined; to send a real website
  group invitation they must use the existing /groups owner-only invite flow.
- Applicant's own enquiries are visible only to themselves and current
  group owners can see applicant Steam IDs only for their own group.
  Group roster, Steam IDs and applications never appear in the public feed.
- Only active, opt-in hv_groups are listed, with no display of closed or
  disbanded groups; at-capacity groups show a full label and block enquiries.
  Leaving/disbanding a group preserves past website membership history.
- A separate public Nest Directory reuses /api/legacy overview without
  changing nesting data. It only requests this source when the existing
  VALLEY_LEGACY_ENABLED feature flag is enabled; accepted egg reservations
  do **not** imply an in-game hatch.
- Additive tables hv_group_recruitment and hv_group_interest with rate
  limits and an active-request unique index; no change to original
  hv_groups, hv_group_members, group progression or invite data.

## Safety and testing

- POST/PUT guarded by Steam-linked session, exact Origin and JSON.
- Ownership verified from existing active website groups and current owner
  Steam identity on each write.
- No automated game or Territory War actions; do not advertise website
  memberships as connected to in-game parties.
- test/groupRecruitment.test.js covers public privacy, owner-only editing,
  CSRF, private interest, nonmember check, capacity, idempotency, review,
  cancelled enquiries and disband visibility.
- Isolated browser smoke checks guest recruitment/community on desktop,
  tablet and phone, including empty states and no accidental Steam leakage.
- Rebase dependency stack, verify backups/staging, then obtain explicit
  production deployment approval. Do not post to HerbyBot Discord until
  the dedicated progress bridge #236 is activated and delivery verified.

## Still not built (scope beyond UX05)

- A live in-game pack/party reader and authoritative presence-based group
  membership. The website group system cannot assert players are physically
  grouped together in Evrima.
- Clan treasury, group alliance/war declarations or player-to-player money.
- In-game automatic hatch detection and mutation inheritance confirmation.
- Any feature automatically modifying Valley Coins, stored dinosaur files,
  Stripe subscriptions, or in-game character state.
