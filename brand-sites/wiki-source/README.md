# W82.3 verified game receipt — 19 November 2026 (AEST)

**Official game publication verified; public guide source finalized.** The normal [production validation run 44424488241](https://github.com/Goofylagaming/primalbound/actions/runs/44424488241) succeeded on production merge `610ec37ee3c0a2e1ca2320291a893ba5c5d405a3`. Its [full verification job 135225676193](https://github.com/Goofylagaming/primalbound/actions/runs/44424488241/job/135225676193) passed **1,770 Web and 226 server tests**. Its [deployment verification job 135227110941](https://github.com/Goofylagaming/primalbound/actions/runs/44424488241/job/135227110941) verified all four game hosts, including **https://primalboundgame.com/web/** at **2026-11-18 23:57:21 UTC**, or **19 November 2026 in Australia/Brisbane**. The game release is **W82.3 — Stone & Wild: Complete Creature Artwork**. Static guide deployment and visibility are recorded separately by release coordination. The separate normal game-announcement receipt is recorded below.

The verified deployment serves **172 exact portrait files: 119 new and 53 retained**, with **217 assets and 98 lazy chunks**. Accounts and cloud saves were true on the three account-enabled hosts. Live HTTP 200 metadata from both Render game origins confirmed release `610ec37ee3c0a2e1ca2320291a893ba5c5d405a3`, notes identity `6fa81e78237002f98373e64c25dd3f58953c6ab9`, gameplay manifest `04672e75087ccd01a1de032cf5e2a06f36cf5bdc012759f8988a84f1d9cc774c`, and artwork revision `c04893276333a5ade1f2dd4e59833b1e536f0ff9e594df24a5ef25772ef8908c`. The two branded hosts returned 403 to this local environment; their exact release and asset bytes were independently verified by the normal all-four-host deployment job linked above. The canonical metadata source remains **https://primalboundgame.com/web/release-info.json**.

PR 174 merged normally at `2026-11-18T23:53:08Z`. Its tree `aff9c73301662aac4fe000fdbc814882b9fd9274` matches final tested candidate `28b9f427265fd5fdad6bd43c5382274711173574`. Release coordination also confirmed the candidate's **59 native UI/art, 199 retained-browser and 5 PostgreSQL cases**. The exact production notes file was independently fetched through GitHub and matches the title and all five ordered strings; its source Git blob is `3ada308e9dadf97425d8f659a31a109a6946bc1d`, distinct from the live `notes_commit` identity above. No synthetic local commit is used as the release version.

**Separate normal game-announcement receipt.** At `2026-11-18T23:58:20Z`, HerbyBot reported exactly one announced `web:6fa81e78237002f98373e64c25dd3f58953c6ab9` event. The visible saved message is `1572762914991902932` in Web channel `1563299603863052381`, part 1, with the complete result reporting `hasMore=false`. The patch notes, exact production build and five ordered bullets were verified. This records the completed game announcement; it does not publish the static guide or require another game announcement.

The public source baseline is `Goofylagaming/hollow-valley-site`, branch `production/brand-websites-20261026`, at `e7a832744beb97d2a502035d2fe7eaf2fb1eb2b9`, tree `7359bfa88def21ed6b22266f64b0bc13eb3c5737`. All **29 branded-site source blobs** plus the repository's **AGENTS.md** were fetched from that exact revision and matched byte-for-byte before editing. This workspace contains the complete branded build input and no private game source. Preserve unrelated repository files using the canonical remote base tree when publishing.

The durable player chapter is **`web/w82-3-complete-creature-artwork-guide.md`**. The finalized guide retains all **83 previous topic IDs in order** and adds one artwork chapter for **84 topics**. All **82 previous non-overview topic sections** remain byte-identical. Historical W82.1/W82.2 artwork descriptions remain historical records; the new chapter explains completed coverage. The latest overview, version badge and introduction now identify verified W82.3. The player-facing release paragraphs contain a brief date, gallery summary and directions, with engineering provenance kept in this README and archive metadata.

The archive preserves all **34 previous Web entries** and **15 World entries** unchanged. The added **W82.3** entry brings Web history to **35 entries**, carries the exact five reviewed artwork notes, and records `published-official-web` on **2026-11-19**, using the actual production merge and verified live notes identity. It keeps the tested candidate separate from the production version and includes the normal run/job links and verification scope.

The chapter explains the **97** formerly unpictured creatures, **20** replaced SVG drawings, **2** replaced hybrid composites and **53** retained individual portraits. Pictures are shared across Sanctuary, Codex, Armoury, fieldwork, Habitats, the DNA Lab and battles, while same-name and bred companions keep separate individual records. Gameplay and **Web save format 34** remain unchanged; **W83 remains next**, Season Zero remains unscheduled, and World/Desktop remains separate.

The only intended public source changes are this README introduction, `release-archive.json`, `web/wiki/index.html` and the new `web/w82-3-complete-creature-artwork-guide.md`. Final handoff requires `node brand-sites/build.mjs`, `node brand-sites/verify.mjs`, `node brand-sites/build.mjs --production` and `node brand-sites/verify.mjs --production`, plus preservation of historical topics, prior archive entries and unrelated output. Local build scripts use the word "Published" for generated files; those local runs do not deploy anything. Remote commits, public guide deployment and visibility checks remain release-coordination actions; the normal game announcement is already verified above.

The existing `AGENTS.md` roadmap-voting register applies to the separate 31 Hollow Valley roadmap features. This Primalbound documentation change implements none of those features and changes no voting eligibility, votes or release-register status.

---

# W82.2 verified game receipt — 19 November 2026 (AEST)

**Official game publication verified.** [Normal production CI 44367193446, verify-deployment job 135026386131](https://github.com/Goofylagaming/primalbound/actions/runs/44367193446/job/135026386131) verified **Stone & Wild: Fieldwork, Gear & Habitats** at Web build `43dbf0821227a841b1557b588f156f37daff1a5c` across all four game hosts, including the official `https://primalboundgame.com/web/` address, on **19 November 2026 (AEST)**. The retained unmodified [cloud-host release metadata](https://primalbound-cloud-preview.onrender.com/release-info.json) matches that exact release; it is the metadata source for this local receipt. The independently verified promotion candidate is `bbc61a4dbbb72b150d6891f8941e14d7c4d3d910`. Its exact five ordered notes retain identity `babd726bae98a8ee10dcd0e4439eab5e76fd7378` and gameplay manifest `32a9c31fea451f333438a952e81014686106fc6b7e0913dfe57f960c5d5332de`. This receipt finalizes the player guide source for publication; static guide deployment and announcement receipts remain separate release actions. Canonical game release source: [https://primalboundgame.com/web/release-info.json](https://primalboundgame.com/web/release-info.json).

The public source baseline is `Goofylagaming/hollow-valley-site`, branch `production/brand-websites-20261026`, at `79d29e127dc82d1dbc3c0ffec290dabf663dac10`, tree `a452100be5350ad9323492ee7110dff5de688ada`. All 28 branded-site source blobs and this repository's `AGENTS.md` were matched byte-for-byte before editing. The complete branded build input is present; unrelated application/server files are outside this documentation-only working snapshot and must be preserved using the canonical remote base tree when publishing.

The durable player chapter is **`web/w82-2-stone-wild-guide.md`**. The prepared richer branded snapshot retains **83 Web topic IDs in their existing order**, with all **81 older non-overview topic sections byte-identical**. Finalization changes only the W82.2 publication paragraph, the overview/version/introduction, the new archive entry and this README introduction. Do not replace this snapshot with the shorter canonical generated handbook. All **33 previous Web entries** and **15 World entries** remain unchanged; W82.2 brings the Web archive to **34 entries**.

This pass documents Operations route/crew/dispatch/cargo views, the Armoury's individual companion dossier and five workspaces, permanent Journey goals and profile/offline/loadout controls, and Habitat portraits/search/24-resident pages/family grouping/decorations. It reuses existing artwork and gameplay rules. The numbered roadmap remains at W82, W83 is next, Web format 34 is unchanged and no Season Zero launch is claimed. World/Desktop content remains separate.

Before publishing this finalized source, run `node brand-sites/build.mjs`, `node brand-sites/verify.mjs`, `node brand-sites/build.mjs --production` and `node brand-sites/verify.mjs --production`. Confirm the old chapter/archive preservation and review the intended Web guide/patch-note output. Release coordination owns remote writes, merging, deployment, public visibility and the normal HerbyBot receipt; this source finalization performs none of those actions.

The existing `AGENTS.md` roadmap-voting register applies to the separate 31 Hollow Valley roadmap features. This Primalbound guide-only change does not implement those features or alter their eligibility/votes.

---

# W82 and W82.1 guide preparation — 18 November 2026

This documentation batch separates the shipped **W82 Season Challenges and Saved Rewards** release from **W82.1 Stone & Wild UI**, the first interface integration. W83 remains the next gameplay milestone. W82 is the verified game release `22fca6ae6ae9a8a9755440d2c7949ad4ae209e1c`, with five ordered notes identified by `bed1d0947658a7d26d0b2feb096b09a78378cc25` and gameplay manifest `41f0f46d72f2b6ecc1ef116412e63d34e1aa3fd5500dd14974fd66abb92d34d7`.

**Official UI publication verified — 18 November 2026.** The official `https://primalboundgame.com/web/` game, release metadata and asset manifest serve `f5c57b5c588e0bd7bf20b3ca1a75bbabd3e80cdf`. The account/cloud deployment reached live at **13:13:22.623004 UTC** (23:13:22 AEST). The separate static mirror completed the same release at **13:17:56.272874 UTC**; both live deployment states were independently observed at **13:18:15 UTC**. The reviewed promotion candidate was `b9184b8d6d1bf24e1d13db1ce58fee14b7be140d`. Its exact five UI-only notes retain identity `df59780a3d8f988ade5bb0749672f8245e0827e4` and gameplay manifest `2420ad5381dca8ead4f8bdc9b1301a0a7632f84265806c5a600d6f46b8e7b97f`; the official entry asset is `assets/index-B8PJew4h.js`. The UI archive uses the actual promoted release SHA and actual publication date. W82 keeps its separate receipt and notes. This guide receipt covers the verified official game and account service; the complete rollout, including the separate static mirror and announcement receipt, is recorded in [Primalbound PR #171](https://github.com/Goofylagaming/primalbound/pull/171).

The source baseline is `Goofylagaming/hollow-valley-site` branch `production/brand-websites-20261026` at `0ffc9b94896759986d0068ac0fd8841525165b79`. The current branded Web snapshot has **80 existing topic sections and stable chapter IDs**. It is richer than the 51-topic HTML currently generated by the separate Primalbound docs branch `docs/primalbound-w81-1-howto-sync-20261111` (`bcd0660eb3b7d608b8f5e6398691e092cf5c6439`). Replacing the branded snapshot wholesale with that older generated output would remove backfilled chapters and break established links.

## Durable source and additive update path

The new player instructions are retained in **`web/w82-stone-wild-guide.md`** alongside this publisher's actual HTML source. Corresponding additions to `docs/PRIMALBOUND_WEB_COMPLETE_PLAYER_GUIDE.md` and its generated `site/dist/web/wiki/index.html` are retained on the private [Primalbound documentation branch `docs/primalbound-w82-1-guide-20261118-f5c57b5`](https://github.com/Goofylagaming/primalbound/tree/docs/primalbound-w82-1-guide-20261118-f5c57b5), based on the exact Primalbound docs-branch baseline. The matching branded-site source is prepared on `docs/primalbound-w82-1-wiki-20261118-f5c57b5` for coordinated publication. The existing generator `site/scripts/build-wikis.mjs` renders the Markdown; only its two new complete `wiki-topic` sections are copied into this branded snapshot, with matching chapter navigation links. This preserves every existing topic section and ID; only the overview/version/save-status text changes. Keep using this additive path until the older canonical renderer/source and all 80 branded chapters have been deliberately reconciled. A routine rebuild must not replace the richer branded source with the shorter canonical file.

The new section IDs are `newer-web-preview-features-w82-season-challenges-and-saved-rewards` and `newer-web-preview-features-w82-1-stone-and-wild-ui`. Existing World instructions, archived Web and World entries, branding routes, assets and other brand sources stay intact. The build now publishes 82 Web topics. Seven painted portraits and the first UI pass are documented accurately; Nightfall and Frostbane retain composite artwork. W82/its UI use save format 34. No season launch or W83 completion is claimed.

Build and verify the unchanged staging and production scripts before publication: `node brand-sites/build.mjs`, `node brand-sites/verify.mjs`, then `node brand-sites/build.mjs --production` and `node brand-sites/verify.mjs --production`. The existing manual Primalbound static service is `srv-dbfd3t29lscs739ls85g`; autoDeploy remains off. Parent release coordination owns all pushes, merging and deployment, and verifies the public game, matching guide and HerbyBot's saved visible notes. This local preparation publishes no service or announcement.

---

# Community safety, verified 11 November 2026

Canonical Primalbound Web game build `066d29b7427ef500f297e60b2f69c9b04f90ad55` was verified live at 2026-11-11T01:17:39Z (11:17 AEST). Reviewed notes `2514da2ce907f51f3ebaceba6340462b8eb28630` match gameplay manifest `4572e18e0f2893d93f370578a07816dc5808af71458b93d978affdea60e864b5`. PR160 selectively adds private invitation opt-in/codes/revocation, report-time evidence and safe re-reporting, pack restriction without deleting existing records, and exact-name owner dissolution. The existing CommunityService remains; alternative PR151 is unmerged. Web format 33 and existing accounts/saves remain compatible; Season Zero is unscheduled. The guide/archive label W81.1 identifies this safety batch after W81, not completion of W82.

The 80 existing Web chapters, all original section IDs, historical notes and separate World source are preserved. CI verified 1,719 Web tests, 210 server tests, 9 PostgreSQL tests and native browser coverage on desktop/mobile/narrow-mobile for the exact tested game tree. This documentation change does not modify gameplay, accounts, saves, DNS or other brands. Publish only through manual Primalbound static service `srv-dbfd3t29lscs739ls85g` after full staging/production validation.

---

# Community activation, verified 11 November 2026

Community, shared dungeons and Clan Lodge activation was verified at 2026-11-10T21:34:17Z (11 November 2026, 07:34 AEST). Canonical game build `c3a0433ce091ef32cc7b5b2cad56ab516c6e568e` serves reviewed maintenance notes `0c44cd7a869215a79f3225a578cd9684917c87f8` and unchanged gameplay manifest `33644798351d93e0f5348a93961910bfe92972714e5e87c2cf074517acb3ab98`. The owner-selected existing Goofy account resolves through the fail-closed moderator configuration. Public community status is enabled; health reports PostgreSQL/accounts configured; unauthenticated state, Lodge, moderation and cloud-save requests remain denied. Season Zero is unscheduled. Web format 33, solo saves and World saves are unchanged.

Guide status labels and the stale version badge now reflect activation, with all how-to chapters and historical release notes preserved. The original W80 archive entry records its initial disabled state; a new maintenance entry records the deployed activation support. Publish only through Primalbound static service `srv-dbfd3t29lscs739ls85g` after staging and production checks. Other brands, gameplay configuration, accounts, DNS and World are outside this documentation change.

---

# W80 integration release, verified 10 November 2026

Game build `f47a466e94d2916dcd53d7c03e98829e923980cb` is live on the canonical /web/ gateway, cloud origin and static origin. All three manifests match `33644798351d93e0f5348a93961910bfe92972714e5e87c2cf074517acb3ab98`; the actual canonical entry asset matches cloud. The release includes the exact 27 ordered notes (`e63df7725024910f842786755ae961476c3db6bd`). Web format 33; World remains separate. Community, shared dungeons and Lodge are shipped but disabled; Season Zero is unscheduled. This is one integrated release, not separate live W73–W79 versions.

Full how-to chapters cover discovery calendars/claims, relic sequences and rewards, optional season enrollment/tiers, private profiles, packs, server-owned co-op, moderation, shared dungeon rounds, personal/clan rewards, vault permissions and Lodge crafting. Historical chapters and every previous release remain intact. No World changes.

Publish only through the existing manual Primalbound static service `srv-dbfd3t29lscs739ls85g` after full staging and production CI. Do not change gameplay services, flags, moderation accounts, DNS or other brands from this documentation release.

---

## Verified W71.1–W72.1 LIVE candidate guide synchronization — 10 November 2026, 21:16 AEST

Web Render service `srv-dbbd4j6q1p3s73c5uacg` deployed `a39af80e476f8baf5cb8d703bb4393a63a29e75d` LIVE on branch `ai/primalbound-independent-web`. Its production build passed 1,654 Web tests (zero failures), original startup budget, emitted a matching build manifest and attached eight reviewed notes to gameplay SHA-256 `5fe5f7cbb597f1f090431dfa42d34fac42207a646b08bf1fc346780594fe962b`. W71.1 itinerary comparison and W72.1 optional biome adaptation constitute the first playable LIVE candidate batch, not completion of W71–W80. Web save format **32** remains unchanged. The detailed source guide, this static Web snapshot and exact historical release archive are synchronized; prior W70/W27.1–W31.2 text and World M36.7 wiki remain preserved. Publication requires passing staging/production static builds and manual deployment of **only** the existing Primalbound Render static service `srv-dbfd3t29lscs739ls85g`; autoDeploy stays off. No gameplay, player saves, DNS, binaries or other service changes.

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

