# Owner-authorised experimental growth requests

The Admin Hub Operations panel can issue experimental scalar opcode 0x22 requests
with value 2 or 3. Both `RCON_GROWTH_MULTIPLIER_WRITE_ENABLED=true` and
`RCON_GROWTH_EXPERIMENTAL_ENABLED=true` are required. The global legacy write gate
cannot opt in; `RCON_DISABLED=true` remains an emergency override for all RCON.
Disable either growth flag to turn off only this experiment.

Every request requires an authenticated website admin, JSON, same-site browser
context (cross-site requests are rejected), typed `TEST GROWTH` confirmation and
`experimental=true`. Both website and automation validate the bounded values.
There are no automatic retries, resets, restarts, persistence edits or announcements.
The UI retains the last request result through status refreshes, blocks clicks
while awaiting it, and never reports a response as verified gameplay success.
Existing automation audit records retain the requested value and experimental label.

## Transport correction

A read-only query executed inside the live Render automation service successfully
reached its existing configured RCON endpoint and retrieved a player list. The
endpoint is neither loopback nor an RFC1918 IPv4 address. Earlier assumptions that
the Admin Hub needed a new private host route before any growth request were
incomplete. This feature uses that existing authenticated direct RCON adapter;
no new game-host listener, firewall rule, public port or credential is introduced.
Other supported game mutations retain their existing HTTP-pull bridge route.

## Limits of evidence

The live PowerShell experiment tracked one Deinosuchus: baseline 0.43 to 0.48 over
five minutes; candidate 2 yielded 0.48 to 0.50 before a missing/ambiguous record;
requested restoration 3 yielded 0.50 to 0.52 over five minutes. Nutrients changed
and RCON readings were coarse. No multiplier readback was recognised. These data
do not prove the scalar command works, identify its scope, or establish reversal.
The owner approved further live experiments, including possible server-wide effects.

The host fallback saved and restarted without SteamCMD. The owner confirmed their
dinosaur and progress survived. Configured GrowthMultiplier remained 3. A restart
does not prove an unknown saved per-player override was cleared.

This release is NOT the PowerShell experiment runner: it does not track characters,
restore 3 automatically or restart. Keep host access available for operator recovery.
A 3 request is also experimental and must not be advertised as verified restoration.
Do not announce an effective growth change until separately confirmed in-game.

## Validation and rollout

Isolated staging exercises website HTTP authentication/validation, automation token
authentication, a local fake RCON socket, exact scalar wire packets, both action
gates, emergency disable, audit records, and no Discord outbox side effects. A
positive fake RCON response still produces `confirmed:false`, `effectVerified:false`.
Browser staging checks gate states, two presets, typed acknowledgement and the
retained unverified result. None of these tests send a game-host mutation.

Deploy with growth gates off, verify the exact live revision and readiness, then
enable both growth gates only on the existing automation service. No database
migration or game-host change is required. World Events remains partial, with
historical roadmap votes preserved and species bonuses still pending issue #268.
