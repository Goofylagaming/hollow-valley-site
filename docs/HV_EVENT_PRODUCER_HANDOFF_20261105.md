# Hollow Valley event lifecycle producer gap

This is local source evidence and a handoff for the shared bot owner. It does
not establish which commit is deployed or authorize a bot release.

The user-assigned owner is the consolidated **Primalbound Web — Gameplay &
Balance** chat, as recorded in `Primalbound web + desktop/GOAL_CHAT_OWNERSHIP.md`.
The shared checkout was inspected read-only; its work and branch were preserved.

## Verified source

`C:/Users/joshu/Documents/ChatGPT/Goals/primalbound-publishing-bot`

Local head: `9c5bf4e06407b60f1df3c68b05a17d2e2813df5a`.
Local branch: `fix/primalbound-stable-download-cache-20261029`.

In `bot.py`, `_scheduled_event_payload` (line 458) omits lifecycle status.
`sync_discord_scheduled_events_once` (line 480) filters every explicit status
except scheduled/active before publishing the complete snapshot (lines 490–493).
Consequently, this source cannot supply explicit completed/cancelled events to
the new attendance evidence service. Status-less events remain readable publicly
as unknown and cannot authorize new paid group registration or attendance proof.

The older `Primalbound web + desktop/herbybot-m20-2` copy has the same observed
behavior, but is not the current owner-designated checkout.

## Producer work required with that owner

- Publish explicit supported lifecycle status and the actual guild identity.
  Include completed and cancelled evidence from authoritative Discord observations.
  Do not infer completion from an event disappearing from the fetched list.
- Define and implement bounded, restart-safe retention of authoritative completed
  event observations so staff can review attendance after the event. Keep actual
  observed lifecycle/time evidence distinguishable from a scheduled end time;
  never manufacture an end time for a missing source value.
- Preserve cancellation, removal and server-side hidden-event behavior. Do not
  renew a completed event's observation freshness merely by replaying old data.
- Test the real serialization/sync behavior with synthetic event objects, including
  status-less, scheduled, active, completed, cancelled, removed, duplicate and
  out-of-order observations, worker restarts, delivery failures and guild changes.
  Source-substring tests alone do not prove this contract.
- Verify the complete producer → authenticated `/api/herbybot/events/sync` →
  automation state → staff review chain against staging. No Discord announcements,
  payouts, merges or deployments are authorized by this handoff.

## Receiver contract now implemented locally

The Hollow Valley receiver normalizes lifecycle values but preserves unknown
status as unknown. All events must match the envelope guild and valid schedules.
Timestamps over one minute ahead are rejected. A strictly older snapshot or a
different payload at an accepted timestamp returns HTTP 409 without overwriting
accepted state. Exact retries are idempotent, retain server-side hidden events,
and do not renew their timestamp. Event order is canonicalized for equal starts.

Read/validate/write and hide operations use a SQLite write transaction, so a
concurrent worker cannot overwrite another accepted update between those steps.
Errors roll back state; receipt recovery and existing free event reads remain
available. The receiver does not synthesize a completed event or promote unknown
status while the producer gap remains.

Both the general dynamic challenge and event-attendance flags remain disabled.
Real producer availability, staff policy and authenticated staging remain release
gates for roadmap #3; the public register stays Building / Testing.
