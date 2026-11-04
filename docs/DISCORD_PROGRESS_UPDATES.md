# Hollow Valley — Discord server progress & updates

**Requested channel:** #server-progress-and-updates
**Discord channel ID:** 1550133934871023679
**Code milestone:** HV-C01 / Discord development log, staged in GitHub.

The channel is the designated public project changelog for Hollow Valley's
website and server work. Never include private Steam IDs, raw audit logs,
RCON credentials, player report evidence, Stripe data or internal secrets.

## Message stages and frequency

- In Development — meaningful milestone started.
- Testing — notable verification results or staging blockers.
- Blocked — dependency or regression preventing release.
- Ready to Deploy — reviewed but not in production.
- Live / Fix Released — only after the production revision passes readiness.

Automated Live posts happen once per successfully verified production GitHub
revision. Meaningful non-release updates can be sent by staff using the
manual GitHub Actions workflow. Avoid commit-by-commit spam.

Each post includes a milestone, status, short change summary and GitHub link.

## Delivery architecture

    GitHub Actions (verified master push or manual milestone)
      -> dedicated HTTPS progress ingestion token
      -> durable HerbyBot progress outbox
      -> existing HerbyBot Discord client
      -> channel 1550133934871023679

The website never holds Discord bot credentials. No new bot is created and
no game command, wallet or payment endpoint is involved. Existing
announcement, alert, territory and game-chat destinations are unchanged.

Authentication uses a dedicated token called HV_DISCORD_PROGRESS_TOKEN,
shared only between the automation Render service and a GitHub Actions
repository secret. The endpoint POST /api/progress-updates is disabled
when that token is missing and rejects invalid authorization. Payloads
accept a small fixed set of status values, validated repository links,
limited text and idempotency nonces. The existing outbox supplies
durable queueing, nonce dedupe, leases, retries and delivery acknowledgement;
HerbyBot disables Discord mentions.

An accepted API request means **queued**, not **delivered**. Only an
HerbyBot acknowledgement confirms Discord delivery.

## Activation checklist — not yet performed

1. Review and test the PR on a feature branch and staging first.
2. Ensure the live HerbyBot process uses the updated integration file
   automation-platform/integration/herbyBotBridge.js. It must keep its
   existing logged-in Discord client; do not start a second bot.
3. Set DISCORD_PROGRESS_CHANNEL_ID=1550133934871023679 on the HerbyBot
   host only. Give HerbyBot View Channel and Send Messages permissions.
   Keep the existing restrictions on ordinary members posting.
4. Generate a new long random token. Set HV_DISCORD_PROGRESS_TOKEN
   on the Render automation service, and the matching value as a
   GitHub Actions repository secret with that exact name.
   Never share the token in chat, logs, GitHub files or screenshots.
5. After review and explicit production approval, merge the PR.
   Allow coordinated automatic website/automation deployment.
   Do not trigger a redundant manual deploy or detach live disks.
6. From GitHub Actions, manually run Hollow Valley Discord Progress
   Updates with a safe Testing milestone referencing a PR. Confirm
   one post in channel 1550133934871023679 and a delivered outbox event.
7. Test duplicate suppression and verify the existing announcement
   and alert channels still route independently.
8. Use the automatic Live notifications for subsequent verified
   releases. Failed readiness checks must never report a change as live.

If the GitHub secret is absent, the workflow skips posting and logs
an informational notice. If the automation token is absent, ingestion
returns 503 and queues nothing.

## Example future progress update (not posted)

Status: Testing
Milestone: HV-W01.1
Area: Hollow Valley Project
Changes: Public read-only status page committed in a draft PR; staging
and browser checks still required before production release.
GitHub: https://github.com/Goofylagaming/hollow-valley-site/pull/233

The live channel must not be described as connected until the
activation test proves HerbyBot delivered a real message.
