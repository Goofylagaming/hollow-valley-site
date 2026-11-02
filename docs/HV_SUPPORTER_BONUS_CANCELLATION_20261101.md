# Hollow Valley supporter Valley Coin cancellation policy (1 November 2026)

## Operator intent

When a supporter cancels monthly renewal, **new supporter-only Valley Coin
multipliers and monthly payouts must stop immediately** once Stripe confirms
the cancellation; previously earned coins are preserved. The paid subscription
may remain `active` for the rest of its billing period and the member can
retain their non-coin membership benefits until Stripe marks the term ended.

This avoids counting an active-but-`cancel_at_period_end` subscription as
eligible for the *extra* coins.

## Implementation

- The website's authenticated Stripe cancellation and resume routes update
  local `auto_renew` / `cancelled_at` only **after successful Stripe response**.
  A failed Stripe request cannot revoke or restore bonus status.
- Signed `customer.subscription.updated` and
  `customer.subscription.deleted` webhooks also update this status for
  cancellations completed in Stripe's portal.
- `/api/internal/supporter-memberships` returns `entitled=false` to the
  game economy for subscriptions that are canceled, scheduled to end, past due,
  or otherwise not eligible, even if Stripe still calls them `active`.
- `playtimeRewardsService`, event, and daily-login tier multipliers share
  the fail-closed `supporterBonusService`. A maximum 90-second cache age
  blocks stale tier awards if website membership refresh is delayed.
- Separately, the existing monthly supporter bonus webhook now skips future
  15k/20k/25k credits after confirmed cancellation.
- The website's supporter page and dashboard report `coinBonusEligible`
  and the **effective** multiplier. Paid-tier access and historic wallet
  ledger entries are unchanged.

## Test and safety expectations

Verify on a disposable/test member before production rollout:

1. Active paid supporter receives the tier multiplier.
2. Cancel via Hollow Valley website: Stripe responds successfully with
   `cancel_at_period_end=true`, local `auto_renew=0` immediately, and
   economy entitlement is false even while Stripe status is `active`.
3. Cancel directly through Stripe: signed webhook updates the local row,
   then the next economy membership refresh removes the bonus.
4. Billing-period-end cancellation and payment failures stay excluded.
5. Successful resume through Stripe clears `cancelled_at` and permits
   bonuses only when Stripe status remains eligible.
6. A late invoice does not award a monthly bonus after cancellation.
7. Already earned Valley Coins are never deducted. No subscription is canceled
   by this deployment; no Stripe token or card data is touched.

The game host and The Isle server do not need to restart. The website and
automation service must be deployed in the normal coordinated release order.
