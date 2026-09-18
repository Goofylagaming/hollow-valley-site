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

## Player-to-player marketplace — later phase

The current live P2P marketplace transfers local roster rows. Once My Dinos is backed by real DinoStorage, P2P trading needs **escrow/locking**.

A safe listing must prevent the seller from:

- redeeming the listed stored dino;
- deleting it;
- listing it twice;
- changing the stored state after the listing snapshot.

Recommended later model:

```text
stored dino -> marketplace escrow/locked slot -> active listing
active listing -> sold -> ownership transfer to buyer
active listing -> cancelled -> return/unlock to seller
```

Do not migrate P2P listings until this escrow model is implemented. Official catalog purchasing can launch independently.

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
