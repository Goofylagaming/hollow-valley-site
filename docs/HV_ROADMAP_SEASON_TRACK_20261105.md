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
- Achievement XP and trustworthy achievement/event source integration. The existing
  permanent ledger currently grants XP from playtime, quests and paid event records;
  it is not a complete season implementation.
- Approved cosmetic/reward policy and any separately authorized payout behavior.
  No new automatic coin payments, restores or game commands are authorized here.
- Private player reads, progress UI, actual producer payload review, performance,
  hosted checks and authenticated staging before rollout.

Original #4 wording and historical votes remain. The feature leaves the active
ballot during development, freeing its old votes without deleting them. Eight
ideas remain eligible. Homepage planning asset version is 122. No production
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
amounts and unsupported sources never count. Achievement XP is still unsupported.
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

Remaining season work includes achievement XP evidence, real source timing/payload
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
catalog still rejects an achievement source; reviewed seasonal point definitions
and consumption remain the next integration step. Other achievement families
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
