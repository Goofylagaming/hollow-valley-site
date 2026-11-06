# Valley Arcade v0.1 — implementation and release guide

Prepared 6 November 2026 (Australia/Brisbane). Not deployed.
Base: `bc8b62af90638dfc0b6e009b7ce514f62eadf979`, verified against GitHub master during implementation.
Working branch: `feature/valley-arcade-v01` in the isolated working copy.

## Approved launch content and staging update

The owner subsequently authorized configuration, staging and deployment, and selected ember, frost and forest skins. Launch content now lives in `automation-platform/src/data/arcade-launch-rewards.json`: three original earned-only palettes (Emberwake, Frostveil, Verdant Warden), fixed duplicate conversion, and dinosaur entitlements at 25/49/75/100%. Existing published skins remain unchanged. Run `node scripts/configure-arcade-launch.cjs` once on automation after backup; it validates and seeds only the new official IDs, refuses mismatched existing content, and applies tables idempotently. It does not enable the feature or issue player rewards. The original coin-only defaults described below remain the fallback for unconfigured installations.

Local launch checks passed: 1,153 automated tests, signed-in desktop/mobile browser flow, real HTTP skin unlocks, admin configuration, and all three textured previews without JavaScript errors. The preview page is `/arcade-skins.html`; visual results remain approximate and are not a claim of live-game application. The first browser readiness matcher timed out because it expected the wrong status text; the corrected check confirmed the textured preview was loaded.

## Existing patterns inspected

| Area | Existing implementation | Integration |
| --- | --- | --- |
| Auth/admin | `server/middleware/requireAuth.js`, session `req.user`, `is_admin` | Player identity and admin actor come from session; same-origin POST checks; private/no-store responses |
| Wallet | Website `routes/wallet.js` → `automationWebsiteClient.js` → automation `economyStore.js` | Same authoritative SQLite connection, wallet balance and immutable ledger; no legacy wallet changes |
| Database | Website `server/db.js`; automation `economyStore.js`, Node SQLite/WAL, additive schema initialization | New tables only; no table drops, rewrites, resets or production data copies |
| Skin Studio | `economy_skin_presets`, unlocks/grants; `skinPresetService.js`, `premiumSkinService.js` | Permanent zero-price unlocks in the existing ownership table; existing owners/grants count as duplicates |
| DinoStorage/My Stuff | Automation `dinoStorageService.js`, website `mydinos.js`, shared `common.js` rail | Separate owned dinosaur entitlements; links to existing storage; no synthetic live dinosaur files or RCON actions |
| Subscribers | `supporterWebhook.js`, `supporterCoinBonus.js`, `premiumSkinService.js`, monthly invoice/claim receipts | Existing deterministic VC/skin benefits unchanged; no subscriber crates, additional draws or altered odds |
| Arcade | Existing `valleyArcade.js`, `valleyArcadeGames.js`, website forwarding routes | Preserve six games, existing VC payouts/cap and emergency switch; opt-in daily free-play limits, XP and fragments |
| Audit | Existing automation `auditService.js` uses a separate store connection | New Arcade audit on the economy connection makes reward/audit atomic; exposed in Admin → Arcade |

## Delivered behavior

- `/arcade`: level/XP, balance, daily claim, free trivia/puzzle/dinosaur challenges, crates, visible odds, fragments, entitlements and opening history.
- My Stuff → Arcade and `/admin/arcade`: versioned reward-table editor, earned grants, totals and audit. Existing emergency controls remain available.
- Valley / Alpha / Prime / Event inventories. Each individual crate snapshots its original table and configuration version. Changing admin tables never changes an already-earned crate.
- Server-only cryptographic weighted selection, exact weights and displayed probabilities. Owned skins set to reroll are excluded and odds renormalized before selection; if all candidates are owned reroll skins, they convert to configured VC. No infinite reroll loop.
- Wallet ledger and crate consumption, skin unlock or dinosaur entitlement, opening result, request receipt and audit commit in one `BEGIN IMMEDIATE` transaction.
- Request keys are scoped by Steam account and reject conflicting actions. Already-opened crates cannot pay twice even under different keys. Concurrent workers serialize. Daily claims also have a natural Brisbane-day key.
- Verified quest/playtime/event/achievement awards can be granted through the admin interface with a stable evidence ID. No endpoint accepts client-supplied game scores or prize amounts from players.
- No payment route, crate purchase, wallet debit, staking, cash-out or transfer endpoint. Subscriber billing does not call the reward engine.

