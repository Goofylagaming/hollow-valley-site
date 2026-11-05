# Free season track — local rules and progress core

Roadmap #4 remains Building / Testing. This local branch starts from Event Engine
`e9556c42` and does not change the three prepared publication heads. No season,
player season UI, reward catalog or new payout has been enabled. The source-time
and achievement timing collectors are called by the existing progression service. The
season store is now reachable through default-off private HTTP routes after
explicit operator initialization. No active producer or reward rule is installed.

## Why the permanent XP write date is insufficient

`progression_xp_ledger.created_at` records reconciliation time. A quest completed
earlier or an event confirmed earlier can receive permanent XP later when that
player's progression is synchronized. Summing ledger write dates for a season
would misattribute delayed grants. Playtime grants previously retained a sequence
and interval length but no durable source-observation clock.

New grants now atomically retain a separate `progression_xp_source_times` receipt,
bound to the exact ledger ID/source/reference type. The table stores no new player
name, route, coordinate or combat identity. Its time basis is explicit:

| Basis | Recorded meaning | Limit |
| --- | --- | --- |
| `playtime-observation` | Accepted snapshot time when an existing playtime XP interval was granted | Not a complete trail or an allocation of all five minutes across a season boundary |
| `quest-achievement` | Original authoritative quest `achieved_at` | Not the time a delayed grant was written |
| `event-confirmation` | Existing paid attendance record's `confirmed_at` | Staff confirmation time, not automatically verified actual attendance time |

SQLite date-time strings are explicitly interpreted as UTC. ISO strings require
an explicit offset/UTC marker. Ambiguous dates, invalid calendar dates, malformed
values and incompatible source/reference bases remain unknown. Known source clocks
allow at most the existing two-minute skew tolerance; a future clock is not thereby
eligible for a season. No date falls back to the receiving process's local time.

Unknown time never changes the original XP award calculation. Existing records
without a receipt are not backfilled or upgraded by duplicate reconciliation.
Exact retries retain the first recorded source time. A source-time write failure
rolls back its new XP grant and the existing associated level reward together.
There is no separate XP grant, coin grant or game action in the receipt collector.

This is an always-active audit addition for newly written existing XP awards once
deployed, rather than an enabled seasonal calculation. It does not change XP
amounts, quest/attendance rules, level thresholds or the existing 100-coin level
reward. Existing paid quest/level behavior is regression-tested with synthetic data.

## Remaining full season-track requirements

- Validate the prepared private APIs and Quests-page enrollment/progress screen
  against real authenticated staging. They remain disabled, with no actual season
  installed and no public rollout.
- Review actual season dates, thresholds and attribution choices with operators.
  The proposed eight-to-twelve-week duration is not activated. Store contracts
  below constrain explicit choices; they do not establish an approved real season.
- Review the prepared privacy/retention maintenance against real operational
  policies and the source reconciliation cadence. The player-triggered update is bounded and never
  manufactures permanent XP or level coins; it is not a background collector.
- Real source verification for the 22 prepared achievement timing contracts. The existing
  permanent ledger currently grants XP from playtime, quests and paid event records;
  it is not a complete season implementation.
- Approved cosmetic/reward policy and any separately authorized payout behavior.
  No new automatic coin payments, restores or game commands are authorized here.
- Private player reads, progress UI, actual producer payload review, performance,
  hosted checks and authenticated staging before rollout.

Original #4 wording and historical votes remain. The feature leaves the active
ballot during development, freeing its old votes without deleting them. Eight
ideas remain eligible. Homepage planning asset version is 129. No production
completion date is assigned.

## Local verification

58 focused progression, fixed-quest, telemetry, roadmap/voting and production
preservation checks pass. The existing achievement/combat/Territory evidence suite
also passes 76 checks, including the source-time tests. With eleven shared checks,
these runs cover 123 distinct passing tests. Source-time cases cover UTC/offset and
calendar validation, incompatible bases, bounded clock skew, delayed reconciliation,
immutable legacy retries, failed-receipt rollback and unchanged existing level rewards.

The initial source-clock prerequisite had no new player UI. The homepage retains its
original descriptions and updated planning/voting state. The prepared season-source
workflow and expanded achievement workflow include these checks. Hosted execution,
real producer review and staging remain unverified. `git diff --check` passes.

## Prepared immutable season rules and separate evidence

`automation-platform/src/services/seasonTrackStore.js` adds a separate domain
store. Initializing it creates additive tables, a source-cursor index and an XP
insert trigger; no runtime route initializes it. It does not import a wallet, permanent
XP writer, command sender or reward fulfiller. API authorization is deliberately
not inferred from the module's Steam-ID validation. The website routes now bind
the current database user's integer ID and Steam identity before forwarding it.

A new reviewed definition contains `id`, `title`, `startsAt`, `endsAt`,
`settlesAt`, `retainUntil`, `free: true`, `sources` and ascending `tiers` (`xp`, `title`). Unknown
fields, prices, reward declarations, duplicate/unsupported sources and ambiguous
timestamps are rejected. Tier labels are milestones without entitlements. There
are at most 100 tiers and up to 366 days per season, with a separately explicit
zero-to-30-day delayed-receipt window. These are storage bounds, not chosen dates.

Canonical rules have a SHA-256 digest. Staging requires that exact digest and a
reviewer. Reusing an ID with different rules is prohibited. Publication is a
separate revision/digest-bound operation before the season starts. Published
play windows cannot overlap. Closing requires the settlement cutoff and cannot
reopen the season. Every state transition and its audit commit atomically. Missing
or contradictory current audit/definition data makes normal reads unavailable.

The supported source policies must be selected explicitly in the reviewed artifact:

