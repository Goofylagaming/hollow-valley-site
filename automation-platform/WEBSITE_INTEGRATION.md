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
7. Test one controlled BodyDrop or DinoStorage request and follow its request ID through reconciliation before enabling the player-facing UI.

The live `master` site remains unchanged until this integration is deliberately connected and reviewed.
