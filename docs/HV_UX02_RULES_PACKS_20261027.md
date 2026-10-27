# HV-UX02 — Hollow Valley rules and pack limits
_Development draft · 27 October 2026 (Australia/Brisbane)_

## What ships on this development branch

Public website:

- /rules — searchable, category-filtered published server rules.
- /packs — all 21 Hollow Valley informational species entries (from the
  first-party server/data/species.json), official pack-size policies when
  published, and an interactive grouping check.
- /api/community-guides — published rules/packs/compatibility only, no drafts.
- /api/community-guides/history — public aggregate revision log with release
  versions and counts, without admin identities.
- /api/community-guides/check — read-only policy evaluation; requests are POST
  to keep structured inputs bounded; no game or wallet actions.

Staff:

- /adminrules — dedicated Steam-admin publishing page.
- /api/community-guides/admin — admin-only draft, version and signed release
  history, with backend permission checks.
- PUT /api/community-guides/admin/draft — private validated draft, optimistic
  concurrency to avoid accidental overwrites.
- POST /api/community-guides/admin/publish — requires exact PUBLISH
  confirmation and authenticated linked Steam admin identity.
- Immutable additive community_guide_history records each published revision.

## Critical integrity rules

### The species reference list is **not** server policy

The current first-party server/data/species.json provides packLimit values for
multiple species, including Tyrannosaurus: 2, Triceratops: 4, Ceratosaurus: 5,
and Deinosuchus: 2. These are informational reference data originally used in
species/help displays. They have **not** been verified as currently approved
Hollow Valley game-server group restrictions.

Do not automatically import these numbers as official rules. The public
species directory labels them Reference; staff must add approved maxima to
the private draft, review, and publish them explicitly. An unpublished
policy causes the checker to respond Unverified, never Allowed/Compliant.

### Checker interpretations

Single-species:
- An approved max exists: within-limit or over-limit at the chosen player count.
- No approved max: unverified, even if reference packLimit exists.

Mixed-species:
- Specific explicit deny: prohibited.
- Specific explicit permission: compatibility-only; total mixed group size is
  still unverified, regardless of species-specific solo pack caps.
- No exact pair decision: unverified.
- No diets, nesting, PvP or allied-group rules are invented.

This is a website policy guide, not a real-time in-game group inspection,
discipline, automation or enforcement system.

## Safe release flow

1. PR is based on feature/hv-ux01-nav-home-20261027 and requires that UI
   parent change (#239) to be reviewed and integrated first.
2. Run test/communityGuides.test.js plus full existing website regression
   and browser staging checks with isolated local SQLite. Do not connect
   real CommandBridge, Stripe or RCON to staging.
3. Verify public pages are functional when no rules have been published,
   and do not expose private drafts or admin Steam IDs.
4. Verify guests/non-admins cannot load admin pages or API; check
   origin protection, concurrency, validation and publication audit history.
5. Ensure SQLite backups include the two additive guide tables; do not
   detach or replace the production disk. Keep existing membership, storage,
   wallet and player database rows intact.
6. After review and explicit production approval, deploy website code
   **with no official policies published**. Staff can then author verified
   Hollow Valley rules in /adminrules and publish them separately.
7. Check displayed rules against the current Discord #rules, game server
   configuration, species roster and written moderator approval.
8. Do not mark future support reports, pack enforcement or automated
   Discord release messages as live until independently tested and approved.

## Next iterations

- A staff-reviewed Markdown import from authoritative Hollow Valley policy
  documentation, with a preview before any publication.
- Clear definitions for group-size rules (fresh/spawned versus grown dinosaurs,
  species switches and whether hatchlings count).
- Pair-specific grouping exceptions and global mixed-group caps **only if
  expressly confirmed**. The current checker never guesses them.
- A detailed public rule-change diff for admins, without exposing private
  moderator notes or personal data.
- Optional Discord publication announcements via the existing dedicated
  HerbyBot progress channel after HV-C01 is safely activated.

No production deployment, database writes to live players, reward changes,
game commands or Discord messages are performed by this branch.
