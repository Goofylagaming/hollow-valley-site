# Hollow Valley Overlay v2.0: native dinosaur groups — STAGING ONLY

Status: native Evrima group membership has NOT been established. DO NOT deploy or enable this integration in production.

## Uploaded ZIP review
The Backend Groupmates Development ZIP contains an older website tree with map.js changes that only add empty groupmates and groupmatesVerified:false. The README claims WPF overlay map changes, but the archive does not contain the referenced C# or Gateway map HTML files; those cannot be audited here.
The GroupTracker Staging Diagnostic ZIP contains only a passive UE4SS Lua probe and README. Its guessed Group/Party/Team fields are not verified native group membership, it does not send data, and it is not production-ready.

## Server-to-server pipeline
1. An independently validated BinaryLane native-Evrima group publisher (NOT YET BUILT) extracts COMPLETE group rosters for the SAME unique sampleId as the existing BinaryLane presence feed.
2. It submits an authenticated POST to automation /api/group-feed/snapshot using an exclusive 32+ character GROUPMATES_FEED_TOKEN over HTTPS.
3. Automation keeps membership only in RAM, never a persistent table, with 30-second expiry, complete-snapshot replacement, strict SteamID64/ID validation, anti-replay, and no identifier logging.
4. Website uses its HOLLOW_VALLEY_API_TOKEN to call automation /api/website/groupmates/:steamId. Automation returns membership only if group and presence sample IDs match exactly and fresh external-presence positions exist.
5. Website /api/map/positions uses the existing session's req.user.steam_id, never a client-supplied player ID. For verified peers in the identical fresh map sample, it exposes only {name,species,position} (normalized 0..1). Non-admin others remain position-free; admin moderation views remain unchanged.

## Default OFF gates
- Automation: GROUPMATES_NATIVE_SOURCE_VERIFIED=1 only after real native-roster proof and staging security review; otherwise HTTP group intake is 404 and website resolution is unavailable.
- Automation: GROUPMATES_FEED_TOKEN (independent 32+ character secret; never embed in browsers, overlay, public logs, or UE4SS client mods).
- Website: GROUPMATES_API_ENABLED=1 only after approval. No new API lookup is made while unset.
- Existing HOLLOW_VALLEY_API_TOKEN continues authenticating automation-to-website requests.

## Future full snapshot protocol
schemaVersion: 1
source: evrima-native-server-v1
complete: true
sampleId: native-group-000001
presenceSampleId: binarylane-presence-000001
sampledAt: UTC ISO-8601 timestamp
groups: [{id: opaque-native-group-id, members: [SteamID64,...]}]

The presenceSampleId must match EXACTLY the authoritative current BinaryLane presence sample. Group membership must be based only on in-game native group records. NEVER infer from Hollow Valley website Groups, species, proximity, chat, Steam friends, or unverified [GROUP-...] logs. Group data and Steam IDs are not returned to the player overlay; only mapped live names and positions are.

## Release blockers
- Identify and verify actual native membership objects (join, accept, leave, kick, disband, disconnect, respawn/death). The Lua diagnostic is NOT proof.
- Build a read-only, private server-side publisher that synchronizes the group roster with a specific BinaryLane presence sample.
- Verify removal latency, feed reordering, retries, restart, false positives, Steam account vs dinosaur life, and clock skew under a staging test using consenting players.
- Obtain the missing WPF overlay source files and test builds on Windows. Test layer toggle, map/mini-map, sign-out, missing character and marker clearing.
- Run full website + automation test suites and staging smoke checks. Any errors, invalid/expired/unmatched data, or RCON fallback MUST return empty groupmates/unverified.
- Explicit approval is required before changing any production flags or merging into master.

Membership cannot disappear from the overlay faster than verified native change detection and update/polling permit. An unverified/stale snapshot must conceal markers instead of extrapolating an old roster. No DinoDen service or dependency is used.
