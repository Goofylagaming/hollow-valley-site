# Hollow Valley Test — consolidation readiness (2026-10-17)

## Approved target layout
- Retain production `hollow-valley-site` on `master` and `hollow-valley-automation` on `automation-platform`.
- Retain `HerbyBot` worker on `main`.
- Consolidate test website under the existing `hollow-valley-ui-v2-preview` service, eventually named `Hollow-Valley-Test`.
- Retire `hollow-valley-site-test` only after data/configuration checks.
- Retire `herbybot-territory-preview` only after preview-specific functionality is verified in the retained HerbyBot and test environment.
- Never modify or merge `hollow-valley-skin-v012-preview`.

## Verified Render inventory
| Service | Branch | Region | Disk |
| --- | --- | --- | --- |
| hollow-valley-ui-v2-preview | test-ui-v2 | Singapore | /app/data, 1 GB |
| hollow-valley-site-test | automation-platform | Oregon | /app/data, 1 GB |
| hollow-valley-site | master | Oregon | /app/data, 1 GB |
| hollow-valley-automation | automation-platform | Oregon | /var/data, 1 GB |
| HerbyBot | main | Oregon | no attached disk in API listing |
| herbybot-territory-preview | territory-wars-preview | Oregon | no attached disk in API listing |
| hollow-valley-skin-v012-preview | skin-studio-persistence-v012 | Singapore | no attached disk in API listing |

## Application dependencies and migration blockers
1. `server/db.js` uses SQLite `DB_PATH` (otherwise `data/hollowvalley.sqlite`). `server/sessionStore.js` stores session records in that database. **Verify that each website service's DB_PATH points to its mounted /app/data disk** before moving or deleting anything.
2. Separate persistent disks are not shared between Render services. **Back up and inspect the legacy test database, then make an explicit decision whether to migrate relevant test records or keep the existing UI-v2 database**. Never copy production SQLite data into test without deliberate review.
3. Website → automation connections use `AUTOMATION_SERVICE_URL`, `HOLLOW_VALLEY_API_TOKEN`, and some admin endpoints require `AUTOMATION_ADMIN_TOKEN`. Check presence and target service without copying secret values into GitHub.
4. Keep current, working Discord and Steam OAuth redirect settings. Any service rename/domain cutover can change hostnames and callback matching; preserve functioning authentication and perform redirect changes only during an approved cutover.
5. Existing HerbyBot `main` includes `/territory` code; however preview `territory_preview_bot.py` includes simulation commands. Audit dependencies and decide whether preview-only test tooling remains necessary before retiring the preview service.
6. `master` and `test-ui-v2` have significantly diverged. **Do not merge `master` wholesale or change production**. Selectively backport features with route/DB/automation tests.

## Reconciliation matrix
| Feature area from master | Status / next step |
| --- | --- |
| Admin event deletion | Staged as draft PR #194, not yet tested/deployed |
| DinoStorage recovery and parked mutations | Requires automation service compatibility and mutation regression tests |
| Marketplace 49% growth and DinoStorage stat visuals | Compare scripts with UI-v2 DOM before backporting |
| Combat-feed / leaderboard corrections | Compare API contracts; test forwarder deduplication and death suppression |
| Prime persistence and Windows forwarder installer | Game-server-side operations; do not mix into test web service migration |
| Skin models/skin-studio fixes | Deferred from this consolidation; skin-v012 preview must remain isolated |
| Steam/Discord accounts | Already working; no changes planned |
| Territory Wars/UI-v2 map | Preserve the preview implementation and keep gameplay tests separate |

## Safe cutover checklist
- [ ] Read-only verify environment variable presence and DB mount/path on retained test service.
- [ ] Back up legacy and retained test databases; compare schema and record counts without exposing player identifiers.
- [ ] Verify new consolidated code in PR, test routes, admin-only permissions, and smoke-test UI.
- [ ] Decide canonical test URL and confirm OAuth configurations without changing working live login.
- [ ] Deploy to existing UI-v2 service, then validate Steam/Discord, Wallet, events, Groups, Territory Wars and Live Map.
- [ ] Verify HerbyBot production command parity and preview simulation tooling.
- [ ] Document rollback using existing Render services and deployed commits.
- [ ] Only then rename retained test service and retire redundant services after an explicit final verification.

## Current state
Draft PR #194 is staging only. No Render service has been renamed, deleted, merged, or reconfigured. This document is a plan and dependency record, not proof of completed database migration.
