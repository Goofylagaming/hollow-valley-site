# HerbyBot private player views — staged companion change

Adds `GET /api/herbybot/player-view/:discordId/:view` behind the existing
HerbyBot service-token middleware AND `HERBYBOT_PLAYER_VIEWS_ENABLED=true`.
Allowed views: player, wallet, quests (completed count), prime, dino.
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
testing. Rollback by disabling the flag. No schema migration or payout route is
introduced. This does not mark a public roadmap feature complete or publish a
release date: production has not received this change.
