# Private player incident investigation — 6 November 2026

Roadmap item #25 remains Building / Testing. This branch adds an explicit,
read-only investigation to the existing admin incident page. It is not a complete
forensic archive and is not verified in authenticated staging or production.

## Implemented behavior

A linked current moderator supplies one exact 17-digit player Steam ID and an
approximate incident time. The query searches 15 minutes either side, capped at
the request-start clock. Times older than 90 days or more than 15 minutes in the
future are rejected. The UI accepts device-local time, converts it to canonical
UTC and displays results in Brisbane time.

The combined timeline includes exact selected-player matches from the newest
200 operator audits and 100 automation requests, and bounded recorded combat and
retained participant chat from the existing admin-token source. Chat searches
only its retained 500-message buffer; combat and chat each return at most 50
matches. The combined result returns at most 200 events in descending time order.
Source or output limits are disclosed. A missing match never proves an event did
not happen. Audit and request timestamps retain their existing created/updated
semantics; they do not establish when a game command took effect.

Source failures and malformed projections are independent: available sources
remain visible with explicit partial-source warnings; all unavailable sources
return a generic error. A valid empty source can still return an empty result.
Raw audit metadata/errors, game locations and structured third-party game IDs are
not forwarded. Participant chat is literal text with the existing credential and
control-character masking; ordinary quoted text can still contain player names
or other text and is not a comprehensive personal-data redactor.

## Access and lifecycle

New GET endpoints under /api/admin-incidents are player-context-capabilities and
player-context. The latter accepts only steamId and occurredAt query fields and
requires X-Incident-Reviewer bound to the current linked moderator. Both verify
current DB permissions; the investigation checks role, Steam binding, account and
rollout again after all source reads, including failed reads. Responses are
private/no-store. No schema, saved report, evidence snapshot, moderation decision,
wallet, command, notification or game state is changed.

The browser verifies fresh /api/me identity before and after private reads,
rejects stale results and clears private output on hiding, loss of visibility,
account change, permission loss or unverified access. Replacement accounts must
reload the page. Private results are held only in page memory and are not written
to localStorage/sessionStorage. The existing recent-audit table now uses the same
browser identity guard; its older API contract remains unchanged.

## Configuration

INCIDENT_PLAYER_CONTEXT_ENABLED=0 is the independent website default. Enabling
this new query does not require enabling website report-context preservation or
selecting a snapshot-retention duration/key. The automation service's existing
PLAYER_REPORT_CONTEXT_ENABLED source must separately be enabled and its admin
endpoint configured for chat/combat reads. With that source unavailable, available
audit/request records remain explicitly partial. No flag was enabled by this work.

## Verification and remaining work

50 affected local tests pass, including actual HTTP permission/binding checks,
read-only SQLite mode, immutable query/window selection, delayed permission/account
changes, invalid queries, bounds, source failures, projection and existing report
source contracts. The actual page, routes and in-memory database pass synthetic
browser fixtures at desktop 1440 and phone 390. They cover explicit-only source
reads, all four source types, literal HTML-like chat, no browser storage, partial
source/retry behavior, paused queries, hide, account switches and role revocation
while replies are pending. The phone result layout was visually checked. The new
CI workflow runs the affected tests and browser fixture.

Before rollout: review private-source access and text policy, rehearse on the
authenticated staging host with bounded synthetic records, verify source clocks
and retention/limit warnings, repeat account/role-switch checks, and inspect host
logs/cache behavior. Separate connection history, dinosaur-action and
marketplace-specific sources, complete historical search and report-linked
navigation remain unfinished. Real game-source semantics and hosted delivery are
unverified. Homepage release register v150 retains #25 in Building / Testing.
No push, merge, deployment, live flag, signing key or production data changed.

## Saved-report navigation (homepage v151)

The private report queue now links to /adminincidents#report=<opaque report ID>.
The fragment contains no Steam IDs, report text or incident time. On arrival the
page fetches current, minimal saved-report details behind the same linked-admin
binding and disabled-by-default rollout. This detail read loads no game sources.
It shows the saved participants and approximate time; the reported player is the
default selection when available, otherwise the reporter is selected. Staff must
explicitly choose Investigate saved report. The independent player/time search
is collapsed while reviewing a saved report, and linked results display directly
below the saved-report controls.

