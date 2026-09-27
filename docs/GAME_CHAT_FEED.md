# Admin game chat feed

The Operations page at `/adminoperations` shows recent player messages and a lag report filter. It is restricted by the website's existing admin session. The automation API requires `AUTOMATION_ADMIN_TOKEN` for reads and `PRESENCE_FEED_TOKEN` for game host ingestion. Only the most recent 500 messages are stored; the page shows the last 150. No RCON chat read is assumed.

Run `scripts/game-chat-forwarder.js` on the Windows game host under Node 22+ after confirming that the Evrima server actually writes chat messages to a local log. Set these environment variables for its process:

- `CHAT_LOG_PATH`: full path to the active server chat log.
- `CHAT_FEED_URL`: `https://<automation-host>/api/chat-feed/messages`.
- `PRESENCE_FEED_TOKEN`: the same secret configured for the existing BinaryLane presence feed on automation.
- `CHAT_LINE_PATTERN`: optional override for a changed log format. It must capture `(?<name>...)`, `(?<message>...)`, and `(?<channel>...)`.

The default parser is based on the verified server line `LogTheIsleChatData: [2026.09.27-10.55.27] [Global] [GROUP-1027772112] Joeyy [76561198449777255]: zurie hello`, preceded by Unreal's timestamp/frame prefix. It captures Global, the player name, and the message, ignoring the group ID and Steam ID. The channel capture also accepts other labels; confirm a real Local message to verify its exact label. `proximity`/`nearby` map to Local, `world`/`server` map to Global; unfamiliar labels appear under Unlabelled. If the log format changes, set the override rather than silently misclassifying messages.

Start with `node scripts/game-chat-forwarder.js`. Keep its process supervised on the game host. The page reports “Feed not connected” until the first batch arrives. The filter matches words such as lag, ping, rubberband, desync, stutter and freeze; it does not measure latency directly.

Lag reports are mirrored by default to Discord channel `1553542987928174642` using the existing HerbyBot process. The bot must have permission to send messages there. Set `DISCORD_GAME_CHAT_CHANNEL_ID` on that process to override the destination. Set `GAME_CHAT_DISCORD_MODE=all` on automation to mirror all chat, or `off` to disable the mirror; `lag` is the default. Messages use the durable HerbyBot outbox and suppress Discord mentions. Confirm that the target channel is private to admins before turning on the game log forwarder.
