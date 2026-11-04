# Subscriber access revocation

## Policy

Subscriber benefits require an active Stripe subscription and a known future
billing-period end. Scheduled cancellation keeps Discord membership, badges,
tier frames, extra storage allowance and monthly skin-choice eligibility until
that boundary. The existing coin policy remains stricter: requesting cancellation
stops monthly bonus payouts and coin multipliers immediately.

There is no payment-failure grace period. `past_due`, `unpaid`, `paused`,
`incomplete`, `incomplete_expired`, `canceled` and `trialing` do not grant paid
benefits. A successful payment restores benefits only if Stripe's current
subscription is active. Canceling immediately revokes immediately, even if the
old billing-period end is in the future.

Already-earned permanent loyalty frames, delivered skins, existing coin balances
and stored dinosaurs remain owned. Expiry removes extra storage admission capacity;
it does not delete stored dinosaurs. Owner finance access and admin authorization
are independent of membership and are never written by these handlers.

## Delivery and identity

The signed raw-body webhook reconciles the current subscription through Stripe's
read API for checkout, subscription lifecycle and invoice paid/failed signals.
Old payloads do not directly activate or deactivate benefits. The handler checks
subscription ID, customer ID, local user ID and Steam metadata for conflicts.
Conflicts and unavailable Stripe reads return a retryable failure without changing
access. An old subscription cannot displace a currently active replacement.

State and processed-event records commit together. A repeated event reconciles
current Stripe state again and retains the user ID for Discord retry; payout
idempotency remains keyed by invoice ID. Old invoices belonging to a superseded
subscription do not trigger new perks or payouts (historical backfill remains a
separate concern). Read/apply pairs are serialized within the website process.
This deployment uses one SQLite-backed website process; scaling to multiple
independent writers requires a shared lock/queue first.

## Rollout and existing-account reconciliation

1. Validate this change on isolated staging before merging to production. Do not
   copy production Discord credentials into staging. Use test subscriptions and
   a test guild to exercise role writes.
2. Confirm the production Stripe restricted key permits reading subscriptions.
   Keep the existing webhook signing secret in the host's secret configuration.
   The five existing events remain required: `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`,
   and `checkout.session.completed`. The code also supports
   `customer.subscription.created` and `checkout.session.async_payment_succeeded`;
   add these to the endpoint if those creation/payment flows are used.
3. Verify `MEMBERSHIP_DISCORD_SYNC_ENABLED=true`, the worker starts, the guild and
   three membership role IDs are correct, and the bot can manage those roles.
   The durable queue sweeps expiry once per minute (250 accounts per batch) and
   retries transient failures. After six failures an operator must resolve the
   cause and retry. Never configure owner/admin role IDs as membership roles.
4. Back up the production database. Compare every Stripe subscription's user and
   Steam metadata with the actual website account and stored customer/subscription
   binding. Resolve conflicts explicitly; do not match accounts by email alone.
5. Re-send a lifecycle event for each existing subscription through Stripe's
   webhook dashboard. Previously processed event IDs are safe to resend: the
   handler reads the current subscription, repairs local state, and enqueues the
   current Discord target. Verify already-canceled subscriptions have no paid
   benefits after reconciliation.
6. Verify scheduled cancellations retain non-coin benefits before expiry, lose
   them at expiry, and restore them on a valid reactivation. Check badge/frame,
   skin-choice, storage admission and coin lookup as well as actual Discord roles.
   Confirm owner finance access separately. Check queue failures and webhook 5xx.

Do not claim existing live access is corrected until the production account
comparison, deployment and reconciliation have been completed. No Stripe billing,
tax or subscription settings need changing for this patch.

## Verification

Run the supporter, membership, Discord and owner-finance tests plus
`automation-platform/test/membershipStorageCapacity.test.js`. The lifecycle suite
uses mocked Stripe responses and an in-memory database; it does not cancel live
subscriptions or mutate Discord. The full repository suite also includes
unrelated automation tests; failures there must not be silently treated as a
successful full-suite run.
