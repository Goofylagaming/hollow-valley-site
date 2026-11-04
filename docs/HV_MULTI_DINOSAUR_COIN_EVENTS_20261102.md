# Hollow Valley Multi-Dinosaur Random Valley Coin Events

Updated 2 November 2026.

## Goal

A single admin-created event can target **1–20 playable dinosaur species**
with different extra Valley Coins per verified minute. The event has one
title, one start and expiration timestamp, one Stop control and **one
consolidated Discord START and one END notification**.

For example, `Carnivore Bonus Hour` could include:

| Dinosaur | Extra VC per complete verified minute |
| --- | ---: |
| Omniraptor | 300 |
| Pteranodon | 300 |
| Triceratops | 500 |
| Deinosuchus | 200 |

Rates are **flat additional rewards**; supporter tier multipliers and
quests still apply only to their existing underlying reward stream.
Playing one species qualifies for exactly that species's rate. A player
cannot collect the other selected dinosaurs' rates simultaneously.

## Admin Hub

Visit `/adminoperations` → Random Dinosaur Events. Use the existing
species selector and extra VC/minute input, click **+ Add dinosaur** and
repeat for every featured species. Each selected species has an editable
rate and Remove control. With no dinosaurs explicitly added, the old
quick single-dinosaur form still works. Enter title, duration (5–720
minutes), optional scheduled start, and select whether to send the
existing verified HerbyBot start/end notices.

The returned Admin event list displays all selected dinosaurs and each
rate. The public `/events` view lists each species and rate without
exposing admin Steam IDs, nonce/ping mode, or internal data.

## Storage and game safety

The existing `species_coin_events` table receives only one new column,
`species_bonuses_json`, containing sorted canonical species IDs and
whole-integer rates. Historic rows have **NULL** and retain the
original `species_key` / `coins_per_minute` fields and full wallet
history. Current schemas and migration checks are additive. No reset or
destructive migration is performed.

Each event remains **one persisted event row** with one ID and status.
A previously issued single-event nonce and wallet credit remains valid.
A new event is stored with its first sorted species also in the original
legacy fields so old clients don't encounter missing data.

The existing sample-based payout service:
- Requires two authoritative presence samples for an eligible SteamID64
  with the same current species and a gap <=90 seconds.
- Accrues only time while a supported species is played, within the
  UTC start/finish window.
- Resets the minute streak when the player disconnects or changes
  dinosaurs, **including between two featured species**.
- Awards just one species-specific rate per completed eligible minute.
  An idempotent event + SteamID + minute-sequence ledger key prevents
  double credits on retries and service restarts.
- Stops automatically at expiration or immediately through the admin
  Stop action; existing earned Valley Coins are never deducted.

Overlapping windows are checked **against every species in each
event**, not only the first selected dinosaur. Thus a grouped event
containing Pteranodon blocks a concurrent standalone Pteranodon bonus,
but a separate non-overlapping species is allowed.

## Announcements

For multi-dinosaur events, the existing HerbyBot outbox queues **one
combined START and one combined END message to the dedicated event
start/finish channel**,
including all species/rates and the Queensland end time. The
one-species legacy route is unchanged: it still posts to Community
Announcements and the original Server Progress destination.

Event-start pings respect the existing No ping / Community Member /
@everyone selection; END never tags the community again. The queued
event nonce remains idempotent.

The dedicated channel `1566412715864358973` is already configured
in the current site and HerbyBot routing. The multi-dino upgrade
preserves this channel and the legacy-routing migration, so historic
outbox notices cannot be replayed in a different destination.

## Not included

Actual species-specific *growth-rate* multipliers still require a
separate, verified game-side per-pawn growth hook; they are unrelated
to this Valley Coin feature. This change does not modify the game
server, RCON, Game.ini, mutation data, Prime, DinoStorage, Discord
roles, subscription billing, or existing wallet balances.

## Deployment acceptance

- Migration from old one-dinosaur SQLite events retains their original
  rate, status, start/end and all previously credited wallet transactions.
- Group creation is idempotent for sorted or reordered equivalent
  species/rate lists; changed rate on a reused request ID conflicts.
- No duplicate species within one group, and no same-species overlap
  between different groups or singles.
- Live player snapshots yield the exact selected rates with one
  receipt per eligible minute.
- Species switching, disconnect, stop and expiration never award
  offline or retroactive credits.
- New combined announcements are queued once per phase. No mass
  notification is emitted merely by deployment.
- Website and automation services pass production readiness checks
  before enabling/administering new group events.