GET /api/admin-incidents/reports/:id returns only the ID, participants, saved time,
supported-window state and an opaque digest of those exact fields. Report text,
evidence links and moderation history are not returned. Missing saved incident
times and unsupported old/future times disable linked investigation without
substituting submission time or the current time. These metadata reads require
an exact X-Incident-Reviewer binding and accept no query overrides.

GET /api/admin-incidents/reports/:id/context accepts only a participant role and
the digest of displayed report fields. It resolves the Steam ID and time from the
saved report, rejects stale details before source calls, and rechecks the current
report after delayed source success or failure. Changed participants/time,
deleted reports, revoked admins, account changes and disabled rollout suppress
pending results. Description or review-status changes do not alter the relevant
participant/time binding. A returned result also binds the report ID/digest/role
so the page cannot label an independent player query as report-linked context.
This does not attach, preserve or save evidence; the separate preservation flow
and its still-pending production retention policy are unchanged.

81 distinct affected local tests pass across the incident and report workflows.
Actual HTTP checks cover minimal metadata, permissions/binding, read-only DB mode,
query overrides, exact saved fields and stale details. Service checks cover both
participant roles, missing participants/time, unsupported times, corrupt saved
fields and report edits/deletion during successful or failed source reads.
Desktop1440/phone390 browser fixtures follow the real private queue link, verify
metadata-only arrival, select either role, reject changed details before/during
reads, handle missing time and reporter-only reports, and clear held metadata
across account changes. Existing source-context and preservation browser fixtures
also pass at both sizes; moderation and saved-copy recovery remain intact. The
phone layout was visually checked and full participant IDs wrap outside the
selector. CI paths now cover the queue link and report schema dependencies.

Authenticated staging, real-source validation, connection/dinosaur-action/
marketplace-specific sources, and complete historical search remain unfinished.
The production retention decision and separately prepared publication candidates
are unchanged. No live flag, key, report data, push, merge or deployment changed.

## Optional official marketplace records (homepage v152)

A separate default-off source now reads official marketplace order timestamps
for the selected player and the same bounded incident window. Both website and
automation have INCIDENT_MARKETPLACE_CONTEXT_ENABLED=0 by default. The automation
GET /api/admin/incident-marketplace/context requires the admin token, accepts only
steamId and occurredAt, and receives the existing economy DB handle at startup.
Its source query does not initialize schema, seed a catalog, parse fulfillment
JSON, call a reconciler, purchase, refund, publish commands or touch wallets.

The source selects only order IDs and stored creation/update/fulfillment timestamp
fields, plus the current stored status for a latest-update entry. SQL scopes each
branch to the exact player/window and returns at most 51 rows; output is capped
at 50 and discloses truncation. SQLite UTC-second and canonical UTC-millisecond
timestamps are normalized without local timezone inference. Creation and
fulfillment-timestamp entries have status recorded; the latest stored status is
not retroactively applied to creation. Unknown statuses remain unknown. These
records neither verify in-game delivery nor reconstruct a full status history.
Peer-to-peer marketplace listings and trades are not included.

The website's fixed admin API client and strict projection bind the response to
the selected player/time, validate all IDs/kinds/statuses/windows, strip extra
fields and reject duplicate or oversized payloads. Marketplace errors/malformed
replies are marked partial without suppressing other available sources. A disabled
source is labelled disabled, not a successful empty history. Turning off its flag
while a reply is pending withholds those rows. The combined view still caps total
output at 200 and uses existing post-read account/permission/report checks.
No retained source order, wallet, report or evidence snapshot is changed.

