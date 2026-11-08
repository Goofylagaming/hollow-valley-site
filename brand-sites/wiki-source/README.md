# Primalbound Wiki Integration

The live Primalbound Render static service builds `brand-sites/dist/primalbound`.
The existing homepage, `/web/` and `/world/` are preserved.

The Web wiki snapshot, historical release archive and verified notes include the 8 November 2026 W43 LIVE release (commit `0331298fecaee1f2a35b71769021deaa3a3512b7`, Web format 30; 1,042 passing tests and matching gameplay notes manifest). W42 (format 29, 995 tests) remains documented historically. W40.5 and older notes remain preserved. Previous W40.4 and older patch notes are retained. The World wiki snapshot and release archive now include the published, non-draft M36.7 Windows ZIP released 6 November 2026 (tag `m36-7-build-42133151186`). The M36.6 and earlier entries remain intact. M36.7 includes launcher navigation, seven Guardian appearances, companion species visuals, Mosswatch courtyard navigation, panel close behavior and unchanged World schema 330; Web and World saves remain separate.

The last build step in `brand-sites/build.mjs` imports `publish-wikis.mjs`, which replaces only:
- `/web/wiki/index.html` (Web Preview W43 verified how-to, including W27.1–W43 save compatibility, Bleed/Poison/Vulnerable, Guardian warnings, Auto Journey, sweep queues, offline work, Prime Ascent, format-30 backups, earlier workspace navigation, Pack Bonds, behaviour specialisations, field focuses, companion retirement, breeding pair plans, Prime Forge preparation, format-29 history, and older W40.5 device/account recovery, Field opportunities, regional research, loadouts and targeted fossil recovery; all W38.0 and earlier chapters retained)
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
