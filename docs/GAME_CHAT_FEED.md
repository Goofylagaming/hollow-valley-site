# Admin game chat feed

The Operations page at `/adminoperations` shows recent player messages and a lag report filter. It is restricted by the website's existing admin session. The automation API requires `AUTOMATION_ADMIN_TOKEN` for reads and `PRESENCE_FEED_TOKEN` for game host ingestion. Only the most recent 500 messages are stored; the page shows the last 150. No RCON chat read is assumed.

Run `scripts/game-chat-forwarder.js` on the Windows game host under Node 22+. Hollow Valley's confirmed log is `C:\HollowValley\TheIsleServer\TheIsle\Saved\Logs\TheIsle.log`, which is the default path. Set these environment variables for its process:

- `CHAT_LOG_PATH`: optional override if the server is moved.
- `CHAT_FEED_URL`: `https://<automation-host>/api/chat-feed/messages`, or supply the existing `PRESENCE_FEED_URL` ending in `/api/presence-feed/snapshot` and the script will derive the chat endpoint on the same host.
- `PRESENCE_FEED_TOKEN`: the same secret configured for the existing BinaryLane presence feed on automation.
- `CHAT_LINE_PATTERN`: optional override for a changed log format. It must capture `(?<name>...)`, `(?<message>...)`, and `(?<channel>...)`.

The default parser is based on verified server lines for `[Global]` (`Joeyy: zurie hello`) and `[Spatial]` (`Goofy: test`), each with Unreal's timestamp/frame prefix, `[GROUP-...]`, player name, Steam ID, and message. Spatial maps to the reader's **Local** view; Global maps to **Global**. Steam IDs appear beside names on the admin page after the game host forwarder is updated; older messages have no ID. The group ID is not displayed. `proximity`/`nearby` also map to Local, `world`/`server` map to Global; unfamiliar labels appear under Unlabelled. If the log format changes, set the override rather than silently misclassifying messages.

Start with `node scripts/game-chat-forwarder.js`. Keep its process supervised on the game host. The page reports “Feed not connected” until the first batch arrives. The filter matches words such as lag, ping, rubberband, desync, stutter and freeze; it does not measure latency directly.

For a one-time check on the game host, run `Select-String -Path 'C:\HollowValley\TheIsleServer\TheIsle\Saved\Logs\TheIsle.log' -Pattern 'LogTheIsleChatData' | Select-Object -Last 3` in PowerShell. This confirms the log is still receiving chat before starting the forwarder.

Game chat is stored for the website Admin Hub only. The automation feed does not enqueue chat for Discord. If an older automation build already queued chat messages, the updated HerbyBot bridge consumes those old entries without sending them. Existing announcement and alert delivery to Discord remains active.
