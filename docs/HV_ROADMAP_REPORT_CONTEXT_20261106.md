# Private report context — local source foundation, 6 November 2026

Roadmap #26 remains Building / Testing. Follow-up branch:
`feature/hv-roadmap-report-context-20261106`, based on status candidate
`e9fb72c4808a87079e47b3db86c6f67d710ee661`. The status branch/ref and its separate
publication approval scope are unchanged. This follow-up is not included in that
fixed candidate and has not been approved for publication.

The default-off automation `PLAYER_REPORT_CONTEXT_ENABLED` source reads recorded
combat/chat context for one reporter and an optional distinct reported player
within 15 minutes either side of the report's supplied approximate incident time.
A canonical explicit UTC timestamp is required; report creation time and current
time are never substituted. Reports may refer to the preceding 90 days; the
existing 15-minute future allowance is accepted as an approximate report time,
but source events after now are always excluded. Arbitrary widened windows,
extra filters, invalid participants and ambiguous clocks are rejected.

`GET /api/admin/combat/report-context` uses the existing automation admin token,
not the general website integration token. The response is private/no-store.
Disabled calls fail closed; a server-side fixed-path client method is ready.
There is no public or reporting-player endpoint for this data. This source alone
does not bind caller parameters to a saved website report: that authorization/
report-binding layer and its staff controls remain unfinished before exposure.

Combat reads select at most 51 rows involving the report participants in the
configured combat-feed source and time window. The response contains at most 50
source IDs/times and participant attacker/victim roles, with unrelated structured
identities, names, growth and locations omitted. Manual or other-source records
are excluded. Missing accused identity cannot match a null attacker or anonymous
chat. A match is an association to investigate, not a finding or a sanction.

Chat reads inspect at most the existing retained 500-message buffer and return
at most 50 matching participant/time records. The normal chat API retains its
150-message default; only the new internal call requests the larger bounded
buffer. Messages retain literal text for eventual safe text rendering. Control
characters and obvious credential-like strings are masked; redacted records carry
an explicit marker and digest of their original text. This masking is not a
comprehensive personal-data detector. Unstructured participant chat can mention
other people and must remain moderator-only. The source does not fetch evidence
links or images and does not send any chat/message.

Combat and chat source failures are independent, without raw errors. Each has
availability and truncation metadata. Overall completeness is always false;
retention limits and time/identity matching cannot establish a complete history
or prove a reported allegation. No attachment is persisted, no moderation decision
is automated, no existing report/review is modified, and no wallet/game action is
performed. No monitoring or report schema is added by the new source.

39 affected local tests pass. Coverage includes report/time/source isolation,
future-event exclusion, unrelated identity/location suppression, missing-accused
null handling, bounded results, partial sources, literal/credential-redacted text,
admin-token enforcement, disabled behavior, forbidden window expansion and actual
client-to-source HTTP reads. The end-to-end fixture queries SQLite in query_only
mode, guards queue/state mutators, checks unchanged total_changes and chat state,
and proves that context beyond the normal newest 150 chat rows remains available
inside the bounded 500-message retention. Existing report, chat, combat ingestion,
production UI and roadmap checks pass. Fixtures use synthetic local data only.

Homepage roadmap asset is v143. The new report-context workflow reproduces these
checks using isolated in-memory defaults. Remaining work includes current-admin
rechecks, saved-report identity/time binding, privacy-safe response validation,
staff display and account-switch/recovery tests, explicit retention/attachment
policy, real feed provenance/cadence, authenticated staging and production review.
No rollout flag, live report, source, database, player data, push, merge or deployment
was changed. The 31-feature objective remains incomplete.


## Saved-report-bound website reader — 6 November 2026

The website now has its own default-off PLAYER_REPORT_CONTEXT_ENABLED gate and
moderator-only context capabilities/read routes. The automation source gate is
separate. GET /api/reports/admin/:id/context takes only a saved report reference;
query overrides are rejected. Reporter identity, optional reported identity and
approximate time come exclusively from the report row. Missing or expired report
times return an explicit unavailable reason without substituting submission/current
time or querying a broader history. Context is never added to player /mine reads.

The current account ID/Steam binding and current users-table admin permission are
checked before a source request. X-Report-Reviewer must exactly match that current
binding. After the asynchronous read (including after a source failure), the
reader rechecks the request actor, current DB permission, rollout gate and saved
report participant/time fields. Revocation, changed binding, report mutation or
paused rollout suppress the response. These server checks do not independently
track a parallel browser session switch; the forthcoming interface must also
revalidate identity before displaying private responses and clear old context.

The source now identifies protocol version 1 and report-participant-context scope.
The website verifies them, the saved report time, exact bounded window start,
nonfuture window end, source availability/truncation, record limits, unique source
IDs, participant roles, timestamps and explicit associationOnly:true/complete:false.
A report without an accused player cannot receive an invented reported-player role.
Unknown extra fields are discarded. Invalid, duplicated, out-of-window, overclaimed
or digest-inconsistent responses fail closed with generic errors. Source exceptions
and raw provider payloads are not forwarded to the browser.