| Source | Required policy | Meaning |
| --- | --- | --- |
| `playtime` | `interval-end` | Attribute the entire existing XP interval to its accepted observation clock; do not prorate minutes across boundaries |
| `quest` | `achievement-time` | Original authoritative quest achievement clock |
| `event` | `confirmation-time` | Existing paid-attendance confirmation clock, without claiming actual verified attendance time |

Only enrolled players collect points, with no charge or purchase field. Enrollment
opens during `[startsAt, endsAt)` and retries preserve its original time. Consent
also binds the current source-ledger position, excluding receipts already present
even if their source clock is slightly ahead or consent is repeated in the same
millisecond. Eligible
source clocks are at or after enrollment and season start, and strictly before
season end. Unknown legacy clocks, mismatched source/reference/basis, invalid
amounts and unsupported sources never count. Optional quest/event-count and life
achievement points are supported through a separate explicitly reviewed policy below.
Original XP amounts become seasonal points; no extra permanent award is requested.

The ledger receipt's strict UTC `created_at` must precede `settlesAt`, even when
the source activity is earlier. Reconciliation may run after closure for an offline
player: timely receipts can still count, while newly arriving late receipts cannot.
Source clocks beyond the collector's two-minute receipt skew are rejected. An
accepted slightly future clock does not count in the current progress projection
until that clock is reached. Season start and source eligibility never use the
ledger write time as a substitute for the original source clock.

Once the store is explicitly initialized, the trigger retains a monotonically
increasing source position and the existing permanent grant's ID/Steam binding
for each new XP insertion. It copies no amount, new activity or location. No old
grants are backfilled; enrollment occurs after initialization. AUTOINCREMENT
prevents deletion and SQLite rowid reuse from making a later new grant disappear
behind a player's cursor. This insertion is part of the original grant transaction;
a failed position write rolls back that grant, like the source-clock receipt.
This additional audit dependency must be verified on authenticated staging before
an operator initializes a real season store. Position records follow the permanent
ledger's retention policy, not optional seasonal enrollment erasure.

Reconciliation scans at most 1,000 source rows per transaction, retaining a private
cursor and exact ledger/source evidence. Failed evidence writes roll back the
cursor too. Replays do not duplicate points. `more`/`pending` explicitly identify
unfinished scanning. Progress reads perform no writes and rejoin original ledger
and timing evidence: removed or altered sources stop counting and set
`evidenceUnavailable`. Valid restored originals can count again; there is no
automatic repair or new permanent grant. Review and correction UI remains needed.

Erasing participation deletes its enrollment and copied seasonal evidence
atomically, even when catalog evidence is damaged. It leaves permanent XP and
wallets intact. Re-enrollment starts a new eligibility clock and never backfills
activity before that consent. Retention and account-bound recovery endpoints
remain runtime work; no player identity is exposed by a public route here.

## Host-operator review tool

`scripts/review-season-track.cjs` provides these explicit commands:

- `review --file <artifact.json>`: validates and prints canonical rules/digest;
  opens no database.
- `inspect --database <existing-file> --id <season-id>`: read-only saved rules,
  revision and bounded audit inspection; does not initialize missing schema.
- `stage --database <existing-file> --file <artifact.json> --reviewer <Steam-ID>
  --digest <reviewed-digest>`: defaults to a read-only plan.
- `publish` or `close --database <existing-file> --id <season-id>
  --reviewer <Steam-ID> --digest <reviewed-digest> --revision <current-revision>`:
  defaults to a read-only validated transition plan.

Only an explicit `--write` on a mutation command writes to the named database.
The tool neither loads `.env` nor guesses a database or creates a new database
file. It requires existing progression, wallet and source-time tables. The
reviewer is the trusted host operator's audit identity, not a remote authentication
mechanism. Catalog publication changes only that database's season state; it
does not deploy code, switch runtime flags, enroll players or issue rewards.

No operator command has been run against a real database. Automated CLI fixtures
use disposable synthetic databases and verify unchanged bytes for dry runs.

## Prior core verification

79 combined checks pass across season rules/evidence/operator commands, original
source clocks, existing permanent XP and 100-coin level rewards, paid fixed quests,
telemetry, retired voting, title reads, homepage/navigation and production guards.
They cover exact reviews, immutable IDs, atomic audit rollback, overlap/lifecycle
rules, enrollment and source boundaries, delayed and after-closure reconciliation,
future skew, bounded retries, deleted/changed evidence, privacy erasure and dry-run
database preservation. This core suite was run before the player UI was added;
current UI/API verification is described below. Hosted checks and authenticated
staging remain unverified.

## Private player API and Quests screen — 6 November 2026

The website mounts `/api/season-track`; the automation service mounts its
token-protected counterpart at `/api/website/season-track`. The website exposes
capabilities, a paged published/closed season catalog, own-account status,
reviewed participation changes and one bounded progress update per explicit
request. Staged plans are excluded from the catalog and guessed staged IDs return
not found. Neither GETs nor catalog/status reads reconcile XP or install schema.

Current website account ID and Steam binding are rechecked in the users database.
Request-supplied account identities are ignored. Mutation requests require the
same website origin, JSON and a non-cross-site fetch; deployment preview/read-only
guards apply independently. The automation side requires the integration token,
validates the Steam identity and repeats rollout/read-only checks. No admin token
or operator catalog mutation is exposed through this player boundary. Errors and
private responses use no-store caching, and unexpected service errors are sanitized.

Player enrollment/deletion binds the exact season digest, current consent revision
and request identity. The choice and its receipt commit with enrollment/deletion.
Failed receipts roll everything back. An exact retry reports both its saved result
and the actual current choice: replaying an old join after deletion cannot rejoin.
Conflicting keys and stale revisions fail. Minimal choice revisions and request
receipts survive deletion; copied seasonal progress and enrollment do not. Join
rate/history bounds still allow an enrolled player's deletion. A progress update
checks the consent revision and season digest within its transaction.

