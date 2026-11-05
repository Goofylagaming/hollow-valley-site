# Dynamic daily and weekly challenges — development

Roadmap #3 remains Building / Testing. This branch has the evidence layer and
private player controls. Nothing has been deployed or enabled.

Authenticated feed validation now preserves unknown numeric telemetry instead of
coercing null/blank/Boolean/container values into measurements. The real intake,
saved website snapshot, Legacy milestones and opt-in challenge journal are checked
together; unknown-to-adult growth cannot fabricate a juvenile milestone. See
`HV_CHALLENGE_TERRITORY_EVIDENCE_20261105.md` for the remaining source-life identity
gap. Existing accepted evidence is not rewritten by this correction.

## Implemented evidence core

`dynamicChallengeStore` uses additive tables in the automation database. It is
called inside the accepted Valley Legacy snapshot transaction, so failures roll
back the snapshot and its challenge evidence together. It consumes accepted
species, normalized growth and observed-life identity. That journal stores no
player names or coordinates and does not read journey history or discovery
receipts. Separate positional collection below requires its own consent. The source remains the
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

Accepted opt-in challenge samples now retain canonical species, normalized growth,
observation time and a private observation-segment key for up to 35 days. No
coordinates or names are added. This challenge history is independent of journey
and discovery consent and is deleted on challenge opt-out and by retention.

Trusted, accepted Legacy combat deaths recalculate affected survival/growth
segments from those samples in the same source-event transaction. Intervals
crossing a death do not count; a sample at the exact death timestamp cannot serve
as an alive endpoint. The best uninterrupted pre/post-death run is retained,
including a valid completion already earned before death. Juvenile/adult evidence
cannot bridge a death. Repeated and out-of-order reports use the same source
events and observations. Future samples begin a fresh challenge segment even
when Legacy cannot link a contradictory late report to its current observed life.
Already-known deaths also prevent later snapshots reconnecting across them.

Corrections affect only the relevant enrolled account, including retained
progress while tracking is paused. Opt-out prevents late reports rebuilding
deleted challenge history. Failed correction rolls back the source death and
progress together; producer reconciliation does not advance its import receipt
on that failure and can retry. Older development aggregates without retained
challenge observations remain stored but cannot qualify survival/growth as
reconciled evidence. New samples do not extend those unjournaled segments.

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

- Verify the real completed-event producer and authenticated staging for staff
  attendance controls. Review staff self-attestation and correction policy before
  enabling them. The ordinary player API has no attendance writer.

- Review the deterministic schedule and supported pool, including canonical
  species aliases and growth evidence. Add operator-reviewed schedule versions
  before changing live definitions.
- Survival remains an *observed continuity* measure: the feed has no immutable
  game-character identity. Accepted deaths correct retained samples, but Legacy
  rejects evidence belonging to closed seasons or conflicting source IDs. That
  existing immutable-season boundary is unchanged. Historical rejection review,
  missing/deleted source evidence and actual character identity remain delivery
  gates before guaranteed survival achievements or any rewards are authorized.
- Review real map units and Highlands geometry and verify source cadence before enabling the local travel/visit
  implementation. Verify the completed-event producer before enabling attendance.
  Add Territory battle survival from frozen participant-life/outcome evidence.
  An RSVP, registration, group win, payout or one location alone cannot prove
  these requirements.
- Define non-punishing streak bonuses and reward rules with approval. No new
  automatic coin payouts are authorized by the implementation plan. Nothing in
  this core installs rewards or treats future approval as granted.
- Verify authenticated staging, feed freshness and production release. Review
  retention policy and deployment flag operation with actual host configuration.
  Runtime toggles unseen by any running service cannot establish an exact pause
  timestamp; configuration changes should use the normal restart lifecycle.

The roadmap release register retains #3's original description and feature ID,
marks development honestly and preserves historical vote counts while freeing
retired active ballot slots. Homepage asset version is 110. Diplomacy publication
approval remains separate and pending; its prepared branch is preserved.

## Local validation

220 affected checks pass across dynamic challenge evidence, Legacy store/private HTTP and
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

