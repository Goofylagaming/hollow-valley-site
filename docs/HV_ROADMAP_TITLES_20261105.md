# HV-W02.1: earned profile titles

Private implementation, 5 November 2026. Not deployed or marked complete.

This starts roadmap #1 using existing permanent account achievements: Valley Regular, Valley Veteran, Ancient One, Living Fossil, Quest Master and Valley Socialite. My Profile shows each requirement, locked/unlocked state and a persisted title choice. Players may clear their choice. The selection is cosmetic.

The website checks fresh automation progression for the signed-in Steam identity on every title read/write. Request-supplied identity, XP or achievements cannot grant a title. Missing, stale or mismatched progression fails closed. Offline failures preserve the saved choice. Mutations require authenticated same-origin JSON. Responses are private/no-store. The additive profile_title_choices table stores only the selection; no player data is replaced.

Roadmap #1 is Building / Testing. Original description and numbering remain. Existing #1 votes remain in historical totals but no longer occupy any of the three active votes. No production date is claimed.

Remaining #1 scope: reputation from quest/event/combat/long-survival/Territory/helping signals, reviewed reputation rules, further titles, public leaderboard display, Discord and overlay integration. Current cumulative account playtime must not be described as one dinosaur's lifetime. Achievements #2 and other roadmap items remain in the original full plan, docs/WEBSITE_ROADMAP_20261027.md; this batch does not substitute for that roadmap.

Validation: 41 service/HTTP/roadmap regression tests pass, covering persistence, account separation, locked/unknown IDs, clearing, forged achievements, wrong identity, stale evidence, outage preservation, same-origin and authentication gates. Roadmap voting tests preserve retired history and the three-vote allowance.

The isolated browser fixture `scripts/verify-profile-titles.cjs` passes at 1440px and 390px. It loads the real profile HTML, styles and JavaScript with synthetic API responses and blocks external network traffic. Verified unlocked-only options, save/reload, failed-save preservation/retry, clearing, read-outage disabled controls, independent progression display, guest guard, form bounds and no page errors. Both panel screenshots were visually reviewed after styling; controls meet a 44px minimum height. Evidence is in the sibling `hollow-valley-roadmap-evidence` directory. These are fixture checks, not authenticated production/staging tests.

Authenticated staging verification remains required before production approval. No live migration, reward payout, game command, merge or deployment is included. The user authorized uploading this branch to the private Goofylagaming/hollow-valley-site repository and opening a draft PR on 5 November 2026. Production merge and deployment remain outside this approval.


## Leaderboard title display — local implementation

Selected earned titles now display beside player names in daily/weekly combat,
playtime and level rankings. The website makes one bounded batch evidence request
for players with saved choices. Evidence must be fresh and match the player's
Steam identity and required achievement; missing, withdrawn and pending-review
awards do not authorize a title. Clearing a choice removes the display.

The authenticated automation endpoint reads saved award records only. It does
not synchronize profiles, unlock achievements or change wallets/XP. Evidence
outages leave ranking rows available without titles. Public responses carry only
the selected title ID and display name, not the underlying award evidence.

Seven targeted service/HTTP tests passed, including no database writes, forged or
stale evidence, permissions, bounded input and graceful outage behavior. Isolated
browser fixtures passed at 1440px and 390px across all tabs, including escaped
text and the untitled fallback. Staging and production remain unverified.
Discord/overlay display and the remaining reputation signals remain outstanding.
