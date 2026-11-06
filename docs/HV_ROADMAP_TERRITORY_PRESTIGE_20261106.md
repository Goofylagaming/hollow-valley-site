# Roadmap #20 — cosmetic Territory prestige

Local eligibility, private API and Groups-page implementation. It is not a
delivered release. No live group, wallet, game state, source feed, policy or
environment setting was changed. There is no automatic game/reward worker.

The draft uses recorded, timestamp-verified capture results frozen to the website
group at declaration. It does not infer current control, time held or distinct
territories from mutable event labels. All retained qualifying results contribute;
it does not derive eligibility from the 50-row recent-battle display. Manual,
simulated, testing, unobserved, unresolved, future, malformed-time, unknown-clock
and self-opponent records cannot qualify. Missing evidence tables mean unknown,
not zero; an existing store with no qualifying history reports recorded zero.
Qualification also requires an existing valid winning-participant receipt. A
resolved capture with no retained winner does not unlock a cosmetic standard.

Draft standards require 1, 5 and 20 recorded captures. They are website cosmetics
only, with no coins, permanent XP, gameplay statistics, game skins, transferable
entitlements or commands. These thresholds/names are not approved production
policy. A digest of the immutable versioned policy must match an independently
configured GROUP_TERRITORY_PRESTIGE_POLICY_DIGEST before non-default choices or
schema preparation. GROUP_TERRITORY_PRESTIGE_ENABLED stays 0; the digest example
is empty. Read-only mode independently blocks choices and schema preparation.

The current owner of an open group can choose an eligible standard. Requests bind
group ID, choice, saved revision, displayed eligibility proof, policy digest and
operation key. Authority, closure, revision and eligibility are checked in the
write transaction. Choice and immutable audit/receipt commit together. Exact
retries return the original receipt; altered requests conflict. Clearing a saved
choice remains possible while new prestige choices are paused. Receipt recovery
is private to the original actor; a later ownership change does not rewrite it.

Read projections recheck the current source and policy. A saved standard becomes
ineffective if the source is missing/withdrawn/disqualified or its recorded policy
is no longer current/reviewed. The saved choice and history remain, rather than
silently granting an unearned replacement. Missing, contradictory or rolled-back
selection/audit state fails closed. Read-only queries create no tables or data.

Eight local service checks cover all-history counts beyond 50, evidence exclusion,
known-zero versus unknown, schema-free read-only inspection, owner/group/revision/
proof binding, exact retries and private receipts, audit rollback, owner/closure
changes, policy pause and source withdrawal. These are synthetic database tests,
not real Territory validation or staging evidence. Frozen website outcomes still
require the broader game's source/runtime verification before live claims.
One check uses the actual battle-provenance producer to prove frozen group and
winning-participant compatibility; later Territory links cannot transfer its
historical eligibility to another group.
The earlier core checkpoint passed 104 affected local tests including
group/diplomacy, battle-control/provenance, voting and production UI regressions.
The integrated API/UI validation below supersedes that checkpoint.

## Private API and group controls

/api/group-territory-prestige uses the current linked website account and an
account-bound header. Actor/group overrides are rejected. Private reads use one
SQLite read snapshot; writes repeat account authorization inside the immediate
transaction, then check current group ownership/closure, saved revision and proof.
Same-origin JSON and preview/read-only guards protect changes. Responses are
private/no-store. Exact receipt lookup is private to the original actor, including
after they leave that group; it does not expose a former group's current state.
Unchanged new requests conflict, and at most twenty changes per group per minute
are accepted. Genuine database lock contention can return unavailable; receipt
checking and same-key retry preserve one durable outcome.

The Groups response advertises availability only when rollout is configured or
prestige storage already exists. The independent panel otherwise makes no new
prestige API request. Initial storage needs enabled rollout, the exact reviewed
policy digest and writable deployment settings. Policy-free and preview reads do
not create tables. Paused existing storage retains private review and owner
clearing. The group panel shows known recorded counts separately from unavailable
evidence; it does not present current-control or holding-time claims.

Review freezes a group, cosmetic choice, revision, proof, policy and operation key
without writing. Confirm sends it explicitly. Lost replies expose saved-receipt
checking or retry of the same request, with no automatic replay. The displayed
standard is rederived from current evidence and never changes purchased group
frames. A withdrawn source result can remove the appearance without deleting the
saved choice or automatically choosing a lower standard. Group/account/visibility
changes clear private state and reject late responses. Two-minute view expiry
clears recorded observations/appearance without source polling. The periodic
identity check only revalidates the account; other reads are initial/context or
explicit user actions. No browser storage is used.

The integrated run passes 165 local tests across prestige, existing groups,
moderation/trading/gifts, battle/control evidence, roadmap and production-page
regressions. New independent writers test competing choices and same-request
recovery after contention. Actual-page desktop 1440px/phone 390px fixtures cover
unreviewed policy, explicit review without writes, lost replies, receipt/retry,
paused clearing, source withdrawal, member/preview restrictions, held account and
membership changes, expiry without polling, existing group-frame coexistence,
safe text, no storage/unexpected API writes and width. Membership-event fixtures
use actual group-store changes and the existing page event contract. These remain
synthetic local fixtures using Node 24.22 and Edge, not real Steam/game staging.

Remaining: hosted checks, operator review of the draft thresholds, broader policy/
catalog lifecycle compatibility, real source compatibility, capacity and lock
behavior, authenticated staging and production verification. The full feature remains incomplete. Roadmap #20 shows
Working on, original wording/historical votes remain, six ideas remain eligible,
and homepage roadmap asset is v163.
