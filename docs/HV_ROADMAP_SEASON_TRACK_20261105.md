# Free season track — source timing prerequisite

Roadmap #4 remains Building / Testing. This local branch starts from Event Engine
`e9556c42` and does not change the three prepared publication heads. No season,
player season UI, reward catalog or new payout has been enabled.

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

- Reviewed season identity, start/end, free enrollment/progression and immutable
  tier definitions. The proposed eight-to-twelve-week duration is not activated.
- Explicit policy for source-time attribution, delayed grants, boundary-spanning
  playtime, confirmations versus actual events, unknown clocks and corrections.
- A separate season evidence/progress ledger consuming eligible existing sources
  without calling permanent `awardXp` to manufacture seasonal points or level coins.
- Achievement XP and trustworthy achievement/event source integration. The existing
  permanent ledger currently grants XP from playtime, quests and paid event records;
  it is not a complete season implementation.
- Approved cosmetic/reward policy and any separately authorized payout behavior.
  No new automatic coin payments, restores or game commands are authorized here.
- Private player reads, progress UI, actual producer payload review, performance,
  hosted checks and authenticated staging before rollout.

Original #4 wording and historical votes remain. The feature leaves the active
ballot during development, freeing its old votes without deleting them. Eight
ideas remain eligible. Homepage planning asset version is 118. No production
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
