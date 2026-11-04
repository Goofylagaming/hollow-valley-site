# HV-UX06 — Verified Server Activity and Event Results
Developed on 27 October 2026 AEST. **Not deployed.**

Parent branch chain:
UX01 PR #239 → UX02 #240 → UX03 #241 → UX04 #242 →
UX05 #243 → UX06 (this branch).

## Features built

- /activity — public read-only server-status freshness, 24/72/168-hour
  player activity and species trends, upcoming scheduled Discord events,
  and staff-published completed event results.
- /adminactivity — protected staff-only event result publishing. An admin
  must be signed into a website Steam account, submit from the same origin,
  provide a unique event key, completed event date, summary, optional
  winner display names and type PUBLISH. Duplicate result keys are
  rejected rather than creating duplicate public announcements.
- /api/community-activity — reads the existing automation-only server
  status cache and bounded presence and Discord event snapshots.
- /api/community-activity/pack-context — Steam-authenticated owner-specific
  website group count and own observed dinosaur species, without access
  to other players' species, exact coordinates or identities.
- /api/community-activity/event-results — safe public published results,
  no staff IDs or private notes.
- Additive hv_event_results_public table on the website's persistent
  SQLite disk. Historical rows are immutable through the UI.
- Builds on the existing Hollow Valley Groups, Pack Guide, Live Map and
  Events system without creating another game-side integration.

## Freshness and privacy guarantees

- "Online" and "Offline" require a configured, non-stale automation
  snapshot with a timestamp within 3 minutes. Older snapshots show
  "Status delayed"; this is NOT proof the Evrima game server is offline.
- Player activity is available only when the existing tracker has
  recorded one or more verified samples in the selected period.
  The panel shows sample counts and exact last-verified time.
- A sample older than 10 minutes is marked delayed. Histories show
  measured unique players, average concurrency, peak and aggregated
  species observation counts; no gaps are invented or backpaid.
- Server raw players, character locations, Steam IDs, individual
  playtime top players, trajectories, exact coordinates and admin data
  are not returned by the public activity API. All external data is
  whitelisted to bounded, aggregate fields.
- Discord event schedule freshness requires a valid sync timestamp
  at most 5 minutes old and a configured source. Delayed feeds show
  no events as verified upcoming.
- Staff event summaries are labelled **manual staff publication**.
  They are not evidence of verified in-game combat, automatic
  attendance, rewards, Valley Coin payments or payouts.

## Explicitly unsupported / future dependencies

- There is NO authoritative in-game party membership or full group
  species roster for Hollow Valley's website Groups. The pack panel
  can show website member count and the staff-published limit for the
  signed-in player's own dino, but MUST NOT call a party compliant.
- No direct RCON from the website; no invasive player tracking or
  public exact location display. Do not add a second CommandBridge
  publisher.
- No automatic event winner extraction or game-combat result feed.
  The separate admin attendance approval already governs approved
  attendance rewards; UX06 does not touch money or reward APIs.
- Real-time in-game pack verification would require a separate,
  expressly approved and privacy-tested game-side feed that reports
  authoritative party identity and current species and that is
  never disclosed to nonmembers.

## Verification and deployment

1. test/communityActivity.test.js checks guest/staff access, stale status,
   activity redaction, event sync freshness, own pack data scope, staff
   confirmation and duplicate publishing.
2. Isolated Chromium staging visits /activity on desktop/tablet/phone,
   confirms unconfigured sources never appear live, confirms admin
   /adminactivity is inaccessible to unauthenticated visitors.
3. Existing production-stability, membership, BodyDrop, Valley Legacy,
   Skin Studio, Territory Wars and Primalbound release suites must pass.
4. Reconcile parent PRs and parallel status, admin incidents,
   player reports and Discord progress PRs. No production merges until
   explicit approval, verified backups and dependency conflicts reviewed.
5. Activate the website features using the existing proven Render
   persistent disk; do not detach it or zero any live database.
6. Do not send a Discord #server-progress-and-updates post until the
   dedicated HerbyBot integration PR #236 is merged, configured and
   real delivery verified.
