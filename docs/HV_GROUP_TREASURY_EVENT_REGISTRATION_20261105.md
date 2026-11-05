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

`GROUP_TREASURY_EVENT_ENABLED=0` defaults off on both website and automation, in addition to the general donation/spending gates. The existing Groups purchase controls now support reviewed group-event items when both service gates permit them. The catalog operator tool still refuses group-event activation pending host roster integration and rollout review. This remains local development, not a production release.

## Owner review and member history

Draft preparation fetches the authoritative event descriptor through the private accounting API and validates its full schema/fingerprint before saving it with the reviewed price and group. Membership/ownership is rechecked after the event read, and a changing owner cannot create a stale draft. The browser cannot supply or overwrite the event descriptor, actor identity or confirmation price. Confirmation requires the saved request's group and explicit consent, with origin, linked Steam and preview/read-only protections inherited from Treasury purchase routes.

The Groups review shows the saved event name, start/end time and a link derived from the verified Discord guild/event IDs. It explains that group registration does not confirm individual attendance or rewards. Unknown end times remain unset. Event and group names are rendered as text. A changed event leaves the original request pending for cancellation rather than replacing the reviewed schedule; rescheduled receipts cannot be accepted as the original purchase.

Confirmation forwards only the saved descriptor to accounting. Reserved/committed replies must return that same descriptor, or the local request remains pending until matching status is read. A release-before-reserve tombstone may have no event descriptor; it cannot create a registration or debit. Lost reservation/commit replies recover under the same immutable request. A successor owner can resolve an uncommitted request; former owners cannot manage or redirect it.

Current group members can read up to 50 verified registrations through `GET /api/group-treasury/event-registrations`, scoped to their current website group rather than a caller-supplied group ID. The website checks membership before and after the remote read and strips actor identities. Responses are private/no-store. The Groups panel loads registration history independently from catalog availability, labels an unavailable history as unverified and clears private data when session/group context changes. Paused purchases retain history and existing-request recovery.

Before accepting real group event purchases:

- Add host registration roster controls and reviewed operator activation. The owner review/consent and private member history are implemented locally.
- Verify the deployed trusted producer's explicit event lifecycle status, cancellation/removal behavior, guild identity and freshness.
- Approve actual prices and fee policy; registration does not currently impose a general event participation fee.
- Verify authenticated staging, concurrent/restart recovery, privacy, backups and hosted checks. Obtain separate publication/merge/deployment approval where required.

## Local evidence

Twelve accounting/descriptor tests use synthetic coins, the real event normalizer/cache, temporary economy databases and real private HTTP routes. They cover scheduled/unknown/hidden/stale/future-clock status, immutable event review, descriptor fingerprints/schema, atomic charge/registration, reschedule/start/rename rejection, failed-audit rollback, duplicate benefits, missing receipt evidence, paused rollout, independent commit/cancellation processes, token protection and lost commit replies.

Nine website HTTP tests cover owner consent, forged fields, changed schedules before/after reservation, lost commit replies, receipt mismatches, private member history, delayed-read membership changes, owner succession during commit/preview and paused rollout. The Groups browser fixture passes at 1440px and 390px for schedule review, lost-reply recovery, reschedule rejection/cancellation, member history, safe text, existing Territory/cosmetic flows and session loss. Existing event-feed regressions pass. These checks do not prove live producer behavior, unfinished host controls or staging delivery.
