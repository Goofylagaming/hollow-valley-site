# Quest/playtime sync investigation

Inspected `Goofylagaming/hollow-valley-site`, master commit `099c66781880a4b4fffd1fa99a9348a25e9a9a04` on 2026-09-30. The automation platform and UE4SS CommandBridge are both in this repository. The referenced chat contained the question only, with no previous findings.

## Confirmed code defects and fixes

1. **The quest page never refreshed.** `public/assets/quests.js` invoked `loadQuests()` once, with no polling or visibility refresh. Its category buttons reused the same response. Implemented a 30,000 ms refresh, refresh on return to a visible tab, no overlapping requests, preservation of the selected filter, and retention of the last successful result with an error notice during refresh failures.
2. **Direct presence sampling cannot satisfy the default quest gap.** `playerPresenceService.intervalMs()` defaults to 300,000 ms and clamps to 300,000–600,000 ms. `playtimeRewardsService` previously required gaps of at most 90 seconds for both quests and wallet payouts. Every normal five-minute pair consequently contributed zero seconds and reset the consecutive streak. Merely setting the presence interval below five minutes does not work because of the clamp.
3. **Replayed timestamps reset consecutive progress.** Zero elapsed time was treated as discontinuous; older observations could also move the wallet/playtime checkpoint backwards. Duplicate and older observations now leave both checkpoint and streak unchanged.
4. **Polling could reinterpret cached presence as fresh playtime.** The polling path stamped reward processing with wall-clock time even when status returned a cached observation, including an external snapshot already credited by ingestion. Reward processing now uses `snapshot.checkedAt`, and skips snapshots sourced from the external feed, which has its own ingestion accounting.

Quest tolerance is now separate from wallet tolerance. The new optional `QUEST_MAX_SAMPLE_GAP_SECONDS` is bounded to 30–630 seconds. Without an override, external ingestion retains the wallet gap default (90 seconds); direct RCON polling uses the larger of the wallet gap and its configured interval plus 30 seconds (normally 330 seconds; 630 at a ten-minute interval). No source poll frequency, wallet gap, XP gap, game mutation setting, or CommandBridge timeout was changed. Restored quest completions can naturally activate their existing coin boosts and species-challenge payouts.

Both quest GET responses explicitly set `Cache-Control: private, no-store`; the browser also requests `cache: no-store`. This is defensive freshness control, not evidence that an existing HTTP cache caused the reported incident.

## Trace from server to screen

* Direct RCON: `src/adapters/evrimaRcon.js` authenticates, reads player list (0x40), server details (0x12), and character data (0x77). `statusService.js` coalesces concurrent reads and caches status. `playerPresenceService.samplePresence()` normalizes players, reconciles sessions, records aggregate samples, refreshes supporter memberships, and calls playtime/quest accounting. Optional character-data failure does not necessarily fail the basic player roster.
* Production architecture documented in `RENDER_MIGRATION.md`: a BinaryLane localhost-RCON sender POSTs HTTPS snapshots to `/api/presence-feed/snapshot`. Its actual sender source, schedule, retries and deployed settings are absent from this checkout. This route authenticates `PRESENCE_FEED_TOKEN`, validates IDs/timestamps/players, rejects conflicting IDs, deduplicates retries and ignores out-of-order snapshots. `PLAYER_PRESENCE_ENABLED=false` disables the internal poller, not external ingestion; the external token also makes quest `trackingEnabled` true.
* Persistence: SQLite at `AUTOMATION_DB_PATH` (deployment reference `/var/data/automation.sqlite`), WAL, 5,000 ms busy timeout. Presence stores sessions, aggregate samples, accepted external sample IDs and latest snapshot. `economy_playtime_progress.last_seen_ms` is the accounting checkpoint; `economy_quest_state` holds daily totals/streak and weekly totals. Quest achievements, challenge progress and wallet ledger entries are persisted. Reward processing is transactional per player.
* Session playtime and quest playtime are **different metrics**. Analytics sums session spans using `started_at` through `ended_at` or `last_seen_at`. RCON failures leave sessions open. This can span observation gaps that strict quest accounting refuses to credit. Matching those totals by backfilling session duration would risk crediting unverified time; this patch does not do that.
* `questBoostService.updateQuestProgress()` updates totals/streak, completes thresholds, and updates growth/species challenges. Daily/weekly periods use `ECONOMY_TIMEZONE`, default Australia/Brisbane; weekly reset is Monday. At period rollover existing logic discards the crossing interval for the newly reset playtime period. This can lose one sample interval near midnight; it does not explain a board frozen all day and is unchanged here.
* Website browser GET `/api/quests` requires the linked Steam session. `server/services/automationWebsiteClient.js` forwards to authenticated `/api/website/quests/:steamId`. That route reads quest state directly; it neither samples RCON nor waits for CommandBridge. There is no quest application-result cache in this client/route. Frontend auth state is cached separately in `common.js`.

