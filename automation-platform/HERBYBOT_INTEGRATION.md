# HerbyBot Automation Integration

Hollow Valley already has one Discord bot: **HerbyBot**. The automation platform is deliberately designed **not** to create another Discord client or hold the Discord bot token.

## Architecture

```text
Automation workers / scheduler / server monitor
                |
                v
       SQLite HerbyBot outbox
                |
       /api/herbybot/* (token)
                |
                v
        existing HerbyBot process
                |
        existing discord.js Client
                |
                v
              Discord
```

The automation platform queues messages. HerbyBot polls, sends them through its existing logged-in client, and acknowledges delivery.

## Credentials

Automation service:

```text
HERBYBOT_AUTOMATION_TOKEN=<long random server-to-server secret>
```

Existing HerbyBot host:

```text
AUTOMATION_SERVICE_URL=https://<automation-service>
HERBYBOT_AUTOMATION_TOKEN=<same secret>
DISCORD_BOT_TOKEN=<existing HerbyBot token>
DISCORD_ANNOUNCEMENT_CHANNEL_ID=<existing/selected channel>
DISCORD_ALERT_CHANNEL_ID=<existing/selected alert channel>
```

Never copy `DISCORD_BOT_TOKEN` into the automation service.

## Bridge endpoints

All endpoints require the HerbyBot token and return `Cache-Control: no-store`.

- `GET /api/herbybot/status` — aggregate server/automation state plus outbox summary.
- `POST /api/herbybot/outbox/claim` — lease pending events for delivery.
- `POST /api/herbybot/outbox/:id/ack` — mark a delivered event complete.
- `POST /api/herbybot/outbox/:id/fail` — release or terminally fail a delivery attempt.

Claims use leases so a crashed HerbyBot process does not permanently lose a message. Every outbox event also has a stable nonce; the HerbyBot bridge sends that nonce with `enforceNonce: true` to reduce duplicate Discord sends if delivery succeeded but acknowledgement was interrupted.

## Existing HerbyBot integration

The isolated branch includes:

```text
integration/herbyBotAutomationClient.js
integration/herbyBotBridge.js
```

The bridge accepts the existing discord.js client as an argument:

```js
const { createHerbyBotAutomationBridge } = require('./integration/herbyBotBridge');

const automationBridge = createHerbyBotAutomationBridge({ client });
automationBridge.start();
```

It does not construct a Discord client and does not call `client.login()`.

The current live `server/herbyBot.js` can keep owning:

- the Discord gateway connection;
- presence text;
- status-channel naming/locking;
- Discord channel IDs and permissions.

The automation bridge adds durable announcement and alert delivery on top.

## Delivery destinations

Outbox events currently use two logical destinations:

- `announcement` → `DISCORD_ANNOUNCEMENT_CHANNEL_ID`
- `alert` → `DISCORD_ALERT_CHANNEL_ID`

The automation service does not know or store those Discord channel IDs.

## Producers

The following automation features now enqueue through HerbyBot:

- manual operator announcement;
- scheduled one-time/daily/weekly announcement;
- confirmed server outage alert;
- server recovery alert.

Server status/presence naming remains owned directly by HerbyBot.

## Failure behavior

- An event is leased before delivery.
- A failed send returns the event to pending until `HERBYBOT_OUTBOX_MAX_ATTEMPTS` is reached.
- After the maximum attempts, the event is marked `failed` for operator attention.
- A delivered event is retained as delivered history.
- Scheduler/monitor work is considered durably handed off once the outbox event exists; Discord delivery is tracked separately by the outbox.
- The automation service never falls back to a second Discord bot connection.

## Production activation

Do not wire this into live HerbyBot until the isolated automation service is deployed.

Recommended first live bridge test:

1. Configure the shared `HERBYBOT_AUTOMATION_TOKEN`.
2. Keep CommandBridge and RCON writes disabled.
3. Start the HerbyBot polling bridge using the existing Discord client.
4. Queue one harmless operator announcement.
5. Confirm HerbyBot claims it, sends it once, and acknowledges it.
6. Verify the event becomes `delivered` in the automation outbox.
7. Only then enable scheduler delivery.
8. Enable server-monitor alerts later, after read-only RCON is stable.

The live `master` HerbyBot remains untouched until that controlled integration step.
