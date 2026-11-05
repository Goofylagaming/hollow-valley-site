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
