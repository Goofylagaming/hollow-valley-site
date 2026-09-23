# Hollow Valley Current Hosting Architecture

Hollow Valley no longer relies on a game-host file-transfer control plane.

## Current layout

- **Game server:** BinaryLane Windows Server 2022.
- **Website:** Render service from `master`.
- **Automation:** Render service from `automation-platform`.
- **HerbyBot:** separate Render worker.
- **Live player reads:** BinaryLane localhost RCON -> presence sender -> Render automation.
- **Game mutations:** Render automation -> authenticated outbound command queue -> BinaryLane PowerShell agent -> local UE4SS CommandBridge.
- **No inbound VPS command port is required.**

## Website configuration

The website talks to the automation service over HTTPS.

Required server-side variables:

```text
AUTOMATION_SERVICE_URL=
HOLLOW_VALLEY_API_TOKEN=
AUTOMATION_ADMIN_TOKEN=
```

The browser must never receive these credentials.

## Automation configuration

Production uses the BinaryLane HTTP-pull transport:

```text
COMMAND_BRIDGE_TRANSPORT=http_pull
BINARYLANE_COMMAND_TOKEN=
COMMAND_BRIDGE_ENABLED=true
COMMAND_BRIDGE_SINGLE_PUBLISHER_ACK=automation-platform-is-sole-publisher
```

The BinaryLane token is dedicated to this command bridge. Do not reuse the website integration token, admin token, Discord token, or RCON password.

## Presence feed

The BinaryLane server is the authoritative source for live player state.

The local scanner reads RCON on localhost and forwards snapshots to the automation service over HTTPS. Website map, active-character, quest, and player-presence features read the resulting automation snapshot rather than opening a second public RCON connection.

## CommandBridge flow

```text
website
  -> Render automation
  -> authenticated HTTP command queue
  -> BinaryLane outbound polling agent
  -> local UE4SS CommandBridge
  -> DinoStorage / BodyDrop / SkinStudio
  -> result file
  -> BinaryLane agent
  -> Render result endpoint
  -> website
```

Supported production verbs include:

- `dino_store`
- `dino_retrieve`
- `dino_list`
- `bd`
- `skin_apply` when SkinStudio is deliberately enabled

Commands are validated before local publication and mutation requests are not automatically retried after an ambiguous outcome.

## BodyDrop

Player BodyDrop uses the live BinaryLane snapshot for species, growth, and location validation.

Current default cooldown:

```text
BODYDROP_COOLDOWN_SECONDS=600
```

The admin-only global emergency drop is OFF by default and requires an explicit enable + activate sequence.

## DinoStorage

DinoStorage commands use the same HTTP-pull bridge. Stored-dino listing, store, and retrieve results are reconciled through the automation request ledger.

Admin restore JSON generation can remain available independently. Direct remote slot-file upload is not part of the current BinaryLane architecture.

## Server mods

Live UE4SS mods are installed on the BinaryLane machine under the game server's local `ue4ss/Mods` directory.

Do not use a hosted-file-transfer deployment button or legacy workflow to update the live BinaryLane server. Server-mod deployment should be handled through a BinaryLane-aware maintenance workflow with explicit backups and restart control.

## Safety rules

- Keep RCON private.
- Do not open a public command port on the VPS.
- Keep one CommandBridge publisher.
- Keep wallet playtime rewards disabled unless deliberately enabled.
- Do not automatically retry ambiguous game mutations.
- Restart the game server only when a mod/config change actually requires it.
