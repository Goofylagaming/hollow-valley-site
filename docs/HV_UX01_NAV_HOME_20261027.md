# HV-UX01 — Hollow Valley navigation and homepage restructuring

Created: 27 October 2026. **Feature branch / draft PR only, not deployed.**

## Why

The homepage put the complete 31-feature roadmap before everyday player tools.
The shared top navigation grew too long and competed with Steam sign-in, while
visitors had no single landing area for dinosaur history, community and support.

DinoDen is a general **information architecture** reference, not a template or
asset source. We have not copied its branding, images, written content or rules.

## Changes

- Main navigation groups **My Stuff**, **Marketplace**, **Community**, **Help**
  and admin-only **Admin**. Wallet, Quests, Live Map and Supporter remain
  direct links. The Hollow Valley logo links home.
- Existing user routes, Skin Studio, My Dinos, DinoStorage, Friends,
  Group invites, marketplace listings, Events, leaderboards, Valley Legacy
  (when enabled) and separate Primalbound game are preserved.
- Navigation opens on button click/keyboard and closes on click-away or Escape.
  Mobile menu groups expand without cutting off account controls.
  Hidden admin-only links and feature-flagged Valley Legacy remain hidden.
- The homepage puts the logo/server information and existing player tools
  first. Personalised summary uses the existing read-only dashboard, wallet,
  progression and game-status endpoints. The full original roadmap and voting
  controls are moved below community navigation, without changing feature
  eligibility or votes.
- New \`/help\` is a **directory** to existing player tools and the Discord
  invite. It does not invent rules, guarantee staff availability or describe
  planned tickets/reports as live.
- A sidebar label that linked to Quests is corrected from "My Reports" to
  "My Quests"; its destination is unchanged.

## Safety / non-goals

No SQLite table or API contract changes, reward alterations, wallet writes,
Stripe payment changes, RCON commands, Discord bot tokens, DinoStorage actions,
server-side secrets, production DNS or game-side files are in scope.

**Do not merge automatically.** Changes touch the shared homepage and nav;
PR #233 also modifies the homepage/status display. Rebase and reconcile both
changes after upstream PRs settle. PRs #235/#237 add future support-related
routes and must not be shown as live before their respective releases. The
Discord release notification PR #236 is separately in review.

## Verification gate

1. Run \`node --test test/hvUx01NavigationHome.test.js
   test/dinoNavigationSeparation.test.js test/primalboundNavigation.test.js
   test/roadmapFrontend.test.js test/productionUiRelease.test.js\`.
2. Run baseline and all feature-preservation checks on the actual candidate.
3. Use GitHub Actions' isolated browser staging (no production database or
   real Steam/game writes) at 390px, 768px, 1051px and 1440px.
4. Check guest and signed-in navigation; dropdown keyboard controls; hidden
   admin and Valley Legacy links; wallet/quests and Primalbound accessibility.
5. Verify the old roadmap has 31 descriptions, votes and suggestions intact.
6. Confirm Help and all other links resolve; do not publish dead placeholders.
7. Review code, production backup state and deployment conflicts. Explicit
   approval required before production deployment or live announcement.

## Next website releases

- HV-UX02 — First-party rules directory and pack limits based on approved
  Hollow Valley rules, not copied DinoDen species limits.
- HV-UX03 — Patch notes and development updates with a verified GitHub/Discord
  publishing source. Don't label unmerged work as live.
- HV-UX04 — Private support hub building on player reports when that PR ships.