Late-death tests cover false completion removal, valid earlier completion,
out-of-order/duplicate reports, exact sample timestamps, growth boundaries,
known deaths before future samples, restart recovery, unrelated accounts,
disabled tracking, opt-out, unjournaled historical aggregates, transaction failure
and actual combat-producer import retry. The real Quests browser fixture also
checks progress changing from 90 to 40 observed minutes after a late death.

## Reward-free event participation evidence core

Existing RSVP times/titles are supplied by the RSVP request, and existing
attendance confirmation issues coins. The new event challenge does not infer
attendance from either that record, a reward transaction, registration or an
RSVP. It does not invoke or change that payout workflow.

`challengeAttendanceEvidence` is a host-internal service with a separate disabled
`DYNAMIC_CHALLENGES_EVENTS_ENABLED=0` flag and an explicit
`DYNAMIC_CHALLENGES_EVENT_GUILD_ID` allowlist. Confirmation requires a fresh
five-minute official event snapshot, matching guild, exactly one visible completed
event and a complete past start/end schedule. Review freezes its canonical
descriptor/revision, participant, attendance time inside that event, asserted
staff actor, reason and a Discord message link in the official guild. The message
is supporting human evidence; the service does not fetch it or claim to verify
its contents or actual in-game participation automatically.

Expected revisions and exact request receipts protect confirmation/revocation.
An altered saved request or changed official descriptor is rejected. State and
the immutable audit entry (including the full frozen event descriptor) commit
together. Revocation remains possible after the event disappears from the feed
and cannot retarget the original attendance time. Retries return the latest state
without restoring revoked credit. A source administrative attestation persists
separately from optional challenge gameplay history.

When explicitly enabled, Quests reads a weekly one-event goal from confirmed
records in the current Brisbane week and strictly after that player's opt-in.
Opt-out removes its challenge credit; rejoining cannot retroactively count earlier
attendance. A later revocation removes credit on refresh. The player view exposes
only progress, with no evidence URLs, staff identities, reasons or private event
records. No wallet tables or payout hooks are installed by this source.

Nine source tests cover review changes, stale/unknown/hidden/cancelled/duplicate
events, wrong guilds, invalid proof/time, retries, revocation, failed-audit rollback,
privacy, opt-in eligibility and default-off behavior. The desktop/mobile fixture
adds synthetic host-internal evidence and verifies displayed credit and revocation;
it initially exercised the internal source only. The subsequent staff workflow
checks below cover the website authorization and controls. Verify the
real producer retains fresh completed events and actual end times before rollout.

## Staff authorization, fixed reviews and Events controls

The separate `/api/admin/challenge-attendance` automation API requires
`AUTOMATION_ADMIN_TOKEN`; the ordinary website token cannot read or write it.
Both service flags, Legacy enablement and source read-only controls remain in
force. `/current` is read-only. `/review` validates and returns the proposed choice
without changing attendance; `/change` revalidates the frozen descriptor and CAS.

The website's matching staff API checks the actual current `users` row, user ID,
linked Steam ID and admin permission before each operation and after asynchronous
responses. It does not rely solely on the session's old admin flag. New reviews
and confirmations require exact-origin JSON, reject cross-site context and obey
deployment-preview/read-only guards. There are no payout calls.

A review is stored immutably in the website database for its creating staff
member. It freezes the server-selected actor, player, action, canonical event,
attendance time, proof, reason, expected source revision and unique source request
key. Confirm accepts only the saved review ID and an empty body. Replacement
fields are rejected. Other staff cannot load or confirm someone else's review.
Twenty reviews per minute per staff member limit accidental flooding. Retries
reuse that original body and key and return the latest source state without
reinstating revoked evidence.

Authority is checked immediately before dispatch and again before disclosing a
response. A permission loss after an already-authorized dispatch cannot cancel a
source commit. In that case the private response is withheld; current authorized
staff can inspect the record, and the creating actor can recover the same request
after reauthorization. HTTP tests explicitly cover this boundary and verify one
source receipt rather than implying cross-database cancellation.