The Quests page shows optional seasons, Brisbane dates and delayed-record cutoff,
participation, saved XP, milestone thresholds and pending/unavailable evidence.
Joining/deletion needs an explicit review and confirmation. New activity is checked
with a separate bounded button; refreshes never silently POST. Lost participation
replies retain the exact request for explicit retry, including malformed successful
replies. Account/session changes clear private state and stale responses cannot
populate a replacement account. Catalog pages are bounded, safe text is rendered
without HTML, and reviews are kept in memory only. Existing quests and dynamic
challenges retain their original controllers and ordering.

Both services default off. Before any rollout, explicitly prepare the automation
database using the reviewed operator workflow. A runtime flag cannot create the
schema/trigger: missing initialized tables or source trigger returns unavailable.
The automation runtime uses the existing economy database with `initialize:false`.

| Setting on website and automation service | Meaning |
| --- | --- |
| `SEASON_TRACK_ENABLED=1` | Allow private season enrollment and explicit progress updates after operator setup |
| `SEASON_TRACK_MANAGEMENT_ENABLED=1` | Keep catalog/status and existing participant deletion available while tracking is paused |
| `SEASON_TRACK_READ_ONLY=1` | Block mutations, including deletion, for a read-only deployment |
| `SEASON_TRACK_MAINTENANCE_ENABLED=1` on automation only | Run bounded retention cleanup independently of player reads and collection flags |

Keep the management setting enabled when pausing tracking so players can recover
and delete participation. Website preview restrictions apply in addition to these
settings. No flags, real database, dates, thresholds, rewards or external messages
have been configured by this local implementation.

Final affected suite: **79 passing checks** across store/runtime/operator APIs,
current-account and token guards, consent rollback/replay, source clocks, existing
permanent progression and paid quests, challenge APIs, voting/navigation and
production page-script preservation. `verify-season-track.cjs` passes on the actual
Quests page at 1440px and 390px with both real HTTP layers and synthetic accounts:
join review, lost reply and exact retry, explicit XP update, tier rendering,
preview, paused deletion/blocked join, stale revision, delayed read/account switch,
session loss, safe text and no horizontal overflow. The existing dynamic-challenge
browser fixture also passes at both widths. Desktop/mobile screenshots were
inspected. The dedicated workflow includes these checks but is still unpublished.

Remaining season work includes further achievement evidence families, real source timing/payload
review, operational retention review and recovery, approved reward policy,
hosted checks and authenticated staging. Roadmap #4 remains Building / Testing;
the full season and 31-feature roadmap are not complete.

## Reviewed retention and independent cleanup — 6 November 2026

New season artifacts must explicitly choose `retainUntil`, strictly after
`settlesAt` and within 366 days of it. This is a storage bound, not a chosen live
retention policy. The date participates in the canonical digest and is immutable
with the season's other rules. Operator review/staging rejects a missing or invalid
date. Older saved definitions retain their original canonical form/digest and
remain readable without an invented expiry; publishing an older staged definition
requires preparing a new definition/identity with reviewed retention instead.

An additive retention index binds the season identity, digest and expiry date.
Every normal read verifies it against the reviewed definition and audit. At the
exact expiry, status/progress reads return no personal enrollment time, XP, tier
achievement or consent revision, even before maintenance runs. The screen explains
that personal records expired and disables progress updates/enrollment. An old
saved join request returns expired rather than recreating participation or a new
receipt. An explicit own-account deletion can erase expired enrollment, progress,
choice revisions and saved requests without leaving a new receipt behind.

Cleanup verifies each due definition/index/audit before deleting anything. A pass
examines at most 25 due seasons and deletes at most 500 personal rows (store bound
1–1,000), across copied XP evidence, enrollments, saved requests and choice state.
Partial work continues on later passes; a completed marker prevents empty old
seasons from starving later cleanup. Failed deletions roll back the entire pass.
Unverifiable retention evidence is reported as unavailable and never supplies an
unreviewed expiry. Season definitions and review/audit history remain, preserving
immutable identities and preventing reopening/reuse after request receipts expire.

Remaining capacity in a pass scans a bounded page of permanent source positions
and removes only positions whose original XP record no longer exists. A durable
cursor cycles through the source index without rescanning its full contents each
minute. Live source positions, permanent XP, source-clock receipts, wallet balances
and existing paid rewards are untouched. Positions for live permanent records
continue to follow that original ledger's retention policy.

The automation runtime starts one unreferenced, one-minute maintenance timer only
when `SEASON_TRACK_MAINTENANCE_ENABLED=1`. It makes an immediate bounded attempt,
then repeats independently of website access, telemetry and the tracking/management
flags. It never initializes missing season schema. The read-only setting skips all
cleanup; failures are reported and retried on the existing timer. Keep maintenance
enabled on a writable authoritative instance when pausing player collection.
No maintenance flag or real expiry policy has been enabled by this work.

The Quests screen shows the reviewed expiry in Brisbane time before enrollment
and explains the expiry state afterward. Its asset version is 2; the homepage
planning asset is 121. Explicit deletion still removes participation/copies before
expiry while retaining minimal anti-replay records until the reviewed retention
date. The synthetic 90-day periods used by tests are not a live policy choice.

Current combined verification: **85 passing checks**, including exact expiry,
immediate read-only projection hiding, bounded multi-pass deletion, failed-delete
rollback, old-request replay, tampered retention indexes, legacy digest preservation,
orphan source-page traversal and maintenance with collection/website access disabled.
The real Quests-page browser fixture passes at 1440px and 390px for disclosure and
the exact expiry transition as well as the earlier consent/recovery cases. All
accounts, dates and databases are synthetic. Hosted and real authenticated staging
remain unverified; rollout and the full roadmap remain unfinished.

