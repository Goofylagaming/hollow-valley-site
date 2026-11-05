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
Writes require same-origin JSON, current staff access, a writable deployment and
an `X-Status-Reviewer` binding matching the current account ID and Steam identity.
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

Still required: official operational
verification and private-evidence retention policy; concurrency/performance and
recovery review; independent Bridge/Discord/Marketplace/Steam/Live Map probes;
authenticated staging and approved deployment. This work creates no automatic
health claims. No live incident or alert was published in this session, and no
payout, restore or game command was issued.
Nothing was pushed, remotely merged, enabled or deployed. The full 31-item roadmap
remains active and incomplete.


## Staff editor and account-bound confirmations — 6 November 2026

The protected `/adminstatus` and `/adminstatus.html` page now provides staff
editing and review controls. It is linked from the private incident timeline and
admin navigation. Both HTML forms of the route use the existing admin-page guard;
private API permissions independently recheck current database staff access.
The timeline remains read-only. Its duplicate body tag was corrected while adding
the separate management link; no timeline source or data was republished.

Staff can choose saved incidents, page older records/change history or start a new
unsaved draft. Recorded times are explicitly entered in Brisbane time; no event or
verification timestamp defaults to now. Form parsing round-trips calendar values
and preserves millisecond precision. Saving, publishing and withdrawing each have
an explicit review panel and separate confirmation. Public wording and private
proof are displayed separately with text nodes; withdrawal previews the actual
published wording rather than an unrelated edited draft. Private notes/reasons
never enter the public projection.

Edited drafts must be saved before their public report can be reviewed. Preparing
or closing a review makes no write. The confirmation freezes its request identity,
action, payload, saved revision, draft digest and staff-account binding. A dropped
reply offers an explicit retry of the identical request; it does not generate a
replacement key or submit again automatically. Staff can instead check the current
saved version. Conflicting edits load the newer saved version for another review.
Rejected fields leave the current draft available to fix; an unverified staff
account clears all private form, evidence, history, list and review data.

The private POST route now requires the `X-Status-Reviewer` header to match both
current request account ID and Steam identity. This prevents a review prepared
under one admin from being submitted under another account if the session switches
between the final browser check and the write. Fresh identity/capability reads
also bracket private reads and successful or unconfirmed responses. Idle identity
polling clears data after an account change, and backend database checks remain
authoritative if permissions change while the page is open.

Preview/read-only mode disables all changes. A publishing pause disables new saves
and publications while keeping permitted withdrawals available. Current public
history visibility is shown separately from publishing permission. The form and
frozen review stay in page memory only; no draft/evidence is persisted to browser
storage. Page reload recovery uses the server's saved versions/history.

The incident picker collapses after selection and focus moves to the selected
editor. Review panels have a separate focus target. At phone widths the fields
stack and long evidence links wrap. A scoped 16px form-text override fixes the
shared snapshot theme's 9px important rule for this page; the browser fixture checks
actual computed text size and horizontal overflow.

**55 affected local tests still pass**, including reviewer-header mismatch/missing
checks and the existing service, HTTP, timeline, status, roadmap/voting and
production-preservation suite. Both real API/browser fixtures pass at 1440px and
390px. Editor scenarios cover 25-item incident/history pagination, no writes during
review, rejected-field preservation, lost-response retry with one saved outcome,
private/public separation, saved corrections, competing staff edits, read-only
changes before confirmation, paused withdrawal, a session switch immediately
before a POST, a switch during a dropped reply, a switch during a held private
read, and revoked staff permissions. The phone rendering was inspected.

The dedicated workflow includes both browser fixtures. Homepage roadmap asset is
v132; the new editor stylesheet/controller are v1. Rollout defaults remain off.
Neither this branch nor any live incident was published or deployed. The season
candidate `708b2c8a` and its operations follow-up `2ef0562d` remain unchanged.
Independent component probes, private-evidence retention policy, operational
concurrency/recovery measurements, hosted checks and authenticated staging are
still required. Roadmap #29 and the full roadmap remain incomplete.


