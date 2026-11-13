# HerbyBot private player views — staged companion change

Adds `GET /api/herbybot/player-view/:discordId/:view` behind the existing
HerbyBot service-token middleware AND `HERBYBOT_PLAYER_VIEWS_ENABLED=true`.
Allowed views: player, wallet, quests (active progress and completed count), prime, dino.
The server resolves the existing Discord-to-Steam link; responses are explicit
small DTOs, exclude identity/coordinates/raw data, and set `private, no-store`.
Progression reads use `sync: false` so viewing a profile does not award XP.

The service token is trusted to assert Discord identity, as with the existing
progression endpoint. The companion bot derives it from the authenticated
interaction, accepts no target-user argument, and gates calls to the configured
Hollow Valley guild. Never expose this token to a browser or third-party tenant.

Run `node --test automation-platform/test/herbyBotPlayerView.test.js
automation-platform/test/herbyBotStaffOverview.test.js` from the repo root.
Deploy to staging before production; enable only after linked/unlinked account
testing. Rollback by disabling the flag. No destructive schema migration.

Also provides `/api/herbybot/rewards/settle`: requires the existing bridge token,
`HERBYBOT_REWARDS_ENABLED=true`, a separately signed approval envelope, a configured
guild, distinct proposer/approver and an integer VC amount in range. Reuses the
existing wallet transaction ledger and immutable reward ID, so retries and
account relinks cannot pay twice. Bot revalidates the approver's Discord roles
before each attempt. The API trusts that signed bot assertion; signing keys must
remain server-side. No real-money billing is introduced. Run
`node --test automation-platform/test/herbyBotRewards.test.js` for real temporary
wallet tests covering duplicate, conflict, relink, disabled and tampered requests.

`HERBY_ADMIN_PROXY_ENABLED=true` enables the fixed `/herby-admin` proxy to the
configured private bot hostname in `HERBY_ADMIN_INTERNAL_URL`. All private views
remain protected by the bot dashboard's signed session/current role checks.
Encoded path escapes and methods other than GET/HEAD/POST are rejected. The
request limit is 16 KiB. Never set the upstream to a browser-provided address.
Run `node --test automation-platform/test/herbyBotAdminProxy.test.js`.

This does not mark a public roadmap feature complete or publish a release date
before production verification. See the companion bot's HERBYBOT_EXPANSION.md
for rollout, credentials, secret files, maintenance and rollback.
