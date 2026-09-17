# Hollow Valley Automation Platform

This folder is intentionally isolated from the live Hollow Valley website code. Development happens on the `automation-platform` branch and nothing here is merged into or deployed from `master` automatically.

The service is a separate Hollow Valley control plane: it connects the HDS-style operator console to Evrima RCON, VeryGames FTP/CommandBridge, BodyDrop, DinoStorage, Discord and persisted scheduling while preserving the current portal's visual language.

## Current milestone

Built on the isolated branch:

- Hollow Valley-style Automation Center UI using the existing dark/gold HDS design language.
- Public aggregate server-health endpoint with privileged player/location data removed.
- Admin-token-protected operator console and privileged APIs.
- Native Evrima RCON status/player-data client.
- Gated RCON write controls for server announcements, direct messages, save, corpse wipe and AI density.
- `RCON_WRITE_ENABLED=false` safety switch so write controls fail closed until deliberately enabled.
- VeryGames plain-FTP CommandBridge adapter with atomic command publication.
- CommandBridge acknowledgement/result correlation and unknown-outcome handling.
- BodyDrop worker using live RCON position data, cooldowns and result reconciliation.
- DinoStorage list/store/redeem worker with deferred-result safety messaging.
- SQLite request, scheduler-job and operator-audit ledgers.
- Automatic BodyDrop and DinoStorage reconcilers.
- Bridge diagnostics for busy command queues and oversized result logs.
- Discord REST automation for status-channel naming and protected announcements.
- Persisted one-time/daily/weekly Discord announcement scheduling with restart recovery.
- Read-only operator audit feed with secret-field redaction.
- Branch-only GitHub Actions regression tests.

Still intentionally not connected to production:

- The isolated automation service itself.
- CommandBridge publishing from this second service.
- RCON write controls.
- Discord channel automation from this second service.
- Player-facing calls from the live Hollow Valley website into this service.

`master` remains untouched by this work.

## Safety model

`GET /health` and `GET /api/status` are public but expose only aggregate information such as server online status, player count and max slots. They do not expose Steam IDs, player names, locations, bridge paths, queues, stored dinos or audit records.

Privileged endpoints require `AUTOMATION_ADMIN_TOKEN` through `Authorization: Bearer <token>` (or `x-automation-token`). If no admin token is configured, privileged APIs fail closed with HTTP 503. The browser console keeps a supplied token in `sessionStorage` only.

CommandBridge behavior is conservative:

- A positive routing acknowledgement is not a BodyDrop completion.
- BodyDrop becomes `confirmed` only from a correlated `source: BodyDrop` result.
- DinoStorage reports accepted sub-mod work separately from the deferred in-game kill/restore outcome.
- Missing results become `unknown`; they are never automatically replayed.
- The FTP publisher refuses to overwrite an existing unconsumed command queue.
- A `results.ndjson` file over 8 MiB blocks normal result processing until it is rotated by an operator.

RCON writes have an additional server-side gate:

- `RCON_WRITE_ENABLED` defaults to `false`.
- The UI remains disabled until RCON is configured and that flag is explicitly enabled.
- Only allowlisted commands are exposed.
- Messages, Steam IDs and AI density values are validated before a packet is built.
- Corpse wipe requires the exact confirmation text `WIPE CORPSES`.
- If a command is written to the socket but no response arrives, it is reported as **sent but unconfirmed** and is not automatically retried.

Discord automation is deliberately narrow:

- It uses Discord REST rather than opening a second gateway session alongside the existing HerbyBot.
- Status-channel renaming has a minimum five-minute cadence.
- Announcements can only target the configured announcement channel.
- `allowed_mentions` is disabled for automated announcements.
- Scheduled announcements use the job ID as a Discord nonce for duplicate mitigation.

The operator audit ledger stores category, action, status, timestamps and limited metadata. Keys containing names such as token, password, secret, authorization, cookie or credential are automatically redacted. BodyDrop/DinoStorage audit entries intentionally do not store Steam IDs.

## Layout

```text
automation-platform/
  public/
    index.html
    assets/
      automation.css
      automation.js
      rcon-controls.css
      rcon-controls.js
      audit-panel.js
  src/
    index.js
    adapters/
      evrimaRcon.js
      fileBridge.js
    middleware/
      adminAuth.js
    routes/
      adminRoutes.js
      bodyDropRoutes.js
      dinoStorageRoutes.js
    services/
      auditService.js
      automationStore.js
      bodyDropService.js
      commandBridgeService.js
      dinoStorageService.js
      discordAutomationService.js
      rconControlService.js
      schedulerService.js
      statusService.js
  test/
    adminAuth.test.js
    audit.test.js
    commandBridge.test.js
    discordAutomation.test.js
    rconControl.test.js
    scheduler.test.js
    statusPrivacy.test.js
  .env.example
  package.json
```