## Independent Bridge worker observation — 6 November 2026

A separate default-off component signal now uses the existing authenticated owner
management-agent heartbeat to observe the Command Bridge **Windows scheduled task**.
It is not a command-execution test, RCON probe or claim that the Bridge pipeline is
fully operational. The website/game summary remains independent, and the public
card explicitly labels its narrow scope as an observation.

The repository's management agent is now v0.3-status-clock. It records UTC
`sampledAt` at the start of `Get-Snapshot`, before collecting process/task/log
facts, and includes that timestamp in its normal outbound status payload. Its
allowlisted hosts, token selection, default status/read-only mode, task-write gates,
job polling and task actions are unchanged. The new script has not been installed
or run on the live Windows host. PowerShell syntax was parsed without executing it;
the local runtime confirms the seven-digit UTC round-trip format emitted by .NET.

The existing authenticated `POST /api/binarylane-management/status` path optionally
captures only `sampledAt` and `tasks.command_bridge`. A minimal singleton table
stores schema version, original source time, receiving time and an allowlisted
Windows task state. It copies no logs, task names/paths, process IDs, server
addresses, player identifiers, token values or owner job data. Public observation
failure is isolated from the existing private management heartbeat, with a generic
notice and no raw source error logging. A failed write never advances the saved
observation's timestamp.

Collection requires `STATUS_COMPONENTS_COLLECTION_ENABLED=1`; public visibility
requires `STATUS_COMPONENTS_PUBLIC_ENABLED=1`. Both default off. Public projection
also requires the existing management channel to be enabled/configured. Neither
flag activates task writes or changes `HV_MANAGEMENT_WRITES_ENABLED`.

The read-only `GET /api/component-status` endpoint never sends a network probe,
leases a management job, polls a command queue, creates monitoring schema or runs
a game action. Schema preparation occurs only on an enabled, supported incoming
heartbeat. Old senders without an explicit source clock remain unobserved rather
than acquiring the receiving process's current time. Existing private owner status
behavior remains compatible with those senders.

Source parsing accepts explicit UTC ISO timestamps, including Windows' seven-digit
fractional precision (conservatively truncated to milliseconds). Invalid calendars,
missing offsets, missing task facts and unsupported states are rejected. Exact
replays preserve the first receiving time; older/conflicting source clocks cannot
overwrite a newer observation. Source skew above two minutes is rejected. Public
reads require both source and receiving clocks not to be future-dated and both ages
to be within 90 seconds. Otherwise the card is delayed, unknown or clock-unverified;
no timestamp is clamped into apparent freshness. The default agent poll interval
is 20 seconds; any nondefault cadence and collection overhead need staging review.

The public card reports an observed running task, a queued task, a task not running
at the last check, or an explicitly unknown/unavailable observation. It does not
infer an offline game or failed command delivery. It renders the original agent
snapshot date in Brisbane time. The browser independently checks that date, so a
cached response still claiming a running task becomes delayed after expiry.

**66 affected local checks pass**, including new source/calendar precision,
replay/conflict, expired/future clock, malformed evidence, minimal projection,
disabled/legacy no-schema behavior, authenticated heartbeat-to-public HTTP flow,
private-field exclusion and management failure isolation. The HTTP fixture keeps
a synthetic queued management job untouched during every health read. Existing
owner-management, read-only, incident, status, voting and production-preservation
checks pass. Both desktop/phone public fixtures pass at 1440px and 390px, including
cached-worker expiry without altering the separate live summary. The phone card
was visually inspected. The staff editor did not change in this follow-up.

Homepage roadmap asset is v133, status CSS v3 and the new component controller v1.
The dedicated workflow includes the source, HTTP, management regression and public
browser checks. No live flags, agent installation, incident, management job, game
command, merge or deployment changed. The season and operations candidates remain
fixed at `708b2c8a` and `2ef0562d`.

