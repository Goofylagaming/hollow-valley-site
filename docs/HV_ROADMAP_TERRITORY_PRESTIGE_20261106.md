# Roadmap #20 — cosmetic Territory prestige

Local eligibility/owner-selection core only. No HTTP route, group-page controller,
worker or default service instance mounts it. No live group, wallet, game state,
source feed, policy or environment setting was changed.

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

Seven local service checks cover all-history counts beyond 50, evidence exclusion,
known-zero versus unknown, schema-free read-only inspection, owner/group/revision/
proof binding, exact retries and private receipts, audit rollback, owner/closure
changes, policy pause and source withdrawal. These are synthetic database tests,
not real Territory validation or staging evidence. Frozen website outcomes still
require the broader game's source/runtime verification before live claims.
One check uses the actual battle-provenance producer to prove frozen group and
winning-participant compatibility; later Territory links cannot transfer its
historical eligibility to another group.
The dedicated checkpoint workflow passes 104 affected local tests including
group/diplomacy, battle-control/provenance, voting and production UI regressions.

Next: private current-account APIs, group-page review/confirm and cosmetic display,
concurrent selections, browser privacy/recovery checks, operator review of the
draft thresholds, real source compatibility, capacity, authenticated staging and
production verification. The full feature remains incomplete. Roadmap #20 shows
Working on, original wording/historical votes remain, six ideas remain eligible,
and homepage roadmap asset is v162.