## Achievement source timing prerequisite — 6 November 2026

`achievementSourceTime.js` now retains timing for newly unlocked `quest-1`,
`quest-25`, `quest-100`, `event-1`, `event-10` and `event-25` achievements. It does
not add permanent XP, seasonal points, coins or a new reward rule. The season
catalog rejected achievement points at that prerequisite commit; the reviewed
season integration is documented below. Other achievement families
still require suitable original source evidence and timing contracts.

Permanent achievement `unlocked_at` is a reconciliation date and is never used
as the source achievement date. Quest-count awards use the original authoritative
clock of the qualifying threshold completion; paid-event-count awards use the
qualifying staff confirmation clock. Paid confirmation is not automatically
verified actual attendance time. Only the matching player's source records count;
RSVPs, registrations and unpaid event rows do not.

All source clocks in the inspected counter history must be known and unambiguous:
an unknown completion might precede the apparent threshold. At most 10,000 rows
are inspected; larger/uncertain histories retain no new timing rather than
guessing. Threshold rows are ordered by UTC source clock and stable source identity,
with explicit tie handling. Future clocks use the existing two-minute collection
tolerance but are withheld from reads until reached.

The additive permanent `progression_achievement_sources` receipt retains the
existing player/achievement binding, qualifying source clock, explicit basis,
receiving clock and hashes binding the award and qualifying source evidence.
It does not copy event titles, source IDs, quest periods, route/location records
or a full activity history. No player API exposes it yet. Its lifetime follows
the original permanent achievement; deleting that award removes its receipt in
the same database operation even when foreign-key enforcement is disabled.
Withdrawing an award preserves its audit history and withholds timing instead.

Only a newly inserted achievement invokes the collector. Existing awards are not
backfilled or upgraded by duplicate reconciliation, and an existing receipt's
source time never changes. New achievement inserts and their receipts share a
savepoint, so receipt failure rolls back that unlock set. Existing permanent XP
and level rewards use their already-separate transaction: a later achievement
audit failure does not reverse previously committed XP/coins. Retrying the same
XP request remains idempotent and never repays a level reward; later achievement
reconciliation can finish its own audit without manufacturing more XP.

The read helper performs no writes. It recomputes source evidence and compares
hashes, original award, source clock and basis. Changed/deleted source records,
new earlier imports that change the threshold, malformed award metadata, pending
reviews, withdrawals and future/incompatible receipt clocks make timing
unavailable. It never repairs or rewrites the first receipt. Operational correction
and real producer review remain rollout gates.

**107 distinct affected checks pass** across the new collector and existing
season, quest, permanent progression, achievement/review, combat/species, life,
Prime and Territory achievement paths. Cases include delayed reconciliation,
identity separation, unknown clocks, source mutation, legacy retries, atomic
receipt failure, deletion lifecycle and unchanged existing level payments. The
achievement and season hosted workflows include the new tests but remain local.
This addition has no new player UI; the homepage planning note is asset v122.
Nothing has been pushed, deployed or enabled, and no real data was inspected or
altered. Roadmap #4 and the full roadmap remain unfinished.

## Reviewed seasonal achievement points — 6 November 2026

Season definitions can now optionally include this exact shape:

```json
{
  "achievementPoints": {
    "policy": "qualifying-source-time",
    "awards": [{ "id": "quest-1", "xp": 25 }]
  }
}
```

This fragment is illustrative synthetic policy, not a configured live amount.
No default point amounts are installed. An operator must review the complete
season artifact and its new digest, then separately stage/publish it. Each of the
supported achievement IDs may appear once (currently twenty), with an integer
award from 1 to 1,000,000 seasonal XP. Unknown policies/IDs, duplicates, prices,
currency fields and malformed values are rejected. Awards are canonically ordered.
Definitions without the optional field retain their exact prior digest and behavior.
Achievement-only plans may explicitly leave the regular `sources` array empty.

The source collector and permanent achievement schema must exist before staging
these rules, including in an operator dry run. Visiting the page or setting runtime
flags never installs them. Source timing contracts cover quest-count,
paid-event-count and the two life awards described below; other families remain
unsupported until their qualifying evidence can be verified. A paid event confirmation is not a claim of
automatically verified actual attendance or an event victory.

Enrollment atomically records an achievement source-position floor alongside the
existing permanent-XP consent position. Already present receipts cannot count,
including same-millisecond rejoin or small future source-clock skew. Retries retain
the original floor; missing consent evidence is unavailable rather than silently
repaired. Eligible achievements require an intact currently supported timing
receipt after that floor, an original qualifying source clock at/after joining and
season start but before season end, and a receiving clock after enrollment and
strictly before settlement. Legacy unknown timing, late receipts and future clocks
cannot bypass these rules. An offline player may reconcile timely receipts after
season closure but before the reviewed retention expiry.

One explicit progress update checks at most twenty configured achievement awards in
addition to the existing bounded XP batch. A separate seasonal evidence table
copies only the configured point amount, achievement identity, source position,
timing/basis and binding hashes. Its season/player/achievement key prevents duplicate
points. Copied achievement points and the permanent-XP batch/cursor share the same
transaction; failed copies roll everything back. The update never calls permanent
`awardXp`, unlocks an achievement, touches a wallet or fulfils a reward.