## Initial balance/content settings

Defaults are deliberately small and configurable: 6 daily plays, 25 daily XP, 75 XP and one Valley fragment per correct challenge, 500 XP per level, 100 levels. XP caps at 49,500. Every fifth level awards a crate; levels divisible by 20 give Alpha, and levels 90/95/100 give Prime. These are initial balancing defaults, not the illustrative cosmetic/skin-choice milestone track from the planning chat.

Fragment costs: Valley 10, Alpha 15, Prime 25, Event 10. Daily claim grants one Valley fragment. Plays reset at midnight Brisbane and do not accumulate. No subscriber XP boost is added.

Initial tables contain only VC at 90%/10% weights: Valley 500/2,500; Alpha 1,000/5,000; Prime 1,500/7,500; Event 2,000/10,000. Admin must approve balance and add real active Skin Studio preset IDs and intended dinosaur species/growth percentages before advertising those drops. A missing/deactivated winning skin fails without consuming the crate. No new skins or visual assets are fabricated.

Example entries in a family's JSON table:

```json
[
  {"id":"coins","label":"500 Valley Coins","type":"coins","amount":500,"weight":80},
  {"id":"skin","label":"Approved skin","type":"skin","presetId":"REPLACE_WITH_ACTIVE_PRESET_ID","duplicate":"convert","duplicateCoins":750,"weight":15},
  {"id":"dino","label":"25% Omniraptor","type":"dinosaur","species":"Omniraptor","growthPercent":25,"weight":5}
]
```

The editor validates active preset IDs, positive weights, coin limits, duplicate handling and growth 1–100. Config saves require the version loaded by the editor to avoid overwriting another admin's edits.

Dinosaur entitlement fulfillment is intentionally not automated in v0.1. Entitlements are durable and visible, with species, growth and a unique ID; there is no “redeem” button that could misleadingly promise an unimplemented storage transfer. Existing DinoStorage restore tooling is unchanged. A future controlled fulfillment workflow must include capacity checks and externally reconciled delivery before marking them redeemed. Automatic gameplay telemetry/quest/event ingestion beyond the existing Arcade games is also not wired; admin verified grants are the v0.1 entry point.

## Migrations and configuration

New automation tables: `arcade_rewards_config`, `arcade_profiles`, `arcade_daily_plays`, `arcade_fragments`, `arcade_crates`, `arcade_entitlements`, `arcade_reward_receipts`, `arcade_rewards_audit`, `arcade_play_receipts`. New indexes cover crate/entitlement ownership. Schema creation is repeatable. Existing SQLite files and mounts must remain in place.

- Both services: keep `VALLEY_ARCADE_ENABLED=1` for the existing Arcade; new `VALLEY_ARCADE_REWARDS_ENABLED=0` initially.
- Both services: retain `VALLEY_CASINO_WAGERING_ENABLED=0` if configured; new code has no wagering implementation.
- Website: retain `AUTOMATION_SERVICE_URL`, `HOLLOW_VALLEY_API_TOKEN`, `DB_PATH`, auth/session configuration.
- Automation: retain the authoritative `AUTOMATION_DB_PATH`, API token and persistent disk. Do not copy `.env` or production databases into a test checkout.
- The existing daily VC cap covers game payouts only. Crate VC prizes are separate earned rewards; Admin shows their aggregate issuance.

## Exact release sequence

1. Apply the supplied patch to the verified base or review/rebase it on current master in a release branch. Do not push directly to master: the repository auto-deploys website changes and automatically mirrors automation changes to the `automation-platform` branch.

   ```sh
   git switch -c feature/valley-arcade-v01 bc8b62af90638dfc0b6e009b7ce514f62eadf979
   git apply --check valley-arcade-v01.patch
   git apply --index valley-arcade-v01.patch
   npm ci --ignore-scripts --no-audit --no-fund
   node --test --test-concurrency=4 test/*.test.js automation-platform/test/*.test.js
   git diff --cached --check
   ```

