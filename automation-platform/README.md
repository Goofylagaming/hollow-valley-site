# Hollow Valley Automation Platform

This folder is intentionally isolated from the live Hollow Valley website. Development happens on the `automation-platform` branch; nothing here is merged into or deployed from `master` automatically.

The project is a separate Hollow Valley control plane that keeps the existing HDS dark/gold/Cinzel-style visual language while moving server automation into an independently deployable service.

## What is built

### Operator console

- Hollow Valley-style Automation Center.
- Public aggregate status with player identities and positions removed.
- Admin-token-protected detailed console.
- Live player/RCON status.
- CommandBridge queue and reconciliation diagnostics.
- BodyDrop/DinoStorage request ledger.
- RCON control panel with server-side write kill switch.
- HerbyBot bridge controls with durable announcement/alert outbox.
- Tested HerbyBot slash-command layer: public `/server` plus staff-only ephemeral `/automation`, `/players [page]`, `/queue`, `/activity`, `/announce` and `/schedule`.
- Persisted scheduler UI.
- Player Activity panel with 24h/7d/30d read-only analytics, average/peak online counts, returning players, session-length metrics, activity trend, species mix and top tracked players.
- Migration Readiness panel showing setup, safety and publisher-cutover state.
- Admin restore JSON builder with `fullNutrients` support and a separately gated DinoStorage slot uploader.

### Evrima and game-server integration

- Native Evrima RCON protocol client.
- Player list, character data, growth/vitals/location and server slot reads.
- Gated RCON actions for announcement, direct message, save, corpse wipe and AI density.
- VeryGames plain-FTP adapter.
- Atomic CommandBridge publication that refuses to overwrite a busy queue.
- Strict bridge acknowledgement vs. sub-mod completion handling.
- BodyDrop worker using live RCON coordinates, cooldowns and reconciliation.
- DinoStorage file reads plus store/redeem request/reconciliation flows.
- Admin restore slot upload that creates missing player storage directories, stages atomically and refuses to overwrite existing slots.

### Automation and persistence

- SQLite request ledger.
- Scheduled-job ledger.
- Operator audit ledger with secret-field redaction.
- Persisted server-monitor state.
- Persisted read-only player-presence sessions plus aggregate player-count/species samples (31-day default retention).
- Automatic BodyDrop/DinoStorage reconcilers.
- Durable HerbyBot outbox for announcements and operational alerts.
- Existing-client HerbyBot integration helper for outbox polling, command registration and interaction handling without a second Discord login.
- Server-side staff overview sanitizer limits Discord player output to name, species and growth; Steam IDs, coordinates and vitals never cross the HerbyBot bridge.
- One-time/daily/weekly HerbyBot announcement scheduler, including idempotent staff slash-command scheduling.
- Multi-failure server outage/recovery monitor.
- Presence analytics: unique/returning players, tracked playtime, average/median/longest sessions, average/peak concurrency, bucketed activity trend, sampled species mix and top tracked players.
- Steam-keyed Valley Coin wallets with immutable idempotent ledger transactions.
- Configurable five-minute verified-online playtime rewards, disabled by default until the economy rate is chosen.
- Automatic daily/weekly verified-playtime quests with approved default boosts of +5%, +10%, +15%, +10% and +20% on future Valley Coin payouts (maximum +60% from the current quest set).
- Atomic official marketplace debit + pending-order creation, with gated real DinoStorage fulfillment and exact-once refunds.
- Real DinoStorage P2P escrow selling with buyer holds, seller credit after proven transfer, cancellation and restart reconciliation.
- Parked-dino mutation editor for active slots 1–4 with duplicate/current slot restrictions and inherited/elder preservation.
- Real captured-skin presets with same-species application and a Valley Coin creation cost.

### Website integration

- Dedicated `HOLLOW_VALLEY_API_TOKEN`, separate from the operator token.
- Private `/api/website/*` server-to-server endpoints.
- `integration/websiteAutomationClient.js` for the eventual live backend connection.
- `integration/liveRouteAdapters.js` to preserve the current My Dinos/BodyDrop/Wallet/Marketplace response shapes and minimize frontend changes.
- Request-status polling that never replays the original game action.

### Deployment safety

- Separate `automation-platform/render.yaml` for a new Render service.
- `autoDeploy: false` by default.
- Persistent `/var/data` SQLite disk configuration.
- `RCON_WRITE_ENABLED=false` by default.
- `COMMAND_BRIDGE_ENABLED=false` by default.
- `PLAYER_PRESENCE_ENABLED=false` by default.
- `WALLET_PLAYTIME_REWARDS_ENABLED=false` and `WALLET_PLAYTIME_COINS_PER_5_MINUTES=0` by default.
- `MARKETPLACE_WRITE_ENABLED=false`, `OFFICIAL_MARKETPLACE_FULFILLMENT_ENABLED=false`, `PARKED_DINO_EDIT_ENABLED=false` and `SKIN_SYSTEM_ENABLED=false` by default.
- `SERVER_MONITOR_ENABLED=false` by default.
- `ADMIN_RESTORE_WRITE_ENABLED=false` by default; JSON generation remains available while FTP slot writes stay locked.
- CommandBridge requires an additional exact sole-publisher acknowledgement before it can publish:

