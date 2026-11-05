# Treasury Territory entry delivery — local adapter

`server/services/groupTreasuryTerritoryDelivery.js` implements the website-side registration effect for roadmap #17 using the existing `territory_event_registrations` and `territory_event_log` tables. It is now connected through the durable owner purchase coordinator and existing Groups purchase endpoints. The rollout defaults off. No live entries, catalog items, prices or coin movements were created while developing it.

## Identity and delivery

Website `hv_groups.id` is the Treasury account identity. Territory `territory_groups.id` is a separate registration identity; equal numbers must never imply a relationship. Preparation requires a current website owner, a currently valid explicit Headquarters Territory link, and that same owner's membership and leadership of the linked Territory group. The adapter freezes the website group, request ID, full reviewed item, cost, event ID, Territory group and link revision in an additive delivery record.

The accounting dependency must read the request through the trusted private accounting integration; browsers cannot supply reservation data. Preparation accepts only a matching `reserved` Territory-entry request. Delivery accepts only that saved item in accounting state `fulfilling`, after the future coordinator has recorded dispatch. Both operations recheck current website ownership after the remote read. Delivery checks the exact frozen link and its revision again inside the registration transaction. Unlinking and relinking the same Territory group does not silently approve the old request.

Both preparation and delivery require an open scheduled/live/paused event, and controlled live-test events enforce their existing group allowlist. A group closure gate blocks entry; a pending delivery blocks closing the group. Resolved delivery records retain financial activity, so closure must still check accounting rather than assuming that a local cancellation released a remote hold.

Delivery commits the actual registration, Territory registration log, immutable final outcome and delivery audit in one SQLite transaction. An audit or log failure rolls back all effects. A prior registration records `not_delivered / ALREADY_REGISTERED` without adding a paid registration, so existing free entry cannot become a second delivered paid benefit. The implementation does not change existing free registration behavior or impose an entry fee.

## Recovery

The saved outcome has a durable unique proof identity. Terminal reads and retries return that same outcome, including after restart or rollout pause; they never repeat registration. Only the current website owner can manage/read this internal request. A successor owner can cancel a pending request without requiring the former owner's Territory leadership. Cancellation and delivery serialize under `BEGIN IMMEDIATE`; whichever wins records the sole final outcome. Cancellation during an accounting read prevents later registration. Cancellation after delivery returns `delivered`, without removing the registration or refunding coins.

The evidence object matches the internal accounting proof fields: proof ID, request, website group, cost, purpose, target event and delivered/not-delivered outcome. An unsigned object alone cannot settle accounting. `signedEvidence` reads the persisted outcome in a transaction, verifies its sole final audit, and checks a delivered registration's status and recorded actor before signing. It accepts no caller-supplied outcome. Only the current website owner can request this internal operation; it has no browser endpoint.

## Authenticated accounting connection

Both services use a dedicated server-only `GROUP_TREASURY_TERRITORY_PROOF_SECRET` of at least 32 bytes. Configure the same independently generated random value on the corresponding website and automation pair; never reuse the website API token or use the test fixture key. No live key has been configured by this change. Missing or mismatched keys fail closed. Preserve the key through recovery; replacing it prevents verification of older signed messages until the website reissues their persisted outcome with the matching current key. Do not log keys or send them to browsers.

HMAC-SHA256 covers a fixed protocol domain and a canonical exact field set, including the immutable proof ID, request, group, event, cost and outcome. Verification rejects extra fields, malformed values, unsupported purposes and altered signatures using constant-time comparison. The signed final receipt has no time expiry: it records a permanent outcome, binds a specific request and cannot be reused to settle another purchase. Accounting retains its existing unique proof identity and idempotent receipt checks.

The private website-token API now exposes `spend-dispatch-territory` and `spend-settle-territory`. Dispatch requires configured proof verification and supports only Territory entry. Settlement independently verifies the signed final outcome and checks the stored purchase identity, price and target, including terminal retries. A delivered outcome commits the held charge; a not-delivered outcome releases the accepted hold without a debit or refund. A verified accepted delivery can settle when new spending is paused. Missing, unsigned, altered or unverifiable evidence leaves the hold unresolved. Existing general commit/release APIs continue to ignore caller-supplied fulfillment proof.

