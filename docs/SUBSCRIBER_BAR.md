# Subscriber Bar: monthly server-cost progress

## Development status

The Subscriber Bar is part of the membership development branch. It is not a
production release. No real costs, payments or production settings were changed
while building it. It starts disabled with no cost items or invented amounts.

## Player experience

The homepage and Supporter page show the percentage of the private monthly
budget covered by verified subscription receipts, with milestones at **50%**
and **75%**. The owner decides whether to publish the bar. Its period and
verification time refer to the **Australia/Brisbane** calendar month.

The server divides verified receipts by the private target, rounds down to a
whole percentage and limits the public result to 0–100%. A payment one cent
short of a milestone therefore does not mark it reached. Both milestones may
move back below their thresholds after a refund. Reaching a milestone does not
confirm a bill was paid.

A verified zero or negative balance shows 0%; surplus above the target shows
100%. Unverified or expired coverage shows an awaiting-verification state,
not 0% or a reached milestone. A new period begins at midnight on the first of
each month in Brisbane. Visitors never receive cost categories, exact receipts,
the target, milestone amounts, remaining amounts, or the size of a surplus.

## Owner controls

Open **Owner Finance → Subscriber Bar** at `/admin/finance`. Only the configured
finance owner can access its API; ordinary admin or Discord roles do not grant
access.

1. Enter one to eight cost items, or use **Load budget file**. The JSON file must
   contain `currency: "aud"`, `enabled: false`, and a `categories` array. Each
   item has a unique `id`, a `label`, and a positive integer `amountCents`.
   Import validates the whole file locally (up to 16 KB) before replacing the
   form. It retains the last saved revision, switches the draft to unpublished
   and does not save, change existing visibility, refresh Stripe or upload the
   file. Invalid files leave the current form untouched.
2. Review the private target, which is the sum of these items, and the exact
   amounts needed to reach 50% and 75%. Each threshold is rounded **up** to the
   next whole cent when needed. The order of categories is for the owner's
   convenience; it has no effect on either milestone.
3. Save with publication off to keep a private draft. To publish progress,
   check **Publish the percentage and 50% / 75% milestones** and save. Costs,
   their labels, the target and the exact received total remain owner-only.
4. Once published, **Refresh verified support total** runs a read-only
   reconciliation. The owner sees the signed amount and its verification time.
   A separate preview uses the same percentage-only data returned to players.
   Receipts are never an editable field.

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
balance, net profit, or evidence of a bank payout. Receipts are adjusted for
refunds and disputes **before Stripe fees**; processing fees and tax are not
deducted from this measure. The owner may include a *provisional fee allowance*
as a private budget item. That increases the target; it does not deduct fees
from receipts or claim to measure fees actually charged.

## Completeness and privacy

The public endpoint reads a separate, allowlisted percentage view of the local
snapshot; a visitor cannot trigger Stripe requests. It does not send monetary
amounts or private budget labels to the browser, including when progress is
published. The private owner response contains the editor configuration and
exact reporting figures, plus `publicProgress` for the preview. A disabled
public bar does not disclose whether the owner has entered a private budget.
Individual payment records, customer names, emails, card details and provider
identifiers are not retained in the Subscriber Bar snapshot.

A complete snapshot is valid only for its current Brisbane month, reporting
configuration and a maximum age of two hours. Failed reconciliation withholds
the public percentage and the owner's verified total. The background worker checks whether an hourly refresh
is due; the owner can also request one explicitly. A database lease prevents
overlapping refreshes from replacing newer results.

An open public page rereads the aggregate once a minute while visible and when
the player returns to the tab. A local expiry timer clears the percentage and milestone states
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
with the relevant Stripe records. Keep public visibility disabled until the
budget and accounting basis have been reviewed. Turning it off hides the bar
without changing subscriptions or payments.

## Endpoints and implementation

- `GET /api/supporter/progress`: public percentage-only projection, with no-store
  caching and no provider requests.
- `GET /api/admin/finance/support-goal`: private owner settings and monetary reporting state, with a separate `publicProgress` preview.
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
