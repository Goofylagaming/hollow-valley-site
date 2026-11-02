# Hollow Valley website roadmap — 27 October 2026

## Scope and safety

Implement the public 31-item roadmap as small, reviewed website releases. Reuse
existing pages, auth, automation, ledgers and audit trails. New features may be
built while The Isle server is offline, but game-verified claims require the
authoritative automation feed or validated game evidence.

Develop on feature branches, run regression tests, review changes, rehearse
read-only workflows against staging, and request approval before merging or
deploying production. Never reset or copy over production player, wallet, Stripe,
storage, quest, group, skin, family-tree or Command Bridge data. No automated
coin payouts, restores or game commands are authorized by this plan.

## Current implementation inventory

- Roadmap item #7 Species Mastery is registered as complete (23/10/2026).
- #9 Nest Management is registered as complete (23/10/2026).
- #8 Dinosaur Family Trees is partially available through Valley Legacy.
- #13 Server Records is partially available through Valley Legacy.
- #31 Territory Wars is Building / Testing.
- Website already has Steam-linked profile XP, rank ladder and achievements.
- Website already has /healthz, /readyz, read snapshots and /api/server-status.
- Existing game status is automation-only; do not add direct RCON access here.
- A public status display must never imply Discord, marketplace or RCON health
  based on website liveness alone.

The above are repository records, not independent production verification.

## Delivery sequence

| Milestone | Public roadmap IDs | Deliverable | External dependency | Completion gate |
| --- | --- | --- | --- | --- |
| HV-W01.1 | 29 | Public read-only /status with process readiness, game state, snapshot age and stale/unknown display | Existing website endpoints | UI tests, route checks, accessible mobile layout, staging verification |
| HV-W01.2 | 25 | Admin-only searchable incident timeline | Existing audit log schema, permissions | Private data visibility and redaction tests |
| HV-W01.3 | 26 | Steam-authenticated reports with safe evidence links and moderation | Identity, reporting tables, admin access | File/link validation, abuse limits, privacy tests |
| HV-W01.4 | 29 | Independent health of Command Bridge, Discord, marketplace, Steam and Live Map plus verified incidents | Trusted component probes | Non-sensitive public output, alert dedupe, independent probes |
| HV-W02 | 1, 2, 7, 13 | Profile titles, badges, mastery links and existing records improvements | Existing player progression | No currency changes without approved rules |
| HV-W03 | 8, 9, 24 | Family tree / nests enhancements, gallery | Verified nesting history, moderated uploads | Never claim a player-advertised egg was hatched |
| HV-W04 | 21, 22, 23 | Skin collections and protected gifting | Skin ownership, immutable transfer records | No skin duplication or lost ownership |
| HV-W05 | 10, 11, 12 | Map discovery, journey history and death recap | Reliable timestamped game positions and combat logs | Opt-in privacy, no live-location leaks |
| HV-W06 | 16, 17, 18 | Group HQ, treasury and diplomacy | Group permissions and wallet ledger | Idempotent accounting and audits |
| HV-W07 | 3, 4, 14, 15 | Challenges, season rewards and event templates | Verified progress + events | Reward anti-farming tests |
| HV-W08 | 19, 20, 31 | Territory Wars, seasons and upgrades | Stable kill/claim recognition | Territory test suite and no false battle outcomes |
| HV-W09 | 5, 6, 27, 28 | Bounties, wanted system, spectator and compensation | Authoritative game signals and snapshots | Admin approval, anti-abuse and privacy |
| HV-W10 | 30 | Installable companion web app / desktop integration | Stable notifications and auth | Version compatibility and security review |

## HV-W01.1 — branch implementation

Development branch: feature/hv-w01-status-page-20261027.
This release uses only existing GET endpoints. The status page separates website
process (/healthz), local storage/readiness (/readyz), and automation-reported
game status (/api/server-status), refreshes each 30 seconds, and labels stale,
unconfigured and unreachable states correctly.

It deliberately does **not** add privileged game connectivity, persist public
incident history, expose names/IDs, or claim independent monitoring of RCON,
Discord, Steam, Marketplace or Live Map.

The public roadmap register keeps #29 in Building / Testing until production
release is verified, then it can become partial with remaining work described.
Do not mark #29 complete until all promised integrations are delivered.
