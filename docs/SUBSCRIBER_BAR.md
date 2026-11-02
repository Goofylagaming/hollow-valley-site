# Subscriber Bar: monthly server-cost progress

## Development status

The Subscriber Bar is part of the membership development branch. It is not a
production release. No real costs, payments or production settings were changed
while building it. It starts disabled with no cost items or invented amounts.

## Player experience

The homepage and Supporter page share a compact **Subscriber Bar**. Once the
owner publishes the real monthly cost targets, it shows:

- The current calendar month in **Australia/Brisbane** and **AUD**.
- Verified subscription payments for that month against the combined target.
- An accessible overall progress bar, the remaining amount, and any surplus.
- Progress toward each cost in the order chosen by the owner.
- The update time and the basis: **Subscription payments received this month,
  after refunds, before Stripe fees**.

Cost progress allocates the combined amount to the targets in order. It is a
budget illustration; it does not assert that the corresponding supplier bill
has actually been paid. The monthly total is the sum of the cost items, so there
is no separate overall goal that can disagree with its breakdown.

A verified zero displays zero. An unavailable or expired total displays an
awaiting-verification state without a financial amount. A negative month, for
example when refunds for earlier payments exceed this month's receipts, keeps
its signed amount visible while the progress bar stops at zero. Surplus remains
visible when the bar reaches 100%. Progress begins a new reporting period at
midnight on the first day of each month in Brisbane.

## Owner controls

Open **Owner Finance → Subscriber Bar** at `/admin/finance`. Only the configured
finance owner can access its API; ordinary admin or Discord roles do not grant
access.

1. Enter the actual monthly costs and descriptive labels, such as game-server
   hosting, website hosting or automation. One cost can represent the complete
   monthly budget, or up to eight can provide a breakdown.
2. Order the costs to set their progress priority. The editor derives the total.
3. Save the settings. Draft labels and amounts remain private while visibility
   is disabled. Enabling visibility publishes the cost breakdown and aggregate
   subscription total when it is available.
4. Use **Refresh** to request a read-only reconciliation. The collected amount
   cannot be manually edited through this form or API.

Costs are positive integer cents, expressed as monthly AUD amounts in the
editor. Annual bills need an explicitly chosen monthly budget amount. Settings
use a version check so two open owner sessions cannot silently overwrite each
other. Same-origin checks protect configuration and refresh requests. Editing
the targets is separate from loading the existing Stripe finance overview.

## What the amount includes

The collector reads Stripe balance transactions created during the current
Brisbane month, bounded by the refresh start time. It uses signed **gross**
amounts before Stripe processing fees. It verifies the transaction's underlying
payment and complete invoice lines against the configured Hollow Valley
membership price IDs.

This approach includes an older invoice paid this month and a current-month
refund of an older subscription payment. Successful subscription charges,
refunds, failed-refund reversals, dispute debits and verified dispute restorations
are accounted for once by transaction ID. A charge's lifetime refunded/disputed
flags are not subtracted again. Uncaptured authorizations are not income.

Legacy charge-to-invoice references and current InvoicePayment-to-PaymentIntent
references are supported. Modern payment allocations must reconcile to the
captured amount; an ambiguous shared payment is never estimated as a fraction.

One-off unrelated payments, account top-ups, transfers and bank payouts are not
subscriber income. The bar is not a forecast of renewals, a Stripe account
balance, net profit, or evidence of a bank payout. Processing fees and tax are
not deducted from the displayed payment amount.

## Completeness and privacy

The public endpoint only reads the local aggregate snapshot; a visitor cannot
trigger Stripe requests. Individual payment records, customer names, emails,
card details and provider identifiers are not returned or retained in the
Subscriber Bar snapshot. Disabling publication also removes draft costs from
the public response.

A complete snapshot is valid only for its current Brisbane month, reporting
configuration and a maximum age of two hours. Failed reconciliation withholds
the displayed amount. The background worker checks whether an hourly refresh
is due; the owner can also request one explicitly. A database lease prevents
overlapping refreshes from replacing newer results.

An open public page rereads the aggregate once a minute while visible and when
the player returns to the tab. A local expiry timer clears the monetary amount
at its freshness limit or the month boundary, including while a new request is
still pending. These public reads do not start additional Stripe reconciliations.

Pagination, provider requests and refresh duration have explicit limits.
Incomplete lists, contradictory duplicates, unsupported payment adjustments,
unverified references, foreign-exchange allocations, mixed invoice allocations,
or unrecognized subscription prices withhold the total. Retired membership
price IDs need verified historical attribution before they can be included;
they must not be silently treated as unrelated income or refunds. No partial
result is presented as the complete funding amount.

## Configuration and rollout

The feature uses the existing Stripe finance configuration:

- `STRIPE_FINANCE_READ_KEY`, with the existing `STRIPE_SECRET_KEY` fallback.
- The existing live-mode setting and all three membership price IDs.
- Read access to prices, balance transactions, charges, invoices and invoice lines,
  InvoicePayments, PaymentIntents, refunds and disputes as required by the
  actual payment records.
- The existing `OWNER_STEAM_ID` finance-owner restriction.

All Stripe operations are GET requests. The bar does not create payments,
refunds, subscriptions or payouts. Preview identities cannot collect or publish
production financial totals; test-mode Stripe data is not represented as live
funding. Use isolated fixtures for staging UI tests.

Each configured price is checked in the connected account before reading the
ledger, including when there are no transactions. A wrong-account read key or
invalid price must not produce a falsely verified zero.

Before enabling production, validate the code on staging, confirm the real cost
amounts, check the read-key permissions, and compare a controlled reconciliation
with the relevant Stripe records. Keep owner visibility disabled until the
budget and accounting basis have been reviewed. Turning it off hides the bar
without changing subscriptions or payments.

## Endpoints and implementation

- `GET /api/supporter/progress`: public aggregate projection, with no-store
  caching and no provider requests.
- `GET /api/admin/finance/support-goal`: owner settings and reporting state.
- `PUT /api/admin/finance/support-goal`: owner cost targets and visibility.
- `POST /api/admin/finance/support-goal/refresh`: owner-triggered read-only
  reconciliation.

Implementation: `server/services/subscriberFunding.js`,
`server/routes/subscriberFunding.js`, `public/assets/subscriber-progress.js`,
and `public/assets/admin-support-goal.js`. The additive SQLite tables are
`subscriber_funding_config` and `subscriber_funding_snapshot`.

This is an additional membership feature, not a replacement or renumbering of
the original 31 roadmap entries.

## Source references

- [Stripe balance transactions](https://docs.stripe.com/api/balance_transactions/list)
- [Stripe InvoicePayment objects and allocation amounts](https://docs.stripe.com/api/invoice-payment/object)
- [Stripe invoice-payment listing](https://docs.stripe.com/api/invoice-payment/list)
- [Official Stripe payment filter schema](https://github.com/stripe/stripe-go/blob/master/invoicepayment.go)
