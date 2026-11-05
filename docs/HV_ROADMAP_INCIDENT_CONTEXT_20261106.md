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
