# Treasury catalog operator review

This local host-operator workflow reviews one Treasury item at a time. It does not approve prices, enable Treasury rollout, move coins, refund purchases, deploy services or provide an external event-delivery adapter. No live catalog has been configured by this implementation.

Access to the automation host/database is the authorization boundary. The supplied reviewer Steam ID is an audit attribution, not proof of login. Do not expose this command as a public endpoint or give website users filesystem access. The website integration token has no catalog-writing API.

## Item file

Supply an operator-approved JSON file with exactly `id`, `revision`, `title`, `description`, `cost`, `purpose` and `target`. `revision` and `cost` must be positive safe whole integers; cost is in Valley Coins. Cosmetic purpose is `group_cosmetic`, with target `{ "kind": "profile_frame", "value": "fern" }` (also `sandstone` or `night`). Prices are a product decision and must be reviewed separately; the tool supplies no default prices. Extra combat/stat fields are rejected.

Territory targets can be staged for review. Activation additionally requires automation GROUP_TREASURY_TERRITORY_ENABLED=1 and a configured dedicated proof key. Website entry also requires its matching flag, proof key and existing Territory runtime flag. Leave them off until approved policy/prices and staging evidence are ready. Group event-registration activation additionally requires GROUP_TREASURY_EVENT_ENABLED=1 and a fresh, visible, explicitly scheduled future target in the trusted event snapshot. Website purchases require the matching website flag. Activation never changes these flags or approves actual prices.

## Review, stage and inspect

Run from the repository root using Node 24. In these examples, `$itemFile`, `$economyDatabase` and `$reviewerSteamId` must be set to the reviewed file, the existing authoritative automation database and the actual acting operator's Steam ID. Never use the website Groups database. Keep rollout flags disabled during preparation and rehearse against a backed-up staging database first.

```powershell
node scripts/review-group-treasury-catalog.cjs review --file $itemFile
```

Review prints canonical item details and their SHA-256 digest without opening a database. Check the full title, purpose, target, revision and cost. Set `$reviewedDigest` to the exact digest of the approved output; then stage that content:

```powershell
node scripts/review-group-treasury-catalog.cjs stage --database $economyDatabase --file $itemFile --reviewer $reviewerSteamId --digest $reviewedDigest
node scripts/review-group-treasury-catalog.cjs inspect --database $economyDatabase --id $itemId --revision $itemRevision
```

Stage registers an immutable revision disabled by default and records its reviewer. Exact retries return its current status without disabling an already active revision. Changing the same revision's content is rejected; use a new revision. Missing database paths and databases without the authoritative economy tables are rejected. Inspect opens read-only and reports the stored item, digest, current availability, active revision and audit history.

## Activate or retire

After inspecting the stored item, set `$reviewedDigest` from that output and `$expectedActiveRevision` to the shown active revision, or the literal string `none` when there is none. Activation is a separate explicit action:

```powershell
node scripts/review-group-treasury-catalog.cjs enable --database $economyDatabase --id $itemId --revision $itemRevision --reviewer $reviewerSteamId --digest $reviewedDigest --active-revision $expectedActiveRevision
```

The command compares both item digest and active revision while holding the same database write transaction that changes availability and records audits. A competing operator's activation makes the review stale. Inspect and review the new state before deciding again. Activating a new revision disables the previous active revision of that item in the same transaction. An audit failure rolls both changes back.

To retire a revision, inspect it again and use the same options with `disable`. Retirement stops new reservations for that revision; it does not cancel accepted holds, revoke paid frames or refund committed purchases. Accepted reservations retain their original price. Neither activation nor retirement changes the Treasury donation/spending rollout flags.

Keep the review output with the change record. Confirm only the intended revision is visible through the private catalog read and authenticated staging Groups page before any separately approved production rollout.

## Local evidence

Nine dedicated tests use synthetic prices and temporary databases. They cover read-only review, exact content matching, no accidental database creation, wrong-database rejection, immutable revisions, activation/retirement audits, stale reviews, rollback on failed audit, gated Territory/event activation, stale or unknown event rejection and paused retirement, independent-process persistence and competing operator activation. These checks do not constitute live price approval or authenticated staging evidence.