2. Let the new Arcade Rewards CI and existing automation/website workflows pass on Node 22. Local validation used Node 24.22.0; Docker builds and hosted CI are not claimed as executed locally.
3. Deploy the reviewed revision to isolated staging website and automation services, each using its own test database and test API token. Never point a mutable staging website at the production automation service. Keep the new reward flag off initially; confirm existing wallet, Skin Studio, subscriber and DinoStorage pages still work.
4. Set the new flag to `1` on both staging services. In existing Arcade settings enable Arcade and leave emergency disable off. Visit `/admin/arcade`, approve tables, then test a synthetic Steam-linked account: daily claim twice, play/retry, grant/craft/open all families, unlock/duplicate skins, dinosaur entitlement, unauthorized access, and emergency pause. Confirm ledger and audit agree. This manual signed-in visual acceptance remains a release check; no real player account was used here.
5. Before production merge, create consistent backups through the existing backup mechanism for BOTH SQLite databases. Run `PRAGMA integrity_check` on backup copies and retain the backup identifiers. Record wallet/ledger/skin row counts. Do not copy a live WAL database file without its proper backup procedure, and do not replace production data with staging data.
6. Keep `VALLEY_ARCADE_REWARDS_ENABLED=0` on both production services. Merge only the reviewed passing revision. The website `hollow-valley-site` deploys master; the existing `Sync Automation Branch` workflow waits for website readiness, fast-forwards `automation-platform`, then waits for `hollow-valley-automation` readiness. Do not force-push that branch or manually rebuild persistent disks.
7. Verify the same merge SHA on both services:

   ```sh
   node scripts/verify-readiness.cjs https://hollow-valley-site.onrender.com MERGE_SHA
   node scripts/verify-readiness.cjs https://hollow-valley-automation.onrender.com MERGE_SHA
   ```

8. Initialize new automation tables if desired before enabling, from the automation service's `/app` directory with its existing environment:

   ```sh
   node -e "require('./src/services/arcadeRewards').schema()"
   ```

   The game play receipt table initializes on the first game start. Compare preexisting ledger/skin records with the backup; only new Arcade tables should have been initialized by the explicit migration.
9. Enable `VALLEY_ARCADE_REWARDS_ENABLED=1` on automation and website only after both revisions are ready. Approve content/config in `/admin/arcade` before granting crates. Check `/arcade`, My Stuff, Admin, and existing pages with an authorized account. Keep exact release evidence and do not mark the public roadmap complete until production delivery is verified. Arcade itself is not one of the 31 numbered roadmap items; their descriptions, voting eligibility and dates are unchanged.
10. Monitor new Arcade audit records and `arcade_crate` ledger entries. A timed-out action should be retried with the same request key; do not issue manual compensation without checking its receipt.

## Rollback

For an immediate reward freeze use existing Arcade emergency disable. For feature rollback, disable `VALLEY_ARCADE_REWARDS_ENABLED` on both services and retain all new tables, opened results, ownership and ledger entries. The previous six-game Arcade behavior resumes when the new flag is off. Roll back code only after services agree on flags. Never restore an old database over new player activity or delete new tables as routine rollback. Investigate any discrepancy using crate ID, request receipt, ledger reference and audit before making a data correction.

## Validation

The full website + automation suite passed locally: **1,150 tests, 0 failures, 0 skips**, Node 24.22.0, approximately 29 seconds. Coverage includes existing Wallet, skins, DinoStorage, subscribers, progression and live-site routing. New tests cover migration repeatability/data preservation, Brisbane rollover, weighted boundaries, table snapshots, ownership, key conflicts/retries, wallet/audit rollback, fragment exhaustion, skin conversion/reroll, dinosaur entitlements, admin/auth/CSRF, feature flags, free-play limits, milestones and simultaneous database workers. JavaScript syntax checks and `git diff --check` also passed. The initial restricted localhost run could not connect; it passed when rerun with local test-server access.

No production changes, deployment, production reward grants, real account actions or database resets were performed.
