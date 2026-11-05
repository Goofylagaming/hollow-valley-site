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
