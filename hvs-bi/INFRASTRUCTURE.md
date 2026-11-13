# Read-only HVS infrastructure inspection

Inspected on 13 November 2026 via connected GitHub, Render and Cloudflare. No secrets were read or copied, and no services, DNS records or production files were changed.

| Component | Observed configuration | BI decision |
|---|---|---|
| Goofylagaming/hollow-valley-site, master | Node/Express game portal, SQLite; root render.yaml describes Docker persistent disk; Render service auto-deploy enabled | Do not push master or import its database/secrets. Add standalone hvs-bi directory only on new feature branch. |
| hollow-valley-studios Render static site | production/brand-websites-20261026, build brand-sites/build.mjs and verify.mjs, publish brand-sites/dist/hollow-valley; auto-deploy off | Marketing infrastructure can later link to BI; no marketing rebuild or change now. |
| hollowvalleystudios.com and www | Cloudflare CNAMEs point to hollow-valley-studios.onrender.com, proxy disabled; no Worker routes returned | No existing path routing to reuse for a Node API. Review BI on its own staging hostname. |
| hollow-valley-automation | Separate Render service, automation-platform branch, auto-deploy off in observed account | No BI dependency or credentials shared. |
| Goofylagaming/hds-dashboard | Private Python bot/dashboard source, HerbyBot worker on main with auto-deploy | Inspected repository listing/file structure and service relationship; no modifications. |
| Primalbound | Separate game repositories and preview services, plus independent static marketing output | Leave gameplay and premium membership untouched. |

Render workspace was explicitly confirmed by the user as Hollow Valley Studios. Existing review services use several unrelated staging branches; none use feature/hvs-bi-pilot-20261113. The existing automation mirror workflow only triggers on master changes under automation-platform (or explicit manual invocation).

Branch base inspected: master e1b6512a55cb0762bc8cad6bcee3f8c9f4541715. Root AGENTS.md concerns game roadmap release tracking; this BI pilot does not implement or mark any of those public game roadmap features complete.

Architecture chosen: one standalone Node 24 service with its own SQLite disk, static dashboard assets, structured open-data collectors, PDF/CSV generation, small in-process weekly scheduler and sandbox billing adapter. It requires no change to existing HVS login, game APIs or production deployment routing. Render reference configuration is supplied but not applied; no hosting costs were deliberately incurred.
