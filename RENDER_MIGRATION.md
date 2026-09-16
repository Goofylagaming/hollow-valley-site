# Migrating Hollow Valley from DigitalOcean to Render

This guide walks through moving the site from the DigitalOcean droplet
(`170.64.237.78`, Docker Compose + manual SSH admin) to Render (git-based
auto-deploy). Nothing here changes the live droplet — it's safe to prepare
in advance and cut over on your own schedule.

## Why move

The droplet setup requires manually SSH-ing in for every deploy and config
change. Several outages this project has hit were caused by hand-edited
files on the server drifting from what's in git (e.g. `docker-compose.yml`
being edited directly, `.env` getting overwritten by a pasted script).
Render deploys straight from GitHub and manages env vars/secrets in its own
dashboard, which removes that whole class of problem.

## What Render plan you need

- **Web service**: "Starter" plan (~$7/mo) for an always-on instance. The
  free tier spins down when idle, which would break RCON status checks and
  make the first request after idle slow.
- **Persistent disk**: ~$0.25/GB/mo, 1GB is plenty for the SQLite DB.

## One-time setup steps

1. **Push this repo to GitHub** (already done — `Goofylagaming/hollow-valley-site`).
2. In the Render dashboard: **New +** → **Blueprint**, select this repo/branch.
   Render will detect `render.yaml` in the repo root and propose the
   `hollow-valley-site` web service with a persistent disk.
3. Render generates `SESSION_SECRET` automatically. Fill in the remaining
   secrets marked "sync: false" in the Render dashboard's Environment tab:
   - `STEAM_RETURN_URL` = `https://hollowvalley.herbydeathsquadgames.com/auth/steam/callback`
   - `STEAM_REALM` = `https://hollowvalley.herbydeathsquadgames.com/`
   - `STEAM_API_KEY` (optional, blank is fine)
   - `RCON_HOST` / `RCON_PORT` / `RCON_PASSWORD` — from your current game host's RCON panel
   - `GAME_FILE_PROTOCOL` — `sftp` by default, or `ftp` for hosts that only provide plain FTP
   - `SFTP_HOST` / `SFTP_PORT` / `SFTP_USER` / `SFTP_PASSWORD` / `SFTP_BASE_PATH` — from your current game host's file access panel; these names are used for both SFTP and FTP
   - `COMMAND_BRIDGE_ENABLED` — keep `false` until the compatible mods and paths below are verified
   - `COMMAND_BRIDGE_SAVED_PATH` — defaults to `Mods/CommandBridge/Saved`, relative to `ue4ss`
   - `BODYDROP_BRIDGE_MODE` — `commandbridge` by default; `legacy` only for the custom HollowValleyBodyDrop schema
   - `BODYDROP_COOLDOWN_SECONDS` — defaults to `900` (15 minutes)
   - `BODYDROP_TYPES` — optional comma-separated drop definitions, e.g. `small:Small body:A small emergency food drop:Compsognathus:1`
   - Discord/Stripe vars if/when you use them
4. Deploy. Render builds the existing `Dockerfile` — no changes needed there,
   since the app already binds to `process.env.PORT`.
5. Verify the Render-provided `*.onrender.com` URL works: homepage loads,
   `/api/me` shows `steamLoginConfigured: true`, `/mydinos/` loads and can
   reach RCON/SFTP (same outbound network access as the droplet — Render
   just makes plain outbound TCP connections, so this should work
   unchanged).

## Cutover (do this once Render is verified working)

1. In your DNS provider (Cloudflare, since `CF-RAY` shows up in headers):
   update the `hollowvalley` CNAME/A record to point at the Render service
   instead of `170.64.237.78`.
2. In Render, add the custom domain `hollowvalley.herbydeathsquadgames.com`
   under the service's **Settings → Custom Domains** — Render issues its own
   TLS cert automatically once DNS resolves to it.
3. Update `STEAM_RETURN_URL`/`STEAM_REALM` if they weren't already set to the
   final domain (they should already match above).
4. Once DNS has propagated and the custom domain is confirmed working, you
   can stop the droplet's `docker compose` stack (or just leave it as a
   fallback for a few days before decommissioning the Droplet entirely).

## After migration

- Deploys happen automatically on every push to `master` (or manually via
  "Manual Deploy" in the Render dashboard) — no more SSH needed for routine
  updates.
- The SQLite DB lives on the Render persistent disk and survives deploys.
- If you still want a safety net, you can keep the droplet paused (not
  destroyed) for a couple of weeks before cancelling it, in case a rollback
  is ever needed.

## CommandBridge: DinoStorage and Body Drop

**Repository changes do not install mods or change a live game server.** Plan
any mod installation/restart separately during an approved maintenance window.
Do not blindly upload the reference Lua files to an online server.