Still required: live source/agent verification, complete Bridge execution and RCON
health, Discord/Marketplace/Steam/Live Map probes, private-evidence retention policy,
operational concurrency/recovery measurements, hosted CI and authenticated staging.
This is progress on #29, not completion of #29 or the 31-item roadmap.


## Live Map source validation — local follow-up, 6 November 2026

The default-off STATUS_COMPONENTS_MAP_ENABLED observation reads the existing
cached server snapshot, independently of management-agent collection. It shares
projection validation with authenticated map positions. The public response
contains only scope, source time, result and renderingVerified:false. It never
returns identities, coordinates, character counts, vitals or raw provider errors,
and never polls RCON or performs writes. A public source check is not proof of
individual account access, upstream ingestion or browser rendering.

Explicit UTC source clocks are mandatory. Missing, malformed, ambiguous, future
or older-than-120-second sources cannot supply live positions. Stale is checked
before offline, preventing an expired cache from inventing an offline verdict.
An empty character observation remains unknown. Missing/invalid/outside map
coordinates are unprojectable; zero is valid. Owner/admin numerical coordinates
remain available when outside community bounds, but markers, region and grid are
withheld rather than clamped onto an invented map edge. Regular members retain
position-free entries for other players. The positions route remains authenticated
and now uses private/no-store caching and generic source-failure responses.

The private map browser validates the original normalized source time before
rendering a received observation and clears rejected positions. Disconnected UI
now distinguishes verified-offline from unverified source data. This change does
not establish account-switch isolation or production map calibration.

The public Map card checks its source clock independently in the browser and
cannot change the website/game summary. Missing or malformed Bridge observations
cannot reset a valid Map result. Older Bridge-only frames retain unknown Map
status. All rollout flags remain off. Home roadmap v134, status CSS v4,
component controller v2 and Live Map v19 reference the new validator v1.

84 affected local checks pass, covering public/private HTTP paths, source age,
bounds, role privacy, minimal observations, source failures and existing Bridge,
management, incident, roadmap and production guards. Desktop/phone public browser
fixtures verify usable/unprojectable sources, cached expiry and privacy. The
390px Map card has been visually inspected. Authenticated production staging,
real source calibration, full map account lifecycle review, independent service
probes, retention policy and hosted checks remain gates. No live configuration,
publication, merge, deployment, game command or player data changed.


## Actual Map-page failure recovery — 6 November 2026

The full local Live Map page exposed a recovery gap after a successful private
position read: HTTP 503 cleared markers but retained the character panel's old
coordinates/vitals. The navigation module also retained its last successful map
state because failure did not emit a map-state update. The new browser fixture
failed on retained private details before the fix.

Failed reads now clear the character panel and emit a null map-state observation
to dependent navigation controls, together with the existing marker/global-state
clearing. Sign-out keeps the explicit sign-in message. Static layers, historical
trails and user-created targets retain their existing meaning; the My dino action
cannot obtain a stale source from the failed read. No account/role semantics or
live data access changed.

The real page and its scripts pass the fixture at 1440px and 390px. It uses the
shared backend projection with synthetic owner/other characters and checks fresh
rendering, escaped names, member position privacy, expired/future cached packets,
HTTP failure, 401, verified-offline, outside-bounds markers and recovery to fresh
positions. Each unavailable case checks the panel, roster, markers, global state
and My dino navigation. Expected unrelated APIs have explicit synthetic responses;
unexpected API calls and page errors fail the fixture. This validates local page
behavior; real Steam sessions, account-switch races and upstream calibration still
require separate evidence. The phone character panel was visually inspected.

All 84 affected local regression checks pass. The dedicated workflow now includes
this actual-page fixture. Live Map asset is v20 and home roadmap is v135. No flags,
push, PR, merge, deployment, game commands or production data changed. The full
31-feature roadmap remains incomplete.