90 distinct local checks pass across the report and incident workflows. Added
fixtures cover bounded exact-player SQL, UTC normalization, read-only DB mode,
no schema creation, no retroactive status inference, admin-token/private HTTP
reads, the real website API client, invalid projections and runtime disabling.
A two-service local HTTP test follows the website route through the real client
and admin-token source, with both DBs in query-only mode. Actual-page desktop1440
and phone390 fixtures render all three order timestamp types, disclose missing/
invalid/disabled sources, preserve other sources and confirm no DB writes. The
phone layout was visually checked. The existing linked-report, account-switch,
role-revocation and literal-chat browser flows continue to pass in that fixture.
CI now includes the source, client/integration tests and affected path triggers.

The user has separately selected saved report context retention of 90 days from
capture. That policy applies to explicitly preserved chat/combat context; the
marketplace timeline source adds no persistence or retention changes. See
HV_REPORT_CONTEXT_RETENTION_POLICY.md. Real-source semantics, authenticated
staging, connection/dinosaur-action sources, P2P marketplace records, complete
historical search and production delivery remain pending. No live flags, key,
production data, push, merge or deployment changed.

## Peer marketplace records (homepage v153)

A separate opt-in source now reads existing peer dinosaur-listing rows for the
selected player/time. INCIDENT_PEER_MARKETPLACE_CONTEXT_ENABLED defaults to 0 on
both website and automation. The admin-token endpoint is
GET /api/admin/incident-marketplace/peer-context; the fixed website client never
calls listing creation, purchase, escrow, cancellation, reconciliation, refunds,
wallet mutations or Command Bridge functions. The source receives the existing
economy DB handle and performs SELECT queries without new tracking, retention,
schema initialization or snapshot parsing.

The exact selected seller can receive creation, latest-update, recorded-sale and
recorded-cancellation markers. The current saved buyer receives latest-update
and recorded-sale markers only: the buyer's current association does not establish
involvement at listing creation/cancellation. Former reservations and cleared or
replaced buyers cannot be reconstructed from these rows. The response explicitly
sets currentBuyerAssociationOnly=true, complete=false and gameDeliveryVerified=false.
The other trader's identity, parked slots, dinosaur snapshot, purchase keys,
prices, errors and wallet data are not returned. Later current status is not
retroactively applied to creation/sale/cancellation timestamps; unknown states
remain unknown. These are stored markers, not confirmed game delivery.

Queries use the same 15-minute either-side window, capped at the request-start
clock, and the same supported incident-time bounds. At most 51 matching rows are
read for a 50-event output cap, with explicit truncation. The website validates
scope, player/time/window, listing IDs, unique event keys, known kinds/statuses,
role restrictions and identity-withholding markers. Wrong-player or malformed
responses are withheld as a partial peer source. Disabled sources are labelled
separately, and a flag turned off during a pending read suppresses those rows.
The combined timeline remains capped at 200 and uses the same current-admin,
account and saved-report binding checks. The UI shows seller/buyer role and
listing reference and explains the incomplete current-buyer association.

99 distinct affected local tests pass. Added source fixtures cover seller/buyer
scoping, non-retroactive status, cleared/replaced buyer associations, counterparty/
slot/snapshot privacy, UTC normalization, bounded results, invalid/disabled queries,
missing schema and read-only DB mode. Actual token-protected HTTP/client checks
cover both roles, disabled and missing sources and no raw database errors. The
two-service integration test now includes real peer source reads through the
website route and admin client with both DBs query-only. Service tests suppress
bad attribution, oversized/duplicate rows, revoked admins, changed reports and a
source disabled during a pending response. Desktop1440/phone390 browser fixtures
render seller and buyer records, exclude seller creation markers from buyer
results, disclose missing former associations, withhold bad/unavailable replies,
and prevent disabled source calls. The phone layout was visually checked. The
existing linked-report and account/role-switch fixtures still pass. CI includes
the new source tests and path dependencies.

The connection-history audit found that player_presence_sessions timestamps are
written by polling/external-snapshot reconciliation. They are not durable exact
join/disconnect logs and were not promoted into verified connection events. A
trusted connection feed remains required. Dinosaur-action integration, full
reservation/status-transition history, complete historical search, real-source
semantics, authenticated staging and production delivery remain unfinished.
The approved 90-day saved-report context policy is unchanged. No live flags,
keys, player tracking, retained data, push, merge or deployment changed.