## Local run

From the repository root:

```bash
cd automation-platform
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3100`.

For UI/local testing, keep both `COMMAND_BRIDGE_ENABLED=false` and `RCON_WRITE_ENABLED=false`. RCON, FTP and Discord credentials may remain blank; the console reports integrations as not configured instead of attempting live actions.

Run tests with:

```bash
npm test
```

## Important environment groups

- `AUTOMATION_ADMIN_TOKEN`: long random operator secret required by privileged APIs.
- `AUTOMATION_DB_PATH`: SQLite request/job/audit database. Production requires persistent storage.
- `AUTOMATION_SCHEDULER_INTERVAL_MS`: scheduler poll interval.
- `RCON_HOST`, `RCON_PORT`, `RCON_PASSWORD`: existing Evrima RCON connection settings.
- `RCON_WRITE_ENABLED`: explicit kill switch for write commands; default `false`.
- `GAME_FILE_PROTOCOL=ftp` and `SFTP_*`: existing VeryGames file-access settings. The historical `SFTP_*` names are retained for compatibility even though this host uses plain FTP.
- `COMMAND_BRIDGE_ENABLED`: keep `false` until this separate service is deliberately connected.
- `COMMAND_BRIDGE_SAVED_PATH`: normally `Mods/CommandBridge/Saved`, relative to UE4SS.
- `BODYDROP_*` / `DINOSTORAGE_*`: cooldown and reconciliation controls.
- `DISCORD_BOT_TOKEN`, `DISCORD_STATUS_CHANNEL_ID`, `DISCORD_ANNOUNCEMENT_CHANNEL_ID`: optional Discord automation.

## API overview

Public:

- `GET /health`
- `GET /api/status`
- `GET /api/bodydrop/options`

Admin-token protected:

- `GET /api/admin/status`
- `GET /api/admin/requests`
- `GET /api/admin/audit`
- `POST /api/admin/reconcile`
- `GET /api/admin/discord`
- `POST /api/admin/discord/sync-status`
- `POST /api/admin/discord/announce`
- `GET /api/admin/jobs`
- `POST /api/admin/jobs/discord-announcement`
- `POST /api/admin/jobs/:id/cancel`
- `POST /api/admin/jobs/run-due`
- `GET /api/admin/rcon`
- `POST /api/admin/rcon/announce`
- `POST /api/admin/rcon/direct-message`
- `POST /api/admin/rcon/save`
- `POST /api/admin/rcon/wipe-corpses`
- `POST /api/admin/rcon/ai-density`
- `GET /api/bodydrop/requests`
- `GET /api/bodydrop/cooldown/:steamId`
- `POST /api/bodydrop/request`
- `POST /api/bodydrop/reconcile`
- `GET /api/dinostorage/requests`
- `GET /api/dinostorage/:steamId`
- `POST /api/dinostorage/store`
- `POST /api/dinostorage/redeem`
- `POST /api/dinostorage/reconcile`

## Production activation order

When this branch is eventually deployed as a **separate** service:

1. Create a new Render service rooted at `automation-platform`; do not repoint the live Hollow Valley service.
2. Add a persistent disk and set `AUTOMATION_DB_PATH` to it.
3. Generate a long random `AUTOMATION_ADMIN_TOKEN` in Render secrets.
4. Add RCON credentials but keep `RCON_WRITE_ENABLED=false`.
5. Add FTP credentials but keep `COMMAND_BRIDGE_ENABLED=false`.
6. Verify `/health`, `/api/status`, admin login, public privacy behavior and RCON read-only status.
7. Verify FTP/CommandBridge diagnostics without publishing commands.
8. Add Discord credentials and verify status-channel sync/manual announcements in a controlled channel.
9. Exercise the scheduler with a harmless test announcement and confirm the audit log.
10. Enable CommandBridge only after confirming the existing UE4SS consumer and single-file queue are compatible with a second publisher.
11. Test controlled BodyDrop/DinoStorage requests and reconcile every result.
12. Enable `RCON_WRITE_ENABLED=true` only after controlled read-only/Discord/CommandBridge verification and test one harmless server announcement first.

The live `master` branch remains the source of truth for the public Hollow Valley site until integration is deliberately reviewed and merged.
