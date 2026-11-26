# Hollow Valley Automation Platform

This folder remains a separately deployed service, but its source now lives on `master` with the Hollow Valley website. `master` is the single source of truth for both services; the legacy `automation-platform` branch is automatically mirrored from `master` only for deployment compatibility.

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
- Legacy plain-FTP adapter retained only for compatibility tests.
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
- Automatic daily/weekly verified-playtime quests with approved default boosts of +5%, +10%, +15%, +10%, +20%, +25% (36h) and +50% (72h) on future Valley Coin payouts, bounded by the existing +100% quest-boost safety cap.
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
    adapters/                 # Evrima RCON + legacy file bridge
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

## In-game EventAI zone toasts and !prime

Players can receive an EventAI toast when the existing milestone detector confirms a zone change, and when they type `!prime`. Lua does not call HTTP. `scripts/windows/Deliver-HollowValleyNotices.ps1` tails CommandBridge `results.ndjson` and writes EventAI `inbox.ndjson`. `Send-HollowValleyPresence.ps1` is unchanged.

`POST /api/presence-feed/notices` uses the same presence-feed token as the snapshot route (`Authorization: Bearer` or `X-Presence-Feed-Token`).

Request:

```json
{ "primeRequests": [ { "id": "chat-prime-76561198000000000-1", "steam": "76561198000000000", "ts": 1732600000 } ] }
```

Response, each notice handed out once:

```json
{ "notices": [ { "id": "uuid", "steam": "76561198000000000", "text": "Entered migration zone: South Rail" } ] }
```

Zone text is `Entered migration zone: {name}`, `Entered patrol zone: {name}`, `Entered sanctuary: {name}`, or `Left sanctuary: {name}`. A successful `!prime` line looks like `Rex 87% · PRIME 2h 14m · Migration 2 · Patrol 1 · Sanctuary 1 · now: South Rail`. If `PRIME_TRACKER_ENABLED` is off, the player has no current life, or the read fails, the text is exactly `Prime tracker unavailable right now`.

The detector is the existing milestone store (Vulnona shapes, two samples at least 3 seconds apart). The first accepted snapshot after an automation restart, and the first snapshot after a player was missing from the previous snapshot, does not emit a zone toast. Each player has a separate 60 second cooldown for migration enter, patrol enter, sanctuary enter, and sanctuary leave. Uncollected notices expire after 60 seconds. Text is limited to 200 characters and cannot contain quotes, backslashes, or control characters. At most 20 notices are returned per call; prime replies are first, and the rest stay queued. Steam IDs must be 17 digits. Prime request ids are deduped. A call answers at most 20 prime requests, which is also the most notices one response returns. Extras are left untouched and zone notices are still returned. The delivery script posts in batches of 20 and moves its tail only after every batch in that pass succeeds.

| Variable | Default | Effect |
| --- | --- | --- |
| `PLAYER_MILESTONES_EVENTAI_NOTIFY` | `false` | Zone toasts. `false` or unset stops new zone notices and drops any still queued. |
| `PRIME_CHAT_NOTIFY_ENABLED` | `true` | `!prime` replies. `false` stops those replies. Zone toasts stay on their own flag. |
| `PRIME_TRACKER_ENABLED` | `false` | When off, `!prime` still replies, with the unavailable line. |

Rollback does not need a game-server restart. Turn `PLAYER_MILESTONES_EVENTAI_NOTIFY` off to stop zone toasts. Turn `PRIME_CHAT_NOTIFY_ENABLED` off to stop `!prime` replies. Stopping the Windows delivery script stops both from reaching the inbox. The website overlay and the older RCON direct-message path are separate.

Latency is about 15–30 seconds for zones (presence snapshot plus the detector's confirming sample, then a delivery poll) and about 5–10 seconds for `!prime` (delivery poll plus one EventAI tick). A crossing that never gets a second sample is still missed, same as the website toast.

This change does not enable the flags on Render and does not deploy. Copy `Deliver-HollowValleyNotices.ps1` to the VPS only after review. See `scripts/windows/README.md`.

## Deployment status

The isolated `hollow-valley-automation` Render service uses the `automation-platform/` root directory from the unified `master` source. Auto-deploy remains disabled unless deliberately changed.

Verified on September 18, 2026:

- the service boots successfully on port 10000;
- SQLite is using the persistent `/var/data` disk and retained the same persistence marker across a controlled redeploy;
- the existing HerbyBot service is successfully polling the durable outbox;
- Direct RCON/file-host access is not required by the BinaryLane HTTP-pull architecture;
- CommandBridge publishing and all game/file write gates remain disabled;
- branch-side Wallet, Quests, Marketplace, My Dinos reads and BodyDrop status reads are prepared to use the automation API;
- My Dinos Store/Redeem and BodyDrop POST still use the legacy publisher until the deliberate single-publisher cutover.

`master` is the production source of truth for both the website and automation service. Runtime write gates remain independently controlled by environment variables and the staged checks in `DEPLOYMENT.md`.