The Events page has an independent staff panel with review/confirm/revoke actions,
explicit Brisbane attendance time and plain-text frozen details. Review creates
no source evidence. Lost confirmation replies never trigger automatic reposts;
the operator must explicitly retry the saved confirmation. A review ID in the URL fragment restores the same
server-owned review after a page reload without posting a confirmation; no private
evidence is stored in browser storage. Account changes clear that fragment and
the review. Stale source revisions require a new review. Members cannot
see the panel, and previews disable writes. The existing Events scripts, payout
controls and group roster remain in order.

HTTP checks cover separate credentials, current/stale staff authority, permission
changes during delayed reviews/confirmations, actor spoofing, immutable targets,
replay recovery, revocation, private cache headers, CSRF and preview/default-off
gates. The actual Events fixture passes at 1440px and 390px for review, explicit
confirmation/retry, revocation, conflict, safe text, preview, account changes and
member privacy. The existing 51-group Events roster fixture also passes at both
widths. All fixtures use synthetic accounts and temporary/in-memory databases;
real staff authentication and completed-event synchronization still need staging.

## Event feed verification and receiver ordering

The owner-designated shared bot checkout was inspected read-only at
`9c5bf4e06407b60f1df3c68b05a17d2e2813df5a`. Its payload omits lifecycle
status and its sync filters out completed/cancelled events. This is a verified
local source gap, not independent evidence of the deployed worker. The source
belongs to the consolidated Primalbound owner and was preserved. Exact evidence,
required producer work and the receiver contract are in
`HV_EVENT_PRODUCER_HANDOFF_20261105.md`. Completed attendance cannot be inferred
from event disappearance while that source gap remains.

The Hollow Valley receiver now rejects mixed-guild events, invalid schedule order,
timestamps more than one minute ahead, older snapshots and conflicting payloads
at the same accepted timestamp. Older/conflicting authenticated HTTP requests
return 409 and leave accepted state intact. Canonical exact retries preserve
hidden events and do not renew timestamps. Source updates and website hides use
one serialized SQLite read/validate/write transaction; failures roll back state.

The expanded local set has 146 passing checks, including ingestion chronology,
same-time conflicts, future/mixed-guild rejection, canonical retries, hidden-event
preservation and rollback, plus existing private group-registration/charge and
recovery checks. The source HTTP fixture uses in-memory databases to avoid
deleting an open database file on Windows. Consumer fixtures use increasing
accepted timestamps and explicitly seed old/corrupt cache states for outage
checks. Existing group-event roster and purchase browser fixtures pass at 1440px
and 390px. No bot change, publication, payout or deployment occurred.

## Separate positional consent and reviewed map goals

The local location core has immutable operator-reviewed catalogs with explicit
Unreal-centimetre units, map version, integer bounds, a simple Highlands polygon
and review notes. Invalid/repeated/intersecting/zero-area geometry is rejected.
Registration freezes a digest; activation requires that exact digest, the expected
active version and an operator identity, with an atomic audit. No real map catalog
or Highlands geometry is supplied or activated by this branch.

`DYNAMIC_CHALLENGES_LOCATION_ENABLED=0` is the default.
`DYNAMIC_CHALLENGES_LOCATION_MAP_VERSION` must match the active reviewed catalog.
The player also explicitly opts in through the separate private `/location` API
and Quests review controls. General challenge participation never implies location
consent. Exact retries, choice revisions, same-origin JSON, session Steam binding
and preview/read-only guards protect this choice. Twenty choices per minute are
allowed; an actual stop remains available at that limit. Consent revisions and
minimal choice receipts remain to prevent replay after deletion/rejoining.

Only current accepted Legacy snapshots are used. The collector retains one last
position per participating player, not a trail. It expires after 120 seconds;
normal Legacy maintenance removes expired rows on its next 15-second pass, or at
startup if the service was stopped. Missing positions, changed lives/catalogs,
paused tracking, map mismatches, gaps over 120 seconds and displacement over
40 m/s break continuity. Samples must be fresh (within 30 seconds), after consent
and after the recorded activation. A source with longer gaps cannot progress
these goals; actual telemetry cadence and units remain staging gates.

