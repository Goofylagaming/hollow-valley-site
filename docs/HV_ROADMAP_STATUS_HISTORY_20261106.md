# Staff-reviewed status incident history — local foundation

Roadmap #29 remains Building/Testing. This independent branch,
`feature/hv-roadmap-status-history-20261106`, starts at the current roadmap
integration history `efcb9c5a`. It changes neither the season publication candidate
`708b2c8a` nor the separate operations follow-up `2ef0562d`.

The public `/status` page now has a default-off incident-history reader, backed by
staff-only draft, review and publication APIs. This is **staff-reviewed reporting**,
not independent monitoring or automatic proof of an outage. Existing website
liveness/readiness and timestamped game snapshots keep their separate meanings.
An empty, unavailable or withdrawn history never implies all services are healthy.

## Prepared workflow

- Current website admins with a matching linked Steam identity can save incident
  drafts. Permission is checked against current database rows, including inside
  the write transaction. A stale admin session or changed binding cannot write.
- Draft fields cover affected components, degraded/outage severity, investigation
  state, public title/summary, recorded start/verification/resolution times and
  private evidence. Resolved reports require a coherent resolution time; other
  states have none. Future source times are rejected.
- Evidence is one to five distinct Discord message links in the configured
  official guild, plus a private explanation. Links are validated and retained,
  **not fetched or automatically verified**. An admin must inspect the actual
  evidence and public wording before publishing.
- Saving a draft does not publish it or change an existing publication. Publication
  requires the exact saved draft digest and current revision. The published
  projection freezes its source review, private proof digest and reported time.
  A change to the configured evidence guild requires a fresh save/review before
  another publication; existing historical reports retain their original proof.
- Corrections use another saved draft and explicit publication. Public reads show
  only the current reviewed summary, not earlier corrected text or private
  revision history. Withdrawal removes the public projection. Restoration requires
  another explicit digest-bound publication, with the original verification date
  retained rather than being stamped as new gameplay evidence.
- Request identities bind the actor, complete reviewed action and payload. Exact
  retries return the saved outcome plus current state without overwriting newer
  edits. Conflicting keys, stale revisions and unsupported actions are rejected.
  History, row changes and receipts share one transaction; audit failure rolls
  back the complete write. New actions are limited to twenty per admin per minute.
- Public projections recheck the latest audit and original publication snapshot.
  Corrupted or unavailable records are withheld with a partial-history indication;
  source errors and proof data do not enter the public response.

Public data contains only the incident identity, reviewed component/severity/state,
public wording and recorded/reported times. Actor identities, proof URLs, notes,
guild configuration and raw errors remain private. Public text rejects common
account-ID, link, IPv4-address and email disclosures, and the client uses text
nodes for every field. These checks complement human privacy review; they do not
establish automatic detection of every possible sensitive string.

## Routes and controls

Public routes:

- `GET /api/status-incidents/capabilities`
- `GET /api/status-incidents?before=<opaque-position>`

Current-admin routes:

- `GET /api/admin/status-incidents/capabilities`
- `GET /api/admin/status-incidents`
- `GET /api/admin/status-incidents/:id`
- `GET /api/admin/status-incidents/:id/history`
- `POST /api/admin/status-incidents/:id` for exact save/publish/withdraw reviews

Reads are bounded to 25 incidents/history revisions, with opaque keyset cursors.
All responses disable caching; private responses use `private, no-store`.
Writes require same-origin JSON, current staff access and a writable deployment.
Preview/read-only checks apply before accepting an action.

All rollout settings default off in `.env.example`:

| Setting | Meaning |
| --- | --- |
| `STATUS_INCIDENTS_ENABLED` | Allow new draft saves and publication reviews |
| `STATUS_INCIDENTS_MANAGEMENT_ENABLED` | Keep private management and withdrawal available while new publishing is paused |
| `STATUS_INCIDENTS_PUBLIC_ENABLED` | Expose current staff-reviewed public history independently of new publishing |
| `STATUS_INCIDENTS_READ_ONLY` | Block all incident changes, including withdrawals, in a read-only deployment |
| `STATUS_INCIDENTS_EVIDENCE_GUILD_ID` | Official evidence guild for new reviews; unset by default |

The factory creates additive incident, history and request tables when the website
is initialized, following existing website feature-store conventions. Rollout
flags gate use, not schema creation. No existing wallet, player, audit, storage,
quest or game-command records are overwritten. Deployment/schema preparation and
backup review remain gates. No live schema or configuration was changed here.

## Public page behavior

The history reader is separate from the existing three live status checks. It
loads capabilities first, supports explicit older pages and refreshes with the
status page. Each report is labelled with its staff-reviewed origin and Brisbane
times. HTML-shaped titles remain literal text. A failed or disabled read clears
unverified old cards without changing the website/game health summary. Refresh
generation checks prevent an older response replacing a newer view.

The existing status controller remains at v1, incident reader starts at v1, status
CSS is v2 and homepage roadmap is v131 on this branch. Original roadmap numbering,
descriptions and historical votes remain. #29 already left the idea ballot, so its
voting eligibility is unchanged.

## Validation and unfinished scope

**55 affected local tests pass**, covering separated draft/publication state,
corrections, paused withdrawal, source-policy changes, immutable retries, stale
reviews, revoked staff, input/time/evidence validation, rollback, corrupt-proof
suppression, private/public HTTP guards and existing status, incident timeline,
roadmap, voting and production UI behavior.

The real HTTP/Edge browser fixture passes at 1440px and 390px for 26-report
pagination, private-proof exclusion, escaped titles, independent live summaries,
withdrawal visibility, failure clearing, disabled rollout and horizontal overflow.
The phone rendering was inspected. The dedicated workflow runs these checks and
the browser fixture, but hosted execution has not run for this unpublished branch.

Still required: accessible staff editing/review controls; official operational
verification and private-evidence retention policy; concurrency/performance and
recovery review; independent Bridge/Discord/Marketplace/Steam/Live Map probes;
authenticated staging and approved deployment. This work creates no automatic
health claims. No live incident or alert was published in this session, and no
payout, restore or game command was issued.
Nothing was pushed, remotely merged, enabled or deployed. The full 31-item roadmap
remains active and incomplete.
