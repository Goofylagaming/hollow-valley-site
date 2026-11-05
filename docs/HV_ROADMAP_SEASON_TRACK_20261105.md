# Free season track — local rules and progress core

Roadmap #4 remains Building / Testing. This local branch starts from Event Engine
`e9556c42` and does not change the three prepared publication heads. No season,
player season UI, reward catalog or new payout has been enabled. The source-time
collector is the only addition called by the existing progression service. The
new season store and operator tool are not wired into live producers or HTTP routes.

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

- Expose reviewed season identity, schedule, free enrollment/progression and tiers
  through currently authorized private APIs and a player UI. The domain core below
  is prepared, but there is no public enrollment or actual season installed.
- Review actual season dates, thresholds and attribution choices with operators.
  The proposed eight-to-twelve-week duration is not activated. Store contracts
  below constrain explicit choices; they do not establish an approved real season.
- Connect bounded progress reconciliation and privacy/retention maintenance to
  the authorized runtime without manufacturing permanent XP or level coins.
- Achievement XP and trustworthy achievement/event source integration. The existing
  permanent ledger currently grants XP from playtime, quests and paid event records;
  it is not a complete season implementation.
- Approved cosmetic/reward policy and any separately authorized payout behavior.
  No new automatic coin payments, restores or game commands are authorized here.
- Private player reads, progress UI, actual producer payload review, performance,
  hosted checks and authenticated staging before rollout.

Original #4 wording and historical votes remain. The feature leaves the active
ballot during development, freeing its old votes without deleting them. Eight
ideas remain eligible. Homepage planning asset version is 119. No production
completion date is assigned.

## Local verification

58 focused progression, fixed-quest, telemetry, roadmap/voting and production
preservation checks pass. The existing achievement/combat/Territory evidence suite
also passes 76 checks, including the source-time tests. With eleven shared checks,
these runs cover 123 distinct passing tests. Source-time cases cover UTC/offset and
calendar validation, incompatible bases, bounded clock skew, delayed reconciliation,
immutable legacy retries, failed-receipt rollback and unchanged existing level rewards.

There is no new player UI to render in this prerequisite. The homepage retains its
original descriptions and updated planning/voting state. The prepared season-source
workflow and expanded achievement workflow include these checks. Hosted execution,
real producer review and staging remain unverified. `git diff --check` passes.

## Prepared immutable season rules and separate evidence

`automation-platform/src/services/seasonTrackStore.js` adds a separate domain
store. Creating it initializes additive tables, a source-cursor index and an XP
insert trigger; no production caller currently creates it. It does not import a wallet, permanent
XP writer, command sender or reward fulfiller. API authorization is deliberately
not inferred from the module's Steam-ID validation: future routes must bind the
current authenticated account before calling it.

A complete reviewed definition contains `id`, `title`, `startsAt`, `endsAt`,
`settlesAt`, `free: true`, `sources` and ascending `tiers` (`xp`, `title`). Unknown
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

## Current local verification

79 combined checks pass across season rules/evidence/operator commands, original
source clocks, existing permanent XP and 100-coin level rewards, paid fixed quests,
telemetry, retired voting, title reads, homepage/navigation and production guards.
They cover exact reviews, immutable IDs, atomic audit rollback, overlap/lifecycle
rules, enrollment and source boundaries, delayed and after-closure reconciliation,
future skew, bounded retries, deleted/changed evidence, privacy erasure and dry-run
database preservation. No new player UI exists yet; browser verification is required
when that UI is added. Hosted checks and authenticated staging remain unverified.
