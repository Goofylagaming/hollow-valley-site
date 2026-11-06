# Territory Seasons — roadmap #19

The original scope remains periodic Territory control resets with historical
champions, total territory time, attacks won and defensive streaks. None is
delivered by this first local source-evidence step.

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
No browser flow or season endpoint exists yet; these are synthetic local source
checks, not authenticated game staging or production observations.

The context table and row share declaration atomicity, including outer rollbacks
and audit/storage failures. No new player probes, coordinates, live roster
collection, game commands, control changes, rewards, standings or season resets
are introduced. The source flag must not be enabled as part of a routine merge;
activation and source/staging validation remain separate release work.

Next implementation must define reviewed immutable season boundaries, safely
coordinate active declarations and reset transitions, preserve verified outcomes
and frozen identities, and distinguish unknown holding-time/streak evidence.
Historical champions and reset previews/confirmation/recovery need private staff
APIs, player display and real-source/staging checks. Do not infer continuous
control intervals from captures alone or reconstruct unrecorded history from
current labels. No reset cadence or champion policy has been approved here.

Roadmap #19 displays Working on; its original wording and historical votes stay.
It leaves active idea voting while five other ideas remain eligible. Homepage
asset is v165. The full 31-item roadmap and this feature remain incomplete.
