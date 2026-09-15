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
   - `BODYDROP_SHARED_SECRET` — a new long random shared secret that must also be configured in the BodyDrop agent/mod
   - `BODYDROP_INBOX_PATH` — defaults to `Mods/HollowValleyBodyDrop/Saved/inbox.ndjson`, matching the game-server `config.lua`
   - `BODYDROP_COOLDOWN_SECONDS` — defaults to `900` (15 minutes)
   - `BODYDROP_TYPES` — optional comma-separated drop definitions, e.g. `small:Small body:A small emergency food drop`
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

## Body Drop bridge notes

The website stores Body Drop requests in SQLite, validates Steam login,
cooldowns, and that the player is currently spawned in-game (needed for
location), then appends a signed NDJSON job into the Qonzer mod inbox:

```text
TheIsle/Binaries/Win64/ue4ss/Mods/HollowValleyBodyDrop/Saved/inbox.ndjson
```

This matches the BodyDrop `config.lua` shape:

```lua
return {
  logDebug=true,
  inboxPath="Mods/HollowValleyBodyDrop/Saved/inbox.ndjson",
  ragdollSeconds=3600,
  maxJobsPerTick=5
}
```

The actual `main.lua` on the game server only processes inbox lines shaped
exactly like this (confirmed from the real mod source):

```json
{"id":"...","action":"spawn","species":"Compsognathus","growth":1,"x":123.4,"y":-567.8,"z":90.1,"steamId":"765..."}
```

Key points learned from `main.lua`:
- `action` **must** be `"spawn"` — any other value is silently ignored.
- `species` must exactly match a key in the mod's own `SPECIES` table
  (`Allosaurus`, `Beipiaosaurus`, `Carnotaurus`, `Ceratosaurus`,
  `Compsognathus`, `Deinosuchus`, `Diabloceratops`, `Dilophosaurus`,
  `Dryosaurus`, `Gallimimus`, `Herrerasaurus`, `Hypsilophodon`, `Maiasaura`,
  `Omniraptor`, `Pachycephalosaurus`, `Pteranodon`, `Stegosaurus`,
  `Tenontosaurus`, `Triceratops`, `Troodon`, `Tyrannosaurus`) — there is no
  generic "small/medium/large" concept on the mod side.
- `x`/`y`/`z` are required raw Unreal world units; the mod has no fallback
  spawn point, so the website looks up the requesting player's live RCON
  location and rejects the request with 400 if they aren't currently
  spawned in-game.
- `main.lua` does **not** verify any signature (its `config.lua` has no
  secret field) — the website still signs the payload for future-proofing,
  but it currently has no effect on the game-server side.
- A request remains locked while its database status is `pending` or `queued`;
  this prevents duplicate drops while the UE4SS mod consumes the inbox line.
- If VeryGames uses a different mod folder, set `BODYDROP_INBOX_PATH` to a path
  relative to `TheIsle/Binaries/Win64/ue4ss/` (for example
  `Mods/HollowValleyBodyDrop/Saved/inbox.ndjson`). Do not include `..` path
  segments.

The website's `BODYDROP_TYPES` env var maps each UI tier (small/medium/large,
or your own custom set) to one `species`/`growth` pair, since the mod itself
only understands species names. Defaults if unset:

- `small` → Compsognathus
- `medium` → Dryosaurus
- `large` → Triceratops

Override with a comma-separated list of `id:name:description:species:growth`,
e.g.:

```text
small:Small body:A small food drop.:Compsognathus:1,medium:Medium body:A mid-size drop.:Maiasaura:1,large:Large body:A big drop for a pack.:Tyrannosaurus:1
```

Do not expose `BODYDROP_SHARED_SECRET`, RCON passwords, or SFTP passwords in
browser JavaScript or screenshots.

## Moving the game server to VeryGames

The website code is host-agnostic. To point it at a new VeryGames Isle server,
update only the Render environment variables and reinstall the game-server mod
files on VeryGames:

1. In Render → `hollow-valley-site` → **Environment**, replace:
   - `RCON_HOST`
   - `RCON_PORT`
   - `RCON_PASSWORD`
   - `GAME_FILE_PROTOCOL` (`ftp` if VeryGames only gives FTP access, `sftp` if it gives SFTP)
   - `SFTP_HOST`
   - `SFTP_PORT`
   - `SFTP_USER`
   - `SFTP_PASSWORD`
   - `SFTP_BASE_PATH`
   - `FTP_SECURE` (`false` for standard FTP; `true` only if VeryGames says FTPS/TLS is required)
2. `SFTP_BASE_PATH` must be the folder prefix that contains
   `TheIsle/Binaries/Win64`. It is host-specific; do not reuse the old Qonzer
   value.
3. Reinstall or upload UE4SS on VeryGames, then upload:
   - `ue4ss/Mods/HollowValleyPark`
   - `ue4ss/Mods/HollowValleyBodyDrop`
4. Confirm `HollowValleyBodyDrop/Scripts/config.lua` uses:

```lua
inboxPath="ue4ss/Mods/HollowValleyBodyDrop/Saved/inbox.ndjson"
```

5. Restart the game server after changing UE4SS or any Lua mod file.

The file bridge intentionally has no hardcoded fallback host, username,
password, or base path. If a VeryGames value is missing, bridge actions fail
clearly instead of writing to the previous host by accident. The env var names
remain `SFTP_*` for backwards compatibility, but they are also used when
`GAME_FILE_PROTOCOL=ftp`.
