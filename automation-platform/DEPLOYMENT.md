# Hollow Valley Automation Platform — Separate Deployment Runbook

This service is designed to be deployed separately from the live Hollow Valley website. Do not change the existing live service root directory or move `master` to this application.

## Intended deployment shape

- Repository: `Goofylagaming/hollow-valley-site`
- Branch while developing/testing: `automation-platform`
- Service root directory: `automation-platform`
- Runtime: Docker using `automation-platform/Dockerfile`
- Health endpoint: `/health`
- Persistent data: SQLite file configured through `AUTOMATION_DB_PATH`

The live Hollow Valley website and this control plane should remain separate services even after production activation.

## Persistent disk

The request ledger, scheduler, audit log and server-monitor state all live in SQLite. Production must place the database on persistent storage.

Example layout:

```text
/var/data/automation.sqlite
```

with:

```text
AUTOMATION_DB_PATH=/var/data/automation.sqlite
```

The exact mount path may be chosen in the hosting service; the important requirement is that it survives container replacement/redeploys.

## Required secret handling

Never commit real values for:

- `AUTOMATION_ADMIN_TOKEN`
- `RCON_PASSWORD`
- `SFTP_PASSWORD`
- `DISCORD_BOT_TOKEN`
- any future API/service credentials

Keep them in the hosting platform's environment/secret settings only.

## Stage 1 — isolated UI and health only

Start with all live-write integrations disabled:

```text
COMMAND_BRIDGE_ENABLED=false
RCON_WRITE_ENABLED=false
SERVER_MONITOR_ENABLED=false
```

RCON, FTP and Discord credentials can initially remain unset.

Verify:

1. `/health` returns HTTP 200.
2. `/api/status` loads without exposing privileged player details.
3. The Automation Center renders with the Hollow Valley styling.
4. The admin API fails closed until `AUTOMATION_ADMIN_TOKEN` is configured.
5. Closing the browser session removes the admin token from session storage.

## Stage 2 — read-only RCON

Add:

```text
RCON_HOST=...
RCON_PORT=...
RCON_PASSWORD=...
RCON_WRITE_ENABLED=false
```

Verify:

- server online/offline state
- online player count
- admin-only player details
- max slot count when the server reports it
- no RCON write buttons are enabled

Do not enable RCON writes yet.

## Stage 3 — FTP diagnostics only

Add the VeryGames file-access values while keeping:

```text
COMMAND_BRIDGE_ENABLED=false
```

Verify that configured paths are correct before permitting a second publisher to touch the CommandBridge queue.

The automation service must never overwrite an existing `commands.ndjson`; a busy queue is a stop condition, not something to bypass.

## Stage 4 — Discord

Add:

```text
DISCORD_BOT_TOKEN=...
DISCORD_STATUS_CHANNEL_ID=...
DISCORD_ANNOUNCEMENT_CHANNEL_ID=...
DISCORD_ALERT_CHANNEL_ID=...
```

Verify manually:

1. status channel rename
2. one harmless announcement
3. audit-log entries for the operator actions
4. one future scheduled test announcement
5. cancellation of a scheduled test job

The isolated service uses Discord REST only and should not open a second gateway session alongside the existing HerbyBot.

## Stage 5 — server monitoring

Keep the alert channel configured, then set:

```text
SERVER_MONITOR_ENABLED=true
SERVER_MONITOR_FAILURE_THRESHOLD=3
SERVER_MONITOR_INTERVAL_MS=60000
```

Verify that normal online checks establish a baseline without sending an alert.

The monitor only marks the server offline after the configured number of consecutive failed health checks. Its confirmed state is stored in SQLite so a normal redeploy does not resend the same offline transition repeatedly.

## Stage 6 — CommandBridge writes

Only after confirming the live UE4SS CommandBridge consumer and the single-file queue behavior, set:

```text
COMMAND_BRIDGE_ENABLED=true
```

Run one controlled action at a time:

1. BodyDrop test
2. reconcile the exact request ID
3. DinoStorage store test
4. reconcile
5. DinoStorage redeem test
6. reconcile

A routing acknowledgement is not a completion. Unknown outcomes must be reconciled before another request for the same player is attempted.

If another publisher can write the same CommandBridge queue, stop here until a proper shared queue/arbiter design is in place.

## Stage 7 — RCON writes last

After all read-only and bridge behavior is stable, enable:

```text
RCON_WRITE_ENABLED=true
```

Test in this order:

1. harmless in-game announcement
2. manual save
3. AI density only if the intended value is known
4. corpse wipe only in a controlled maintenance situation

Corpse wipe remains protected by the exact `WIPE CORPSES` confirmation text in addition to the admin token and server-side write switch.

If an RCON command is reported as **sent but unconfirmed**, do not repeat it automatically. Verify the game state first.

## Rollback

The quickest safe rollback is to disable write integrations without taking the console offline:

```text
COMMAND_BRIDGE_ENABLED=false
RCON_WRITE_ENABLED=false
SERVER_MONITOR_ENABLED=false
```

The service can remain online for read-only status and audit inspection.

If the entire service must be removed, the live Hollow Valley site remains independent and should continue operating from its own existing deployment.

## Before any connection to the live website

Do not point player-facing Hollow Valley actions at this service until:

- the separate deployment is stable
- persistent storage is confirmed
- admin/auth boundaries are reviewed
- CommandBridge ownership is clear
- all branch CI tests are green
- controlled live-server tests have been reconciled

Only then should website-to-control-plane authentication be designed and reviewed separately.