## Timing inventory (repository defaults/reference values, not verified live values)

| Layer | Value / behavior |
|---|---|
| BinaryLane presence sender | Not present; live interval/HTTP timeout/retry policy unknown |
| Internal presence polling | 300,000 ms default; clamped 300,000–600,000 ms |
| RCON status cache | `RCON_STATUS_CACHE_MS`, 300,000 ms default; same 5–10 minute clamp |
| RCON request timeout | `RCON_TIMEOUT_MS`, 6,000 ms default; multiple sequential reads, not one total request budget |
| External snapshot freshness | `PRESENCE_FEED_MAX_AGE_SECONDS`, 180 default; clamped 60–600 |
| Quest sample gap before patch | Shared `WALLET_PLAYTIME_MAX_SAMPLE_GAP_SECONDS`, 90 default |
| Quest sample gap after patch | Optional `QUEST_MAX_SAMPLE_GAP_SECONDS`; default external 90, internal interval + 30 seconds (normally 330) |
| Wallet sample gap | 90 seconds default, clamped 30–600; unchanged |
| Coin payout interval | 300 verified seconds, only if enabled and positive base payout; unchanged |
| XP sample gap | `PROGRESSION_MAX_SAMPLE_GAP_SECONDS`, otherwise wallet gap, otherwise 90; unchanged |
| Supporter membership request | 5,000 ms default, max 15,000; awaited before reward processing |
| Website → automation request | `AUTOMATION_SERVICE_TIMEOUT_MS`, 8,000 ms default; clamped 1,000–30,000 |
| Quest browser refresh | Previously once; now every 30,000 ms while visible, plus visibility return |
| Presence aggregate retention | 744 hours default |
| SQLite lock wait | 5,000 ms |
| CommandBridge Lua loop / HTTP input | 1,000 ms loop; `inputPollSeconds` default/minimum 1 second; one in-flight input fetch |
| CommandBridge curl GET and result POST | 3-second connect timeout, 8-second total timeout; async; failed result posts retried |
| CommandBridge HTTP batch | Maximum 10, reduced to 1 when game action queue enabled (default) |
| Action queue | 2,000 ms cooldown, 45,000 ms lock timeout defaults; not quest accounting |
| Bridge deployment variable | Blueprint sets `COMMAND_BRIDGE_TIMEOUT_MS=20000`, but no runtime reference to this variable exists in this checkout; changing it alone has no effect here |
| BodyDrop / DinoStorage reconcile | 5,000 ms default each; unrelated to quest reads |

## Remaining reliability risks / live evidence needed

The source proves the defects above; it does not prove which deployed configuration caused this incident. No production database, runtime environment or game-host logs were accessed. Do not describe defaults as measured production settings.

External ingestion catches playtime-accounting errors, logs `[playtime-rewards]`, and still records the external sample as accepted. Thus HTTP 201 does not prove quests advanced: inspect `rewards.reason` for `reward-error`. Per-player transactions can leave earlier players committed if a later player fails. Ingestion also returns `skipped: true, reason: sample-already-running` while busy, but its route currently returns 201. A sender that considers every 2xx delivered can drop these observations. These are concrete failure branches; their occurrence in production is unverified. Safe retry/atomicity changes need sender behavior and fault-injection work and are not bundled into this narrow timing/UI fix.

The RCON basic response helper consumes the first TCP data chunk, whereas character data uses a sentinel and can return a partial buffer at timeout. Large/fragmented roster responses are another potential observation-quality problem; no host trace establishes that it happened here. Extending timeouts does not correct first-chunk parsing.

Read accepted feed gaps from a consistent SQLite backup (read-only):

