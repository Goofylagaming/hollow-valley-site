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
   - `RCON_HOST` / `RCON_PORT` / `RCON_PASSWORD` — same values currently on the droplet
   - `SFTP_HOST` / `SFTP_PORT` / `SFTP_USER` / `SFTP_PASSWORD` / `SFTP_BASE_PATH` — same values currently on the droplet
   - `BODYDROP_SHARED_SECRET` — a new long random shared secret that must also be configured in the Qonzer BodyDrop agent/mod
   - `BODYDROP_INBOX_PATH` — defaults to `Mods/HollowValleyBodyDrop/Saved/inbox.ndjson`, matching the Qonzer `config.lua`
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

The website stores Body Drop requests in SQLite, validates Steam login and
cooldowns, then appends a signed NDJSON request into the Qonzer mod inbox:

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

The Qonzer-side `HollowValleyBodyDrop` mod/agent should read those requests,
verify the `signature` with the same `BODYDROP_SHARED_SECRET` if it supports
signature checking, perform the in-game drop, and log/write its own result.

Do not expose `BODYDROP_SHARED_SECRET`, RCON passwords, or SFTP passwords in
browser JavaScript or screenshots.
