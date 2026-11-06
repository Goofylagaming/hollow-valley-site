# Hollow Valley event scheduling changes

Implemented in an isolated checkout of Goofylagaming/hollow-valley-site, based on c0c4d6fc. The existing project checkout and production data were not modified. No deployment or live event creation was performed.

## Behavior
- Duration mode keeps the existing 5–720 minute limit and optional start time.
- Exact mode accepts Queensland start/end date-times, converts them to UTC, and records Australia/Brisbane. Maximum exact duration is 30 days; the existing maximum start lead time remains 30 days.
- The requested window is 6 November 2026 19:00 QLD to 8 November 2026 23:59 QLD: 52h 59m / 3,179 minutes. UTC: 2026-11-06T09:00:00.000Z to 2026-11-08T13:59:00.000Z.
- End is exclusive: bonus accrual stops at the end timestamp. Trusted presence and existing complete-minute payout rules remain required.
- Admin shows SCHEDULED / ACTIVE / COMPLETED, and retains STOPPED for manually stopped events. The legacy API status 'expired' remains compatible; displayStatus supplies COMPLETED. Status is derived from timestamps, including after restart, and the open Admin table updates every 15 seconds.
- Kentrosaurus is available in the event selector, website validation, automation validation, grouped bonus decoding and presence payout matching. The presence alias Kentro is accepted. Event-specific eligibility does not alter unrelated shop/storage catalogs.
- Existing event limits of 20 selected species, per-species rates, overlap checks, announcement nonces and idempotency are preserved.

## Changed files
- Dockerfile — packages shared validator in the website image.
- automation-platform/src/services/eventSchedule.js — new side-effect-free shared scheduling validation.
- automation-platform/src/services/speciesCoinEventService.js — exact schedules, additive metadata, lifecycle display and Kentrosaurus.
- server/routes/adminOperations.js — website validation, forwarding and Kentrosaurus selector catalog.
- public/adminoperations.html — scheduling controls and cache version.
- public/assets/species-events-admin.js — Queensland conversion, calculated duration, payload and live status display.
- public/assets/home-roadmap.js — records tested scheduling work as awaiting release, without claiming production delivery.
- public/index.html — roadmap asset cache version.
- automation-platform/test/speciesCoinEvents.test.js — exact window, restart, payout and validation coverage.
- automation-platform/test/speciesCoinPingMigration.test.js — legacy timestamps and metadata preservation.
- test/speciesCoinEventsWebsite.test.js — admin range forwarding and browser conversion/submission tests.
- docs/event-scheduling-release.md — this release report.

## Validation
54 tests passed, 0 failed, across:

    node --test test/speciesCoinEventsWebsite.test.js test/adminOperationsRoute.test.js automation-platform/test/speciesCoinEvents.test.js automation-platform/test/speciesCoinPingMigration.test.js automation-platform/test/speciesCoinEventRoutes.test.js automation-platform/test/playerPresence.test.js automation-platform/test/scheduler.test.js

JavaScript syntax checks and git diff --check also passed. Tests used isolated/in-memory databases. Browser logic was exercised through Node VM tests; no interactive browser or production smoke test was performed. Container packaging was inspected, but a Docker image was not built.

## Deployment and migration
1. Apply the supplied patch to a clean checkout of the matching base, or merge the implementation branch. Re-run the listed tests if combining with newer changes.
2. Take a consistent backup of the automation SQLite database using the existing deployment backup procedure, retaining its production data volume.
3. Deploy the automation service first. Startup adds schedule_mode TEXT NOT NULL DEFAULT 'duration' and timezone TEXT to species_coin_events when absent. It does not delete or rewrite event windows, wallets, ledgers or payout progress. No manual SQL migration is needed.
4. Deploy the website from the same revision. Include the updated Dockerfile/shared validator; do not deploy just the route file. No dependency or environment-variable changes are required. Existing SPECIES_COIN_EVENTS_ENABLED and trusted-presence settings still apply.
5. Validate in staging: create a short future exact event, observe SCHEDULED then ACTIVE then COMPLETED, verify Kentrosaurus payout and stop behavior, and verify an existing duration event remains unchanged. Confirm both services are healthy before production rollout.
6. Once deployed, create the weekend event in Admin using Exact start and end (QLD), entering the dates above and choosing the desired species/rates. No live weekend event has been created by this change.

Rollback: keep the additive columns and production database. Roll back application code only; never restore a stale database over newly earned wallet credits. Existing versions already understand the persisted start/end fields, but do not understand Kentrosaurus bonuses, so avoid rollback while such an event is active unless its effect has been reviewed.