## Steam provider observation — local follow-up, 6 November 2026

Valve documents Steam Community OpenID as the website authentication provider:
https://partner.steamgames.com/doc/features/auth#website . The existing website
login router redirects users to its login endpoint and verifies callbacks there.
This follow-up adds a distinct discovery HTTP observation; it does not perform a
login, verify a signed identity, link accounts, fetch profiles, persist a session
or exercise the site's callback. No auth behavior was changed.

STATUS_COMPONENTS_STEAM_ENABLED defaults to 0. When explicitly enabled alongside
the existing nonempty Steam realm/return configuration, the process-started
monitor requests only https://steamcommunity.com/openid/ . The fixed GET sends
no user identity, callback URL, cookie, API key or auth headers, and redirects are
not followed. The result is responded only for HTTP 200 with the expected
application/xrds+xml content type. The provider document is cancelled after
headers, not parsed or retained. This is endpoint reachability with expected
headers, not a verified OpenID document or proof account linking works.

Each process makes at most one request per minute with one active request and a
five-second deadline, including when a transport ignores cancellation. The source
time is captured before requesting and never replaced with read or completion
time. Responses older than three minutes expire; backwards/future clocks remain
unverified. Public reads neither initiate nor accelerate probes. HTTP errors,
redirects, HTML challenges, timeouts and transport failures have generic scoped
states without provider bodies or private errors. Restart has no observation.
Shutdown cancels outstanding work, clears the loop and observation, and rejects
late publication even for transports that ignore abort. Flag/config withdrawal
withholds public results. No monitoring table or retention of identities is added.

The public endpoint requires the separate public status flag and returns only
component ID, scope, state, original source clock and linkingVerified:false. The
Steam card independently expires cached successful packets and rejects future or
invalid clocks. Older Bridge/Map-only frames show unknown Steam status. Failures
remain separate from the website/game summary. The page still labels full account
linking as unverified and does not infer an offline game or universal login outage.

The tests cover disabled/unconfigured no-network behavior, fixed request privacy,
status/content-type checks, body cancellation, exceptions, timeout/late response,
single flight, cadence, expiry/rollback, stop/start isolation and public HTTP reads.
Public desktop/phone fixtures use a synthetic provider transport; they verify the
card, cached expiry, future/invalid clocks and independent summary. The 390px card
was visually inspected. Existing Steam profile and owner-email auth tests also
remain in the affected verification suite. 101 affected local checks and the desktop/phone public browser fixtures pass; real deployed egress and Steam login/link/callback/profile behavior
remain staging gates. Multiple-process probe volume needs operational review.

Home roadmap is v136, status CSS v5 and component controller v3. No flag was
enabled, no live provider probe was installed, and no push, merge, deployment,
incident publication, command or account data changed. RCON/Discord/Marketplace
monitoring and the remaining #29 and full-roadmap gates are still incomplete.


## Marketplace health source — local integration step, 6 November 2026

The existing GET catalog route calls seedOfficialCatalog before reading. It is
therefore unsuitable for periodic monitoring that promises no business writes.
The new token-protected GET /api/website/marketplace/health uses a separate,
default-off STATUS_MARKETPLACE_HEALTH_ENABLED gate in the automation service.
It never calls seeding, initializes tables, invokes fulfillment, or queries or
mutates wallets, orders, players or command queues. Its website client method
uses the existing server-side integration token and does not take a player ID.
The public status endpoint does not call this source yet.

The source performs one bounded SELECT of active catalog rows and validates
nonempty item identity/type/name, positive safe integer prices and object-shaped
JSON payloads. The limits are 1000 active records, 16 KiB per payload and 2 MiB
of total payload bytes. It reports readable, empty-catalog, invalid-catalog,
catalog-too-large, unavailable or unverified-clock. Inactive malformed rows do
not affect the active read. Missing tables stay unavailable; no schema is added.
This check validates storage/readability, not species policy, catalog completeness,
storefront rendering, purchase eligibility, checkout or delivery.

