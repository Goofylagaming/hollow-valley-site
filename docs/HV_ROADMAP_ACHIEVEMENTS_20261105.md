# Roadmap #2: permanent achievement expansion

Local development branch: feature/hv-roadmap-achievements-20261105, stacked on
the title draft PR #296. Not deployed. The full 31-item roadmap remains in scope.

Valley Collector unlocks at ten distinct active skin presets explicitly owned,
purchased or personally granted to the Steam account. Shared catalog access is
not ownership. Revoked grants and inactive presets do not qualify; overlapping
entitlements count once. The existing permanent achievement ledger preserves an
earned badge if the collection later shrinks. Existing profile achievement cards
display it through the authenticated progression response. No new XP, currency,
skin grants or game commands are issued.

Versatile Hunter unlocks after kills against five distinct recognized dinosaur
species. The existing game-log parser now forwards the victim's Dino field;
the separately authenticated combat feed canonicalizes and stores it in an
additive nullable column. Historical unknowns remain unknown. Replays cannot
replace species evidence, including with a different event ID for the same
occurrence. Repeated species, self-kills, environmental deaths and another
account's kills do not advance this badge. Existing combat quest rewards remain
unchanged; the badge itself adds neither coins nor XP.

Deploying this scope requires updating both the automation service and the
Windows game-log forwarder, then observing a staging event end-to-end. The
canonical registry deliberately ignores unrecognized labels; update it only with
verified species names. No historical species backfill is attempted.

The original #2 description is retained and its status is Building / Testing.
Historical votes remain; retired #2 votes no longer use active voting slots.

Remaining original unlocks and evidence requirements:

| Unlock | Current evidence and remaining work |
| --- | --- |
| Ten hours on one dinosaur | Legacy tracks observed life segments, separating species changes, growth resets and long gaps. Account playtime is insufficient; delayed combat deaths and continuity must be reconciled before permanent awards. |
| Reach Prime | Prime tracker distinguishes preexisting Prime from observed transitions, but admin Prime grants exist. Establish eligibility and provenance before awarding gameplay badges. |
| Win a Territory War | Integrate authoritative finalized battle results and participant identity; a kill or generic territory event is insufficient. |
| Kill five different species | Implemented locally from event-time species, awaiting forwarder/service rollout and authenticated staging verification. |
| Raise a nested baby to adult | Verified parent links exist, but nest reservations are not hatch proof. Link verified hatch evidence to growth in the same life. |
| Visit every major biome | Tracker zone visits are migration/patrol/sanctuary areas, not a reviewed biome catalog. Define canonical biome coverage and map version. |

Collector validation covers entitlement deduplication, account isolation, revoked
and inactive exclusions, shared catalog exclusions, purchase ownership, permanent
ledger persistence and no XP/currency award. Roadmap tests cover retirement and
historical vote preservation. Authenticated staging and production approval remain
required; no production completion date is claimed.

Combat validation exercises an old-schema migration, canonical names and class
aliases, unknown species, conflicting ID/occurrence replays, parser-to-ledger
badge unlock, account isolation, deduplication and no additional payout. Existing
combat HTTP authentication, daily/weekly reset and leaderboard tests also pass.
Windows test fixtures now close their SQLite handles before deleting temporary
files, and refresh economy/quest module instances between database fixtures.
