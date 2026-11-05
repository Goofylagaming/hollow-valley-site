# Territory victory badge: evidence audit

Inspected the local achievements branch on 5 November 2026. This is a delivery
dependency for roadmap #2, with shared evidence requirements for #13 and #31.
It is not a completed victory badge or production verification.

## Local implementation progress

`territoryBattleProvenance` now persists a declaration record in the attack's
creation transaction. Runtime observations retain simulated evidence; manual
configuration/control/status changes disqualify an active attack. Controlled
testing is ineligible from declaration. Capture closes the record within its
existing transaction and forced capture is explicitly marked manual. Unknown
historical attacks cannot become eligible merely by receiving a later live tick.
Idempotent initialization and conflicting result checks preserve the first record.

The runtime now records registered fighters physically observed in the claim
zone on each usable live sample. Capture freezes winning participants in the
same transaction as the result. Side-switchers are excluded; subsequent lineup
changes or observations cannot extend a closed result. Unit tests cover restart,
rollback, replay, side switching and preview/manual exclusions. This foundation
does not yet export results, award victory badges or implement defensive victory
resolution. No automatic grants
consume its eligibility result yet. Runtime end-to-end winner attribution remains
to be implemented and tested; current tests cover store persistence/rollback,
source transitions and the existing HTTP/access-control/control-math regressions.

The automation receiver now exists at `/api/website/territory-results`, protected
by the existing website integration token. It accepts version 1 recorded-live
captures with positive event/attack IDs, ordered timestamps and 1–256 distinct
Steam identities. Results and winner rows commit together. Exact replays are
idempotent (roster ordering is irrelevant); changed identity, event, time or roster
for an existing attack returns 409 without modifying evidence. Unknown, simulated,
manual and defensive outcome formats are rejected.

Progression can now award Territory Victor from this received ledger, only to
frozen winners and without XP/currency. Receiver tests cover auth/disabled-token
gates, payload validation, immutable replay, account separation, failed multirow
insert rollback and retry. The website producer/outbox is not yet connected;
there is no production end-to-end delivery or defensive victory support yet.

## Existing behavior

- `server/routes/territoryWars.js` owns the website-side battle runtime and tables.
  `captureTerritory` writes `territory_attacks.outcome='capture'` and increments
  group wins. The same function serves automatic capture and admin force-capture.
- `contestPresence` supports both real automation positions and preview presence.
  Preview output has `simulated:true`; the capture record does not retain that
  distinction. A live final tick alone cannot prove earlier control was real.
- Admin control adjustment, force-capture, reset and challenger removal exist.
  Admin defence writes a resolved `defence` outcome. These are not independent
  proof of a played victory.
- `territory_event_lineups` and group membership are mutable current state.
  Existing outcomes do not freeze eligible Steam identities at resolution.
- `server/services/serverStatus.js#getState` removes retained positions and marks
  the server offline when the snapshot is stale. Preserve this existing boundary.
- `automation-platform/src/routes/websiteTerritoryFeedRoutes.js` accepts a
  website-authenticated Discord announcement, not a structured victory ledger.
  Do not reinterpret announcement text as achievement evidence.
- Progression achievements reside in the automation database, while authoritative
  Territory battle resolution resides in the website database. A local SQL join
  from progression cannot bridge those stores.

## Implementation requirements

1. Record battle provenance from activation onward. Persist preview/manual-control
   contamination; an eventual live tick must not erase it. Existing attacks with
   unknown provenance remain ineligible for automatic victory awards.
2. Freeze eligible participating Steam identities and winning side at resolution,
   in the same website transaction as the outcome. Use actual registered battle
   participation, not every current member of the winning group. Preserve evidence
   through later membership changes and event resets.
3. Store a stable outcome identifier, event/attack IDs, resolution timestamp,
   provenance and frozen winner roster. A replay must be identical; conflicting
   payloads must not overwrite a result. Keep preview/manual outcomes distinguishable
   and out of automatic badge grants.
4. Deliver eligible outcomes through a durable website outbox to a dedicated
   authenticated automation endpoint. Retries must not duplicate results. The
   endpoint must validate bounded identifiers, roster size, distinct valid Steam
   IDs, timestamp and immutable replay identity. Never accept player-supplied wins.
5. Evaluate the permanent badge from the received result ledger. Add no currency,
   XP, game command or retrospective awards from ambiguous historical group totals.
6. Test actual runtime capture through outbox delivery and profile unlock, including
   preview-to-live transitions, manual control, stale snapshots, replay conflicts,
   changed membership, failed delivery/retry, cancelled battles and nonparticipants.
   Rehearse against staging before production approval.

This work must include both attacker captures and defensible winner semantics for
defender victories. The current runtime's admin defence path is insufficient to
claim automatically verified defensive wins. Decide and test a real resolution
rule within the Territory feature before declaring the full victory badge complete.