Contracts inspected:

- [DinoStorage architecture](https://github.com/diplomatic-tendencies/evrima-dev-knowledge/blob/main/EVRIMA_DinoStorage_Architecture.md):
  `!store`/`!redeem` are **player chat hooks**, not RCON commands. The sender
  controller supplies Steam identity. Store saves state then schedules death;
  redeem transforms a naturally spawned same-species pawn.
- [BodyDrop architecture](https://github.com/diplomatic-tendencies/evrima-dev-knowledge/blob/main/EVRIMA_BodyDrop_Architecture.md):
  upstream BodyDrop accepts token-array commands through CommandBridge, not
  the old custom HollowValleyBodyDrop `action:"spawn"` object.
- [CommandBridge reference source](https://github.com/squeaky-joe/final-ancestor-bot/blob/306174b08332609adeb839391b912a4207ea813f/mods/CommandBridge/Scripts/main.lua),
  [DinoStorage implementation](https://github.com/squeaky-joe/final-ancestor-bot/blob/306174b08332609adeb839391b912a4207ea813f/mods/DinoStorage/Scripts/main.lua),
  and [BodyDrop implementation](https://github.com/squeaky-joe/final-ancestor-bot/blob/306174b08332609adeb839391b912a4207ea813f/mods/BodyDrop/Scripts/main.lua)
  define the concrete IPC contract used here. A mod with the same name is not
  sufficient: verify the installed version supports this schema and results.

The old website sent literal `!store` via the generic Source RCON library,
omitted player identity by default, and treated any reply as success. Evrima's
working status reader (`server/rcon.js`) uses a different binary RCON protocol.
Neither transport impersonates a player chat sender. The website no longer
uses raw RCON for DinoStorage, and `DINOSTORAGE_RCON_PREFIX`,
`DINOSTORAGE_STORE_COMMAND`, and `DINOSTORAGE_REDEEM_COMMAND` are unused.

### Wire contract and acknowledgement limits

The website appends one complete line to `CommandBridge/Saved/commands.ndjson`
using FTP `APPE` or SFTP append. It never rewrites the live queue or creates
missing mod directory trees. Examples (IDs are illustrative; real IDs are UUIDs):

```jsonl
{"id":"request-1","ts":1789480800,"verb":"dino_store","steam":"76561198000000000","args":{"args":["default"]}}
{"id":"request-2","ts":1789480800,"verb":"dino_retrieve","steam":"76561198000000000","args":{"args":["default"]}}
{"id":"request-3","ts":1789480800,"verb":"bd","steam":"76561198000000000","args":{"args":["spawn","Dryosaurus","12.5","-9","44","0.75","76561198000000000"]}}
```

CommandBridge routes `dino_store`/`dino_retrieve` into
`Mods/DinoStorage/Saved/cmd.flag` as `[id] store <steam> default` or
`[id] retrieve <steam> default`. `bd` routes to
`Mods/BodyDrop/Saved/inbox.ndjson` with a top-level `args` token array.
BodyDrop gets raw Unreal coordinates and the requesting Steam as the last
token, so the compatible mod resolves the player's current location itself.
Growth is a fraction, not a percentage.

All responses append to `Mods/CommandBridge/Saved/results.ndjson`. The first
reply may be a routing ACK (`ok:true,msg:"queued"`, no `source`), not completion.
The website ignores positive routing ACKs and waits for the same `id`, `steam`,
and `source:"DinoStorage"` or `source:"BodyDrop"`. Routing rejection or a
sub-mod `ok:false` is surfaced as failure; duplicate ACKs cannot become success.
This is the default `DINOSTORAGE_RESULT_MODE=submod` policy. DinoStorage alone
has the opt-in routing-ACK compatibility mode described below; BodyDrop always
waits for its sub-mod result.
Partial final lines are deferred; malformed complete lines fail explicitly.
Result reads are bounded at 8 MiB; archive/rotate larger logs with the bridge
stopped, never delete active queues/results while requests are in flight.

**A DinoStorage result is not proof that the dino died or restoration finished.**
The reference stores state, emits success, then later calls `SetHealth(0)` in
a protected Lua callback. Retrieval also acknowledges before deferred apply.
The website cannot repair an engine/mod failure after that ACK. Verify the
per-slot file and in-game outcome; do not add a separate website kill, which
could kill before a durable snapshot exists. The reference requires 75% growth
to store and a live same-species pawn to retrieve. Its `!store` chat hook is
not enabled (the bot fork is IPC-only), unlike the architecture's chat lineage.

Only the mod's `default` slot is exposed here. The SQLite marketplace roster
is **not** the mod's `stored/<steam>/<slot>.json` index. Roster card Park/Redeem
actions are disabled instead of pretending to target a slot. Stored files
are not deleted automatically after retrieve: acknowledgement precedes actual
restore, so deleting then risks losing the only recoverable state.

**A BodyDrop sub-mod result means the mod reports spawn success**, not that a
player necessarily sees a safe edible body. The reference fork still uses
blind `Z + 1500` and `bAlwaysRelevant=true`. The newer architecture explicitly
replaces those with ground tracing/water rejection and normal relevancy:
older builds can put bodies below terrain or cause client load-in crashes.
Review/fix the installed Lua separately; this website does not patch it.

After an attempted write, transfer ambiguity, read failure, or result timeout
returns HTTP 202 with `queued:true,confirmed:false`, a request ID and an
explicit **do not retry** message. The job may already be executing. Body Drop
stays locked; a player saying "nothing spawned" cannot clear a live command.
There is no background late-result watcher: an operator must reconcile a late
result and queued database record. DinoStorage callers must likewise keep
the request ID and avoid a second store/retrieve until reconciliation.
Append and Lua rename/read/delete polling do not provide exactly-once delivery.

### DinoStorage v002 routing-ACK compatibility

The pinned `306174b` v002 source already accepts
`[id] store <steam> default` / `[id] retrieve <steam> default` in `cmd.flag`
and emits `source:"DinoStorage"` with the same ID and Steam. Thus an ACK-only
live response does **not** establish a v002 format mismatch. Without the
installed files/logs, the missing result's exact cause remains unconfirmed.

For an operator-approved compatibility deployment, set this **Render**
environment variable:

```text
DINOSTORAGE_RESULT_MODE=bridge_ack
```

The default remains `submod` when unset. Unknown modes fail before uploading.
In `bridge_ack` mode a matching positive CommandBridge routing ACK returns
immediately as **HTTP 202**, with `ok:false`, `accepted:true`, `queued:true`,
`acknowledged:true`, `confirmed:false`, `source:"CommandBridge"` and the
request ID. `accepted` means only CommandBridge accepted/routed the command,
not that DinoStorage stored it. This avoids reporting a missing sub-mod result
as a timeout when routing acceptance is all this mode is intended to await.
It does not repair a stalled consumer or missing result writer. A matching
sub-mod result already present in the same read takes precedence, including
rejection. Routing rejection remains an error. ACKs with a different UUID,
Steam or verb, and unrelated sub-mod sources, cannot acknowledge this request.
BodyDrop and strict DinoStorage behavior are unchanged.

Every DinoStorage service result has `completionConfirmed:false`, including
positive sub-mod results, because v002 emits its result before the deferred
kill/restore. No file deletion, separate kill command, flag rewrite or
automatic retry is performed.

**Reconcile the existing request before retrying**, even after enabling this
mode. The setting does not cancel the prior command or make retrying safe.
At the same active game instance, follow its exact UUID:

1. CommandBridge's positive ACK confirms its `appendLine` to
   `Mods/DinoStorage/Saved/cmd.flag` returned success. Check that this path is
   also the one the loaded DinoStorage uses, not another mod tree.
2. v002 polls every 3 seconds, renames `cmd.flag` to `cmd.flag.processing`,
   reads/processes that file, then removes it. Inspect both files without
   rewriting them. Do not interpret a missing flag as success or failure.
   The reference removes an old `.processing` file before the next rename;
   do not restart/reload merely to retry, as that can discard evidence.
3. Inspect `[DinoStorage]` startup/poll errors (`safeCall(pollCmdFlag) failed`)
   and the actual `Mods/CommandBridge/Saved/results.ndjson` output. An exception
   before `emitResult`, an unwritable results path, or a different working
   directory can explain a routing ACK with no matching sub-mod result.
4. Compare `stored/<steam>/default.json` and in-game state. Storage success
   schedules a kill about 3 seconds later; retrieval requires a live same-species
   pawn and also defers its mutations. These engine outcomes need separate
   verification. Do not infer them from the ACK or from flag consumption.

No production setting or game file is changed by this repository patch.

### Exact Render configuration (apply only when approved)

Keep the feature disabled until the compatible mod installation is verified:

```text
COMMAND_BRIDGE_ENABLED=false
COMMAND_BRIDGE_SAVED_PATH=Mods/CommandBridge/Saved
COMMAND_BRIDGE_TIMEOUT_MS=20000
DINOSTORAGE_RESULT_MODE=submod
BODYDROP_BRIDGE_MODE=commandbridge
GAME_FILE_PROTOCOL=ftp
FTP_SECURE=false
SFTP_BASE_PATH=/
```

Use `ftp` only for an FTP endpoint, `sftp` for SFTP/SSH. `FTP_SECURE=true`
enables explicit FTPS/TLS only when supported/required by the host. Set
`SFTP_HOST`, `SFTP_PORT`, `SFTP_USER`, `SFTP_PASSWORD` from the **file-access**
panel, not RCON. These variable names are used for both protocols.
RCON status settings remain separate and are still needed for live-player
location checks. Successful RCON status says nothing about FTP or mod health.

`SFTP_BASE_PATH=/` means `TheIsle` is directly at the file-access root, resolving:

```text
/TheIsle/Binaries/Win64/ue4ss/Mods/CommandBridge/Saved/commands.ndjson
/TheIsle/Binaries/Win64/ue4ss/Mods/CommandBridge/Saved/results.ndjson
```

If the visible root contains `games/isle/TheIsle`, set
`SFTP_BASE_PATH=/games/isle`. Alternatively set `COMMAND_BRIDGE_SAVED_PATH`
to the exact absolute FTP/SFTP-visible `.../CommandBridge/Saved` directory.
Do not copy a native Windows drive path or prefix a relative path with
`ue4ss/` again. Both command and result files must refer to the same active
game instance.

The reference Lua uses relative `Mods/...` paths. If its effective working
directory is `Win64`, those differ from a website destination under
`Win64/ue4ss/Mods`. Verify the actual paths on disk/logs; use an absolute
FTP-visible override or adjust the installed Lua's path configuration in
maintenance. Do not guess its working directory.

Confirm `CommandBridge`, `DinoStorage`, and `BodyDrop` are enabled via the
installed UE4SS mechanism (`mods.txt` or equivalent), their startup logs show
successful load/polling, and all three `Saved` folders exist and are writable.
The website needs append permission for commands and list/read permission for
results. After those checks, set `COMMAND_BRIDGE_ENABLED=true` on Render.
No shared secret is present in the documented CommandBridge job schema;
restrict file-access credentials. Never expose credentials in browser code
or shared logs.

### Live checks by failure stage

| Evidence | Check next |
| --- | --- |
| `configuration` error | Explicit enable flag, file-access protocol/port and resolved paths |
| `connect` error | FTP/SFTP authentication, host firewall/passive data connection, TLS mode |
| `read results preflight` error | Results directory/list/read permissions, malformed or oversized results log |
| `append command` ambiguity | Logged request ID in commands and `.processing`; do not send a duplicate |
| Upload but no routing ACK | Correct CommandBridge instance/path, enabled flag, polling loop and UE4SS errors |
| Routing `ok:false` | Its `msg`, especially missing/wrong `Mods/DinoStorage/Saved` or `Mods/BodyDrop/Saved` |
| ACK only, no matching `source` | Correct sub-mod version/IPC support, `cmd.flag` or BodyDrop inbox, `.processing` and sub-mod load errors |
| DinoStorage `ok:false` | Snapshot write permission, 75% growth, online live pawn, slot existence or same-species rule |
| DinoStorage `ok:true` but no death/restore | Saved `stored/<steam>/default.json`, deferred callback, pawn lookup and Lua setter errors; ACK precedes engine mutation |
| BodyDrop `ok:false` | Species/class lookup, game mode/world, player location and spawn failures in `msg` |
| BodyDrop reports spawned, no visible body | Installed ground-trace/replication implementation, terrain/water and actual location; website cannot fix an old Lua spawn recipe |

Correlate the exact UUID, Steam and source in `results.ndjson`. Do not treat a
positive CommandBridge `queued` ACK as either a stored dino or spawned corpse.
Preserve queue/result evidence when reconciling; absence from an inbox alone
does not prove failure. No credentials need to be shared to compare redacted
paths, log stages and matching result records.

### Legacy HollowValleyBodyDrop compatibility

Only set `BODYDROP_BRIDGE_MODE=legacy` if the installed **custom**
`HollowValleyBodyDrop` mod really accepts:

```json
{"id":42,"action":"spawn","species":"Compsognathus","growth":1,"x":123.4,"y":-567.8,"z":90.1,"steamId":"76561198000000000"}
```

That mode uses `BODYDROP_INBOX_PATH` (default
`Mods/HollowValleyBodyDrop/Saved/inbox.ndjson`, relative to `ue4ss`, or an
absolute FTP/SFTP path) and optional `BODYDROP_SHARED_SECRET` signing. Its
legacy Lua does not verify the signature and has no documented result
contract; upload remains unconfirmed/queued. These settings are ignored by
CommandBridge mode. Changing only the folder name does not translate schemas.

In either mode, `BODYDROP_TYPES` maps UI tiers to
`id:name:description:species:growth`. Defaults are Compsognathus, Dryosaurus
and Triceratops at growth 1. Verify those species exist in the installed mod's
catalog. `BODYDROP_COOLDOWN_SECONDS` defaults to 900.