The private dispatch and settlement endpoints remain internal service capabilities. The signing key is a service trust boundary; host operators and website server code with this key are trusted issuers. Browser users and possession of the separate private API token alone cannot forge outcome signatures. Retain the same permanent receipt during lost replies and restarts. Status checks never dispatch or register an entry; when a final local outcome already exists, they can finish its verified accounting settlement.

## Owner purchase coordinator

The existing Groups purchase flow supports a reviewed Territory entry item behind `GROUP_TREASURY_TERRITORY_ENABLED=0` on both services. Website availability additionally requires the existing `TERRITORY_WARS_ADMIN_TEST_ENABLED=1` runtime gate, both general Treasury rollout flags, the proof key and existing Territory tables. Historical tables alone cannot enable entry. Keep all rollout switches off until pricing, policy and staging review are complete. Controlled-test allowlists continue to apply.

Review stores the exact item revision/price, website group, linked Territory group and name, link revision, and target event/name. No coins are held yet. Explicit unchecked-by-default consent authorizes that saved request. Confirmation checks its accounting status before any reservation, prepares the frozen binding, records dispatch, registers the entry and settles its signed final outcome. Retries reuse the same immutable ID. The public response contains purchase/binding details without the signing key, signed evidence or actor Steam IDs.

A lost dispatch reply leaves the hold unresolved. Checking status does not create the entry; explicit finish can resume that same dispatched request. A lost settlement reply can recover the committed receipt without another registration or charge. If the local final outcome exists but accounting has not accepted it, status recovery can complete only that signed settlement. Pausing entry blocks new reservations/delivery while keeping final-outcome recovery and cancellation available.

Cancellation first persists a bound non-delivery record, including when it overtakes reservation or preparation, before contacting accounting. Late preparation returns that terminal outcome; late dispatch cannot deliver. If delivery already won, cancellation returns the delivered outcome and completes its accepted charge instead of revoking/refunding the registration. A successor website owner can cancel the saved request without assuming the former owner's Territory leadership. Former owners cannot manage it or receive its management response after authority changes.

The Groups review shows the saved Territory group and event and explains that cancellation retains held coins until non-delivery is verified. Cosmetic selection remains available independently. A changed link/event leaves the original request recoverable rather than redirecting it. Entry does not replace existing free registration or impose a general event fee; choosing the live fee policy remains a review requirement.

## Remaining integration

- Rehearse the implemented owner coordinator and database signing/settlement against authenticated staging. Keep unavailable-website requests and uncertain dispatched holds retained until the final outcome can be verified.
- Review actual entry prices and policy before activating an entry catalog. The operator tool permits reviewed Territory activation only with its dedicated rollout flag and proof key configured; group-event activation has its separate event gate and fresh scheduled-event checks.
- Verify the separate implemented group event-registration path and staff roster in authenticated staging; its local evidence is documented in HV_GROUP_TREASURY_EVENT_REGISTRATION_20261105.md. Individual Discord attendance remains separate.
- Review live prices/policy and rehearse authenticated staging, backups, failure recovery and hosted checks before separately approved production rollout.

## Local evidence

Eleven delivery tests use temporary website databases, synthetic accounting responses and the actual Territory registration schema. They cover the registration effect and log, request replay/reinitialization, dispatch requirement, owner/leader checks, frozen link revisions, ended/test events, prior free entry, failed-audit rollback, cancellation during a delayed read, disabled/missing accounting, group closure, membership loss during a read and independent delivery/cancellation processes.

Seven additional settlement tests use real local private HTTP routes, separate temporary website/economy databases and synthetic coins. They cover signed delivery-to-charge and cancellation-to-release, every signed field, wrong keys and tokens, ignored proof injection on older endpoints, missing local effect/audit, lost settlement replies, reissuing receipts from a fresh process, paused spending and prior free registration.

Ten owner-coordinator HTTP tests cover consent/authority, immutable review, lost dispatch/settlement replies, cancellation before preparation and during dispatch, owner succession, link/event changes, paused entry, parallel confirmations and dormant Territory runtime. The real Groups browser fixture passes at 1440px and 390px with saved target display, lost dispatch recovery, cancellation races and the existing cosmetic/member/session checks. This evidence uses synthetic prices and local accounts; live policy, authenticated staging and production remain unverified.