Every progress read revalidates the original achievement and its qualifying source
records/review state through the read-only timing helper. A missing/withdrawn/pending
achievement, changed threshold evidence, source mutation or mismatched saved binding
stops contributing immediately and is labelled unavailable. Restoring the exact
valid original evidence can restore its existing seasonal contribution without a
new grant. Eligibility and configured amounts are never taken from a player request.
Totals include a separate `achievementXp` breakdown, and eligible uncopied receipts
make progress pending without causing a GET to write anything.

Participation deletion removes both copied achievement points and their consent
floor. Rejoining starts fresh and cannot reclaim an earlier receipt. Reviewed expiry
hides personal progress before cleanup; bounded retention cleanup removes the new
tables together with the older season copies. Permanent achievements and their
source receipts follow their original permanent retention policy and are preserved
by seasonal erasure. Preview/read-only, same-origin, current-account and token
boundaries continue to apply without new mutation endpoints.

The Quests screen displays each configured achievement and amount before enrollment,
explains qualifying completion/confirmation dates and shows the achievement portion
of total season XP. Its review binds the immutable season digest already used by
participation requests. Player asset v6 and homepage planning asset v126 are local.
No actual season, point policy, reward, flag, database or producer has been enabled.

**113 affected checks pass** across reviewed rules, operator readiness/dry runs,
source timing, consent boundaries, immutable copies, withdrawal/revalidation,
receipt/XP cursor rollback, after-closure settlement, deletion/rejoin, retention and
the existing season/progression/quest/achievement paths. The real two-layer Quests
browser fixture passes at 1440px and 390px, including consent amounts, 10 existing
XP plus 25 synthetic achievement XP, source invalidation/restoration, safe rendering,
lost-reply retry, account changes, pause/preview and expiry. Screenshots were inspected.

Remaining full scope includes other achievement families, real producer/source
review, chosen live point/season rules, approved cosmetic/reward fulfillment,
operational recovery/retention review, hosted checks and authenticated staging.
This is not production completion of #4 or the full 31-feature roadmap.

## Life achievement timing and seasonal points — 6 November 2026

The optional reviewed achievement-point policy now also accepts `nested-adult`
and `life-survival-10h`, with no default amount. Existing definitions, digests,
permanent eligibility thresholds and payment rules remain unchanged. The new
`achievementLifeSource.js` supplies read-only, life-specific evidence to the
existing new-award receipt collector and season projection.

For nested adulthood, the source clock is the original recorded adult observation.
The receipt binds the matching player's life identity, species/start, exact
juvenile/adult milestones, one or two valid earlier same-species parent lives,
immutable parent links and a matching verified hatch record. The hatch must name
the same child/parents and retain a nonempty evidence reference; a future verification
cannot authorize an earlier receipt. Missing/changed lineage, source identity or
milestones make timing unavailable. Hatch references and parent identities are
hashed into the receipt, not copied into player responses.

For ten-hour survival, the source clock is the original achievement metadata's
`observedThrough` endpoint. This is a qualifying observed record, not a guessed
first threshold time calculated from life start or reconciliation. At capture,
the record's time/value must exactly match the new award, the recorded duration
must fit within that life and observation window, and the source must meet the
existing 36,000-second threshold. Later legitimate record growth may continue
supporting the captured earlier observation without changing its receipt/time.
A reduced/incompatible record, changed life binding or an ending before that
observation cannot preserve its seasonal contribution. Account-wide playtime is
never used as lifetime evidence.

Both life contracts directly check Legacy and combat death evidence for that
player inside the original qualifying interval, inclusive at its endpoints. The
check does not wait for a profile read, review creation or periodic importer. Late
death evidence can therefore stop copied season points immediately, while a later
death outside the qualifying interval leaves that earlier observation intact.
Unknown/ambiguous death clocks or over-limit histories withhold timing rather than
guessing continuity. Each death source is bounded to 10,001 inspected rows, using
the existing player/time indexes in initialized production stores. Real source
volumes and query performance still require authenticated staging review.

Pending/withdrawn permanent awards independently withhold source timing. Upholding
a badge does not itself override a still-contradictory underlying life/death record;
the source evidence must again support the captured observation. These reads never
repair a life, delete/rewrite a badge, create an admin review, add permanent XP or
send a payment/game command. Existing unknown historical awards remain unbackfilled.

The existing consent position, settlement cutoff, duplicate-copy, source revalidation,
erasure/rejoin and reviewed-expiry rules apply to these two added point types. The
Quests review gives them meaningful labels and uses the same immutable digest as
the configured amounts. Remaining families—skins and Prime
achievements—still need trustworthy qualifying-clock contracts
before they can be selected for seasonal points. Real producer review, approved
reward fulfillment, live season/point rules, hosted checks and staging remain gates.

Current verification: **117 affected checks pass**. New cases exercise original
observation dates, later legitimate life growth, source/lineage corruption, early
life endings, unknown clocks, direct late combat/Legacy deaths and no read-time
writes. Existing real Legacy/progression tests verify that newly unlocked life
badges actually receive these receipts while permanent eligibility stays intact.
The actual desktop/mobile Quests fixture passes at 1440px and 390px with reviewed
life amounts, combined XP totals, late-death exclusion/restoration, consent/retry,
pause/preview, account changes and expiry. The phone screenshot was inspected.
All data and point amounts are synthetic; nothing was pushed, deployed or enabled.

## Combat diversity and Territory capture achievement points — 6 November 2026

The optional reviewed policy now accepts `combat-species-5` and `territory-victory`,
bringing the supported set to ten achievements. No default/live point amount is
chosen. `achievementBattleSource.js` supplies source evidence to the same new-award
collector, immutable receipt and private season-progress checks already described.
There are no new mutation endpoints, game actions, coin payments or permanent XP.