Only version, scope, result, pre-query observation time and explicit false
checkoutVerified/fulfillmentVerified fields leave the source. Raw exceptions,
item details, identifiers, prices and payloads are excluded. Responses use
private/no-store caching. Disabled calls return 503 with available:false;
token authorization remains required even while the feature is disabled.

The source tests exercise corruption, empty/missing storage, payload/item/total
bounds, multi-byte payload sizes, invalid clocks and unchanged total_changes.
The actual route/client fixture runs with SQLite query_only enabled, substitutes
a seeding method that fails if called, and proves both empty and readable results
without writes. Existing official catalog tier/policy and marketplace UI guards
remain in the affected suite. A pre-existing Windows test cleanup problem was
fixed by closing the test's SQLite handle before removing its temporary directory.
All 117 affected local checks pass. Homepage roadmap is v137.

Periodic website collection, stale/replay handling, public Marketplace display,
local browser checks of that display, deployment of this new source, authenticated
staging, purchase/delivery verification and the wider #29/roadmap gates remain
unfinished. No monitor, flag, catalog, wallet, order, purchase, game command,
publication, merge or deployment was changed in a running environment.


## Marketplace collection and public observation — 6 November 2026

STATUS_COMPONENTS_MARKETPLACE_ENABLED defaults off in the website. Collection
requires an existing automation URL/token and the separate automation source flag
from the preceding section. The process starts one monitor, polls no more than
once a minute, uses one active request and a five-second deadline, and cancels
outstanding HTTP work on shutdown. There is no fallback to the catalog GET,
which seeds records. A missing/disabled/newer-incompatible source stays unverified.
The new optional request signal combines with the existing client's own deadline;
other client methods retain their existing requests.

The collector checks source version, availability, exact scope, bounded state,
explicit checkoutVerified:false/fulfillmentVerified:false and an explicit UTC
source timestamp. Unknown schemas, future clocks, conflicting equal-time facts
and older observations cannot become successful status. Exact source repeats
preserve both the source clock and their first local check-start clock. Reads
expire after three minutes by either clock. Repeated public polling never moves
those clocks or requests another source check. Local transport/error observations
use their check-start time and generic unavailable/timed-out states; they never
copy provider bodies, errors, tokens or catalog data. Config/credential changes
invalidate saved facts and suppress pending old-source results. Process restart
starts without an observation.

The public endpoint exposes a separate official-catalog-read component only when
public status is enabled. It returns no item/customer records or connection data.
The new card says Catalog readable for a successful bounded active-record read,
not that purchases or delivery work. Empty/invalid/oversized catalogs, invalid
observations, transport failure, timeout, delayed clocks and missing configuration
have separate scoped labels. Cached successful packets expire independently in
the browser; future/malformed timestamps and upgraded verification claims become
unknown. Old component frames show unknown Marketplace status. Website/game
summary signals are never changed by these scoped failures.

126 affected local checks pass. The actual client/automation-source/collector/
public-route fixture uses query_only SQLite, a failing seeding substitute and
unchanged total_changes to prove the monitored path has no business writes.
Repeated public reads cause one source call. A separate actual held HTTP request
proves cancellation propagation. Service checks cover cadence, single flight,
replays/conflicts, source expiry, clock rollback, config changes and late results.
Desktop1440/phone390 public fixtures exercise readable, empty, invalid, oversized,
timeout, old/future/bad clocks and invalid verification flags while preserving the
separate game summary. The phone card was visually inspected. Homepage is v138,
status CSS v6 and component controller v4. No user actions, live flags, purchases,
orders, commands, pushes, merges or deployments were performed.

Still required: deploy/review the source and collector together, authenticated
staging, operational source-clock synchronization, multi-process load review,
storefront rendering and real checkout/delivery verification, remaining service
monitors, incident retention policy and broader #29/full-roadmap release gates.
