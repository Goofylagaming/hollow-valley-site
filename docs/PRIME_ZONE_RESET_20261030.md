# Hollow Valley — Prime Tracker: Reset Tracked Zones
Development date: 30 October 2026 (Brisbane).
Status: Feature branch, not automatically deployed.

## What players see
In the existing Prime Tracker on both the Live Map and DinoStorage:
- A **Reset tracked zones** button.
- A confirmation explaining exactly what does and does not reset.
- A visible date showing the most recent zone reset.
- The migration, patrol and sanctuary visit counters go back to zero for
  the selected **currently tracked dinosaur life**.
- If the dinosaur is still standing in a mapped zone when reset occurs,
  that particular zone counts again only after the dinosaur leaves and
  subsequently re-enters it. New zones begin recording normally.

Use after Entomb: spawn your new dinosaur, allow a fresh player-presence
sample, verify the species/growth in the tracker, then reset zones.
Entomb itself is not modified or automatically triggered by this button.

## What is protected
- Existing and newly earned Prime status/flag.
- Prime time (prime_seconds), Prime achievement timestamp and history.
- Historical dino lives including older Prime records.
- All dinosaur storage/redeem/scrap logic, mutations and skins.
- Valley Coins, quest progress, rewards, player account links,
  subscriptions, Stripe and Territory Wars.
- Game-side Prime eligibility and RCON/Command Bridge commands.

The automation database remains authoritative. Reset archives the current
life's previous zone visit rows in prime_tracker_zone_resets and deletes only
their current-count rows (same SQLite transaction). Historical zone visit
snapshots are preserved for recovery, not publicly downloadable.

## Data safety and abuse prevention
- POST /api/mydinos/prime-tracker/reset-zones requires signed-in website
  Steam identity, exact same-origin JSON request and affirmative user
  confirmation. Request body Steam IDs are ignored.
- The website forwards the *authenticated* Steam ID through its existing
  protected website-to-automation integration.
- The target active life ID must still match the ID visible when the player
  pressed reset; stale-life attempts fail 409 instead of resetting a new dino.
- A UUID request ID is persisted to make network retries idempotent.
- Repeated fresh requests less than 60 seconds apart fail 429.
- Late and duplicate position samples cannot restore visits from before reset.
- No new direct game-server or Discord API connections are created.
- Only new SQLite table and two additive columns in Prime's own lives table.
- Existing zone rows are not modified until a real player confirms the reset.

## Verification and release
- automation-platform/test/primeZoneReset.test.js tests Prime preservation,
  archived zone visits, wrong-player and stale-life rejection, resend
  idempotency, cooldown, delayed telemetry, zone exit/reentry and a
  same-species 100%-to-5% Entomb-like life rollover.
- test/primeZoneResetRoutes.test.js tests website Steam auth, exact-origin
  protection, false Steam ID body spoofing, HTTP conflict propagation, UI
  cancellation, idempotent retry, and only zone-related browser checkboxes.
- Existing automatic site/automation regression tests and Render readiness
  must pass before production deployment.
- Back up both the website and automation persistent SQLite databases and
  verify they are readable. Do not change or detach either disk.
- The GitHub master -> automation-platform sync deploys the automation
  service when its code changes. Coordinate that short restart with the
  website release and verify Command Bridge and HerbyBot health afterwards.
- Do not mark this live before explicit rollout and post-deployment verification.
