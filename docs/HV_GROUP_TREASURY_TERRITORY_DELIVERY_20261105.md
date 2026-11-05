# Treasury Territory entry delivery — local adapter

`server/services/groupTreasuryTerritoryDelivery.js` implements the website-side registration effect for roadmap #17 using the existing `territory_event_registrations` and `territory_event_log` tables. It is an internal adapter, disabled by default and not mounted to an HTTP route or browser control. No live entries, catalog items, prices or coin movements were created while developing it.

## Identity and delivery

Website `hv_groups.id` is the Treasury account identity. Territory `territory_groups.id` is a separate registration identity; equal numbers must never imply a relationship. Preparation requires a current website owner, a currently valid explicit Headquarters Territory link, and that same owner's membership and leadership of the linked Territory group. The adapter freezes the website group, request ID, full reviewed item, cost, event ID, Territory group and link revision in an additive delivery record.

The accounting dependency must read the request through the trusted private accounting integration; browsers cannot supply reservation data. Preparation accepts only a matching `reserved` Territory-entry request. Delivery accepts only that saved item in accounting state `fulfilling`, after the future coordinator has recorded dispatch. Both operations recheck current website ownership after the remote read. Delivery checks the exact frozen link and its revision again inside the registration transaction. Unlinking and relinking the same Territory group does not silently approve the old request.

Both preparation and delivery require an open scheduled/live/paused event, and controlled live-test events enforce their existing group allowlist. A group closure gate blocks entry; a pending delivery blocks closing the group. Resolved delivery records retain financial activity, so closure must still check accounting rather than assuming that a local cancellation released a remote hold.

Delivery commits the actual registration, Territory registration log, immutable final outcome and delivery audit in one SQLite transaction. An audit or log failure rolls back all effects. A prior registration records `not_delivered / ALREADY_REGISTERED` without adding a paid registration, so existing free entry cannot become a second delivered paid benefit. The implementation does not change existing free registration behavior or impose an entry fee.

## Recovery

The saved outcome has a durable unique proof identity. Terminal reads and retries return that same outcome, including after restart or rollout pause; they never repeat registration. Only the current website owner can manage/read this internal request. A successor owner can cancel a pending request without requiring the former owner's Territory leadership. Cancellation and delivery serialize under `BEGIN IMMEDIATE`; whichever wins records the sole final outcome. Cancellation during an accounting read prevents later registration. Cancellation after delivery returns `delivered`, without removing the registration or refunding coins.

The evidence object matches the internal accounting proof fields: proof ID, request, website group, cost, purpose, target event and delivered/not-delivered outcome. **The object is a local record, not independently authenticated accounting evidence.** Do not forward a browser-supplied copy to the accounting verifier.

## Remaining integration

- Connect a durable owner-authorized purchase coordinator to reservation, prepared binding, recorded dispatch and this delivery adapter.
- Implement the accounting service's authenticated verification/read of final website delivery evidence, including unavailable-website recovery. Keep uncertain dispatched holds retained until a verified final outcome exists.
- Add reviewed entry catalog activation and owner controls only after the full effect/charge/recovery path is connected. The operator tool currently rejects external-item activation.
- Implement a separate actual group event-registration path; the current Discord RSVP system records individual attendance and is not group paid registration.
- Review live prices/policy and rehearse authenticated staging, backups, failure recovery and hosted checks before separately approved production rollout.

## Local evidence

Eleven tests use temporary website databases, synthetic accounting responses and the actual Territory registration schema. They cover the registration effect and log, request replay/reinitialization, dispatch requirement, owner/leader checks, frozen link revisions, ended/test events, prior free entry, failed-audit rollback, cancellation during a delayed read, disabled/missing accounting, group closure, membership loss during a read and independent delivery/cancellation processes. They do not prove the remaining cross-service charge/evidence connection or staging behavior.
