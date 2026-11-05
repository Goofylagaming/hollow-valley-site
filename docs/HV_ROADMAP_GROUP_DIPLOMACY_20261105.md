# Rivalries / Alliances — roadmap #18

The public requirement is formal group ally/rival declarations plus preserved historical Territory head-to-head scores. This local branch implements the relationship store, private account APIs and verified battle aggregate reads. Groups-page controls and desktop/mobile acceptance remain unfinished. `GROUP_DIPLOMACY_ENABLED=0` defaults off; roadmap #18 remains Building / Testing with no production release date.

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

## Local evidence and remaining work

89 affected local checks cover the relationship state machine, current-owner/member permission, immutable retries, stale group/revision conflicts, failed-audit rollback, owner succession, closed-group/name reuse, literal search, rate/capacity limits, independent-process competing decisions, private HTTP authorization, origin/read-only protections, lost response recovery, frozen Territory identity and all-time counts beyond the 50-row display cap. Existing Groups/progression/recruitment, roadmap, production-preservation and dormant Territory checks also pass. Fixtures use synthetic identities and temporary databases; no live group or Territory state was changed.

Original roadmap descriptions remain unchanged. Historical #18 votes remain stored while no longer consuming active ballot slots. Homepage roadmap asset version is 99.

Next work is the actual Groups controls for search, proposal/acceptance, rival declarations, revision conflicts and outcome recovery, plus head-to-head display and desktop/mobile checks. Authenticated staging, real Territory evidence verification, review publication and separately approved production rollout remain required. The branch is local and stacked on the Treasury draft; its publication is not covered by the Treasury approval.
