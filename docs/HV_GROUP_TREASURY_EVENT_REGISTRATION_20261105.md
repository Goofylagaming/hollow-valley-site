# Group event registration — local accounting integration

Roadmap #17 includes group spending for event registration. This implementation adds the actual group-registration record to the authoritative automation economy database so registration, its audit and the group coin debit can commit together. It uses website group IDs, not Territory group IDs or individual Discord RSVP rows. No live catalog, prices, registrations or rewards have been configured.

## Event evidence and consent

The source is the existing trusted HerbyBot `discord:scheduled-events` snapshot in `automation_state`, read on the accounting transaction's own database connection. The cache must be fresh under `DISCORD_EVENTS_STALE_SECONDS`, have a valid guild/event identity and exactly one matching visible event, and carry an explicit `scheduled` lifecycle status. Events whose start time has arrived, hidden/removed events, unavailable/stale snapshots and active/completed/cancelled/unknown status cannot authorize a new group registration.

`discordEventService.normalizeEvent` now preserves recognized textual lifecycle states (`scheduled`, `active`, `completed`, `cancelled`); missing or unrecognized values become `unknown`. Older producer payloads remain readable for the existing event page, but they cannot authorize a paid group registration. The deployed producer must be verified to publish the explicit state before rollout; this change does not establish that live evidence.

Private `group-event-preview` returns a canonical event descriptor: ID, guild, title, start/end time and a SHA-256 revision fingerprint. A reservation must include that exact reviewed descriptor. The descriptor is retained in the spending request and cannot change on retry. Before committing, the current authoritative descriptor must still match it; rescheduling or renaming an event requires releasing the old request and reviewing a new one. Preview never holds or charges coins.

## Accounting and recovery

`createGroupEventRegistration` adds `economy_group_event_registrations` and its audit table. The existing Treasury spending service optionally mounts this registration adapter, while its established external-proof path remains available for historical/internal records. Runtime private Treasury APIs use the local registration adapter for new bound event requests. A new `event_json` column distinguishes these requests from older external-proof records.

A bound registration can commit only from a reservation, within the same `BEGIN IMMEDIATE` transaction as the group ledger debit, terminal spending receipt and spending audit. A failure in the registration audit, accounting audit, balance update or receipt rolls back the entire effect. Group/event identity and request identity are unique. The existing benefit reservation constraint also prevents buying the same event under another item ID.

The registration is the group's website entry record for the synced scheduled event. It does not RSVP individual members to Discord, confirm attendance, reward anyone, post messages, admit players to a game server or execute commands. Individual attendance and reward tables remain independent. Event-host consumption/display of group entries remains integration work before rollout.

Lost commit replies recover through the same request status/receipt. Repeated commits cannot add a registration or charge again. Cancellation racing commit either releases an uncommitted reservation or returns the existing committed purchase. It never refunds a completed registration. Pausing group event registration prevents new effects while preserving release and committed receipts. Historical receipts remain readable when the event is no longer in the current snapshot.

Receipt verification requires the matching registration, group ledger debit and registration audit. Missing or mismatched evidence fails closed rather than recreating a registration or charge. Private registration history uses committed spending records and validates their evidence, so a deleted registration cannot quietly appear as an empty history. History omits actor Steam IDs.

## Gates and remaining work

`GROUP_TREASURY_EVENT_ENABLED=0` defaults off in automation, in addition to the general donation/spending gates. The current website purchase controls still reject group-event items, and the catalog operator tool still refuses their activation. This backend integration is not a player-facing release.

Before accepting real group event purchases:

- Connect durable owner review/consent, event descriptors, group registration history and the existing purchase controls.
- Add reviewed operator activation only after the website flow and host registration roster are connected.
- Verify the deployed trusted producer's explicit event lifecycle status, cancellation/removal behavior, guild identity and freshness.
- Approve actual prices and fee policy; registration does not currently impose a general event participation fee.
- Verify authenticated staging, concurrent/restart recovery, privacy, backups and hosted checks. Obtain separate publication/merge/deployment approval where required.

## Local evidence

Eleven dedicated tests use synthetic coins, the real event normalizer/cache, temporary economy databases and real private HTTP routes. They cover scheduled/unknown/hidden/stale/future-clock status, immutable event review, atomic charge/registration, reschedule/start/rename rejection, failed-audit rollback, duplicate benefits, missing receipt evidence, paused rollout, independent commit/cancellation processes, token protection and lost commit replies. Existing event-feed regression tests also pass. These checks do not prove live producer behavior, the unfinished owner/host UI or staging delivery.