Accepted pairs produce coordinate-free distance/Highlands receipts, expiring
after 35 days and removed by maintenance. Distances use observed straight-line
displacement in metres, capped at the 12 km display target. Highlands requires
both consecutive points inside the reviewed polygon; a line crossing the region
does not count. Only pairs wholly inside the current Brisbane day contribute,
with no invented cross-midnight position/time interpolation. Accepted late deaths
invalidate receipts crossing their timestamp and clear the position baseline;
unrelated valid movement is retained.

These are observed displacement receipts, not proof of continuous ground travel
or absence of teleportation. Validate actual gameplay movement/teleport signals
and anti-farming rules before authorizing rewards or guaranteed achievements.
No new reward or game command is installed. Journey/discovery preferences and
their saved private data remain independent.

Stopping location tracking erases its position and progress receipts. Stopping
all challenges does the same and advances the separate consent revision so a
delayed old opt-in cannot restore collection after rejoining. Location can also
be stopped while its map rules are unavailable, subject to the existing website
write guards. Player responses expose consent/catalog metadata and capped
progress only, with no coordinates, geometry, operator notes or private route.

Twelve additional core tests cover map validation/activation rollback, explicit
consent, accepted displacement, two-point visits, gaps/jumps/life changes, deletion,
replay, activation/map changes, late deaths, snapshot rollback, independent raw
retention and Brisbane rollover. The actual private HTTP fixture checks Steam
binding and location deletion on general opt-out. The desktop/mobile Quests
fixture uses an explicitly synthetic catalog to verify review, lost replies,
explicit retry, 12 km/Highlands rendering and deletion while tracking is paused.
The location implementation initially brought the affected set to 158 checks;
the operator workflow below raises it to 165. Real geometry, real map/feed
verification and authenticated staging remain unfinished.

## Map operator review and activation workflow

`scripts/review-challenge-map.cjs` supplies `review`, `stage`, `inspect`, `activate`
and `deactivate` commands. Database writes require explicit `--write`; review can
create a separate new offline HTML artifact but opens no database. Staging and
inspection default to read-only connections and do not run schema migrations.
Missing files, unrelated databases, changed digests and stale active versions
fail before changing catalog selection. The tool never loads `.env`, guesses a
database path, creates a new database file or toggles collection settings.

The self-contained review artifact shows the canonical digest, map version/units,
review evidence, bounds and numbered polygon vertices. Text is escaped and its
content-security policy allows no scripts or external resources. A deliberately
synthetic artifact was generated through the actual CLI and rendered/visually
inspected. It is not a real Highlands boundary or production approval.

Activation/deactivation and their audit entries atomically clear last-position
and runtime baselines, including a pause/restart occurring between observations.
Saved geometry is revalidated against its digest before use. Exact known active
metadata can still be deactivated if the payload is damaged, without using or
repairing that geometry. Older activation audit rows receive an additive action
column; read-only inspection does not perform that migration.

Seven operator tests cover read-only behavior/schema preservation, wrong files,
changed rules, explicit writes, compare-and-swap, audit migration, baseline
clearing and integrity failure while preserving unrelated wallet data. See
`HV_CHALLENGE_MAP_OPERATOR_20261105.md` for the review/runbook and remaining release
gates. No real catalog or live database was changed by this work.

## Territory survival prerequisite

The next source audit confirmed that capture winner records do not establish
individual survival. Live status now requires actual fresh automation timestamps;
cached responses cannot fabricate a new `checkedAt` or keep positions live beyond
120 seconds. Runtime participation uses source observation times and retains an
explicit clock-verification boundary without upgrading old/unstamped history.
Public/admin Territory pages distinguish unavailable tracking from verified
offline reports. The combined affected scope has 220 passing checks, and both
real-page desktop/mobile projections pass presentation checks. See
`HV_CHALLENGE_TERRITORY_EVIDENCE_20261105.md` for exact evidence and the unfinished
participant/life/end-of-battle proof requirements. No survival reward or claim is
created from the clock marker or existing victory roster.

The dedicated Dynamic challenge tracking workflow runs the affected checks and
the real-page browser fixture on pull requests. Those hosted runs have not yet
been executed for this unpublished local branch.
