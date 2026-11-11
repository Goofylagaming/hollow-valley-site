# Private player zone notifications

Scope: sanctuary enter/leave, mapped patrol entries, mapped migration entries.
Perfect diet was explicitly removed from this release's scope.

The automation service consumes the existing authenticated presence feed and fresh
RCON character snapshots, using Prime Tracker's Gateway geometry. It writes only
three new `player_milestone_*` tables. Existing Prime visits, wallets, dinosaur
storage and player records are unchanged. Before first schema creation a consistent
SQLite backup is made in `backups/before-player-milestones-v1.sqlite`, verified,
and never overwritten or automatically restored.

## Player experience

Signed-in players see private browser overlay toasts while the website is open.
Profile → Player notifications contains sanctuary/patrol/migration toggles,
unique mapped zones and total entries for the current observed dinosaur life.
Settings persist per Steam account; turning alerts off does not stop counters.
The website always selects the signed-in Steam ID. The automation endpoint uses
the existing private website token. Responses are not cached.

First observations establish a silent baseline. Initial occupied footprints count
as observed visits, not announced entrances. Changes require two consecutive
observations at least three seconds apart, with a one-minute alert cooldown per
category. Counts continue even when an alert is throttled. Duplicate and older
samples are ignored. Missing location and gaps over ten minutes re-baseline
silently; a disconnect is not a death. Notifications expire after two minutes,
retain at most 100 per player, and do not replay on first opening the site.
Cross-tab delivery uses a browser lock and account-scoped last-seen cursor.

Life resets use observed health <= 0 / explicit `isDead`, local combat death
evidence, species changes, adult-to-hatchling growth reset, or a changed optional
`dinosaurId`. Stable IDs must identify the saved dinosaur across reconnects, not
the connection or pawn object. Missing values never mean death. Without stable
IDs, an unobserved non-combat death followed by the same species at similar growth
cannot be distinguished reliably; the system does not pretend otherwise.

Map zones are static footprints, not proof of currently active migration/patrol
objectives. Brief visits between scanner samples can be missed. Changes take two
samples to confirm. This does not grant Prime, achievements, rewards or quests.

## Private in-game path

Command Bridge has no general notification verb. The existing RCON adapter has
`directMessage` (0x11, SteamID plus message), strict Steam ID validation, a 240
character limit, and per-action write gates. Delivery is implemented only through
that private path, never `announce`. It requires **both**
`PLAYER_MILESTONES_INGAME_ENABLED=true` and
`RCON_DIRECT_MESSAGE_WRITE_ENABLED=true`, valid RCON configuration, RCON not
disabled, plus the player's `inGame` preference (off by default).

Messages are durably claimed before transmission, combined per recipient, and
never automatically retried after a timeout. An uncertain send can be lost but
cannot be duplicated by a restart. The production rollout stays overlay-only
unless the private transport is independently verified; no new game-server mod
or RCON-wide write permissions are required.

`PLAYER_MILESTONES_ENABLED=false` stops new tracking/delivery without deleting
counters. Rollback code can ignore the additive tables; do not restore an older
database over player purchases or progress. Both services retain their existing
persistent disks. Deploy automation and website at the tested revision and verify
`/readyz`, private endpoint authentication, and published assets. No game-server
restart is needed.
