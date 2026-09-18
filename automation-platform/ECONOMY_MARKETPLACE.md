# Hollow Valley Economy — Wallet & Marketplace Schematic

This document defines the next-generation Valley Coin wallet and marketplace architecture for Hollow Valley.

The live website currently has a simple user-ID wallet, transaction history, official dinosaur catalog and player-to-player roster listings. The automation platform introduces a Steam-keyed, idempotent economy that can safely earn currency from verified game presence and later fulfill marketplace dinosaur purchases through DinoStorage.

## Core goals

1. Players earn a configurable amount of Valley Coin for every **5 verified minutes online**.
2. Wallet ownership follows the player's 17-digit Steam ID.
3. Every coin movement has an immutable ledger entry.
4. Retries/restarts must never double-credit playtime or double-charge a purchase.
5. Marketplace payment and order creation are atomic.
6. Dinosaur fulfillment is separate from payment and is never reported complete until DinoStorage fulfillment is actually confirmed.
7. RCON outages or long sample gaps must never generate back-pay for unverified online time.
8. Existing live wallet balances must be preserved during migration.

---

## Wallet model

### economy_wallets

Cached current balance for fast reads.

- `steam_id` — primary key.
- `balance` — integer Valley Coin balance, never negative.
- `created_at`
- `updated_at`

### economy_wallet_ledger

Immutable source of truth for every balance change.

- `id`
- `steam_id`
- `amount` — positive credit or negative debit.
- `kind` — e.g. `playtime_reward`, `marketplace_purchase`, `marketplace_refund`, future quest/admin rewards.
- `reason`
- `idempotency_key` — unique.
- `reference_type`
- `reference_id`
- `metadata_json`
- `created_at`

The cached balance is changed in the same SQLite transaction as the corresponding ledger entry.

---

## Five-minute online earning

Configuration:

```text
WALLET_PLAYTIME_REWARDS_ENABLED=false
WALLET_PLAYTIME_COINS_PER_5_MINUTES=0
WALLET_PLAYTIME_MAX_SAMPLE_GAP_SECONDS=90
```

The amount is intentionally not hard-coded yet.

### Earning flow

For every successful RCON player-presence sample:

1. Normalize the current online Steam IDs.
2. Read each player's persisted earning progress.
3. Count elapsed time only when the gap from the previous successful sample is within the configured maximum sample gap.
4. Add that elapsed time to the player's accrued verified time.
5. Every complete 300 seconds creates one `playtime_reward` ledger credit.
6. Keep the remainder toward the next five-minute reward.
7. Persist a monotonically increasing reward sequence.

Playtime reward idempotency keys use:

```text
playtime:<steam_id>:<reward_sequence>
```

A repeated sample or service restart therefore cannot pay the same five-minute interval twice.

### Important behavior

- First sighting establishes the clock; it does not award historical time.
- Successful one-minute polling naturally reaches one reward after five verified elapsed minutes.
- RCON unavailable: no earning progress is advanced.
- Player absent: no earning progress is advanced.
- Long gap beyond the configured tolerance: the gap is discarded instead of back-paid.
- Restart within a normal polling gap: persisted progress continues.
- A player can accumulate a Steam-keyed wallet before opening/linking the website; once the website account is linked to the same Steam ID, that wallet becomes visible.

### Wallet UI data

The protected website wallet response includes:

- current balance;
- recent immutable transactions;
- whether playtime earning is enabled/configured;
- configured coins per five minutes;
- verified seconds accumulated toward the next reward;
- seconds remaining until the next reward;
- total rewarded five-minute intervals.

This supports a future wallet UI such as:

```text
VALLEY COIN
2,450

Earn 20 Coin every 5 minutes while online
████████████░░░░  3m 42s / 5m

Next payout in 1m 18s
```

---

## Economy-rate calibration

The existing live official catalog currently ranges from roughly **960** Valley Coin at the low end to **3,760** at the high end.

Because there are 12 five-minute intervals in one hour:

```text
coins per hour = coins per 5 minutes × 12
```

Example calibration:

| Coin / 5 min | Coin / hour | 960 Coin item | 2,000 Coin item | 3,760 Coin item |
| ---: | ---: | ---: | ---: | ---: |
| 5 | 60 | 16.0 h | 33.3 h | 62.7 h |
| 10 | 120 | 8.0 h | 16.7 h | 31.3 h |
| 15 | 180 | 5.3 h | 11.1 h | 20.9 h |
| 20 | 240 | 4.0 h | 8.3 h | 15.7 h |
| 25 | 300 | 3.2 h | 6.7 h | 12.5 h |
| 30 | 360 | 2.7 h | 5.6 h | 10.4 h |

This should be balanced alongside quests, events, supporter benefits and any future coin sinks before enabling live rewards.

---

## Playtime quest boosts

Quest completion is automatic from the same verified online-time stream used by Valley Coin rewards. There are no manual claim buttons.