```text
COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK=automation-platform-is-sole-publisher
```

That acknowledgement must remain unset until the existing live website has stopped publishing directly to the same CommandBridge queue.

## Safety model

Public endpoints only expose aggregate health. Steam IDs, names, locations, stored dino data, queues, audit history, presence history and migration diagnostics are protected.

`AUTOMATION_ADMIN_TOKEN` protects operator/admin APIs.

`HOLLOW_VALLEY_API_TOKEN` protects the live website's server-to-server integration. Never expose it to browser JavaScript and never reuse the operator token.

`HERBYBOT_AUTOMATION_TOKEN` protects the HerbyBot claim/ack bridge. Discord credentials stay on the existing HerbyBot service; the automation service never receives `DISCORD_BOT_TOKEN`.

Game actions remain conservative:

- queue/routing acknowledgement is not completion;
- BodyDrop becomes confirmed only from the correlated BodyDrop result;
- DinoStorage acceptance is separate from its deferred in-game kill/restore lifecycle;
- unknown outcomes are never automatically replayed;
- a busy single-file command queue is a stop condition;
- RCON writes reported as sent-but-unconfirmed are not retried automatically.

## Important directories

```text
automation-platform/
  public/                     # HDS-style Automation Center
  src/
    adapters/                 # Evrima RCON + VeryGames FTP
    middleware/               # admin + website auth
    routes/                   # admin/player-service endpoints
    services/                 # workers, reconciliation, scheduler, analytics
  integration/                # future live-site backend adapter/client
  test/                       # regression/privacy/safety tests
  .env.example
  Dockerfile
  render.yaml
  WEBSITE_INTEGRATION.md
  ECONOMY_MARKETPLACE.md
  DEPLOYMENT.md
```

## Local run

```bash
cd automation-platform
npm install
cp .env.example .env
npm start
```

Open `http://localhost:3100`.

For safe local/UI testing leave these disabled:

```text
COMMAND_BRIDGE_ENABLED=false
RCON_WRITE_ENABLED=false
PLAYER_PRESENCE_ENABLED=false
WALLET_PLAYTIME_REWARDS_ENABLED=false
SERVER_MONITOR_ENABLED=false
ADMIN_RESTORE_WRITE_ENABLED=false
```

Run tests with:

```bash
npm test
```

The branch GitHub Actions workflow also runs the test suite and Docker build after pushes.

## API groups

Public:

- `GET /health`
- `GET /api/status`
- `GET /api/bodydrop/options`

Operator/admin protected:

- `GET /api/admin/status`
- `GET /api/admin/requests`
- `GET /api/admin/audit`
- `GET /api/admin/presence`
- `GET /api/admin/presence/analytics`
- `POST /api/admin/presence/sample`
- `GET /api/admin/migration-readiness`
- `POST /api/admin/reconcile`
- `GET /api/admin/dinostorage/admin-restore`
- `POST /api/admin/dinostorage/admin-restore-json`
- `POST /api/admin/dinostorage/admin-restore/upload` (separately write-gated)
- HerbyBot outbox/announcement controls
- scheduler controls
- server-monitor controls
- RCON controls

Website server-to-server protected:

- `GET /api/website/wallet/:steamId`
- `GET /api/website/quests/:steamId`
- `GET /api/website/marketplace/catalog`
- `GET /api/website/marketplace/orders/:steamId`
- `POST /api/website/marketplace/catalog/:catalogId/buy`
- `GET /api/website/marketplace/state`
- `GET /api/website/marketplace/listings`
- `GET /api/website/marketplace/listings/mine/:steamId`
- P2P listing/create/buy/cancel endpoints
- parked-dino mutation read/write endpoints
- skin preset list/create/apply endpoints
- `GET /api/website/bodydrop/cooldown/:steamId`
- `POST /api/website/bodydrop`
- `GET /api/website/dinostorage/:steamId`
- `POST /api/website/dinostorage/store`
- `POST /api/website/dinostorage/redeem`
- `GET /api/website/requests/:requestId?steamId=...`

See `WEBSITE_INTEGRATION.md` for the live-site contract, `ECONOMY_MARKETPLACE.md` for the wallet/marketplace architecture, `HERBYBOT_INTEGRATION.md` for the existing-bot bridge, and `DEPLOYMENT.md` for the staged rollout/cutover procedure.

## Production status

This work remains intentionally disconnected from production. The automation service has not been deployed, the live website has not been switched to the new integration client, CommandBridge publishing is disabled, and RCON writes remain disabled.

The live `master` branch stays the source of truth until integration is deliberately reviewed and merged.
