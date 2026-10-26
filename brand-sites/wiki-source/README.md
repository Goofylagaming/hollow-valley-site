# Primalbound Wiki Integration

The live Primalbound Render static service builds `brand-sites/dist/primalbound`.
The existing homepage, `/web/` and `/world/` are preserved.

The last build step in `brand-sites/build.mjs` imports `publish-wikis.mjs`, which replaces only:
- `/web/wiki/index.html` (W26.28 Preview baseline)
- `/world/wiki/index.html` (M36.4 Windows playtest)
- `/assets/wiki.css`
- `/assets/wiki.js`

Source snapshots in `brand-sites/wiki-source/` come from
`Goofylagaming/primalbound`, branch `feature/primalbound-web-world-wikis`,
generated from two canonical guides on the notes branch:
`docs/PRIMALBOUND_WEB_COMPLETE_PLAYER_GUIDE.md` and
`docs/PRIMALBOUND_WORLD_DESKTOP_COMPLETE_PLAYER_GUIDE.md`.

To update guide content: update the guides in Primalbound first, rebuild the wiki static output using
`node site/scripts/build-wikis.mjs`, copy the four resulting files to `brand-sites/wiki-source/`, run the brand build and verifier on staging, then deploy with production approval.

The staging build injects `noindex,nofollow` into the two wiki pages. Production build omits it.
The wiki uses a single same-origin, static JavaScript search file. No login, iframe, database, game API calls, analytics or third-party scripts are introduced. Game services, saves and other sites are not modified.
