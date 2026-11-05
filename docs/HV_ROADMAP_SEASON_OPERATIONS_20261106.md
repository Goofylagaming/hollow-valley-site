# Free-season operational inspection — local preparation

This follow-up is on `feature/hv-roadmap-season-operations-20261106`, based on
the fixed season publication candidate `708b2c8a`. It does not change that candidate
or its pending publication request. Roadmap #4 remains Building/Testing. No live
database, configuration, season policy or player record was accessed or changed.

The host operator can now inspect a season without running collection, modifying
schema or exposing account identifiers. This complements the existing exact-rule
review and bounded collection/maintenance tools. It does not replace source-feed
verification, backup/recovery review, performance measurements or authenticated
staging.

## Run against an explicitly selected existing database

Set `$automationDatabase` to the existing database file and `$reviewedSeasonId`
to the reviewed season identity, then run from the repository:

```powershell
node scripts/review-season-track.cjs health --database "$automationDatabase" --id "$reviewedSeasonId" --limit 5
```

The CLI opens that file read-only. It does not load environment files or import
the economy/progression runtime, select a default database, create a missing file,
install source hooks or invoke a writer. `--write`, repair options, duplicate
options, unsupported fields and invalid page sizes are rejected. Existing rule
review/stage/publish/close commands retain their previous behavior.

Each inspection uses one SQLite read transaction for the rules, queue and source
projections. A concurrent collector or source update cannot produce a mixed
before/after report within that inspection. The read transaction ends before the
command returns. A subsequent page is a new snapshot, so pages are samples rather
than an atomic census of a changing system.

The default is five participants; the allowed range is one to ten. For each
participant, backlog inspection returns at most 100 XP candidates and an overflow
marker. The existing progress reader separately retains its existing bounded
achievement source validation. SQL aggregate/index work still depends on actual
history size; these limits do not establish acceptable production performance.

## Read the report

- `checks.coreSchema` and `missingTables` identify missing required tables or
  columns. An unprepared database remains unprepared, with no private probing.
- `checks.reviewVerified` requires the immutable definition, digest, latest audit
  and retention record to agree. Failure leaves `season` and `sample` empty.
- `checks.sourceIndex` checks the exact XP source-position insert hook.
- `checks.collectionQueue` checks the queue/cursor schema and exact join/leave
  hooks. `queueConsistency` separately reports sampled missing jobs, jobs without
  enrollment and invalid checkpoint shape. Missing/orphan counts stop at 100 and
  carry overflow markers. A zero sample is not proof that a damaged queue is valid.
- `checks.achievementSources` checks selected timing families' required schema,
  including prepared level/playtime, Prime and skin audits. For life sources, an
  existing combat table must support the direct death check. Schema presence is
  distinct from verified producer behavior or available dates for every player.
- `sample.pendingProgressParticipants` counts sampled projections that still have
  work. `unprocessedXpCandidates` counts raw source candidates, **not eligible
  seasonal XP**. Unsupported sources, late receipts and unknown clocks can be in
  that count. `moreXpCandidatesParticipants` marks the 100-candidate cap.
- `unknownXpClockCandidates` and `undatedSelectedBadges` report unknown timing
  without stamping it as new. Legacy unknowns can be expected; the report does not
  infer loss or corruption from their presence.
- `oldestSampledPendingReceiptAt` uses known nonfuture ledger receiving clocks.
  It is not a gameplay date or a global backlog-age promise. Future receiving
  clocks are counted separately and never used as an old receipt.
- `invalidCopiedParticipants` reflects the existing source-revalidated progress
  reader. `unavailableParticipants` counts failed projections without including
  their identities or source error messages. Other sampled participants continue.
- Expired seasons report a bounded count of retained enrollment rows needing
  cleanup and probe no private progress. Expiry does not run maintenance implicitly.

The report omits Steam IDs, ledger IDs, player names, private season/milestone
labels, skin data and private source errors. It returns season identity/digest,
aggregate observations and opaque queue positions. A successful CLI exit means a
report was produced; it is not approval to enable, pay, publish, merge or deploy.

When `sample.moreParticipants` is true, pass its opaque `nextPosition` as
`--after` for another bounded page. Paging requires prepared collection hooks;
without them, the first enrollment sample is still available, with no continuation
cursor. Do not treat the resulting sample as a complete rollout audit.

## Recovery review

1. Compare the season identity/digest with the original reviewed artifact. Inspect
   any schema, audit, retention or hook mismatch before changing deployment state.
2. Verify the real tracking, collection, maintenance and read-only settings on the
   host separately. This tool does not read or infer deployed process settings.
3. Use verified backups and a separate recovery rehearsal before any data/schema
   repair. Unknown historical clocks must remain unknown; do not use the current
   time, badge unlock date or today's inventory to fill a gap.
4. Investigate missing queue jobs or source errors against current consent and
   original receipts. The inspector deliberately provides no automatic repair,
   replay, enrollment, payout or source-time rewriting command.
5. Repeat bounded inspection and independent source/producer checks after reviewed
   recovery. Existing source audits can affect ordinary XP/Prime/skin transactions
   even with seasonal rollout off; pausing a season does not remove that coupling.
6. Complete authenticated staging, performance and privacy checks before rollout.
   Rewards and actual season policy still require their own review.

## Evidence and remaining scope

**204 distinct affected local tests pass**, including the seven new inspection
cases. They verify bounded pagination and overflow, unknown/changed clocks,
undated badges, corrupt rules, missing/replaced hooks, queue inconsistencies,
participant failure isolation, expired exclusion, CLI restrictions, exact main
database byte preservation, no runtime import and a genuine second SQLite
connection updating evidence during a stable read snapshot. The broader season,
commerce, concurrent collector and HTTP checks remain passing.

The current season browser fixtures previously passed at 1440px and 390px; this
follow-up changes no season player controls or private HTTP behavior. Homepage
planning asset v130 reflects the operational work and remains Building/Testing.
The seven new tests are included in both relevant CI workflows. Hosted execution,
real operational recovery and authenticated staging remain unverified. No branch
was published, remotely merged or deployed by this follow-up.
