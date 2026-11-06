# Private spectator dashboard — 6 November 2026

Roadmap #27 is Building / Testing on feature/hv-roadmap-spectator-20261106,
based on retained-history follow-up 74331d85. This scope is local and is not part
of published drafts #320/#321/#322. No live flag, merge, deployment or source
activation has been performed.

## Connected read-only view

/adminspectator and /adminspectator.html are protected by the existing private
admin page gate. The page links from the admin navigation and contains no game
command or mutation controls. The shared automatic daily-login claim is explicitly
suppressed on this page. Refresh reads existing records only and does not sample
RCON, claim jobs, invoke a reconciler, generate rewards or change player records.

The automation source uses the private automationStore DB through a read-only
store method, with no exported mutable DB handle or new schema initialization.
GET /api/admin/spectator/summary requires the admin token and accepts no query
overrides. ADMIN_SPECTATOR_ENABLED=0 separately gates automation and website use.
The website /api/admin-spectator capabilities/summary routes require current
linked DB admin permission; summary also requires X-Spectator-Reviewer binding.
Identity, permissions and the rollout flag are rechecked after asynchronous
source reads, including source failure. All responses are private/no-store.

The source and website projection expose these limited observations:

- Population/species: existing external cached roster only, with its original
  timestamp, strict roster identity/length consistency, a 500-player and 1-MiB
  payload limit, no future clock, and a two-minute freshness limit. Missing or
  malformed samples do not produce zero. Unknown species remain unknown. Only
  recognized species codes are accepted.
- Regions: the source passes ephemeral bounded roster observations to the trusted
  website server. The browser receives counts by nearest existing map label,
  never roster Steam IDs, player names or coordinates. Outside/missing positions
  remain region-unknown; positions are not clamped into a valid region. These are
  approximate labels, not verified biome boundaries or discovery receipts.
- Health: the latest stored server_health_samples observation, with its original
  timestamp and a ten-minute freshness limit. Recorded online/offline is not a
  complete service-health claim. Contradictory sources are not silently reconciled.
- FPS: explicitly not recorded by the current producer. An unexpected cached FPS
  field is ignored rather than promoted into a verified metric.
- Body drops: counts of current stored queued, acknowledged and outcome-unknown
  bodydrop requests. This does not verify a drop in the game.
- Marketplace: current failed official orders whose stored update is within the
  recorded past 24 hours. This is not the full order or fulfillment history.
- Battles: at most 20 stored warning/active unresolved website attack records,
  with their declared/last-tick timestamp and old-observation label. This SELECT
  does not run Territory runtime ticks or verify a current game battle.
- Combat: at most 10 largest repeated attacker/victim pairs from the configured
  combat feed over 24 hours, requiring at least two distinct stored event times.
  Same-time duplicates, self kills, anonymous attackers and other configured-source
  values do not inflate the result. Pair Steam IDs are private staff review data;
  no names/positions are included. Counts are not abuse findings or automatic moderation.
- Failures: at most 20 current failed audit/request rows updated in 24 hours, with
  bounded typed category/action/reference fields. Raw messages, errors, payloads,
  command details and credentials are not forwarded. Later status changes can
  remove an earlier failure from this view.

Missing tables or failed reads leave their sections unavailable. A bad remote
summary leaves known local battle records available without claiming that remote
counts are zero. Counter reads are independent stored observations, not one
atomic cross-system snapshot or proof of execution. Source read time is validated
and cannot renew cached player/health observations.

## Browser behavior and roadmap tracking

The browser checks fresh /api/me identity before and after private reads. Pending
responses are discarded after hidden/focused state changes; replacement accounts
must reload. Private data stays in page memory, not local/session storage. Opening
an enabled dashboard loads once; later source reads require explicit Refresh.
The expiry timer does not poll sources or rebuild the DOM every second. It removes
expired population/species/region observations, and the whole view expires after
two minutes without a refresh. Identity is periodically rechecked. Focus restores
current access/capability, clears old records and requires explicit refresh; a
disabled capability remains disabled.

Roadmap original feature wording/ID is preserved, with #27 Building / Testing.
Its existing votes remain counted historically but no longer occupy active
ballot slots. Eight ideas remain eligible. Homepage roadmap asset is v155.

## Verification and outstanding delivery

145 distinct affected local tests pass across the spectator, report-context and
incident workflows. Added tests cover read-only SQL, configured-source combat
counts/deduplication, limits, malformed/oversized/stale/future caches, unknown vs
measured zero, private aggregate projection, independent source failures, stored
battle reads and late account/role/rollout changes. A real private automationStore,
admin HTTP route, fixed website client and private website API fixture confirms
no business-state mutator calls, current authorization and empty/missing data
behavior. The root DB is query-only during successful HTTP reads. Source tests
also operate with query-only SQLite.

Actual-page desktop1440/phone390 browser fixtures pass for initial disabled state,
all ten panels, explicit refresh, DOM stability, cache expiry without source
polling, future samples, source failures, pending account changes, revoked roles,
paused reads and private-state clearing. Unexpected API writes fail the fixture;
the daily-login write has no fixture stub and is not called. The phone layout
was visually inspected. CI includes the source, private-store/API, projection,
roadmap/voting, route/syntax and production UI checks plus browser fixture.

FPS producer integration, real cached-feed semantics and map calibration,
actual game-battle/fulfillment evidence, reviewed combat-analysis policy beyond
neutral repeated-pair counts, retained-data query plans/capacity, authenticated
Steam/admin staging and production delivery remain unfinished. No local synthetic
fixture verifies those hosted behaviors. No new tracking or retention is added.
The approved 90-day saved chat/combat policy is unchanged. No new coin payout,
restore, source probe, private key, game command, external message, push or rollout
is part of this local dashboard checkpoint.