| Quest | Cadence | Progress rule | Boost config |
| --- | --- | --- | --- |
| 1 hour | Daily | 1 consecutive verified hour | `WALLET_QUEST_DAILY_1H_BOOST_PERCENT` |
| 3 hours | Daily | 3 total verified hours that day | `WALLET_QUEST_DAILY_3H_BOOST_PERCENT` |
| 6 hours | Daily | 6 total verified hours that day | `WALLET_QUEST_DAILY_6H_BOOST_PERCENT` |
| 12 hours | Weekly | 12 total verified hours that week | `WALLET_QUEST_WEEKLY_12H_BOOST_PERCENT` |
| 24 hours | Weekly | 24 total verified hours that week | `WALLET_QUEST_WEEKLY_24H_BOOST_PERCENT` |

Rules:

- Daily periods use `Australia/Brisbane` by default and reset at the next local day.
- Weekly periods begin on Monday in the configured economy timezone.
- The 1-hour quest resets its current streak after a disconnect or unverified sample gap.
- 3h/6h daily totals survive normal disconnects during the same day.
- 12h/24h weekly totals accumulate across the week.
- Completed daily and weekly boosts stack additively.
- The combined boost is limited by `WALLET_QUEST_MAX_TOTAL_BOOST_PERCENT` (100% default safety cap).
- A quest boost affects future 5-minute payouts only. It does not retroactively increase earlier payouts.
- Each achievement is persisted for its daily/weekly period so restarts cannot remove it.
- The boost percentage is snapshotted at achievement time for that period.

Approved default quest boosts:

| Quest | Suggested boost |
| --- | ---: |
| Daily 1h consecutive | +5% |
| Daily 3h total | +10% |
| Daily 6h total | +15% |
| Weekly 12h total | +10% |
| Weekly 24h total | +20% |
| **Maximum combined** | **+60%** |

With a 20 Coin base payout, that would progress from 20 Coin/5m to a maximum of 32 Coin/5m when every active daily and weekly boost has been earned.

These percentage defaults are now configured on the isolated automation branch. Playtime coin earning itself still remains disabled until `WALLET_PLAYTIME_REWARDS_ENABLED=true` and a positive base `WALLET_PLAYTIME_COINS_PER_5_MINUTES` value are deliberately chosen.

---

## Official marketplace catalog

### economy_marketplace_catalog

- `id` — stable string ID, e.g. `dino:carno:75`.
- `item_type`
- `name`
- `description`
- `price`
- `payload_json`
- `active`
- `sort_order`
- timestamps.

A dinosaur catalog payload can contain:

```json
{
  "speciesId": "carnotaurus",
  "growth": 0.75,
  "sizePercent": 75
}
```

The existing catalog can be migrated into these stable IDs without changing its prices until the economy rate is approved.

---

## Purchase flow

### economy_marketplace_orders

- `id`
- `steam_id`
- `catalog_id`
- `price`
- `status`
- `idempotency_key`
- item snapshot JSON
- fulfillment JSON
- error
- timestamps.

Initial statuses:

```text
pending -> fulfilled
pending -> failed -> refunded
```

A future fulfillment worker may add an explicit `fulfilling` state.

### Atomic payment

A catalog purchase is one SQLite transaction:

1. Validate the active catalog item.
2. Ensure the wallet exists.
3. Reject if balance is insufficient.
4. Debit the cached balance.
5. Insert one immutable `marketplace_purchase` ledger row.
6. Insert one pending marketplace order.
7. Commit.

If any step fails, the entire transaction rolls back.

Purchase calls require a unique idempotency key. Replaying the same request returns the same order without charging again.

---

## DinoStorage fulfillment

Payment and fulfillment are intentionally separate.

Recommended v1 fulfillment:

1. Pending marketplace order is read by the fulfillment worker.
2. Build a validated DinoStorage state from the purchased catalog payload.
3. Create a unique stored slot tied to the marketplace order ID.
4. Write the stored dinosaur safely through the established DinoStorage/FTP path.
5. Confirm the stored slot exists/was accepted.
6. Mark the marketplace order `fulfilled`.
7. The player sees it under **My Dinos** and chooses when to redeem it.

Marketplace purchases should **not** auto-redeem or replace the player's active dinosaur.

If fulfillment fails:

1. mark order `failed`;
2. allow a controlled retry when the failure is known-safe; or
3. refund exactly once using `marketplace-refund:<order_id>`.

A fulfilled order cannot be automatically refunded without a separate return/removal workflow.

---

## Website integration contract

Protected server-to-server routes now exist for:

```text
GET  /api/website/wallet/:steamId
GET  /api/website/quests/:steamId
GET  /api/website/marketplace/catalog
GET  /api/website/marketplace/orders/:steamId
POST /api/website/marketplace/catalog/:catalogId/buy
```

The browser never owns `HOLLOW_VALLEY_API_TOKEN`.

The live Hollow Valley backend derives the Steam ID from its authenticated `req.user`. A browser-supplied Steam ID is not trusted for wallet or purchase identity.

The compatibility adapter preserves the existing catalog fields:

- `id`
- `species_id`
- `price`
- `size_percent`

