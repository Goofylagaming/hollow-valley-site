# Dynamic daily and weekly challenges — development

Roadmap #3 remains Building / Testing. This branch begins the evidence layer;
it is not a delivered player feature. Nothing has been deployed or enabled.

## Implemented evidence core

`dynamicChallengeStore` uses additive tables in the automation database. It is
called inside the accepted Valley Legacy snapshot transaction, so failures roll
back the snapshot and its challenge evidence together. It consumes accepted
species, normalized growth and observed-life identity, never player names,
coordinates, opt-in journey history or discovery receipts. The source remains the
authenticated automation presence feed/fresh RCON observation already used by
Legacy; the website gains no game connectivity or progress-writing endpoint.

The proposed v1 schedule resets at midnight Australia/Brisbane and on Monday.
Daily goals alternate 90 minutes of connected observed survival and growing an
observed juvenile herbivore to adulthood. Weekly variety records three different
supported species. These are development definitions, pending product review;
do not mutate an existing challenge ID's meaning after rollout. Expand the pool
with reviewed versioned definitions as additional evidence connections land.

Survival uses the best single observation segment, not combined lives. Species
change, growth reset, absence, invalid species and gaps beyond 15 minutes break
continuity. Boundary-crossing intervals credit only time inside the current
period. Growth requires juvenile and adult observations in the same segment and
daily period. Merely logging in as an adult does not qualify. Supported short
species aliases map to the canonical registry; unknown labels and aliases cannot
inflate variety. Variety currently means an accepted observation, not an invented
minimum playtime requirement.

Participation requires explicit opt-in at the store boundary; no one is enrolled
automatically. Repeated enrollment retains the original start, and samples at or
before that start do not contribute. Opt-out removes participation, progress and
continuity cursors; rejoining cannot import that old evidence. Challenge progress
is retained for up to 35 days and cleaned on accepted enabled snapshots. Missed
days create no debt. Reads return only the requested player's current periods;
they contain no Steam identities, life IDs or positions.

`DYNAMIC_CHALLENGES_ENABLED=0` is the default. Tracking currently also requires
`VALLEY_LEGACY_ENABLED=1`. The existing fixed challenge/quest reward service is
unchanged. New tracking never accesses a wallet, ledger or game-command service,
and explicitly reports rewards disabled.

## Required remaining delivery

- Steam-bound private API, strict same-origin JSON writes, preview/read-only
  controls, request revision/recovery and player opt-in/progress controls on
  Quests. Browser verification must cover both desktop and mobile.
- Review the deterministic schedule and supported pool, including canonical
  species aliases and growth evidence. Add operator-reviewed schedule versions
  before changing live definitions.
- Survival remains an *observed continuity* measure: the feed has no immutable
  game-character identity. Late combat-death reconciliation and contradictory
  growth/life evidence must be handled before presenting a guaranteed survival
  achievement or authorizing any rewards.
- Add travel (12 km), Highlands visitation, confirmed event participation and
  Territory battle survival only from reviewed map units/geometry, attendance
  evidence and frozen participant-life/outcome evidence. An RSVP, registration,
  group win, payout or current location alone cannot prove those requirements.
- Define non-punishing streak bonuses and reward rules with approval. No new
  automatic coin payouts are authorized by the implementation plan. Nothing in
  this core installs rewards or treats future approval as granted.
- Verify flag disable/re-enable and retained evidence policy, snapshot failure
  recovery, authenticated staging, feed freshness and production release. Cleanup
  currently depends on accepted snapshots and needs independent maintenance.

The roadmap release register retains #3's original description and feature ID,
marks development honestly and preserves historical vote counts while freeing
retired active ballot slots. Homepage asset version is 101. Diplomacy publication
approval remains separate and pending; its prepared branch is preserved.

## Local validation

78 checks pass across dynamic challenge evidence, Legacy store/private HTTP and
authenticated telemetry, roadmap ballots/homepage integration, existing quest
boosts/challenge payouts, journeys and discovery. Tests cover repeated/stale
samples, alias farming, midnight/Monday rollover, opt-out/rejoin, separated lives,
invalid observations, adulthood qualification, evidence-failure rollback,
reopening, private output and unchanged wallet data. The existing quest boost
fixture now closes its database before removing its checked temporary directory
on Windows. No browser/staging verification is claimed for the unfinished UI.
