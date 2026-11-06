# Territory Seasons — roadmap #19

The original scope remains periodic Territory control resets with historical
champions, total territory time, attacks won and defensive streaks. The local
source-evidence and definition-planning foundations do not deliver live seasons.

Current Territory control is stored on territory_events, whose territory key,
label, schedule and owner display name can be edited. Battle provenance stores
event ID and times; it does not freeze the event's territory metadata. Joining an
old battle to today's event row would silently reattribute its territory after an
edit. Current owner names also cannot establish historical group identity or
prove total holding time. Existing website group identities remain frozen by the
separate declaration producer.

The new territoryBattleContext service snapshots the existing territory key and
label inside the battle declaration savepoint. A separate explicit
TERRITORY_SEASON_EVIDENCE_ENABLED=1 is required; its example value is 0 and no live
configuration was changed. Disabled declarations create no context table or row.
Enabled declarations with missing/invalid event metadata record an explicit
unknown rather than derive a territory from a name. A declaration retry never
backfills an old context, including after the flag is enabled or metadata is
repaired. Existing snapshots survive later event changes/deletion and reads work
with query-only connections. Snapshot digest and parent declaration identity are
checked before use. This detects inconsistent stored data, not malicious edits
by someone with database access.

All 77 affected local tests pass, including four dedicated context tests,
declaration/group identity and rollback checks, existing prestige/control/victory
regressions, voting and production-page checks. The actual Territory HTTP
declaration/runtime fixture enables the option only in its temporary database and
checks the frozen event/key/label for both ordinary and manually disqualified
results. Existing source-clock, roster and manual-award exclusions still pass.
At that source-only checkpoint there was no browser flow or season endpoint;
the later planning interface is described below. These remain synthetic local
checks, not authenticated game staging or production observations.

The context table and row share declaration atomicity, including outer rollbacks
and audit/storage failures. No new player probes, coordinates, live roster
collection, game commands, control changes, rewards, standings or season resets
are introduced. The source flag must not be enabled as part of a routine merge;
activation and source/staging validation remain separate release work.

## Explicit season definition plans

The territorySeasonPlans service adds staff-only future definitions
behind the independent TERRITORY_SEASON_PLANS_ENABLED flag, whose example is 0.
Storage initialization is explicit and requires enabled, writable settings.
Absent-storage inspection does not create tables. The current linked
administrator is checked against the users table, including inside confirmation.

Each save or cancellation requires a two-minute account-bound review of an exact
season ID, revision, name and millisecond start/end boundaries. The digest binds
the reviewed definition and existing state; it is a consistency token, not a
signature or a substitute for staff authorization. Reviewing changes no data.
Confirmation uses an immediate transaction, rechecks the current saved revision,
state digest, authority, clock and all other plans, then saves definition and
append-only receipt/audit together. Overlapping planned windows are rejected;
adjacent boundaries are permitted. No 8/12-week policy is inferred.

Before their planned start, plans can be revised or cancelled through another
review. Once their start is reached they lock, even when no runtime season has
been activated. Cancellation retains history and frees the date window, but its
season ID cannot be reused. The local bound is 500 retained plan IDs; further
capacity and lifecycle policy still need review. An original request reference
recovers its exact saved receipt after expiry or while new planning is paused.
Changed retries conflict, and receipt reads are private to the original current
staff identity. Read-only mode blocks confirmation, including retries, while
query-only history/receipt reads remain possible. Contradictory current/audit
state is withheld. This service provides no activation or reset method, scheduler,
public season display, reward or game command.

All 83 integrated local tests pass. Five new planning checks cover disabled and
read-only storage behavior, authority/relinking, reviews without writes, expiry,
date overlaps/adjacency, revisions, cancellation, start-boundary locks, exact
retries, private receipts, audit rollback and inconsistent history. A separate
independent-writer SQLite test proves only one of two overlapping plans can save;
busy connections must retry/check the same reference. The existing source,
runtime, voting and production-page checks also pass. Hosted and authenticated
staging results remain pending for this unpublished work.

## Private staff planning page

/api/territory-season-plans exposes current-database linked staff reads, review,
confirmation and original-actor receipt recovery. X-Season-Planner binds each
request to the displayed account. POST operations require same-origin JSON and
strict fields; account/query overrides are rejected. Current role/account checks
run before and after each operation, with the core repeating authority inside
the write transaction. Responses are private/no-store. Capabilities and disabled
or preview reads do not initialize missing planning tables. Writable enabled
access prepares missing planning storage explicitly. Existing history stays
readable while new planning is paused; exact saved retries can recover a receipt.

/adminseasons and /adminseasons.html use the existing admin page gate, and the
staff navigation links the page. The editor shows local device times and exact
UTC dates before explicit confirmation. Review freezes the action, definition,
revision and request key. Discard does not write. Lost replies preserve the same
request for explicit receipt checking or retry. A successful save followed by a
failed plan-list read also retains that recovery state. Conflicting edits require
refresh before another review. Expired reviews disable confirmation. Preview and
paused modes disable new choices. Every display waits for fresh account/role
verification; delayed responses cannot restore cleared data. Account, role,
visibility and focus changes clear private views and form values. No browser
storage, automatic write replay, source polling or season activation is used.

85 affected local tests pass, including current-role/header/field/origin checks,
paused receipt recovery, preview reads without migrations and retained-history
consistency. A missing current definition now blocks inspection and overlapping
new plans while its audit remains, rather than silently freeing its date window.
Actual-page fixtures pass at 1440px/390px using the real planning API/core and
synthetic cookie accounts; shared navigation is omitted in the isolated fixture.
They cover review/discard without writes, local/UTC date review, safe text,
unreadable save replies, original receipt checking, same-request retry, failed
post-save list reads, cancellation, expiry, competing staff changes, preview/
pause, held replies across account/role changes and width. Visibility checks use
the explicit page event contract in headless Edge. Browser storage stays empty and no
unexpected API calls occur. The phone review screenshot was visually inspected.
These are not real Steam or hosted staging results.

Next implementation must obtain reviewed cadence/boundaries and safely
coordinate active declarations and reset transitions,
preserve verified outcomes
and frozen identities, and distinguish unknown holding-time/streak evidence.
Historical champions and reset previews/confirmation/recovery need private staff
APIs, player display and real-source/staging checks. Do not infer continuous
control intervals from captures alone or reconstruct unrecorded history from
current labels. No reset cadence or champion policy has been approved here.

Roadmap #19 displays Working on; its original wording and historical votes stay.
It leaves active idea voting while five other ideas remain eligible. Homepage
asset is v167. The full 31-item roadmap and this feature remain incomplete.
