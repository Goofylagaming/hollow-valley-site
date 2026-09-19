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
- `POST /api/herbybot/commands/announcement` — queue a staff slash-command announcement using a Discord interaction nonce.
- `POST /api/herbybot/commands/schedule` — create an idempotent scheduled announcement using a Discord interaction nonce.

Claims use leases so a crashed HerbyBot process does not permanently lose a message. Every outbox event also has a stable nonce; the HerbyBot bridge sends that nonce with `enforceNonce: true` to reduce duplicate Discord sends if delivery succeeded but acknowledgement was interrupted.

## Existing HerbyBot integration

The isolated branch includes:

```text
integration/herbyBotAutomationClient.js
integration/herbyBotBridge.js
integration/herbyBotCommands.js
integration/herbyBotIntegration.js
```

The combined integration accepts the existing discord.js client as an argument:

```js
const { createHerbyBotIntegration } = require('./integration/herbyBotIntegration');

const automation = createHerbyBotIntegration({ client });

client.once('ready', async () => {
  // Keep the existing HerbyBot presence/status setup here too.
  await automation.onReady();
});
```

It does not construct a Discord client and does not call `client.login()`.

## Slash commands

The first command layer contains:

- `/server` — public, aggregate-only Hollow Valley status: online/offline, player count/capacity and automation connectivity.
- `/automation` — staff-only (Manage Server / Administrator), ephemeral automation health including HerbyBot outbox state and integration readiness.
- `/players [page]` — staff-only, ephemeral online-player overview with player name, species and growth only. Steam IDs, coordinates and vitals are stripped server-side.
- `/queue` — staff-only, ephemeral BodyDrop/DinoStorage request counts plus HerbyBot outbox delivery state.
- `/activity [window]` — staff-only, ephemeral 24h/7d/30d player-activity summary with unique/returning players, tracked sessions, average/peak online counts, top players and top species. Steam IDs and raw trend data are removed before crossing the HerbyBot bridge.
- `/announce message:` — staff-only, queues an immediate announcement into the durable HerbyBot outbox. It does not bypass the delivery bridge.
- `/schedule message: minutes: repeat:` — staff-only, creates an idempotent scheduled announcement. The first delivery can be 1–43,200 minutes ahead; recurrence is once, daily or weekly.

No Steam IDs, player names, locations or stored-dino data are exposed by `/server`. The staff player view is separately sanitized on the automation service before Discord formatting, so only name/species/growth can cross the HerbyBot bridge.

Command registration uses `DISCORD_GUILD_ID` when configured so development/test commands appear quickly in the target guild. If no guild ID is configured, HerbyBot registers the commands globally.

The runtime handler checks staff permissions for `/automation`, `/players`, `/queue`, `/announce` and `/schedule`; Discord command visibility alone is not treated as the security boundary. Slash-command write endpoints also require a valid interaction nonce, and retries reuse the same outbox event/job instead of creating duplicates.

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
3. Attach the combined HerbyBot integration to the existing Discord client.
4. Register the slash commands and verify `/server` returns aggregate status.
5. Verify non-staff users cannot use `/automation`, `/players`, `/queue`, `/activity`, `/announce` or `/schedule`.
6. Test `/automation`, `/players`, `/queue` and `/activity` with a staff account and confirm player/activity output has no Steam IDs or coordinates.
7. Test one harmless `/announce` and confirm it queues exactly one outbox event.
8. Test one short-delay `/schedule` and confirm a retry does not create a duplicate job.
9. Confirm HerbyBot claims the announcement, sends it once, and acknowledges it.
10. Verify the event becomes `delivered` in the automation outbox.
11. Only then enable broader scheduler delivery.
12. Enable server-monitor alerts later, after read-only RCON is stable.

The live `master` HerbyBot remains untouched until that controlled integration step.
