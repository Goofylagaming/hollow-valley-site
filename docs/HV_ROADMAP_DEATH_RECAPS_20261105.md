# Death recaps — roadmap #12

Initial local service reads up to 20 combat deaths belonging to the victim's Steam account, from the last 30 days. A provisional five-minute disclosure delay limits immediate tactical use. Production delay and live behavior require privacy review and staging validation.

The reader returns recorded attacker display name, event time and victim species when available. Historical schemas without victim species remain supported. Attacker Steam IDs and live positions are excluded. Attacker species, growth, death location, dinosaur age and continuous survival remain unknown because the current combat contract lacks sufficient evidence. Those fields need trusted event-time telemetry and conservative life association before delivery is complete.

The service defaults off through DEATH_RECAP_ENABLED. Local tests cover delayed disclosure, victim isolation, old and recent events, absent tables, historical species schema and unknown values. Account APIs, UI, opt-in/retention policy alignment and richer evidence remain pending. Roadmap #12 is Building / Testing and historical votes remain stored while freeing active slots.

Account reads are now wired through /api/death-recaps. The website derives victim identity from the authenticated Steam session and sends it over the internal bearer-authenticated Legacy route. Player responses are private/no-store. An isolated two-server test proves guest/unlinked rejection, forged query actor isolation, disclosure delay, internal authentication and disabled rollout. The browser page and richer event fields remain pending.

The /death-recaps page is linked from the profile and shows event time, recorded attacker name and victim species. Missing telemetry fields display Unknown. Refresh errors clear displayed records, and guest/disabled/empty states are explicit. Desktop/mobile fixtures verify safe text, long-name wrapping, read-only GET usage and error recovery. The provisional five-minute disclosure policy still needs privacy review and staging; richer trusted combat fields remain pending.

Combat ingestion accepts optional killerSpecies and victimGrowth from the authenticated event producer. Species uses the existing canonical registry; growth must be numeric zero through one. Additive killer_species and victim_growth columns preserve historical unknowns. Mixed-version retries retain the original event without enrichment or erasure, while contradictory known evidence is rejected. Recap reads project the stored values, including zero growth. Producers still need to emit these fields at event time. Death location, age and survival evidence remain pending.

Producer parsing now preserves the actor Dino species and explicit victim Growth value from LogTheIsleKillData kill lines. Natural-death lines retain the actor's victim species and growth. Existing game-chat-forwarder spreads these parsed fields into its queued combat payload. Parsing preserves zero growth and leaves malformed/out-of-range or missing values unknown. UTC/DST timestamp fixtures still pass. This is local producer code verification; deploying and observing live field delivery remains required.

Recorded combat location now flows from the kill-line at: X/Y suffix through optional eventLocation ingestion and immutable event_location storage into delayed owner recap reads. Coordinates must be finite numeric world units within the implementation bound; malformed fields remain absent at parsing or are rejected by ingestion. The UI labels these as Recorded combat location and converts to map shorthand. The exact actor/victim meaning of the log suffix remains unverified, so victim death location stays unknown. Tests cover zero/negative coordinates, contradictory retries, historical schema and desktop/mobile rendering. Live location semantics and the provisional disclosure policy remain release gates.

Recent recorded combat is now projected into each eligible recap. It includes at most ten prior events involving the same account within ten minutes before the death timestamp, excluding the recap event itself and events after it. The list returns event type and time, with no opponent IDs or positions. Its scope is the account's recorded combat window; association with one continuous dinosaur life remains unverified. The page renders the timeline and its empty state. Owner-isolation, event-window and desktop/mobile checks pass.

## Source and current-account correction — 6 November 2026

Local review found that the recap and recent-combat queries did not require the
configured combat source. Both now filter by COMBAT_FEED_SOURCE (the existing
hollow-valley-game default); imported/manual/other-source rows cannot enter a
recap or its timeline. A historical table without a source column is withheld
with an unavailable response, rather than silently attributing its records to the
current source. No rows are migrated, enriched or deleted. One captured clock
sets the disclosure/retention window. Canonical species, bounded numeric growth
and a bounded x/y-only coordinate projection keep malformed optional stored
evidence unknown; malformed location JSON cannot break every recap.

The website verifies the authenticated account against its current user row and
requires X-Death-Recap-Actor to match that identity. Actor/query overrides are
rejected. After the asynchronous source read, account identity and rollout are
checked again before any private payload is returned. The source bearer route
also rejects extra body/query fields. Responses remain private/no-store.
Disabled source requests return before opening or initializing Legacy storage.
Both environment examples now explicitly keep DEATH_RECAP_ENABLED=0; no actual
environment settings were changed.

The page reads fresh /api/me before and after each recap read, verifies the
response binding, stages content before display and discards late replies after
view changes. Hidden/focused pages and failed account checks clear private data.
Two-minute expiry clears the displayed view without fetching source observations;
only account verification runs periodically. Refresh is explicit, with no
browser storage or background recap polling.

All 46 affected local tests pass across recap service/HTTP, combat ingestion,
combat calendar/death suppression, bearer authentication, log parsing, roadmap
and production-page regressions. The isolated-page desktop 1440px/phone 390px
browser fixture now uses the actual website/source routes and SQLite evidence,
with synthetic authenticated users and a small shared-helper stub. It passes
source exclusion, recorded/unknown fields, safe text, relinking while a source
reply is held, session switching before display, empty/error recovery, guest/
disabled views and expiry without recap polling. Visibility/focus checks exercise
the page event contract explicitly because headless tabs do not reliably become
hidden; they are not an OS/session integration result. The phone screenshot was
visually inspected. No browser storage or mutation API requests occur. Local
runtime is Node 24.22 and Edge. The dedicated hosted workflow has not run for
this unpublished candidate.

Roadmap #12 stays Working on (homepage asset v164). The existing provisional
disclosure delay, live producer delivery, location semantics, life/age/survival
evidence, authenticated staging and production verification remain unfinished.