```sql
WITH recent AS (
  SELECT sampled_at, LAG(sampled_at) OVER (ORDER BY sampled_at) AS previous_at
  FROM player_presence_external_samples
  WHERE sampled_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day')
)
SELECT sampled_at,
       ROUND((julianday(sampled_at)-julianday(previous_at))*86400, 1) AS gap_seconds
FROM recent WHERE previous_at IS NOT NULL ORDER BY sampled_at DESC LIMIT 200;
```

Compare these gaps with the sender's captured timestamps, HTTP outcomes, `sample-already-running`, `reward-error`, and the affected player's quest/checkpoint rows. Check actual deployment commit and persistent database path as well.

## Interval/timeout recommendation

Do **not increase the time between syncs** to fix this: longer gaps make progress older and previously made all quest credit disappear beyond 90 seconds. Faster UI refresh alone cannot restore dropped backend credit. Increasing a timeout helps only if requests genuinely finish after that deadline; neither CommandBridge nor the quest API timeout participates in elapsed-time calculation.

For external ingestion, retain the current cadence until measured. If a verified 60-second sender routinely produces accepted 100–120-second gaps, an explicit quest-only tolerance such as 150 seconds is available, but it also accepts more unobserved time. Do not set it automatically without observing the gaps. For a verified five-minute sender, 330 seconds may be appropriate; separately review the 180-second snapshot freshness setting, since that sender would otherwise appear stale between updates. No live values were changed.

## Changed files

* `public/assets/quests.js`: refresh behavior and uncached fetch.
* `server/routes/quests.js`, `automation-platform/src/routes/websiteRoutes.js`: quest-only no-store headers.
* `automation-platform/src/services/playtimeRewardsService.js`: independent quest tolerance and monotonic observation handling.
* `automation-platform/src/services/playerPresenceService.js`: pass observation timestamp and internal cadence; avoid double-accounting external snapshots.
* `automation-platform/test/questSync.test.js`, `questPresencePolling.test.js`, and `test/questPolling.test.js`: regression coverage.
* `automation-platform/test/presenceFeedEndpoint.test.js`: real ingestion → persistence → authenticated quest API assertions with wallet payouts disabled.
* This document.

## Deployment and rollback

Validation on Node 24.19.0 / Windows:

* Six new regression tests passed (four accounting cases, one presence polling integration case, one browser-script behavior case). The expanded external ingestion/API test also passed.
* Full modified suite: **506 tests, 412 passed, 94 failed**. Full unmodified base: **500 tests, 406 passed, 94 failed**. The failure names match exactly after normalizing checkout paths. Existing failures include Windows deletion of open SQLite files, stale source-content assertions, and supporter schema fixtures. This is not a clean full-suite pass; Linux CI remains a deployment gate.
* `git diff --check` passed.

Targeted test command from repository root:

```sh
node --test automation-platform/test/questSync.test.js automation-platform/test/questPresencePolling.test.js automation-platform/test/presenceFeedEndpoint.test.js test/questPolling.test.js
```

Full comparison command: `node --test --test-timeout=30000 --test-reporter=tap`. The supplied test logs include both modified and unmodified runs.

1. Apply the supplied patch on the inspected base (or review conflicts against newer master). Run the targeted tests listed in the delivery report and the full suite in the normal Linux CI/deployment environment.
2. Take a consistent backup of automation SQLite using the existing backup workflow. No schema migration or historical backfill is required.
3. Deploy the reviewed commit to `hollow-valley-automation` first. Its reference Blueprint has auto-deploy **false**, root `automation-platform`, build `npm install --omit=dev --no-audit --no-fund`. Preserve all existing runtime flags, tokens, wallet/XP settings and database disk/path. Leave `QUEST_MAX_SAMPLE_GAP_SECONDS` unset unless the measured external cadence warrants an override.
4. Deploy the same commit to `hollow-valley-site` (Docker; reference auto-deploy **true**). The website alone cannot deploy automation changes. No game-server/UE4SS restart or CommandBridge change is required.
5. With a linked test player online, compare two fresh presence timestamps, the persisted checkpoint and quest progress, then leave `/quests` open for 30 seconds. Verify progress advances only on new accepted observations; category remains selected; wallet rewards and unrelated actions keep their prior settings. An external feed with gaps over 90 seconds still needs an evidence-based quest override.
6. Roll back by redeploying the previous commit to both services and removing only a newly added quest override. This does not reverse legitimately earned achievements or wallet rewards; do not reset production data as part of rollback.

Prepared for GitHub review. Deployment and production verification remain pending.
