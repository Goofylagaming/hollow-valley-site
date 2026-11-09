## Verified W70 completion — 10 November 2026, 08:28 AEST

LIVE game commit `5ebfccaaad8d0751e16c1d1b61d1664836732999`, manifest `eebdbfbd252ad046be6a3152bd4dd893212a1a74137bb0687b230e73e69d47ee`, fourteen ordered notes and Web save format **32**. The five W66–W70 how-to chapters document actual Legacy investments, mastery branches, habitat upgrades, recessive genomes and collection rewards. Candidate verification: 1,587 Web, 61 cloud and 100 browser cases. All earlier chapters, archives and the separate World guide remain unchanged. This documentation update does not modify gameplay, player data, DNS or other services.

# Primalbound Wiki Integration

**Current verified Web guide: W65 Difficulty Ladder (9 November 2026, 20:38 AEST).** Web Preview Render service `srv-dbbd4j6q1p3s73c5uacg` reached LIVE commit `c4a89d4a28fec23e1686b035491414f6b0655f77`. The successful production build passed **1,458 Web tests (zero failures; zero skipped)**, generated `dist/build-manifest.json`, passed its unchanged bundle budget and attached eight ordered notes for gameplay manifest SHA-256 `ff3d6bf61f0efb1371619a0dce6df94dfea36a4f7faf8b57085abf7caa8d3402`. Documentation covers opt-in Veteran/Apex sequential stage gates, ×1.35/×1.20 and ×1.80/×1.50 enemy difficulty, first-clear-only ×1.5/×2.5 Bones/Prime, read-only review, no-entry-cost fights, zero-reward replays, duplicate/cloud safeguards and independent saves. **Web format 30** remains unchanged with an optional version-1 ladder record. The W64 Gear Forge, bundled W62/W63.1 and every older W27.1–W31.2 guide chapter and World M36.7 instructions remain preserved. No separate W65 World release exists.

**Publication remains gated:** Merge documentation-only source and website PRs only after tests, run staging/noindex and production static CI, and manually deploy only approved Primalbound static Render site `srv-dbfd3t29lscs739ls85g` (autoDeploy off). Do not publish a gameplay branch or update player accounts/saves from this documentation work.


**Current verified Web guide: W64 Gear Forge (9 November 2026, 19:23 AEST).** LIVE Web Render commit `7cd7f1d52d1a452d889d6925d3f1b5e3c38e431e` passed **1,373 tests (zero failures)**, generated `dist/build-manifest.json`, passed the bundle budget and attached seven ordered gameplay notes against manifest SHA-256 `9839b909f2258a2594db4751c439da2d2ae57dc9219677d56fb227050449ac7b`. How-to instructions now cover chosen-level upgrades, exact duplicate use, deterministic same-set/tier slot reforging, reviewed salvage, lock/assignment protections and unchanged **Web save format 30**.

**Previous verified Web release: W62 Automation 2.0 + W63.1 Boss Tactics**, bundled in **one** LIVE deployment at `ab01ecd3aab3c87639fb54c2231e4be7e0e903b2` on 9 November 2026 at 18:19 AEST. 1,283 tests and eight reviewed notes match manifest `cb4ab4c65022e482507adac79212272fe82c67ca350ad26576642c1a1444f71d`. Its complete guide chapters explain six safety profiles, target/fight/power/stamina/health/storage stops, safer online/offline continuation and boss phase/signature briefings. No separately LIVE W62 deployment is claimed. All older W27.1–W61.2 and World M36.7 guide content, historical notes and independent save-compatibility instructions are preserved. No Web↔World save migration.

**Publication gate:** The documentation-only site PR must pass both staging/noindex and production static builds; the approved Primalbound Render static service remains manual-deploy-only (autoDeploy off). The World wiki snapshot, other services, DNS, gameplay and player data are not part of this release.

**Current verified Web guide: W61.2 Buildcraft Comparisons (9 November 2026, 14:48 AEST).** LIVE Render commit `d4d394c034014a2a88114208ab40114299065cc8` passed **1,170 tests (0 failures)**, emitted `dist/build-manifest.json` and attached all six ordered patch notes against gameplay manifest SHA-256 `1930071fd3f7ace18ed76f78fc29e81d803525fd3b3316dce9dd279f699d540f`. The wiki now explains the on-demand, read-only **Before vs After starting Attack/Health** comparison, signed changes, formation effects, expandable companions/abilities/behaviours/set bonuses, and safe fallback when the preview download fails. Starting stats are **not** predictions or frozen Rift/expedition crew previews. **Web save format 30** and existing named presets, gear-only operations and atomic activation protections remain unchanged. Detailed W61.1 and older W27.1–W60 how-to chapters and every historical patch-note entry are preserved. Separate World M36.7 guidance and saves are unchanged.

**Previous verified Web guide: W61.1 Buildcraft Foundations (9 November 2026, 10:16 AEST).** LIVE Render commit `a806169d8cd2503d4453fc3f38c7bf7890bdc1c0` passed **1,139 tests**, emitted `dist/build-manifest.json` and attached eight exact-order notes with gameplay manifest SHA-256 `ec5b568c8a576a5a5986f9e0bbb87d8db4fdf34d01c4f908e53f1197777873d9`. Web **save format 30** is unchanged; existing named equipment builds are compatible. The guide and `web/wiki/index.html` static snapshot explain gear-only versus reviewed atomic equipment + battle-party/formation activation, mission/Offline Journey/Ancient Rift locks, recovery and separate World saves. `release-archive.json` preserves the exact eight notes and every previous Web/World entry. The prior W60 release description and older how-to instructions below remain historical records.


