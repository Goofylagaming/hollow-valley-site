# Hollow Valley Automation Platform — Separate Deployment Runbook

This service is designed to be deployed separately from the live Hollow Valley website. Do not change the existing live service root directory and do not point the current production service at `automation-platform`.

## Intended deployment shape

- Repository: `Goofylagaming/hollow-valley-site`
- Development branch: `automation-platform`
- New service root directory: `automation-platform`
- Runtime: Docker using `automation-platform/Dockerfile`
- Health endpoint: `/health`
- Persistent data: SQLite through `AUTOMATION_DB_PATH`
- Suggested Render definition: `automation-platform/render.yaml`

The live Hollow Valley website and the automation control plane should remain separate services after production activation.

## Safety switches

The separate service is intentionally safe by default:

```text
COMMAND_BRIDGE_ENABLED=false
COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK=
RCON_WRITE_ENABLED=false
PLAYER_PRESENCE_ENABLED=false
SERVER_MONITOR_ENABLED=false
ADMIN_RESTORE_WRITE_ENABLED=false
```

Do not turn these on together during initial deployment.

The protected Automation Center exposes a **Migration Readiness** report at:

```text
GET /api/admin/migration-readiness
```

Use that report as the checklist for moving from isolated setup to live integration.

## Persistent disk

Requests, scheduled jobs, audit history, monitor state and player-presence sessions are stored in SQLite. Production must use persistent storage.

Recommended Render path:

```text
AUTOMATION_DB_PATH=/var/data/automation.sqlite
```

The supplied `automation-platform/render.yaml` creates a separate persistent disk at `/var/data`.

## Secrets and credentials

Never commit real values for:

- `AUTOMATION_ADMIN_TOKEN`
- `HOLLOW_VALLEY_API_TOKEN`
- `RCON_PASSWORD`
- `SFTP_PASSWORD`
- `HERBYBOT_AUTOMATION_TOKEN`

`AUTOMATION_ADMIN_TOKEN` is for the operator console and admin APIs.

`HOLLOW_VALLEY_API_TOKEN` is a different server-to-server credential used only between the live Hollow Valley backend and `/api/website/*`. Do not expose it to browser JavaScript and do not reuse the admin token.\n\n`HERBYBOT_AUTOMATION_TOKEN` is another dedicated server-to-server credential. It allows the existing HerbyBot to claim and acknowledge durable automation messages. Keep the actual Discord bot token and Discord channel IDs only on the HerbyBot service.

## Stage 1 — deploy the isolated service

Create a **new** Render service from `automation-platform/render.yaml` or equivalent settings. Keep `autoDeploy` off while testing.

Verify:

1. `/health` returns HTTP 200.
2. `/api/status` returns aggregate health only.
3. The Automation Center renders with the current Hollow Valley visual language.
4. `/api/admin/*` fails closed until `AUTOMATION_ADMIN_TOKEN` is configured.
5. `/api/website/*` fails closed until `HOLLOW_VALLEY_API_TOKEN` is configured.
6. The persistent SQLite path survives a redeploy.
7. Migration Readiness shows the exact missing setup items.

## Stage 2 — read-only RCON

Configure:

```text
RCON_HOST=...
RCON_PORT=...
RCON_PASSWORD=...
RCON_WRITE_ENABLED=false
```

Verify server status, online player count, slot count and admin-only character details.

Do not enable RCON writes yet.

### Optional player-presence tracking

After read-only RCON has been stable, optionally enable:

```text
PLAYER_PRESENCE_ENABLED=true
PLAYER_PRESENCE_INTERVAL_MS=60000
```

Presence tracking only closes a session after a successful RCON snapshot shows that player absent. An RCON outage does not log everybody out.

The admin console can then show 24-hour unique players, tracked playtime, peak tracked concurrency and top tracked players.

## Stage 3 — FTP diagnostics only

Configure VeryGames file access while leaving:

```text
COMMAND_BRIDGE_ENABLED=false
COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK=
```

Verify the UE4SS and CommandBridge paths. A busy `commands.ndjson` is a stop condition; the service must never overwrite an unconsumed queue file.


### Admin restore JSON and slot upload

The operator console can build and validate admin restore JSON while writes remain locked. This includes the optional:

```json
"fullNutrients": true
```

which fills Carb, Protein and Lipid during the DinoStorage restore without changing normal stored-dino behavior.

Keep:

```text
ADMIN_RESTORE_WRITE_ENABLED=false
```

during normal isolated testing. For a controlled admin restore window, it may be set to `true` only after FTP paths are verified. The uploader creates the player's missing DinoStorage directory if required, refuses to overwrite an existing slot, stages the file before rename, and **does not automatically redeem the dino**. Turn the write gate back off after the slot is prepared.

