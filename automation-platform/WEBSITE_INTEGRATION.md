# Hollow Valley Website Integration

The automation service exposes a narrow server-to-server API for the live Hollow Valley website. This avoids giving the public website or browser clients the operator/admin token.

## Authentication

Configure the same long random `HOLLOW_VALLEY_API_TOKEN` in both services:

- Hollow Valley website backend: outbound integration credential.
- Automation platform: inbound `HOLLOW_VALLEY_API_TOKEN`.

The website backend sends either:

```http
Authorization: Bearer <HOLLOW_VALLEY_API_TOKEN>
```

or the dedicated `x-hollow-valley-token` header.

If the automation service has no website token configured, `/api/website/*` fails closed with HTTP 503. Invalid credentials return HTTP 401.

Do not expose this token to browser JavaScript. Player browsers should continue calling the Hollow Valley website backend; only the backend should call the automation service.

## Base path

All website integration endpoints are mounted under:

```text
/api/website
```

Responses are marked `Cache-Control: no-store`.

## Supported calls

### Wallet

```http
GET /api/website/wallet/:steamId
```

Returns the Steam-keyed Valley Coin balance, recent immutable ledger transactions and five-minute earning progress/state. The wallet can exist before the player visits the website because earning identity follows Steam.

### Playtime quests

```http
GET /api/website/quests/:steamId
```

Returns the five automatic playtime quests, current progress, threshold, completion state, configured boost percentage and combined active boost. Daily progress uses the configured economy timezone; weekly periods reset on Monday.

### Marketplace catalog

```http
GET /api/website/marketplace/catalog
```

Returns active automation-owned catalog items.

### Marketplace orders

```http
GET /api/website/marketplace/orders/:steamId
```

Returns that Steam account's recent marketplace order state.

### Marketplace purchase

```http
POST /api/website/marketplace/catalog/:catalogId/buy
Content-Type: application/json

{
  "steamId": "7656119...",
  "idempotencyKey": "website-marketplace:..."
}
```

Payment and pending-order creation are atomic. HTTP 402 means insufficient Valley Coin. A successful purchase is **not** proof of DinoStorage fulfillment; the order remains pending until the fulfillment layer confirms delivery. Repeating the same idempotency key returns the original order without charging again.

### BodyDrop cooldown

```http
GET /api/website/bodydrop/cooldown/:steamId
```

Returns the player's current cooldown/pending state.

### BodyDrop request

```http
POST /api/website/bodydrop
Content-Type: application/json

{
  "steamId": "7656119...",
  "dropType": "small"
}
```

Returns HTTP 202 when the request has been accepted into automation processing. This is not proof that a body spawned in-game. The request must still be reconciled through CommandBridge results.

### DinoStorage list

```http
GET /api/website/dinostorage/:steamId
```

Reads the player's DinoStorage slots from the game-server file store.


### Active character

```http
GET /api/website/dinostorage/active-character/:steamId
```

Returns the same live-character fields currently used by the My Dinos page: species, gender, growth, health, stamina, hunger, thirst, Prime Elder state, mutations and location. This is read-only and lets the existing frontend keep its live-dino card and redeem eligibility checks after migration.

### DinoStorage store/redeem

```http
POST /api/website/dinostorage/store
POST /api/website/dinostorage/redeem
Content-Type: application/json

{
  "steamId": "7656119...",
  "slot": "default"
}
```

Returns HTTP 202 for accepted automation work. DinoStorage acknowledgement and the deferred in-game kill/restore lifecycle remain separate outcomes.

### Request status

```http
GET /api/website/requests/:requestId?steamId=7656119...
```

The request is returned only when the supplied Steam ID matches the stored request owner. This lets the live website poll a request safely without exposing the full automation ledger.

## Existing live-route mapping

The isolated `integration/liveRouteAdapters.js` now covers every request used by the current My Dinos / BodyDrop frontend without requiring browser changes:

| Current live route | Adapter function | Automation call |
| --- | --- | --- |
| `GET /api/wallet` | `getWallet` | Steam-keyed Valley Coin wallet + earning progress |
| `GET /api/quests` | `getQuests` | automatic daily/weekly quest progress + active boost |
| `GET /api/marketplace/catalog` | `listMarketplaceCatalog` | official marketplace catalog |
| `POST /api/marketplace/catalog/:id/buy` | `buyMarketplaceCatalogItem` | atomic debit + pending marketplace order |
| `GET /api/mydinos` | `listDinos` | DinoStorage slot list |
| `GET /api/mydinos/active-character` | `getActiveCharacter` | read-only active character |
| `POST /api/mydinos/park-active` | `parkActive` | DinoStorage store |
| `POST /api/mydinos/stored/:slot/redeem` | `redeemStored` | DinoStorage redeem |
| `GET /api/bodydrop` | `getBodyDropState` | cooldown + server/eligibility state |
| `POST /api/bodydrop` | `requestBodyDrop` | BodyDrop request |

Compatibility behavior intentionally preserved:

- the website backend remains the source of Steam identity;
- wallet/playtime rewards follow linked Steam identity rather than a browser-supplied user or Steam ID;
- daily/weekly playtime quests are automatic; no manual claim request is trusted as proof of completion;
- marketplace purchases use backend-generated idempotency keys and are returned as accepted/pending until DinoStorage fulfillment is confirmed;
- logged-in users without a linked Steam account still receive the existing harmless read-only states;
- BodyDrop remains carnivore-only and limited to 60% growth or below;
- failed BodyDrop requests do not consume cooldown;
- stored dino responses retain the full fields used by the existing cards, including max stats, Prime state and `mutationList`;
- write requests return accepted/queued semantics without pretending the deferred game-side action is complete;
- timeouts and unknown outcomes are never automatically replayed.

## Recommended live-site flow

1. Player signs in to Hollow Valley with the existing Steam login.
2. The website backend derives the player's Steam ID from the authenticated server-side session; do not trust a browser-supplied Steam ID.
3. The website backend calls `/api/website/*` with `HOLLOW_VALLEY_API_TOKEN`.
4. The automation service validates the Steam ID/action and queues the game-side work.
5. The website stores or returns the automation request ID.
6. The website polls the request-status endpoint until it reaches a terminal or operator-attention state.
7. `unknown` outcomes must not be automatically replayed.

## Production activation

Keep this integration disconnected until the automation platform is deployed as a separate service. When ready:

1. Generate a new `HOLLOW_VALLEY_API_TOKEN`; do not reuse `AUTOMATION_ADMIN_TOKEN`.
2. Add it to both Render services as a secret environment variable.
3. Keep `COMMAND_BRIDGE_ENABLED=false` for the first connectivity test.
4. Verify unauthorized website calls return 401 and missing configuration returns 503.
5. Verify backend-authenticated read-only DinoStorage list and active-character calls.
6. Enable CommandBridge only after confirming the single-file queue consumer is ready for this publisher.
7. Verify wallet and marketplace catalog reads with the reward switch still disabled.
8. Migrate/reconcile existing wallet balances before switching the live Wallet page.
9. Test one controlled marketplace purchase only after its DinoStorage fulfillment worker exists.
10. Test one controlled BodyDrop or DinoStorage request and follow its request ID through reconciliation before enabling the player-facing UI.

The live `master` site remains unchanged until this integration is deliberately connected and reviewed.


See `ECONOMY_MARKETPLACE.md` for the Valley Coin earning, wallet ledger, marketplace order, DinoStorage fulfillment and legacy-wallet migration schematic.
