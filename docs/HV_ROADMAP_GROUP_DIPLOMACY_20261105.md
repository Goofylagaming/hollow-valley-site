# Rivalries / Alliances — roadmap #18

The public requirement is formal group ally/rival declarations plus preserved historical Territory head-to-head scores. This local branch implements the relationship store, private account APIs, Groups-page controls and verified battle aggregate reads. Local desktop/mobile acceptance passes; authenticated hosted staging remains pending. `GROUP_DIPLOMACY_ENABLED=0` defaults off; roadmap #18 remains Building / Testing with no production release date.

## Relationship rules

The current website group owner can propose an alliance. It becomes active only when the other group's current owner accepts. The recipient can decline, the sender can withdraw a pending proposal, and either owner can end an active alliance. Members can read their group's relationships but cannot change them. Descriptive Headquarters ranks grant no diplomacy authority.

Rivalry is directional: one owner can declare or clear their group's outgoing rivalry, while the other group's declaration remains independent. Declaring a rival ends any alliance/proposal for that pair. Both rivalry declarations must be cleared before a new alliance proposal. These are website relationships; they do not change friendly fire, targeting, Territory eligibility, kill recognition, rewards or any game commands.

One canonical pair row covers the two distinct website group IDs, preserving both rival directions and one alliance state. Changes require the displayed actor group, target group, expected pair revision and a durable operation key. Current ownership and both active group states are checked in the write transaction. Closure gates prevent new relationship changes during group closing. Stale revisions conflict rather than overwrite another decision.

An exact operation retry returns the current pair state and does not add another edit. Altered key details fail. Each successful revision and its edit audit commit together. A failed audit rolls back new pairs and revisions. Ownership succession preserves group relationships while removing the former owner's authority. Closed groups retain history but no effective alliance; a new group reusing the name cannot inherit the old ID's declarations or battles.

The store limits successful outgoing changes to 20 per minute and active relationships to 100 per group, including incoming relationships. List reads use 50-row cursor pages; edit history is bounded to 20 entries per pair. Authenticated group-name search returns at most 50 active groups, excludes the caller group and treats SQL wildcard characters literally. Search and relationship output expose no owner/member Steam identities or operation keys. Historical edits remain in the database.

## Private API

`/api/group-diplomacy` requires the rollout flag, authenticated linked Steam and active membership. Reads are private/no-store. Writes also require same-origin JSON and writable deployment/preview settings; `GROUP_DIPLOMACY_READ_ONLY=1` independently blocks changes. Capability reads return only rollout/read-only state. The server takes the acting Steam identity from the session and target identity from the route, ignoring spoofed body actors/targets.

Routes provide relationship pages, bounded group-name search, a pair's state/history/head-to-head results and owner-authorized changes. No public group directory, notifications, wallet mutations, game connection or automatic background actions are installed.

## Territory head-to-head history

`groupBattleHistory.versus` joins both sides' website identities frozen at battle declaration to the existing battle provenance. Later Territory links cannot assign older battles. Counts include only completed capture/defence outcomes with live observation and no disqualifying reason; manual, simulated, controlled-test, unobserved, unresolved and unmapped history are excluded. All eligible records contribute to all-time wins/losses; at most 50 recent battle rows are returned. The reverse group's totals invert correctly.

If the Territory evidence store does not exist, availability is false and totals remain unknown. An existing store with no eligible shared history reports zero recorded battles. Reads contain result/time/event identifiers, with no fighter roster, Steam identities or live location. Diplomatic declarations do not create, edit or backfill battle outcomes. Current alliance/rival status has no effect on historical scores.

### Sample-clock correction, 06/11/2026

Head-to-head totals and Headquarters battle lists now also require the existing
territory_battle_sample_clock row with verified=1. A live_observed flag alone
does not prove the source clock. Legacy unstamped observations, a battle with any
unstamped accepted observation, and missing clock rows remain excluded. Later
stamped observations do not repair an earlier unknown clock. When the entire
clock store is absent, head-to-head availability is false, not a measured zero.

