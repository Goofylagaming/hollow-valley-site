# Production stability release — 23 October 2026

## Verified starting point

Both production services were live on 3bcb109a3d03ae7afa07361ba4c21655819cc02d.
Automation uses branch automation-platform, disk /var/data, and TCP health checks.
Website uses master, disk /app/data, and homepage health checks.
Both auto-deploy on commit. Each deployed twice on 23 October: new_commit then API,
creating avoidable second interruptions. Never trigger an additional manual deploy
after an automatic one. Persistent disks prevent zero-downtime replacement.

## Release gates

1. Obtain fresh consistent backups of both SQLite databases using SQLite backup or
   VACUUM INTO (never copy only the live database while WAL is active). Preserve all
   other disk files and existing backups. Verify quick_check on backup copies and
   record row counts using `node scripts/storage-preflight.cjs BACKUP`.
2. Pass Production stability checks on Linux/Node 22. Existing Windows wallet
   tests leave SQLite handles open and cannot remove their temporary directories.
3. Merge only the reviewed revision. Website auto-deploys first. The branch-sync
   workflow pins the initiating SHA, runs safety tests, and waits for three /readyz
   responses with that exact SHA before advancing automation without force.
4. Automation deploys automatically once. The same workflow waits for three
   successful /readyz checks. Failure stops the release; do not rerun blindly.
5. Set each live service's HTTP health path to /readyz after code is available.
   Keep existing disk identities, mount paths, DB paths, tokens, feature flags and
   sole-publisher acknowledgement. Blueprint references are not a migration.
6. Verify current revision, status/progression reads, Command Bridge poll/result
   traffic and presence-feed success in logs. Do not issue test purchases, credits,
   parking, restore or game commands against production players.

## Behavior and limitations

/healthz reports process liveness; /readyz performs a local read and rejects drain
state. Remote game/Primalbound outages do not make the whole service unready.
Schema initialization remains synchronous before listening. Readiness does not
prove off-site backup coverage or filesystem writability.

Only server-snapshot reads retry once, with jitter inside the original request
deadline, and stop after three failed operations for a 15-second cooldown. One
probe may reopen traffic. Commands and wallet mutations are never automatically
retried. Existing ledger uniqueness and command acknowledgement rules remain.

Website status and per-Steam progression display snapshots persist in an additive
read_snapshots table in the existing website database. Stale status is labelled
and expires after 15 minutes; progression expires after 24 hours. Retained positions
are not supplied to territory calculations. These snapshots never authorize rewards,
wallet changes or commands. No restore, backfill or balance rewrite occurs.

Primalbound's free cloud service restarted at 03:35:15 and 03:53:51 UTC, shortly
after the gateway's 12-second failures. Its public capabilities handler does not
query the database. Cold startup is strongly indicated. Capability requests now
share one in-flight request with a 60-second total budget and circuit breaker.
Account/save requests are not replayed. A paid always-on service would address
cold starts more directly but is not provisioned by this change.

Server-monitor alerts use an incident timestamp for deduplication, preserving it
through delivery retries, and require two consecutive successes for recovery.
This is the game-server monitor; Render HTTP incidents are monitored separately.

## Safe persistent storage migration (staged, no production cutover)

Keep both disks attached throughout this release. Never replace SQLite with an
empty database or detach disks to obtain zero-downtime deploys.

1. Inventory all production disk paths and database files, including wallet ledger,
   progression ledger, dino requests/storage metadata, command queue/results,
   outbox, sessions, skins and auxiliary files. Run storage-preflight on consistent
   backup copies; store reports privately. Preserve arbitrary non-database files.
2. Verify encrypted off-site backups and rehearse restoration in an isolated
   environment without RCON, FTP, Discord, payment or Command Bridge credentials.
3. Build a PostgreSQL adapter behind a default-off flag. Preserve transaction
   boundaries, uniqueness/idempotency keys, integer currency, IDs, timestamps,
   monotonic sequences and foreign keys. Start with read-only shadow comparisons.
4. Rehearse import into a NEW staging database only. Compare every table's row
   count, wallet balances and ledger totals, XP totals, ownership and command states.
   Reject missing/duplicate IDs, negative balances and unexplained differences.
5. Schedule a maintenance window, stop new mutations and drain in-flight commands.
   Unknown command outcomes must be reconciled from game evidence, never replayed.
   Capture a final consistent backup and reconciliation report before cutover.
6. Switch one authoritative writer only after parity and restore tests pass.
   Keep old disks read-only for retention. Rollback after new writes requires a
   reconciled reverse transfer; simply pointing at old SQLite loses new changes.

No PostgreSQL resource, production data transfer, dual-writer mode, destructive
migration, backup pruning or disk removal is performed by these changes.