A purchase returns `accepted: true` while its order is pending. It must not claim the dinosaur is delivered until fulfillment is complete.

---

## Existing live wallet migration

The current live website wallet is keyed by internal website `user_id`. The new economy is keyed by Steam ID.

Cutover must be explicit and reconciled.

### Linked users

For each existing user that already has a Steam ID:

1. read the old wallet balance;
2. create/ensure the Steam-keyed wallet;
3. insert one migration ledger credit using a stable key such as:

```text
legacy-wallet-migration:user:<old_user_id>
```

4. verify old and new balances match;
5. never repeat that migration key.

### Users without a linked Steam ID

Do not discard or arbitrarily assign their balance.

Keep the legacy balance available for migration when the player links Steam. The migration can then use the same stable old-user migration key.

### Supply reconciliation

Before switching live reads/writes:

1. sum all legacy balances;
2. sum all migrated ledger credits;
3. identify intentionally unmigrated/unlinked balances;
4. require:

```text
legacy total = migrated total + preserved-unlinked total
```

Only then switch the website wallet endpoint to the automation economy.

---

## Player-to-player DinoStorage marketplace

Player-to-player selling now has an isolated implementation based on **real DinoStorage file escrow** rather than website roster rows.

### Listing

1. Seller selects a parked DinoStorage slot and Valley Coin price.
2. A durable listing row is created in `escrowing` state.
3. The real stored JSON is atomically renamed out of the seller's normal `stored/<steam>/` directory into `marketplace-escrow/<listing-id>.json`.
4. Once escrow is confirmed, the listing becomes `active`.

Because the JSON is physically absent from normal storage while listed, the seller cannot redeem it, edit its mutations, apply a skin, or list the same slot twice.

### Buying

1. Buyer wallet is checked.
2. The listing becomes reserved and the buyer price is held with one idempotent ledger debit.
3. The escrowed JSON is copied into a deterministic buyer storage slot and tagged with the listing ID for restart reconciliation.
4. Escrow is removed.
5. Only after transfer is proven does the seller receive the Valley Coin and the listing become `sold`.

Safe transfer failure refunds the buyer once and reactivates the listing. An uncertain transfer does **not** refund or credit either side blindly; it remains `transfer_uncertain` until the reconciler proves where the DinoStorage file exists.

### Cancellation

An active seller can cancel. The escrow file is restored into the original seller slot and the listing becomes `cancelled`. Cancellation also uses a transfer marker so a restart after copy-before-cleanup can finish safely.

### Restart reconciliation

A periodic reconciler handles `escrowing`, `reserved`, `transfer_uncertain` and `cancelling` states. It uses both durable database state and DinoStorage file markers to complete only provable operations.

### Safety gate

```text
MARKETPLACE_WRITE_ENABLED=false
MARKETPLACE_RECONCILE_INTERVAL_MS=15000
```

Reads can be staged while writes remain disabled. Do not enable P2P buying/selling until FTP escrow movement and wallet migration have been controlled-tested.

---

## Activation sequence

1. Keep `WALLET_PLAYTIME_REWARDS_ENABLED=false`.
2. Choose `WALLET_PLAYTIME_COINS_PER_5_MINUTES`.
3. Verify read-only RCON/presence sampling.
4. Run reward logic in isolated test/staging.
5. Seed/migrate the official catalog.
6. Migrate/reconcile existing linked wallet balances.
7. Connect the website Wallet page read-only.
8. Connect marketplace catalog read-only.
9. Test one controlled purchase with fulfillment disabled/pending.
10. Build and verify DinoStorage purchase fulfillment.
11. Enable marketplace buying.
12. Enable playtime rewards last, after economy/pricing review.
13. Migrate P2P marketplace only after DinoStorage escrow exists.

No live economy switch or wallet migration should occur merely by deploying the isolated automation service.


---

## Parked dinosaur customization

Two additional DinoStorage-backed tools are staged behind write gates.

### Mutation editor

`PARKED_DINO_EDIT_ENABLED=false` by default.

The player can edit only the four active mutation slots (`Slot1`–`Slot4`) on a parked dinosaur. Parent/inherited and elder mutation fields are preserved unchanged. Mutations are selected from a curated catalog; duplicate active mutations and arbitrary free text are rejected.

A listed dinosaur cannot be edited because its JSON is physically held in marketplace escrow instead of the player's stored folder.

### Real skin presets

```text
SKIN_SYSTEM_ENABLED=false
PARKED_DINO_EDIT_ENABLED=false
SKIN_PRESET_CREATE_COST=500
```

A player creates a skin preset **from the actual CustomizerData captured in a parked DinoStorage JSON**. The preset stores body/marking/flank/underbelly/teeth/mouth/claw/detail/eye/male-display colors plus skin variation, pattern and theme.

Private presets belong to the Steam account. Premium presets can later be made globally available. A preset can only be applied to a parked dinosaur of the same species. Applying it rewrites only the stored skin data; growth, vitals, mutations, Prime state and nutrients are preserved.

The legacy name-only skin records remain readable during migration, but new player presets use real captured skin data.
