# Hollow Valley integrated release — W01 + UX01–06
Integration date: 27 October 2026, Australia/Brisbane.
Status: STAGING BRANCH ONLY. Not live and not production-approved.

## Included draft feature branches
- UX01 #239 — grouped navigation, homepage and Help
- UX02 #240 — searchable rules, pack limits and admin publishing
- UX03 #241 — News & Patch Notes with gated verified releases
- UX04 #242 — private Steam-linked Support Hub and staff tickets
- UX05 #243 — Community directory, opt-in recruiting and Legacy nest links
- UX06 #244 — aggregate verified activity and staff event results
- W01.1 #233 — public website/game snapshot status page
- W01.2 #235 / W01.3 #237 — admin incident timeline and private player reports
- C01 #236 — existing HerbyBot progress queue for Discord channel 1550133934871023679

All upstream PRs remain drafts. This staging branch doesn't merge, close, supersede or deploy any PR.

## Integrated conflicts resolved
- Merged public/admin API routes and accessible grouped navigation; dedicated Wallet, Quests and Live Map links remain.
- Combined Homepage Player Hub, updates preview and freshness-safe Status card.
- Preserved 31 roadmap descriptions, suggestion form, votes and release register.
- Roadmap #25, #26 and #29 show Building / Testing; no false Live status.
- These three items are retired from NEW roadmap votes, but all historic votes are preserved and do not consume the three current selectable votes.
- Both /status and /reports have correct guest-facing layouts; /adminincidents and /adminreports are gated server-side.
- Dedicated progress queue uses existing HerbyBot; no bot token or direct Discord API on the website.
- No change to player wallets, subscriptions, DinoStorage, RCON, CommandBridge or production disks.

## Release gates — NOT YET PERFORMED
1. Run unified tests, GitHub workflows, production baseline comparison and isolated Chromium browser smoke.
2. Carry out Steam-linked player/admin staging tests (guest smoke alone isn't a complete authenticated QA).
3. Verify authoritative Render workspace, website and automation deploy services, active flags and disk mounts.
4. Backup and test restore of real production website/automation SQLite and WAL, supporter data, wallet ledger, user identities, game state and stored dinos.
5. Review upstream PRs and plan a coordinated, minimally disruptive deployment. Website master has autoDeploy enabled; merging is a production action.
6. Activate new support reports and policy publishing only with approved Hollow Valley rules, pack limits, trained moderators and confirmed permissions.
7. The progress channel 1550133934871023679 remains inactive until the separate HerbyBot token/channel configuration and a controlled real send/ack test.
8. Explicitly obtain production approval before any merge, Render deploy, flag/secret change, migration or Discord post.
9. Verify site and automation readiness/rollbacks after deployment and distinguish live release from in-development changes.

## Known external integrations still pending
- In-game authoritative party membership and per-player dinosaur species: website Groups are not an Evrima party source.
- Automatic hatch/mutation inheritance proofs, report-to-combat/chat log evidence correlation.
- Separate RCON, Discord, Steam, Marketplace and Live Map health probes; status page initially covers website process/readiness and game snapshot only.
- Official staff policy text, approved group restrictions, and staffing the support moderation queues.
- The full set of 31 game-mechanics roadmap concepts goes beyond the completed 6 website information-architecture milestones.

## Important development flags
- HV_SUPPORT_TICKETS_ENABLED is false by default.
- Player Reports submissions require PLAYER_REPORTS_ENABLED=true and are not enabled here.
- SITE_UPDATES_AUTO_RELEASE_ENABLED is false by default.
- The progress bot requires a separate long secret and DISCORD_PROGRESS_CHANNEL_ID on the existing HerbyBot host, not the website.

Tests: test/hvRoadmapIntegration.test.js, test/roadmapCommunity.test.js, test/statusPage.test.js, test/incidentTimeline.test.js, test/playerReports.test.js, test/discordProgressWorkflow.test.js, automation-platform/test/progressUpdates.test.js, the UX01–06 suites, and the existing production release regression suites.

Nothing in this branch itself posts to Discord, awards Valley Coins or changes gameplay state.