The live Primalbound Render static service builds `brand-sites/dist/primalbound`.
The existing homepage, `/web/` and `/world/` are preserved.

The Web wiki snapshot, historical release archive and verified notes also retain the **9 November 2026 (08:25 AEST) W60 LIVE release** (commit `73db44a88f5473c5914a1ed305f383e982cdfdc9`, **1,074 passing tests**, 16 ordered W60 notes matching gameplay manifest SHA-256 `1abcdee097891076375d07610bd4e69d0d9185b7e917f31baf356ca2ba8db58d`, unchanged Web save format **30**). **W51–W59 are feature increments bundled into the verified W60 build, not separately asserted LIVE releases.** The W50 release and bundled W44–W49 content remain archived, as do the W43 (Web format 30), W42 (format 29), W40.5 and earlier patch notes and W27.1–W31.2 how-to backfill. The World wiki snapshot and release archive still include the published M36.7 Windows ZIP released 6 November 2026 (tag `m36-7-build-42133151186`), with M36.6 and earlier World notes intact. World schema 330 and its profiles, recovery and launcher remain separate from Web.

The last build step in `brand-sites/build.mjs` imports `publish-wikis.mjs`, which replaces only:
- `/web/wiki/index.html` (Web Preview W60 verified how-to, including W51–W60 Rift/Survey/gear/training/offline Chronicle updates, format-30 compatibility, W44–W50 events, world map, mastery, habitats, breeding, profile/share codes and Ancient Rift, Web format-30 safety, and W27.1–W43 save compatibility, Bleed/Poison/Vulnerable, Guardian warnings, Auto Journey, sweep queues, offline work, Prime Ascent, format-30 backups, earlier workspace navigation, Pack Bonds, behaviour specialisations, field focuses, companion retirement, breeding pair plans, Prime Forge preparation, format-29 history, and older W40.5 device/account recovery, Field opportunities, regional research, loadouts and targeted fossil recovery; all W38.0 and earlier chapters retained)
- `/world/wiki/index.html` (M36.7 Windows playtest; preserves M36.6 wild species and checksum recovery, adds Guardian/companion species visuals, launcher and courtyard guidance, unchanged World schema 330)
- `/assets/wiki.css`
- `/assets/wiki.js`

Source snapshots in `brand-sites/wiki-source/` come from
`Goofylagaming/primalbound`, branch `notes/primalbound-world-parity`,
generated from the two canonical player guides:
`docs/PRIMALBOUND_WEB_COMPLETE_PLAYER_GUIDE.md` and
`docs/PRIMALBOUND_WORLD_DESKTOP_COMPLETE_PLAYER_GUIDE.md`.

To update guide content: update the guides in Primalbound first, rebuild the wiki static output using
`node site/scripts/build-wikis.mjs`, copy the four resulting files to `brand-sites/wiki-source/`, run the brand build and verifier on staging, then deploy with production approval.

The staging build injects `noindex,nofollow` into the two wiki pages. Production build omits it.
The wiki uses a single same-origin, static JavaScript search file. No login, iframe, database, game API calls, analytics or third-party scripts are introduced. Game services, saves and other sites are not modified.

## Automatic documentation and patch notes

The website now has three public patch-note routes:

- /patch-notes/
- /web/patch-notes/
- /world/patch-notes/

Each wiki has a **Recent guide updates** panel populated from the same reviewed release notes as the dedicated pages. The core chapters remain version-labelled; new gameplay is not claimed as having been independently re-audited just because a release summary appears.

### Verified sources

- **Web**: the most recent **successfully deployed Web Preview** release-info.json from https://primalbound-web-preview.onrender.com/release-info.json. The Web build itself rejects notes that do not match the compiled game-asset manifest.
- **World**: non-draft, non-prerelease published Windows release records from https://api.github.com/repos/Goofylagaming/primalbound-downloads/releases. Branch commits and CI artifacts alone are not evidence of a public release.
- Historical verified entries are retained in release-archive.json; a future release must be added to the archive even if the player skips versions, so old patch notes remain accessible.

The browser checks the read-only release feeds on page load. It uses no credentials, storage, cookies, player accounts or game APIs, and all remote text uses DOM textContent (never untrusted HTML). If a feed cannot be reached, the verified pinned archive remains visible and the page reports that it is showing cached notes. Web cross-origin retrieval may depend on Web Preview sending an appropriate CORS response.

### Long-form guide updates

Reviewed gameplay releases should also update the detailed Markdown guide and the corresponding Notion guide, especially when instructions, key bindings, balance, save formats or recovery procedures change. The wiki addenda show immediate verified release summaries, **not** fabricated documentation. During the recurring documentation synchronization, apply the reviewed notes to the correct sections, rebuild the static wiki snapshots and use the existing staging + CI + Render production checks.

Never silently rewrite player saves, the game, its databases, DNS or the separate Hollow Valley website as part of documentation sync.
