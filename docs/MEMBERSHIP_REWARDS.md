# Hollow Valley membership rewards

## Delivery status

Development implementation prepared on 2 November 2026 (Australia/Brisbane).
This document does not declare a production release. Feature switches default
off. No live Stripe payments, Discord role changes, game commands, skin grants,
storage restrictions or publication are performed by installing this code alone.

## Member benefits

| Tier | Monthly skin choices | Proposed extra storage | Profile frame |
| --- | ---: | ---: | --- |
| Valley Supporter | 1 | +1 | Fern |
| Valley Guardian | 2 | +2 | River, plus Fern |
| Valley Legend | 3 | +4 | Valley Gold, plus lower-tier frames |

The existing prices, eligible Valley Coin multipliers and monthly coin grants
are retained. Storage additions have no effect until a standard allowance and
all game-server intake paths are verified; see `MEMBERSHIP_STORAGE_ROLLOUT.md`.

Three cumulative, verified paid months earn the **Valley Companion** frame and
loyalty badge; six earn **Ancient Guardian**; twelve earn **Heart of the Valley**.
These earned rewards remain available after membership expiry. A player can
hide their membership badge and choose any available frame. Expired active-tier
frames fall back to Classic without destroying the saved preference.

The Supporter page contains **My Membership**. The profile page renders the
selected frame, membership badge and highest earned loyalty badge. Both handle
disabled rollout, incomplete paid history and unavailable downstream services.

The homepage and Supporter page also include a **Subscriber Bar** for progress
toward owner-configured monthly server costs. It uses verified aggregate
subscription payments in AUD for the Brisbane calendar month, adjusted for
refunds and before Stripe fees. Costs start blank and visibility is disabled;
see `SUBSCRIBER_BAR.md` for owner controls, privacy and reconciliation details.

## Paid periods and cancellation

`MEMBERSHIP_REWARDS_ENABLED=true` enables the website reward ledger and UI.
Bounded non-coin entitlement requires an active Stripe subscription record and
a verified future billing-period end. Trials and unbounded legacy records do
not create the new paid benefits. Cancelling auto-renew preserves non-coin
benefits through that paid end; existing coin-bonus eligibility still ends
immediately when cancellation is confirmed, as previously requested.

Monthly choices are created from a paid Stripe invoice with a recognized
membership price and a full monthly period. The invoice ID is unique. Duplicate
webhooks and repeated history imports cannot issue a second allowance. Current
monthly plans are supported; annual plans and unusual shortened first periods
are intentionally not inferred as a paid month. Zero-payment invoices and
unrecognized prices do not create paid loyalty credit.

A paid prorated upgrade can increase the existing period's total allowance to
the newly paid tier. It does not add a month or reset choices already used.
Overlapping billing periods are counted once for loyalty. A fully refunded
invoice with a resolved invoice ID cannot fund new choices or future milestones;
refund markers survive refund-before-payment event order and are recorded even
while new rewards are disabled. Historical import checks the underlying charge
or InvoicePayment/PaymentIntent association, rather than treating invoice status
alone as proof of unrefunded funding. Unverifiable payments are reported as
incomplete history. Existing earned
cosmetics are not confiscated. Delivery of refund events and their invoice
association must be verified against the configured Stripe API version before
rollout.

### Existing members

The **Verify paid history** button reads paid invoices for the account's current
linked Stripe subscription, imports them idempotently and awards verified
milestones. It never charges, refunds or alters Stripe. Previously recorded
periods remain when a member changes subscriptions. Earlier subscriptions that
were overwritten before this ledger existed are not guessed from account age;
their historical linkage needs separate verified reconciliation.

## Premium Skin Studio

See `MEMBERSHIP_PREMIUM_SKINS.md` for the admin workflow and automation flag.
The first original palette definitions are **Ashfall**, **Moonlit Marsh** and
**Valley Royalty**, in the **Valley Origins** collection. They are private drafts
until an administrator seeds them, checks the exact colours in-game, records
the verified dinosaur species and explicitly publishes the collection.

The old skin `isPremium` property means free/public in the existing system.
Subscriber skins use a separate membership marker and catalogue. Ordinary
purchase, share, import, grant and publication paths cannot turn them into
public/free skins. Palette previews are labelled as palettes, not guaranteed
renderings of the in-game dinosaur. Members can only apply a published premium
skin to verified species. Existing ordinary player skins are preserved.

### Reliable monthly claims

1. A signed-in, Steam-linked member selects a published skin.
2. The website reserves one choice inside a SQLite write transaction.
3. Automation records a permanent skin unlock and a receipt in one transaction.
4. The website verifies the matching claim, skin and preset receipt before
   marking delivery complete.

Pending reservations count against the allowance. A timeout keeps the same
claim ID; retrying it never consumes another choice. Already-owned skins return
the reservation. Definitive unavailable-skin responses return the choice;
uncertain responses remain pending. Receipt retries can finish after expiry or
rollout disablement, while new claims remain gated. Skin mutations also respect
the existing read-only preview protection.

## Discord roles

The existing Valley Supporter, Valley Guardian and Valley Legend role sync is
reused. Only membership roles are managed. `MEMBERSHIP_DISCORD_SYNC_ENABLED=true`
enables a durable, bounded retry queue and expiry sweep. Production credentials
must never be copied into a preview to test role writes. Role-state failures
are exposed as a pending/failed sync with a safe retry message. Retries re-read
current entitlements and linked accounts; unrelated Discord roles are retained.

## API surface

- `GET /api/supporter/rewards`: authenticated rewards, appearance, monthly
  allowance, loyalty, downstream storage readiness and Discord sync status.
- `POST /api/supporter/appearance`: select an owned frame and badge visibility.
- `POST /api/supporter/rewards/sync-history`: verify current-subscription paid
  history through read-only Stripe requests; rate limited and serialized.
- `POST /api/supporter/rewards/skins/:skinId/claim`: reserve or retry a skin choice.
- `POST /api/internal/membership-rewards/entitlements`: bearer-protected batch
  non-coin entitlement lookup for automation; no public account enumeration.
- `GET /api/skins/premium`: public safe catalogue; private admin methods use
  the signed-in admin's identity and the preview mutation guard.

Rewards tables are additive. No migration deletes users, coins, stored dinos,
ordinary skins or existing subscription records. Keep a fresh verified backup
of both website and automation databases before enabling this release.

## Release sequence

1. Review the branch and passing CI. Validate the website and automation builds
   against separate staging databases; the repository requires staging before
   production. Verify disabled flags preserve current functionality.
2. Confirm the target Render workspace/services and capture the current deploy
   commits and fresh database backups. Do not overwrite unrelated active work.
3. Deploy automation and website in the existing coordinated release process,
   initially with the new switches off. Check readiness and logs.
4. Enable website rewards, verify a known paid invoice and history import, and
   verify profile/frame/cancellation behavior. Retain existing payment prices.
5. Prepare and test palette drafts with an authorized admin, then publish only
   the verified species. Enable premium claims and check a controlled claim and
   its idempotent retry.
6. Enable Discord reconciliation only after role IDs, bot permissions and
   production environment identity are checked. Confirm expiry and retries.
7. Leave storage capacity disabled until the base allowance and every native
   game-server/chat/mod intake route are verified. Then use a controlled store,
   retrieval, expiry and full-capacity purchase test without risking player data.

Rollback disables new admission/claim switches while preserving earned rewards,
pending receipts and dinosaurs. Database rollback is not an application rollback.
Roadmap feature 22 remains Building / Testing until production is verified;
broader rarity tiers and collection displays are still outside this release.
