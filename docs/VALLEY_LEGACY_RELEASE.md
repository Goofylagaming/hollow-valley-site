# Valley Legacy release

The implementation is on `feature/valley-legacy-systems`, based on production
`25801be1d80c88abdfc8c665e361cc821db0c7d9`. The previously cited PR #1 was an
unrelated deployment repair. The branch previously contained no Legacy code.

## Behavior

- `/legacy` presents current-season and all-time records, archived season winners,
  Steam/species mastery, observed dinosaur history, verified parent/child links,
  and player-managed egg listings/requests.
- Mastery awards 10 XP per five verified minutes, with 50 levels and cosmetic
  milestone titles. No gameplay buffs or skin entitlements are granted.
- Life duration is **observed active time**, not an assertion of exact biological
  age. Species changes, growth resets, missing players and gaps over 15 minutes
  break observed continuity. Same-species deaths that the feed misses cannot be
  inferred reliably. Cached/replayed snapshots do not award Legacy progress.
- Movement uses Unreal centimetres converted to metres; samples above 40 m/s
  are rejected. No historical telemetry or economy backfill is performed.
- Family links require admin-authenticated hatch evidence. They are immutable,
  same-species, older-parent links. Mutations are displayed as observations;
  genetic inheritance is not inferred. Automatic hatch detection is pending.
- Nest listings require an owned, currently observed dinosaur. Requests reserve
  eggs only when accepted by the host. Acceptance does not award offspring.
  Listings close when full, manually closed, or after 24 hours.

## Producer connections

| Producer | Connection |
| --- | --- |
| Verified presence | External ingestion and fresh RCON observations |
| Combat kills/deaths | Durable `combat_events` reconciliation; idempotent event IDs |
| Gameplay coins | Positive `playtime_reward` and `event_reward` ledger entries only |
| Territory captures | Pending authoritative attribution adapter |
| Group battles | Pending authoritative battle-size adapter |
| Hatches | Admin verification API; automatic game producer pending |

Transfers, sales, refunds, admin credits and daily-login rewards do not count as
gameplay earnings. Producer code being connected does not by itself confirm that
production feeds are configured or publishing. Closed-season delayed events are
rejected and recorded in `vl_imports.error` for operator reconciliation.

## Configuration and API

`VALLEY_LEGACY_ENABLED=1` is required on both the website and automation service.
Absent this flag, APIs return 503, the navigation link stays hidden, and the
Legacy schema is not initialized. The existing website/admin secrets are reused
only in their established roles; no credentials are changed by source code.

Website `/api/legacy` and `/api/legacy/me` proxy to automation; player mutations
derive Steam identity from the server session and require the same-origin custom
header. No public route writes records or family links.

Automation routes under `/api/website/legacy`:

- Website token: GET `/overview`, GET `/players/:steamId`, POST `/nests`,
  POST `/nests/:id/request`, POST `/nests/:id/manage`.
- Admin token: POST `/events` with `{id,type,steamId,at,value,name}`;
  POST `/hatches` with `{child,parents:[lifeId],evidence}`;
  POST `/seasons` with `{name}`.

`at` is Unix milliseconds. Admin events are for authoritative integrations, not
browser submissions. Use a unique durable ID. Do not submit synthetic events to
production. Season close archives current records; late closed-season evidence
does not silently change winners.

## Storage, deployment and rollback

All new persistence uses additive `vl_*` tables in the automation SQLite DB.
Existing tables, balances, game credentials, auth, Stripe and DinoStorage are
not migrated. The website's existing session DB is unchanged.

Production topology verified before rollout:

- `hollow-valley-site`: `master`, Docker, `/app/data` disk
  `dsk-dajsk9nqj5pc73euebtg`, SQLite `/app/data/hollowvalley.sqlite`.
- `hollow-valley-automation`: `automation-platform`, Node, `/var/data` disk
  `dsk-damarhijnfac73eemlug`, SQLite `/var/data/automation.sqlite`.
- `hollow-valley-site-test`: separate `/app/data` disk, branch
  `feature/groups-player-test-20261017`, automatic deployment off.
- UI and skin previews are separate services and must not be repurposed.

The disposable Legacy preview runs `scripts/legacy-staging.js` only with
`VALLEY_LEGACY_STAGING=1`. It hosts the actual website and automation apps across
a loopback HTTP boundary, generates temporary secrets, uses separate disposable
SQLite files, and starts no game/Discord/payment jobs. It is not a production
topology or persistent environment. Never configure production secrets there.

Release gates: targeted CI passes, preview `/legacy` and auth checks pass,
telemetry replay/validation tests pass, consistent production backups pass
`quick_check`, additive migration is tested on an isolated backup copy, and the
candidate/merge/deploy SHAs are verified. Merge triggers website deployment and
the existing automation-branch synchronization workflow. Do not rewrite the
automation branch if it has diverged.

Enable the feature only after the new automation deployment is healthy, then
enable it on the website. Activation creates additive tables. Roll back by
disabling the flag and reverting source; keep the existing disks and databases.
No old database restoration is required merely to disable Legacy.

## Initial validation

29 local targeted checks passed, covering the new system, HTTP session identity,
CSRF, token separation, telemetry deduplication, migration idempotency, existing
owner authentication, restart telemetry and migration-readiness guards.
The Linux workflow additionally runs the existing presence suite (whose cleanup
hits open-file errors on Windows). Runtime and production validation results
must be recorded separately; a successful unit test is not a deployment.