Combat diversity uses the earliest recorded event for each recognized event-time
victim species, ordered by source UTC clock and stable event identity. The fifth
distinct species supplies the qualifying source date. Current dinosaur state,
repeated species, unknown historical labels, self-kills, environmental deaths and
another player's kills cannot establish that threshold. The helper reuses the
combat intake's canonical species registry. Qualifying records need their original
victim identity, event identity, source label and unambiguous clock; it does not
infer a missing old event date/species from later records or reconciliation.

The receipt hashes the five qualifying events, binding original clock/species,
victim identity and feed source without copying names, locations, growth or raw
combat records into a seasonal response. Later nonqualifying/later species events
do not move the original fifth-species date. Removing/changing a qualifying event
or importing an earlier event that changes the threshold makes that receipt
unavailable; it is not silently redated. Unknown clocks among recognized eligible
events also withhold timing. Historical event inspection is bounded to 10,001 rows
through the existing killer/time index; real feed provenance/volumes still need
authenticated producer/staging review. A source label alone is not new proof of
actual game execution beyond the existing protected combat intake.

Territory timing uses the original earliest capture resolution date for that
frozen winning Steam identity. The helper requires a version-1, `recorded-live`,
`capture` result whose attack/event IDs, start/resolution clocks and receiving
clock agree with the saved result row. The payload must contain the same unique
1–256 valid Steam identities as the complete saved winner roster. Orphan winner
rows, malformed/unknown clocks, manual/simulated provenance, contradictory payloads,
missing membership or reused event identities cannot provide an invented date.

Current membership, ownership, alliances, later player deaths and group names are
not part of the frozen capture proof. In particular, this contract establishes
capture participation and never claims battle survival or satisfies the separate
unfinished survival challenge. There is no change to existing Territory capture
awards or permanent badge eligibility. Source records are bounded to 10,001 joined
winner results, with the selected first roster bounded to 257 rows. An additive
non-unique event-ID index supports a bounded duplicate-identity lookup; existing
intake and conflict behavior remain unchanged. Website Territory event identities
already use AUTOINCREMENT and are not inferred from current group state.

Both contracts retain the common enrollment/source-position floor, original-date
window, receipt settlement cutoff, duplicate-copy protection, read-time validation,
withdrawal/erasure and reviewed retention rules. The Quests review displays meaningful
combat/capture labels and the exact configured seasonal amount. Permanent badge
and source rows remain intact when seasonal copies are deleted or unsupported.
Remaining clocks include skins and Prime; chosen live rules,
approved reward fulfillment, real producers, operational recovery, hosted checks
and authenticated staging still need completion.

**121 affected checks pass** across the new battle-source contracts and existing
season/achievement/quest/payment paths. Actual protected combat ingestion and
Territory result tests verify newly unlocked permanent badges receive the original
event-time receipt without new XP/coins. New cases cover distinct-species ordering,
unknown/self/unrelated events, source deletion/replacement and late earlier imports,
frozen rosters, contradictory provenance/times and duplicate event identities.
The desktop/mobile Quests fixture passes at 1440px and 390px with capture labels,
combined synthetic points, source invalidation/restoration, late-death behavior,
consent/retry, paused deletion, account changes and expiry. The phone screenshot
was inspected. Player asset v5 and homepage v125 remain local. No real policy,
database, flag, deployment, message or game command has been changed.

## Level and playtime milestone source clocks — 6 November 2026

The reviewed policy now also accepts `first-level`, `level-10`, `level-25`,
`level-50`, `level-100`, `playtime-1h`, `playtime-25h`, `playtime-100h`,
`playtime-250h` and `playtime-500h`. No point amounts or live policy are installed.
Existing immutable definitions/digests and permanent eligibility remain unchanged.
The original XP formulas, 999 level limit, ten XP per five-minute interval and
100-coin level payment are now shared through pure `progressionRules.js`; their
values and external progression exports are preserved.

A level source uses the **original activity clock of the grant that crossed its
official XP threshold in credit order**. It is not a guessed level date computed
by sorting delayed activity dates, the ledger write date or the badge unlock date.
A delayed quest may cause a level increase now while retaining its earlier quest
activity date; seasonal eligibility uses that original activity and the normal
receiving cutoff. The player review explicitly explains this choice.

New qualifying level transitions atomically capture old/new XP and levels, the
triggering ledger identity, a stable source position, a prefix hash and fixed
`permanent-xp-v1` rules. One transition can support several crossed milestones.
The full positive credited-XP prefix must agree with the new total; unexplained
legacy counter balances or over-limit histories produce no dated transition.
Only transitions crossing one of the five supported level milestones are retained.
They commit with the original XP grant, source clock, counter update and existing
level payment; an audit failure rolls back that transaction rather than paying twice.

An additive AUTOINCREMENT XP-identity index gives each grant a durable position.
Its one-time initialization registers existing ledger identities only—never old
activity clocks, transitions or achievement receipts. Older records' positions
mean they predate the new audit, not that their original temporal ordering is
known. New transition hashes bind the complete existing credited prefix, independently
of implicit SQLite rowids; VACUUM and later grants do not redate the old proof.
Missing/changed prefix grants, changed source binding, contradictory counters,
ambiguous repeated crossings or unsupported rules make timing unavailable. Deleting
a triggering grant removes its transition; the opaque order tombstone retains no
player name, Steam identity, amount or activity date of its own.

Level source inspection is bounded to 50,001 candidate prefix rows and requires
the actual triggering grant's matching playtime/quest/event source receipt. Unknown
or manual grant timing cannot substitute a receiving/unlock date. The permanent
achievement collector still runs only for newly inserted awards, so existing
undated level badges never acquire a new date on retry. These additions audit new
existing XP grants once this code is deployed, even with seasonal rollout off;
the schema/transaction dependency must be included in authenticated staging review.

