# Roadmap #23 — one-time promotional skin codes

Local implementation only, behind `SKIN_PROMO_CODES_ENABLED=1` on both website
and automation, plus the existing skin-system flag. No rollout settings changed.

Admin creators may issue codes for their own active non-membership skins. The
client supplies a cryptographically random `HVP-` plus 64 lowercase hexadecimal
characters; only its SHA-256 hash is persisted. A reason, request ID and expiry
within 90 days are required. Exact issuance retries are safe; conflicting retries
fail. Admin lists expose up to 100 issued records without bearer codes or recipient
identities. Unredeemed codes can be revoked with an immutable reason.

Redemption runs in one SQLite write transaction: validate the code, expiry,
revocation, current skin eligibility, original creator and palette fingerprint;
insert a permanent normal skin unlock; then record consumption. No skin copies,
coin awards, game commands or changes to existing balances occur. A new account
may receive its normal empty wallet row because the unlock schema references it.
An already-owned skin leaves the code unconsumed. A redeemed code can be retried
by the same recipient without another write; other accounts cannot consume it.
Membership claims remain exclusively in their existing quota/verification flow.

Website APIs bind Steam identity to the session and require admin permissions for
issuance, listing and revocation. Writes require same-origin JSON and pass through
the Skin Studio preview guard. Automation APIs use the existing website bearer
credential. Codes travel in request bodies, never query strings. Responses are
private/no-store. No code is currently issued in production.

Validation: five real SQLite/service tests and one local HTTP route test pass,
covering ordinary skin access, duplicate redemption, conflicting requests,
no currency changes, expiry, revocation, changed palettes, ownership, membership
exclusion, session binding, admin permissions, origin and preview restrictions.

Remaining: broader concurrent-worker verification, player-to-player gifting,
authenticated staging and production verification. #23 remains Building / Testing;
its previous roadmap votes remain recorded while freeing active voting slots.

## Website controls

`/skin-codes`, linked from profile collections, supports Steam-authenticated
redemption and admin creator issuance/history/revocation. The browser generates
32 random bytes using Web Crypto. An issuance attempt locks its original fields
and retries with the same code and request ID after a failed response. The code
remains only in page memory, not local/session storage or URLs; leaving the page
with an unsaved code triggers a browser warning. Only a confirmed code can be
cleared to start another issuance. A failed redemption retains the input.

Disabled rollout, signed-out and read-only preview states hide or disable writes.
History renders names and reasons as text. Desktop/mobile fixtures at 1440px and
390px pass issuance/retry, secret retention, revocation, redemption retry, escaping,
no browser persistence, preview, guest, rollout-disabled and layout checks.
These are isolated fixtures, not live account or staging verification.