The projection contains only bounded combat role/time records and participant
chat context. Literal text is preserved for safe eventual rendering; obvious
credential-like patterns are masked again and marked redacted. An unredacted
source text must match its source digest; a redacted digest remains a source claim,
not proof the website inspected the original. The existing note about incomplete
personal-data masking still applies. No source attachment, decision, report edit,
review, wallet or game action is written by these reads.

48 affected local checks pass. New service/actual-route tests verify current DB
permission rather than a stale admin flag, exact reviewer headers, saved-only
source arguments, disabled/missing/old-time no-query behavior, held responses during
permission/account/report/flag changes, strict source projection, duplicate/window/
role/digest rejection, generic source errors and redaction marking. HTTP checks
prove private/no-store responses, no query override, no data on player /mine and
unchanged total_changes with query_only SQLite. Existing source, report, chat,
combat, production UI and roadmap checks still pass. Homepage is v144.

Staff display, fresh browser identity checks, held-response/account-switch and
retry/recovery browser fixtures, source attachment/retention policy, authenticated
staging and production verification remain unfinished. The original status branch
stays fixed at e9fb72c4 and has not acquired this follow-up. No live flag, source,
player report, moderation decision, push, merge or deployment changed.

## Staff context controls — 6 November 2026

The reports queue now offers an explicit Load recorded context button only when
the current linked moderator's context capability is enabled. It does not fetch
source records on page load or queue reload. Each report has its own hide control;
retrying replaces earlier results with a loading state and never leaves stale
chat visible after a failed source read. Missing report times, unavailable sources,
limited records and partial chat/combat coverage have explicit explanatory text.
The context panel always labels matches as context, not proof, and the history as
incomplete. Chat uses textContent, so supplied HTML is literal text, and masked
text is labelled. No attachment or moderation decision is created by loading it.

A page-local identity guard uses fresh no-store /api/me reads rather than the
shared helper's cached/fallback identity. It checks before and after context and
queue reads and review actions. Switched/revoked/unknown identities clear private
context and the queue, hide controls and require a page reload. Focus/visibility
changes hide private content and clear context until current access is verified;
periodic visible-page identity checks detect otherwise unannounced changes.
Delayed context/list replies are guarded by actor identity and request generation.
Abort controllers prevent hidden/replaced context reads from repopulating panels.

Existing review controls remain available. The updated UI sends a reviewer-binding
header, and the review endpoint rejects a provided mismatched binding before any
write. This preserves older clients that do not send the optional header; it does
not claim to retrofit bound reviews onto old cached pages. The browser validates
identity again after uncertain or failed responses and does not automatically
repost a review. Normal review saves still use the existing status/history service.

48 affected local checks pass, along with actual-page desktop1440/phone390 browser
fixtures. Browser coverage includes no automatic context reads, literal chat,
source/truncation warnings, hide, source failure and explicit retry, partial source
results, missing-time no-query behavior, held source replies during account switch
and permission revocation, identity endpoint failure, held queue replies, disabled
controls and unchanged review writes. A review prepared before an account-cookie
switch is rejected with no new review record; a normal explicit synthetic review
saves once and queue refresh does not reload context. Tests use the real website
routes, DB permissions, response projection and bound headers with synthetic source
records, not a real Steam session or production feed.

The phone panel was visually inspected and both layouts have no horizontal
overflow. A reports-page footer width override fixes overflow from its existing
rail margin, and the duplicate body tag was removed. Review/context controls have
readable 16px input/button sizing. Admin reports script is v2, its context guard
v1, reports CSS v2 and homepage roadmap v145. The workflow includes the new browser
fixture. No live report, flag, source, moderator action, push, merge or deployment
changed. Status publication candidate e9fb72c4 remains fixed.

Persistent attachment/retention rules, broader historical coverage, real source
provenance, authenticated staging and production verification remain open. These
controls show read-only retained context; they do not automatically preserve it
on a report or complete the original #26/full-roadmap goal.

## Reviewed preservation core — 6 November 2026

A separate snapshot core is implemented locally but is not connected to HTTP or
staff save/read controls yet. New settings all default disabled/unconfigured:
PLAYER_REPORT_CONTEXT_SNAPSHOTS_ENABLED=0, RETENTION_DAYS=0, REVIEW_SECRET empty,
and RETENTION_CLEANUP_ENABLED=0 (each with the PLAYER_REPORT_CONTEXT_ prefix).
The retention preference has been requested from the user; no duration has been
selected or activated in a running environment. Supported configured durations
are 30, 90 or 365 days from capture. Test fixtures use an explicitly synthetic
90-day policy and key; that does not establish the user's production policy.

The core can issue a ten-minute, HMAC-signed review of a strictly projected
context, report identity/time fingerprint, current moderator binding and selected
retention duration. Offering a review is read-only and creates no table or private
server-side draft copy. Empty context cannot receive a preservation offer. The
signature binds exactly what was reviewed; changed content, report fields, policy,
moderator or signing key cannot save under the old review. A future/expired review
fails closed. No signing secret is generated, exposed or included in the review.