This can lower previously displayed scores that included unknown-clock history.
It does not rewrite history, backfill clocks, change links, alter battle outcomes,
or create/remove rewards or commands. A verified observation clock is an added
evidence condition; it is not a claim that real game integration or staging has
been verified. All eligible records still contribute to totals; recent lists
remain limited to 50.

281 distinct affected local checks across Headquarters, diplomacy and dynamic
challenges pass. New real-provenance tests cover missing/unstamped/mixed clocks,
late stamped observations, rejected future observations, reverse-group totals,
missing clock storage and read-only SQL. Existing over-50 history checks continue
to prove that totals are not derived from the display cap. Homepage asset is v157;
roadmap #16 and #18 remain Building / Testing. Authenticated staging and
production delivery remain outstanding.

## Groups controls and recovery

The independent diplomacy panel works without enabling Headquarters or Treasury. Current members can search active group names, page retained relationships and view a selected group's alliance/rival directions, recent change history and verified all-time battle record. Closed counterparts are historical and cannot receive new changes. Only the current owner gets actionable relationship controls; preview and own-group closure state disable them.

Review freezes the named groups, displayed pair revision, action and operation key without writing. Confirm explicitly sends that request. Declaring a rival explains that it ends an alliance/proposal. A lost or incomplete reply triggers only authoritative reads; the page retains the same request and offers an explicit retry. Retrying a recorded operation returns current state without another edit. A definitive conflict discards the stale review and loads the current relationship for a new decision. Refreshing a reviewed pair never silently changes its expected revision. Review keys are held in page memory, not browser storage; reload never resends a change.

Group/context changes clear selection, review, search results and private history immediately. Generation checks ignore late responses from a former group or selection. Server binding still rejects a stale write after leaving/recreating. Same-group refresh retains a review while disabling it if the pair revision changed. Permission changes are reread; former owners cannot keep mutation controls, and the successor can manage the group's retained relationship. Names and history render as text.

The record view labels unavailable evidence separately from an existing store with zero shared battles. The display contains at most 50 recent battles, while the score counts all eligible historical records. Social changes and ownership succession cannot rewrite the frozen battle score.

## Local evidence and remaining work

89 affected local checks cover the relationship state machine, current-owner/member permission, immutable retries, stale group/revision conflicts, failed-audit rollback, owner succession, closed-group/name reuse, literal search, rate/capacity limits, independent-process competing decisions, private HTTP authorization, origin/read-only protections, lost response recovery, frozen Territory identity and all-time counts beyond the 50-row display cap. Existing Groups/progression/recruitment, roadmap, production-preservation and dormant Territory checks also pass. Fixtures use synthetic identities and temporary databases; no live group or Territory state was changed.

The real Groups-page browser fixture passes at 1440px and 390px for both-owner acceptance, directional rivalry, reviewed writes, incomplete-reply recovery using exactly the same request, stale conflicts, 52-row pagination, private battle totals, member/preview access, session loss, delayed reads during leave/recreate and owner succession. It uses synthetic groups, local session cookies and recorded test battle evidence. Existing Groups/Headquarters, Treasury and purchase fixtures also exercise the disabled diplomacy module as a regression check.

The combined Treasury/diplomacy workflow commands pass 241 distinct local tests. All four Groups-related browser fixtures pass at both widths after the diplomacy controls are added. The lost-reply fixture cuts a response after headers/body bytes, verifies that no extra write is automatically posted by the page, and confirms that an explicit retry uses the same saved operation and adds no second edit.

Original roadmap descriptions remain unchanged. Historical #18 votes remain stored while no longer consuming active ballot slots. Homepage roadmap asset version is 100.

Authenticated staging, real Territory evidence verification, review publication and separately approved production rollout remain required. The branch is local and stacked on Treasury draft PR #307; its publication is not covered by the Treasury approval. Local browser authentication does not prove live Steam behavior, and no production release is claimed.
