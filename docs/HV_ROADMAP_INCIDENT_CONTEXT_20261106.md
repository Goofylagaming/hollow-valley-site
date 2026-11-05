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
