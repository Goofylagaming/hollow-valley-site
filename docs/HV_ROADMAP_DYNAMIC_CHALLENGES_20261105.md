# Dynamic daily and weekly challenges — development

Roadmap #3 remains Building / Testing. This branch has the evidence layer and
private player controls. Nothing has been deployed or enabled.

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
continuity cursors; rejoining cannot import that old evidence. Minimal choice
revisions and request receipts remain to prevent replay restoring deleted
participation. Challenge progress
is retained for up to 35 days and cleaned on accepted enabled snapshots and
independently at Legacy startup/every 15 seconds. Missed
days create no debt. Reads return only the requested player's current periods;
they contain no Steam identities, life IDs or positions.

`DYNAMIC_CHALLENGES_ENABLED=0` is the default. Tracking currently also requires
`VALLEY_LEGACY_ENABLED=1`. The existing fixed challenge/quest reward service is
unchanged. New tracking never accesses a wallet, ledger or game-command service,
and explicitly reports rewards disabled.

Tracking activation is durable. Observing a disabled flag clears challenge
continuity cursors without changing consent or deleting valid earlier progress.
Starting the service disabled does the same even without snapshots. Re-enabling
starts new observation segments; delayed samples timestamped before the recorded
activation cannot backfill a disabled interval. The weekly species already
observed remain counted, and a previously completed valid segment stays complete.
This does not combine separate survival segments or juvenile/adult evidence across
the pause. The maintenance timer runs this check with tracking disabled and
continues retention even if event reconciliation fails. If the entire Legacy
service is disabled/stopped, startup performs overdue cleanup when it next runs.

## Private API and player controls

`/api/dynamic-challenges/capabilities` exposes flags only. Authenticated `/me`
and `/participation` bind the Steam identity from the session, ignoring client
identity/progress fields. Reads are private/no-store. Writes require exact origin
and JSON, reject cross-site context and enforce feature, explicit read-only and
deployment-preview guards. Automation separately requires the website token,
feature/read-only gates and the existing Legacy gate. It offers no challenge
progress-writing endpoint to that token.

Participation writes carry an expected revision and unique request key. A
transaction acquires the SQLite write lock before reading the revision, saves
the choice and receipt atomically and rejects stale/altered requests. Exact
retries return current state without repeating the change, even if a newer
choice has since stopped participation. A failed receipt rolls back deletion or
enrollment. Twenty accepted changes per minute are allowed; an actual opt-out
remains available at the limit. Successful repeated enrollment does not move
the tracking start. Status reads use a consistent SQLite snapshot.

The existing Quests board and its scripts remain in order. An independent panel
shows the optional rotation, observed progress, Brisbane resets and no-reward
policy. Joining and stopping require review and explicit confirmation. A lost
reply only triggers reads; explicit retry reuses the saved key/body. Stale choices
require a new review. Fresh identity checks before and after private reads and
writes clear old account data after session changes. Preview controls are
disabled, and no private data is retained on sign-out or failed authentication.

## Required remaining delivery

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
- Verify authenticated staging, feed freshness and production release. Review
  retention policy and deployment flag operation with actual host configuration.
  Runtime toggles unseen by any running service cannot establish an exact pause
  timestamp; configuration changes should use the normal restart lifecycle.

The roadmap release register retains #3's original description and feature ID,
marks development honestly and preserves historical vote counts while freeing
retired active ballot slots. Homepage asset version is 103. Diplomacy publication
approval remains separate and pending; its prepared branch is preserved.

## Local validation

103 checks pass across dynamic challenge evidence, Legacy store/private HTTP and
authenticated telemetry, roadmap ballots/homepage integration, existing quest
boosts/challenge payouts, journeys and discovery. Tests cover repeated/stale
samples, alias farming, midnight/Monday rollover, opt-out/rejoin, separated lives,
invalid observations, adulthood qualification, evidence-failure rollback,
reopening, private output and unchanged wallet data. The existing quest boost
fixture now closes its database before removing its checked temporary directory
on Windows. Subsequent API and consent coverage adds exact retries, stale and
altered choices, receipt rollback, rate limits, private identity boundaries and
concurrent HTTP choices. The real Quests browser fixture passes at 1440px and
390px with synthetic accounts and an in-memory database, including original
quests, explicit reviews, lost replies, progress, preview, conflicts, account
changes during delayed reads, sign-out and opt-out. Authenticated hosted staging
remains unverified.

Maintenance coverage adds disabled snapshots/restarts, delayed samples after
activation, separated survival/growth evidence, no-feed retention, retained
consent/receipts and storage-error rollback. A scheduled Legacy fixture proves
cleanup continues while import fails and tracking remains disabled.

The dedicated Dynamic challenge tracking workflow runs the affected checks and
the real-page browser fixture on pull requests. Those hosted runs have not yet
been executed for this unpublished local branch.