Playtime milestones use their exact numbered five-minute interval: 12 intervals
for one hour through 6,000 for 500 hours. The helper checks a complete, unique
ordinal prefix, original ten-XP amounts, matching five-minute/sequence metadata
and a consistent permanent interval counter. Known clocks must not run backward.
The threshold interval itself needs the original `playtime-observation` clock.
Earlier untimed intervals do not supply invented dates: their explicit ordinals
can establish which interval crossed the threshold, but an untimed threshold
interval still cannot date an award. Gaps, duplicate/altered sequence evidence,
unknown threshold clocks and incompatible receipts withhold timing.

Playtime evidence is bounded to the threshold prefix plus one overflow candidate
(at most 6,001 rows), supported by an additive player/interval expression index.
Later intervals do not move the first qualifying date. Read-only inspection never
tracks new time or calls the XP writer. The existing observation/continuity collector
remains responsible for actual game evidence, and real producer cadence still
requires staging verification.

Operator dry runs/staging/publication require the level/playtime source schema
before these policies can be selected. Runtime private reads remain noninitializing.
Seasonal amounts, consent floors, original-date windows, settlement, copies,
withdrawal/revalidation, deletion/rejoin and expiry remain governed by the same
immutable season rules. The Quests screen labels every supported milestone and
explains the source-date/observed-interval policy before enrollment. Asset v6 and
homepage v126 remain local.

**130 affected checks pass**. The actual XP/playtime pipeline is exercised through
new level and one-hour receipts, separate season points and unchanged balances;
other cases cover multi-level skips, one-time 100-coin-per-level rewards, atomic
audit failure, legacy initialization, missing/changed prefixes, VACUUM, unknown
clocks, 6,000-interval boundaries and operator readiness/dry-run preservation.
The real desktop/mobile season fixture passes at 1440px and 390px for the new
review labels/timing disclosures and existing privacy/recovery behavior. It does
not claim a real live milestone or policy. The phone screenshot was inspected.

Prime/skin qualifying clocks, approved reward fulfillment, real season/point
choices, operational review/recovery, hosted checks and authenticated staging remain
unfinished. No branch was pushed, no deployment or flag was changed, and no real
player data or funds were accessed. The full roadmap remains active and incomplete.


## First recorded Prime observation points — 6 November 2026

The optional reviewed point catalog now supports 21 achievement contracts, including
`prime-observed`. No point amounts or live policy are installed. Skin ownership
source clocks remain unfinished. The season script is v7 and homepage roadmap v127;
#4 remains Building/Testing with its original feature number and description.

An additive Prime observation audit binds a life's identity, owner, normalized
species, start, first positive source clock, receiving clock and observation kind.
It records either a first-seen-already-Prime dinosaur or an observed transition.
This is observation evidence; it does not establish when or how Prime was attained.
The Quests policy and enrollment review explicitly disclose that distinction.
The first positive receipt commits atomically with the tracker snapshot and zones;
a receipt write failure rolls back that player snapshot, allowing a safe retry.
No location or player name is copied into this audit.

Old Prime lives and badges are never backfilled. Every positive historical life
must have compatible evidence before its first observation can date a new award;
an undated older life cannot be silently replaced by a later dated one. Reads are
bounded to 10,001 candidate lives, preserve the earliest observation across later
lives and re-observations, and withhold copied points after source mutation or
removal. Existing badges remain permanent. Operator review requires the prepared
audit schema; private reads do not initialize it.

Prime tracking now rejects missing, malformed and future source clocks rather
than substituting the current time. External presence intake uses the same strict
source parser. Fresh RCON observations preserve rich character facts and use their
check clock for Prime, Legacy and playtime progression. Cached, stale and already
ingested external snapshots cannot be polled again as fresh progression evidence.
The minimal presence analytics DTO remains unchanged. Existing XP formulas, level
thresholds, paid quests and 100-coin level rewards are unchanged.

**138 affected checks pass**, including the real tracker-to-achievement-to-season
pipeline, first-seen and transition evidence, legacy exclusions, rollback/retry,
changed/deleted sources, operator readiness, external-feed deduplication and fresh
versus cached presence clocks. Desktop/mobile season fixtures pass at 1440px and
390px; the phone screenshot was inspected for the new disclosure. CI workflows
include the new source and presence checks. Hosted checks and authenticated staging
have not run for this local branch. Real producer cadence, season/point choices,
reward fulfillment and operational recovery still require review. No branch was
pushed, no merge/deployment occurred, and no rollout or real player data changed.


## Recorded collector ownership crossings — 6 November 2026

Optional reviewed seasonal points now support all 22 existing achievement IDs,
including `skins-10`. This adds a timing contract, not new permanent eligibility,
point amounts, live seasons or reward payouts. The source basis is explicitly
`recorded-skin-ownership-crossing`: the recorded change that first brings the
active personal collection from nine to ten after audit initialization. It does
not infer original acquisition dates from today's inventory or badge unlock time.
The Quests policy and confirmation explain creation, purchases and personal grants,
exclude shared catalog access, and disclose that older collections have no new date.
Season asset v8 and homepage roadmap v128 remain local; #4 remains Building/Testing.

Economy initialization atomically records existing distinct ownership counts only.
An account already at ten receives an undated qualified baseline, so dropping below
ten and later returning cannot create a new clock. Existing badges never receive
timing on retry. Database hooks cover preset ownership/activation, purchase unlocks
and personal grants (including revocation, renewal and gifts). Each skin counts
once across entitlement paths; inactive skins and revoked grants do not count.
Cosmetic edits and catalog access never create a milestone. Candidate IDs use
existing owner/account indexes instead of scanning the full shared catalog.

