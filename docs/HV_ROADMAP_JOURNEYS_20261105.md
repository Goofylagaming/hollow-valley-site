# Private journey history — roadmap #11

Local implementation begins with `journeyStore` and its accepted Legacy snapshot integration. Collection requires both `JOURNEY_HISTORY_ENABLED=1` and a per-player opt-in. The rollout flag is off by default. There is no public endpoint or browser consent control yet, and no production data has been collected by this work.

Preferences use optimistic revisions. Deleting history also disables collection and preserves a consent cutoff so delayed samples cannot recreate it. Renewed opt-in begins a new collection epoch. Historical points are private to the supplied authenticated actor at the future API boundary; no cross-account list method exists.

Storage retains at most 10,000 points per player for up to 30 days, with at least 15 seconds between samples in a continuous life. Reads return at most 500 points and an exclusive timestamp cursor. Expired points are excluded from reads and pruned during accepted snapshots. When snapshots stop, physical cleanup waits for the next accepted snapshot; a separate scheduled cleanup remains necessary before rollout.

Only accepted Legacy snapshots feed collection. Life changes, gaps over two minutes and displacement above 40m/s break the route. Points represent observed samples, not exact distance or proof of death. Existing Legacy observation closure is deliberately not relabelled as death.

Local tests cover consent, deletion, late samples, account isolation, malformed/future/duplicate timestamps, route discontinuities and integration behind the rollout gate. Still required: bounded-read and storage-cap verification, stronger coordinate validation at the snapshot boundary, session-bound account APIs, consent/deletion UI, private map rendering, trustworthy death/event association, retention scheduling, staging and production verification. Discovery (#10) and recap (#12) remain separate incomplete requirements; no rewards or game commands are introduced.
