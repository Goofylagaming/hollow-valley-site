# Membership renewal choice

New members choose **One month only** (selected by default) or **Auto-renew
monthly** before choosing a tier. Existing memberships keep their renewal
settings. Existing clients that omit `renewalMode` retain the previous recurring
checkout behavior; invalid explicit values return 400.

Both choices use the existing server-owned monthly Stripe Prices and account /
Steam identity checks. The one-month path verifies that its Price really has a
one-month interval. It writes `renewal_mode=one_month` to the Checkout Session
and subscription metadata and discloses the end-of-month cancellation in Stripe
Checkout. No new Stripe products, prices, tax settings or API-version changes
are needed.

Stripe Checkout does not expose `cancel_at_period_end` on subscription creation.
The verified lifecycle handler therefore sets that flag on the subscription
before activating the local membership. It handles invoice-first ordering as
well as Checkout and subscription events. Failed Stripe updates return 500 so
Stripe retries; the event is not acknowledged as processed. Repeated deliveries
use a stable idempotency key and cannot extend an already scheduled period.
User recovery also completes a missing cancellation. Monitor failed webhooks:
a prolonged delivery/API outage still needs operator intervention before the
first renewal; this integration depends on working Stripe webhooks.

The existing `active` + future paid-period gate ends website and game benefits
at expiry. The existing Discord queue sweep removes the membership role at the
boundary. Immediate cancellation and payment failure still revoke access.
One-month purchases retain their coin multiplier and eligible initial invoice
bonus for their paid month. Existing recurring memberships that request
cancellation retain the previous immediate coin cutoff. Invoice IDs remain the
wallet's idempotency keys; permanent coins/items are never taken back.

Members can explicitly turn on auto-renew with a payment confirmation prompt.
That request updates the Stripe renewal flag and metadata together. Renewal
changes and lifecycle processing share the single-process membership lock, so
an in-flight initial webhook cannot undo an explicit resume. Later old events
read the current Stripe choice. This follows the existing single-instance
SQLite deployment design.

The additive `renewal_mode` column defaults existing rows to `auto_renew` without
changing their actual renewal flags, status or permissions. Owner Finance,
admin roles, reward rollout flags and tax configuration remain unchanged.

Verification covers both checkout choices and all tiers, invalid choices and
price intervals, HTTP forwarding/authentication, invoice-first and duplicate
events, cancellation-update failure/retry, paid-period expiry, coin lookup and
invoice idempotency, payment failure/recovery, explicit and concurrent resume,
existing cancellation behavior, and owner/admin preservation. Stripe requests
in automated tests are stubbed; no real payment is created.
