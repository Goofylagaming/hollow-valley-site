# Subscriber area deployment (prepared only)

Two companion changes are required: `Goofylagaming/hds-dashboard` (HerbyBot)
and `Goofylagaming/hollow-valley-site` (website mapping), both on
`feature/discord-subscriber-area-20261105`.

1. Review and merge the draft PRs. Deploy HerbyBot from `main` and the website
   from `master` through their existing Render services. No bot credential belongs
   on the website. Keep `HERBYBOT_SUBSCRIBER_AREA_MODE=off` (the default) and
   `HERBYBOT_SUBSCRIBER_WRITES_ENABLED=0` (the default).
2. On the existing HerbyBot service only, set
   `HERBYBOT_SUBSCRIBER_AREA_MODE=dry-run`, leave writes disabled, and restart.
   Inspect `HV_SUBSCRIBERS` logs: eight create/update/no-op entries with exact
   overwrite bitfields. Resolve any fatal preflight conflict manually before retry.
   This uses the existing connected bot and guild 1540359454627725382.
3. Before a separately approved live run, ensure one HerbyBot instance is running,
   legacy `HERBYBOT_PERMISSION_CLEANUP` is unset, and the bot has Manage Channels
   and Manage Roles permission. Review staff role access in the dry-run report.
   Staff roles with Administrator, Manage Server, Manage Channels, Manage Messages,
   Moderate Members, Kick Members or Ban Members receive View Channel access.
   Existing permission flags are preserved. Unknown explicit View Channel grants
   stop the run for manual review; the reconciler never silently removes them.
4. To enable the one-shot live run later, set BOTH
   `HERBYBOT_SUBSCRIBER_AREA_MODE=apply` and
   `HERBYBOT_SUBSCRIBER_WRITES_ENABLED=1` on HerbyBot, then restart it.
   Do not use multiple bot replicas for this maintenance operation.
5. Verify the category, six text channels and voice channel in Discord with a
   subscriber, non-subscriber and moderator account. Restart in `dry-run` mode
   and verify eight no-ops. Return mode to `off` and writes to `0`.

No startup action occurs with default settings. Reconnects run at most once per
process. A failed/partial run is resumed by a deliberate restart after review;
fresh channel inventory prevents duplicate creation. No deletes, role creation,
channel renames or moves are implemented. Ambiguous names, wrong channel types,
misplaced names and unrelated category children stop the entire preflight.
Do not run another channel editor concurrently. Turning flags off stops future
runs; it does not delete created channels.

Website tiers always map to existing IDs:
- supporter -> Valley Member `1550695486464204810`
- guardian -> Valley Guardian `1550695581373042688`
- legend -> Valley Legend `1550695426456555551`

Old DISCORD_ROLE_*_ID overrides no longer change this fixed Hollow Valley mapping.
Existing membership-sync gates remain unchanged; this PR does not enable them.

Validation: `python -m unittest test_subscriber_area test_permission_cleanup` in
HerbyBot; `node --test test/discordMembership.test.js test/membershipDiscordQueue.test.js test/membershipEntitlements.test.js`
in the website. Tests use fakes/in-memory data, not live Discord.