A new crossing records its stable source position, account, database clock, nine-to-ten
counts and ten sorted skin identities with boolean ownership paths. It copies no
palette, skin name, description, price, grant note or third-party owner identity.
The first receipt remains historical after later legitimate gifting, deletion,
revocation or reactivation. It is not a requirement to keep owning ten forever,
matching the existing permanent badge. Evidence edits or deletion withhold copied
season points through the existing receipt hash and review checks. Current count
inconsistency, unsupported source shape and missing/replaced hooks also withhold
source timing. Reads return one bounded ten-skin snapshot and perform no repair.

The audit commits inside the actual ownership transaction. A failure rolls back the
skin change and any enclosing purchase charge; retries preserve the first result.
Grant renewal uses conflict-safe trigger predicates compatible with the existing
upsert. A slight SQLite/JavaScript clock difference can be captured within the
shared two-minute skew limit, but the standard reader does not expose seasonal
points before the recorded source time arrives. Source/consent floors and season
windows remain unchanged.

The hooks and version marker are required before operator staging can select this
policy. Dry runs inspect without changing database bytes. Startup rejects missing
or changed hooks in an already initialized audit rather than silently repairing a
collection gap; recovery needs explicit evidence review. This schema/transaction
coupling audits economy ownership changes even while the seasonal rollout is off,
and must be included in authenticated staging and backup review. No production
schema or flags were changed in this session.

**188 affected checks pass**, including actual paid purchases, unchanged permanent
XP, no extra coins, debit rollback/retry, personal grants and renewal, legacy
initialization, activation/transfer, distinct paths, immutable first clocks,
malformed/deleted evidence, operator byte preservation, and existing concurrent
gifting/promotion workflows. Desktop/mobile season fixtures pass at 1440px and
390px with skin policy confirmation, separate points and evidence withdrawal;
the phone rendering was inspected. CI paths and commands include these checks.
Hosted CI, real policy choices, reward fulfillment, producer review, operational
recovery and authenticated staging remain unfinished. No push, merge, deployment,
real player mutation or payout was performed; the full roadmap remains active.


## Optional automatic saved-progress collection — 6 November 2026

A default-off background collector now reconciles existing season enrollments
without requiring a player's page visit or update request. It copies supported
existing XP/achievement evidence only. It never calls the permanent XP writer,
creates an enrollment, grants a reward or issues a game command. The player update
button remains available for bounded catch-up; ordinary GET projections remain
read-only and continue revalidating original evidence.

The automation runtime requires both `SEASON_TRACK_ENABLED=1` and
`SEASON_TRACK_COLLECTION_ENABLED=1`, and skips every collection write under
`SEASON_TRACK_READ_ONLY=1`. Management access alone cannot run collection. All
flags remain off in the example configuration. Privacy maintenance retains its
independent `SEASON_TRACK_MAINTENANCE_ENABLED` control and does not depend on
tracking, collection or website visits.

Each minute the existing single-instance scheduler attempts cleanup and collection
separately. One task's failure does not prevent the other task from running.
Collection defaults to ten participants and 100 XP source candidates per participant.
The store caps a call at 25 participants, 1,000 candidates per participant and
2,500 total XP candidates. Each selected participant also uses the existing bounded
22-contract achievement inspection. These are work limits, not a promised live
refresh cadence: full-cycle latency depends on queue size, backlog, source validation
cost and deployment throughput, which still need real staging measurements.

An additive queue assigns a durable AUTOINCREMENT identity to each enrollment.
The saved checkpoint contains only an opaque position, never a Steam ID. Keyset
selection wraps fairly across participants rather than repeatedly exhausting one
busy account. A process restart or VACUUM does not reset membership positions.
Independent collectors serialize the batch and checkpoint under the database's
write transaction. The shared reconcile body rechecks the current enrollment,
immutable season review and retention inside that same transaction. Missing or
changed evidence and unreviewed dates never gain a new basis through collection.

Each participant has a savepoint: its source error rolls back its copied progress
and leaves its personal cursor unchanged, while the queue advances to other
participants. A later cycle retries the failed account. A batch/checkpoint failure
rolls back the complete batch. Reports contain aggregate counts and a generic
maintenance/collection category, not account identities or private source errors.
Delayed receipts can be copied after a season closes only when their original
activity and receipt dates satisfy its unchanged windows; expired history is never
collected. Deletion/rejoin uses the existing source floors, so neither the worker
nor a lost reply can restore erased points.

Explicit operator initialization now creates/migrates the queue and hooks in the
same schema transaction. Existing enrollments enter the queue without changing
their consent dates, choice revisions or source floors. Runtime flags and reads do
not initialize or repair this schema. Operator inspection reports `collectionReady`
without writing; missing/replaced queue hooks stop automatic collection. Privacy
deletion directly removes queued identities even if the leave hook is damaged.
Bounded expiry maintenance also counts/removes queue rows and works with older
schemas that have no queue. No production schema or flag was changed here.

**197 affected checks pass**, including fair bounded traversal, durable checkpoint
restarts, independent simultaneous collectors, VACUUM, participant and checkpoint
rollback, delayed/closed-season evidence, expired exclusion, account erasure and
same-clock rejoin, automatic achievement copies, missing-hook readiness, runtime
flags/read-only behavior and cleanup failure isolation. Desktop/mobile HTTP/browser
fixtures pass at 1440px and 390px: the background copy appears on a subsequent
read without a player POST; a later manual update does not duplicate points.
The homepage planning asset is v129 and #4 remains Building/Testing.

No branch was pushed, merged or deployed. Reward policy/fulfillment, actual season
choices, producer verification, operational recovery, hosted CI and authenticated
staging remain required. The full 31-item roadmap remains active and incomplete.
