# Territory survival challenge evidence — development

Roadmap #3 includes surviving a Territory battle. That requirement is not yet
implemented as a player achievement. This change hardens the prerequisite source
observations without inventing survival from a win, registration or current group.

## Current source evidence

`server/services/territoryBattleProvenance.js` freezes attack/event identity,
observed attacker/defender Steam identities and first/last observation times.
Eligible capture results are delivered through the existing immutable victory
outbox. Its v1 automation receiver retains attack/event IDs, start/resolution
times and winning Steam identities. That payload does not carry a character/life
identity or prove that a participant was alive at resolution; it does not provide
the complete set of battle outcome/participant combinations needed by this goal.

The website status cache previously marked snapshots stale on an error, but a
successful response containing old positions could still be reused as live.
Missing `checkedAt` also fell back to the website's current time. Territory
provenance recorded the runtime poll time rather than the source observation time.
Those behaviors cannot support a survival claim.

## Implemented freshness boundary

`liveSnapshotFreshness.observation` requires an actual timestamp, no producer stale
flag, no future date and an age of at most 120 seconds. Status polling preserves
the source's `checkedAt`; it never fabricates a fresh sample time on arrival.
Expired, missing/future or producer-stale observations cannot enter the fresh
saved cache. `getState()` reevaluates freshness even without another poll and
suppresses live player/position arrays when evidence expires. Display-only retained
data remains marked stale for its existing bounded window; it cannot feed battle
calculations. A verified offline report stays distinct from unavailable evidence.

Both Territory presence projections and control calculations independently require
that fresh source timestamp. Unknown tracking is displayed as unavailable with
progress paused, rather than as a verified offline game. The website still uses
automation only; no direct game connectivity, new game command or changed source
polling interval is introduced.

Runtime participants now retain the automation observation timestamp. Repeated
polls of the same snapshot do not advance first/last seen. Pre-declaration, future
or expired explicit sample times are ignored. A separate additive clock marker
distinguishes newly recorded timestamped observations from older/unstamped
history. Existing records are not retroactively upgraded, and an unstamped accepted
observation prevents a later one from upgrading that battle. This marker verifies
the accepted clock contract only: it does not prove full battle coverage, survival,
an eligible outcome or a game-character identity.

## Required survival integration

### Source identity and unknown telemetry audit

The inspected authenticated external intake (`normalizeExternalPlayers` in
`playerPresenceService.js`) and saved external snapshot carry Steam identity,
species, growth, vitals and location, but no stable game life/character ID.
Legacy creates its own UUID for an observed segment, splitting on disappearance,
species/growth reset or a long gap. That UUID does not establish an authoritative
game life, including an unobserved same-species respawn between samples. The
Territory survival requirement therefore still needs verified producer evidence;
neither Steam identity nor the Legacy UUID is promoted into a survival proof.

Intake now accepts only nonblank finite numeric strings or numbers for numeric
telemetry. Explicit null, blank strings, Booleans, arrays and objects stay unknown,
rather than coercing to zero or one. This also prevents invalid object coordinates
from becoming observations at the origin. Actual numeric zero remains valid.
An authenticated HTTP fixture checks intake, immutable retry, saved snapshot and
Legacy together: unknown growth followed by adult growth cannot create a juvenile
milestone; a genuinely observed zero followed by adult growth still can.

This correction does not repair previously accepted samples or retroactively
grant/revoke progress. A retry of a historical sample whose normalized payload
changes under this stricter conversion can conflict with its original hash; it
must not silently replace the original receipt or repeat its side effects.

91 affected checks pass after this correction, including authenticated intake,
challenge/Legacy/location evidence, existing paid quest rules, presence sessions
and roadmap/navigation preservation. The presence unit fixture now uses isolated
in-memory SQLite databases; its former open-file cleanup failed on Windows.
No new player interface is added. Homepage planning asset version is 111.

- Freeze the actual participant/side and authoritative life/character identity
  for the relevant real battle. Include the needed capture/defence and other
  participating-side outcomes; a winner-only roster is insufficient.
- Prove that the same life was observed alive at resolution, without a supported
  death, reset or unacceptable gap across the qualifying participation interval.
  Current membership, absence of a log alone or a newly spawned dinosaur cannot
  substitute for that evidence.
- Exclude manual, testing, simulated, side-switched and unsupported histories.
  Preserve original battle identity/outcome evidence and explicit source versions.
- Bind credit to the player's opt-in and challenge period. Deliver/import proofs
  idempotently, retain conflicting/unknown evidence for review and handle late
  death contradictions atomically. Never rewrite existing capture awards or
  historical battle records to manufacture a survival proof.
- Verify actual feed cadence, source clocks/identity, complete end-of-battle
  observations and authenticated staging before enabling a player goal. Existing
  valid captures remain distinct from this unfinished survival requirement.

No survival counter, coin reward, restore or automatic game action is installed
by this change. General and event/location challenge flags remain disabled in the
example configuration; no merge, deployment or real server change occurred.

## Local checks

220 affected checks pass across the existing challenge set and the expanded
freshness/Territory/status/map/community scope. Real runtime tests show expired,
future and timestamp-less online positions cannot mark live provenance or advance
the contest, while fresh observations still produce the existing valid capture.
Unit tests cover passive expiry, successful cached replies, missing/future/stale
times, offline distinction, recovery, original sample timestamps, old history and
outer transaction rollback. Existing delivery, manual/simulation exclusion,
private admin and group-history checks pass.

The actual public/admin Territory pages pass at 1440px and 390px for unavailable
tracking, verified offline, live counts and recovery. That browser fixture tests
presentation with synthetic API data; the separate runtime/private API tests
establish the backend boundary. No live authentication or production feed behavior
is claimed from these fixtures.
