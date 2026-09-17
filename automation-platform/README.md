# Hollow Valley Automation Platform

This folder is intentionally isolated from the live Hollow Valley website code. Development happens on the `automation-platform` branch and nothing here is merged into or deployed from `master` automatically.

The service is a control plane for Hollow Valley: it connects the operator console to Evrima RCON, VeryGames FTP/CommandBridge, BodyDrop, DinoStorage and Discord automation while keeping the current Hollow Valley visual language.

## Current milestone

Built on the isolated branch:

- Hollow Valley-style Automation Center UI.
- Public aggregate server health endpoint.
- Admin-token-protected operator console and privileged APIs.
- Native Evrima RCON status/player-data client.
- VeryGames plain-FTP CommandBridge adapter with atomic command publication.
- CommandBridge acknowledgement/result correlation.
- BodyDrop worker using live RCON position data, cooldowns and result reconciliation.
- DinoStorage list/store/redeem worker with deferred-result safety messaging.
- Local SQLite automation request ledger.
- Automatic BodyDrop and DinoStorage reconcilers.
- Bridge diagnostics for busy command queues and oversized result logs.
- Discord REST automation for status-channel naming and protected announcements.
- Branch-only GitHub Actions tests.

Still intentionally not built/connected:

- Scheduled announcements/events/rewards.
- Production deployment for this isolated service.
- Player-facing calls from the live Hollow Valley website into this service.

## Safety model

The service deliberately separates public health information from privileged data.

`GET /health` and `GET /api/status` are public but expose only aggregate state such as online status and player count. They do not return Steam IDs, player names, locations, bridge paths or automation queues.

Privileged endpoints require `AUTOMATION_ADMIN_TOKEN` using `Authorization: Bearer <token>` (or `x-automation-token`). If no token is configured, privileged APIs fail closed with HTTP 503.

The operator page stores a supplied admin token only in browser `sessionStorage`, so closing the browser tab/session removes it. Do not put the real token in Git or frontend source.

CommandBridge work is conservative by design:

- A positive CommandBridge routing acknowledgement is **not** treated as a BodyDrop completion.
- BodyDrop becomes `confirmed` only when a correlated `source: BodyDrop` result arrives.
- DinoStorage reports an accepted sub-mod result separately from the deferred in-game kill/restore outcome.
- Missing results become `unknown`; they are not retried automatically.
- The FTP publisher refuses to overwrite an existing unconsumed command queue.
- An oversized `results.ndjson` (>8 MiB) blocks normal result processing until an operator rotates it.

Discord automation is also deliberately narrow:

- It uses Discord REST rather than opening a second gateway session alongside the existing HerbyBot.
- Status-channel renaming is rate-limited to a minimum five-minute cadence.
- Announcements can only be sent to the configured announcement channel.
- `allowed_mentions` is disabled for automated announcements so message text cannot trigger mass mentions accidentally.
- All Discord control routes require the automation admin token.

## Layout

```text
automation-platform/
  public/
    index.html                 # HDS-style operator console
    assets/
      automation.css
      automation.js
  src/
    index.js                   # Express service entrypoint
    adapters/
      evrimaRcon.js            # Evrima-specific TCP RCON protocol
      fileBridge.js            # VeryGames FTP + CommandBridge files
    middleware/
      adminAuth.js             # Constant-time admin token check
    routes/
      adminRoutes.js
      bodyDropRoutes.js
      dinoStorageRoutes.js
    services/
      automationStore.js       # SQLite request ledger
      bodyDropService.js
      commandBridgeService.js
      dinoStorageService.js
      discordAutomationService.js
      statusService.js
  test/
    adminAuth.test.js
    commandBridge.test.js
    discordAutomation.test.js
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

For UI-only/local status work, leave `COMMAND_BRIDGE_ENABLED=false`. RCON, FTP and Discord values can also remain blank; the console should show them as not configured rather than attempting live actions.

Run tests with:

```bash
npm test
```

## Environment configuration

Start from `.env.example`. The important groups are:

- `AUTOMATION_ADMIN_TOKEN`: long random operator secret; required for all privileged APIs.
- `AUTOMATION_DB_PATH`: SQLite request ledger location. Production needs persistent storage.
- `RCON_HOST`, `RCON_PORT`, `RCON_PASSWORD`: same Evrima RCON settings used by the current site.
- `GAME_FILE_PROTOCOL=ftp` and `SFTP_*`: same VeryGames file-access settings used by the existing CommandBridge deployment. The historical `SFTP_*` variable names are retained for compatibility even though VeryGames uses plain FTP on port 21.
- `COMMAND_BRIDGE_ENABLED`: keep `false` until the isolated service is deliberately connected.
- `COMMAND_BRIDGE_SAVED_PATH`: normally `Mods/CommandBridge/Saved`, relative to the UE4SS directory.
- `BODYDROP_*` and `DINOSTORAGE_*`: cooldown/reconciliation controls.
- `DISCORD_BOT_TOKEN`, `DISCORD_STATUS_CHANNEL_ID`, `DISCORD_ANNOUNCEMENT_CHANNEL_ID`: optional Discord automation configuration.

## API overview

Public:

- `GET /health`
- `GET /api/status`
- `GET /api/bodydrop/options`

Admin token required:

- `GET /api/admin/status`
- `GET /api/admin/requests`
- `POST /api/admin/reconcile`
- `GET /api/admin/discord`
- `POST /api/admin/discord/sync-status`
- `POST /api/admin/discord/announce`
- `GET /api/bodydrop/requests`
- `GET /api/bodydrop/cooldown/:steamId`
- `POST /api/bodydrop/request`
- `POST /api/bodydrop/reconcile`
- `GET /api/dinostorage/requests`
- `GET /api/dinostorage/:steamId`
- `POST /api/dinostorage/store`
- `POST /api/dinostorage/redeem`
- `POST /api/dinostorage/reconcile`

## Production checklist

Before deploying this branch as a separate service:

1. Create a separate Render service/root directory for `automation-platform`; do not repoint the live Hollow Valley service.
2. Generate a long random `AUTOMATION_ADMIN_TOKEN` in Render secrets.
3. Attach persistent storage and set `AUTOMATION_DB_PATH` to that disk.
4. Add RCON and FTP credentials as Render secrets.
5. Deploy initially with `COMMAND_BRIDGE_ENABLED=false`.
6. Confirm `/health`, `/api/status`, admin authentication and RCON status first.
7. Verify the FTP paths and CommandBridge diagnostics read correctly.
8. Add Discord credentials/channel IDs and verify status sync before allowing announcements.
9. Enable CommandBridge only when the existing live consumer is known to be compatible and there is no competing publisher writing the same single-file queue.
10. Test with controlled BodyDrop/DinoStorage requests before connecting the live player website.

The current live `master` branch remains the source of truth for the public Hollow Valley site until an integration is deliberately reviewed and merged.
