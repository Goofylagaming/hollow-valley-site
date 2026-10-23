# Roadmap release tracking

Whenever implementing any of the 31 public roadmap features, update the release
register in `public/assets/home-roadmap.js` in the same change. Keep original
feature numbers and descriptions. Mark complete only for a verified, delivered
scope; use partial for missing required integrations and explain what remains.
Completed features show a green tick and `Complete, added DD/MM/YYYY`, using the
actual production release date in Australia/Brisbane. Do not guess release dates.
If a planned deployment is delayed, correct its date before publishing.

Keep `server/services/roadmapCommunity.js` voting eligibility aligned when an
idea leaves the idea stage. Preserve existing votes and check how retired votes
affect the three-vote allowance. Bump homepage asset versions for changed files.
Validate staging before production and confirm the published status after release.