A valid explicit save uses BEGIN IMMEDIATE and rechecks current linked moderator
permission against the database inside the transaction. One immutable application
row holds projected context, its digest, report fingerprint, capture actor/time,
fixed expiry and a request-key/hash receipt. No duplicate full request payload is
stored. A unique moderator/request key prevents duplicate captures. Exact verified
retries recover the original metadata even after new saving is paused or the
signing key rotates, provided permission, report/account binding and saved bytes
remain valid. Changed requests fail instead of updating the old artifact.
Storage failures roll back the snapshot and receipt together. There is a limit
of 50 active snapshots per report.

The additive snapshot table/indexes are created only during an enabled, validated
save, not on reads or disabled calls. This module does not modify reports, review
history, wallets, sources, messages or game state. Read/list operations are current-
moderator-only. Saved bytes are projected again and digest-checked before reading;
corruption is withheld. If current report participants/time differ from capture,
the stored context cannot be silently relabelled under the new report fields.

Expiry is fixed at capture and does not extend on retries or reads. Expired data
is excluded from lists and reads, and its receipt cannot authorize a new capture.
An explicitly gated host cleanup method deletes only expired rows in the owned
snapshot table, including their payload, actor and receipt fields. It does not
remove reports, chat/combat source records or unrelated audit data. Automatic
cleanup scheduling and operator policy/configuration are still unfinished; no
claim of automatic physical erasure is made for this unconnected core. The in-
application digest is an integrity check, not an external forensic attestation.

57 affected local checks pass. New tests cover disabled/no-schema behavior,
read-only reviews, exact preserved bytes, signed review tampering, source/report/
policy/key/account changes, review expiry and clock rollback, receipt reuse,
permission revocation, corrupt storage, report rebinding, retained expiry,
explicit cleanup isolation and transaction rollback. Two independent Node/SQLite
processes race the same signed request and produce exactly one snapshot; one
worker recovers the same receipt. All fixtures are local and synthetic.

Homepage roadmap is v146. API integration, explicit save review UI, saved-context
reads, late/lost-reply browser recovery, retention selection and scheduled cleanup,
authenticated staging and production verification remain open. Snapshot saving
is not available on the website yet. The status publication candidate remains
fixed at e9fb72c4; no live flag, record, secret, push, merge or deployment changed.

## Private preservation APIs — 6 November 2026

The default website context reader now includes preservation capabilities and,
only with enabled/configured snapshot policy and signing key, a signed review
offer for the exact projected context. The existing GET remains read-only: it
creates no table, snapshot or receipt. Disabled or unconfigured preservation
returns no review offer. The current staff context panel still ignores the offer;
explicit preservation/recovery controls are not connected yet.

New current-moderator-bound endpoints under /api/reports/admin/:id provide
GET context-snapshots (metadata only), GET context-snapshots/:snapshotId and
POST context-snapshots (explicit save). They require linked current DB admin access
and exact X-Report-Reviewer binding. All responses are private/no-store; query
subject/time overrides are rejected. Saving also requires same-origin JSON and
the signed context review/request key. A provided report/snapshot reference cannot
read another report's artifact. New saves perform no source fetch or moderation
review write. Existing saved reads/retry recovery remain available when new saving
is paused, subject to permission, binding, integrity and fixed expiry.

The source context, ten-minute signed offer and request key must travel together.
The save path checks exact report/context/reviewer/policy binding before writing.
A missing/rotated key or retention setting cannot silently activate saving, and
key material is not sent to the browser. Existing successful request receipts
recover their original artifact without another source call, even after the short
live source buffer is unavailable. Metadata lists omit context bytes and private
receipt/actor-Steam fields; player /mine responses receive neither saved payloads
nor preservation metadata. Expired artifacts are unavailable before physical
cleanup, which remains a separate unconnected host function.

58 affected local checks pass. The new actual HTTP fixture covers disabled and
unconfigured offers, schema-free/read-only review generation, wrong origins and
content types, wrong reviewer/current-role bindings, invalid signatures, one
explicit save with exact replay, saved reads after source loss, report isolation,
shared authorized moderator reads, player exclusion, paused saving/recovery,
expiry and revoked access. All duration/key configuration in this fixture is
synthetic test data; production retention selection is still pending. Existing
snapshot-core, source, report, chat, combat and production-preservation checks pass.
The existing staff context browser fixtures pass at desktop1440/phone390 with the
new optional offer response, preserving literal rendering, private read guards,
error/retry behavior and existing review controls.

Homepage roadmap is v147. Staff preservation review/confirm/read and lost-response
recovery UI, retention selection, scheduled physical cleanup, authenticated staging
and production verification remain unfinished. No live feature flag, key, retained
report data, push, merge or deployment changed. The separate status publication
candidate remains fixed at e9fb72c4.