## Stage 4 — HerbyBot bridge and scheduler

Configure the same dedicated `HERBYBOT_AUTOMATION_TOKEN` on the automation service and the existing HerbyBot host. Do **not** add `DISCORD_BOT_TOKEN` to the automation service.

HerbyBot keeps its existing Discord gateway connection, status presence and channel IDs. The automation service only stores durable outbox events under `/api/herbybot/*`.

Test:

1. authenticated HerbyBot bridge status
2. claim/ack of one harmless announcement event
3. audit entry creation
4. one future scheduled announcement landing in the outbox
5. scheduled-job cancellation
6. one simulated monitor alert landing in the alert outbox

The provided `integration/herbyBotAutomationClient.js` and `integration/herbyBotBridge.js` are designed to plug into the existing HerbyBot client without calling `client.login()` or creating a second Discord client.

## Stage 5 — server monitoring

After the HerbyBot bridge, HerbyBot alert channel and read-only RCON are stable, optionally enable:

```text
SERVER_MONITOR_ENABLED=true
SERVER_MONITOR_FAILURE_THRESHOLD=3
SERVER_MONITOR_INTERVAL_MS=60000
```

The monitor requires multiple consecutive failed checks before declaring an outage and persists confirmed state to avoid alert flapping across ordinary redeploys.

## Stage 6 — prepare the live website integration

The private website API already exists under:

```text
/api/website
```

Detailed endpoint behavior is documented in `WEBSITE_INTEGRATION.md`.

The isolated compatibility files are:

```text
integration/websiteAutomationClient.js
integration/liveRouteAdapters.js
```

Before modifying the live site:

1. Give the automation service and live website backend the same new `HOLLOW_VALLEY_API_TOKEN`.
2. Set `AUTOMATION_SERVICE_URL` only in the live website backend.
3. Ensure Steam identity continues to come from the authenticated server-side session (`req.user.steam_id`), never a browser-supplied Steam ID.
4. Test read-only DinoStorage and request-status calls first.
5. Keep player-facing write actions on the existing path until the publisher cutover below.

## Stage 7 — CommandBridge publisher cutover

This is the critical migration step.

The existing live website and the automation service must **not** both act as independent publishers to the same single-file `commands.ndjson` queue.

The new service requires two separate settings before it can publish:

```text
COMMAND_BRIDGE_ENABLED=true
COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK=automation-platform-is-sole-publisher
```

Do **not** set the acknowledgement until the old/live direct CommandBridge publisher has been disabled or replaced by the website-to-automation client.

Recommended cutover order:

1. Confirm the isolated automation service is healthy and persistent storage works.
2. Confirm website server-to-server authentication works.
3. Disable the live website's direct CommandBridge publishing path.
4. Confirm no old request is still sitting in `commands.ndjson` or an unresolved processing state.
5. Set `COMMAND_BRIDGE_ENABLED=true` on the automation service.
6. Set the exact sole-publisher acknowledgement.
7. Confirm Migration Readiness reports `migration-ready`.
8. Run one controlled BodyDrop request and reconcile the exact request ID.
9. Run one controlled DinoStorage store request and reconcile it.
10. Run one controlled DinoStorage redeem request and reconcile it.

A CommandBridge routing acknowledgement is not proof the sub-mod completed the action. `unknown` outcomes must never be automatically replayed.

## Stage 8 — RCON writes last

Only after read-only operation, website integration and CommandBridge migration are stable should you consider:

```text
RCON_WRITE_ENABLED=true
```

Test in this order:

1. harmless in-game announcement
2. manual save
3. AI density only when the intended value is known
4. corpse wipe only during controlled maintenance

Corpse wipe requires the exact `WIPE CORPSES` confirmation in addition to the admin token and server-side write switch.

If an RCON write is reported as **sent but unconfirmed**, do not repeat it automatically. Check the game state first.

## Rollback

Fastest safe rollback:

```text
COMMAND_BRIDGE_ENABLED=false
COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK=
RCON_WRITE_ENABLED=false
SERVER_MONITOR_ENABLED=false
PLAYER_PRESENCE_ENABLED=false
ADMIN_RESTORE_WRITE_ENABLED=false
```

The separate service can remain online for health inspection, audit history and read-only diagnostics.

If player-facing requests were already moved to the automation service, restore the previous live-site route path only after confirming there are no queued or unknown automation requests that could later complete and create duplicates.

The live `master` deployment remains independent until a deliberate integration change is reviewed and merged.
