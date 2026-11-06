# Subscriber Discord community

This extends the existing subscriber implementation; it does not create another
subscription, payment, entitlement, reward or voting ledger. The companion
HerbyBot change lives in `Goofylagaming/hds-dashboard`, branch
`feature/discord-subscriber-community-20261105`. Merge both draft PRs manually.
No deployment or live Discord mutation was performed during development.

## Ownership and access

Website Supporter maps to existing Discord Valley Member `1550695486464204810`,
Guardian to Valley Guardian `1550695581373042688`, and Legend to Valley Legend
`1550695426456555551`. The existing tier synchronizer only adds/removes these IDs.
Existing webhook/current-Stripe reconciliation and the membership queue retain
access through a verified paid period and remove it at expiry. Neither that
queue nor cancellation removes loyalty roles or fulfilled skin claims.

HerbyBot owns category/channel reconciliation. It denies everyone View Channel,
allows the three tiers, preserves staff permissions, fails closed on ambiguous
or unexpected grants, and never deletes channels or changes unrelated roles.
The managed category has six text channels and one voice channel:

| Channel | Subscriber permission |
|---|---|
| subscriber-lounge | Read/write/react |
| premium-skins | Read/react |
| subscriber-votes | Read/react; website votes alone count |
| subscriber-suggestions | Read/write/react |
| perks-and-rewards | Read-only |
| dev-previews | Read/react |
| Subscriber Lounge | Connect/speak; text chat disabled |

Thread creation/posting is denied in read-only channels. Private thread creation
and everyone mentions are denied for subscribers. Staff retain their moderation
access. Discord administrators inherently bypass channel permissions.
An existing `subscriber-events` child is renamed in place to
`subscriber-suggestions` only when the destination is absent and unambiguous;
history is preserved. Conflicts stop before writes. No new subscriber-events
channel is created. Existing public events are never modified.

## Website controls

`/subscriber-community.html` provides paid-member suggestion intake and admin
shortlisting, post previews, queue controls and delivery status. Suggestions
are deduped and rate limited. All admin mutations require authentication,
admin authorization and a matching Origin. Staff can shortlist ideas discussed
in Discord by asking their author to submit them on this page; Discord messages
are not silently scraped or imported.

The existing `/adminsupporters` ballot form now supports premium skins, public
event themes and community choices. All use the existing website membership
eligibility and equal, changeable one-vote-per-member ledger. Discord votes or
reactions never enter it. Only one ballot is open at a time. Public events stay
open to everyone; no event admission rules are changed.

Admin post previews default to dry-run. Support updates use one immutable key
per Brisbane month; development previews use a content hash; vote announcements
use the website ballot ID. No private finance fields enter these templates.
Free text rejects mentions, account/payment identifiers, links and currency
amounts; staff must still review prose before publishing.

Monthly Subscriber Drop is a deduped announcement directing members to existing
paid-period skin choices. It does not create extra paid rewards. The hourly
worker checks the Brisbane month and queues one drop, and one each of 50% and
75% milestones when the existing verified public funding snapshot reaches them.
Unavailable/stale snapshots publish nothing. Milestone content contains the
threshold percentage only—no dollar amounts, names, counts, IDs or provider data.
The monthly “what your support helped build” post is admin-triggered, not automatic.

Permanent 3/6/12-month cosmetic roles use the existing earned loyalty ledger:
Valley Companion, Ancient Guardian, Heart of the Valley. HerbyBot creates or
reuses unique zero-permission roles. The website grants by configured exact ID,
validates name/permissions, and never removes an earned role. No loyalty role
is given access to the private subscriber category by itself.

## Delivery and recovery

SQLite uniquely keys every post and atomically claims it before Discord send.
`allowed_mentions` is empty and a stable Discord nonce adds short-term dedupe.
Sent records are never replayed. An uncertain result is held in `review`; a
crash after claiming leaves `sending`. Neither state auto-retries, even after
restart. This deliberately trades automatic recovery for duplicate protection.
Staff must inspect the target channel and database record before reconciling a
held entry; there is no unsafe automatic “retry all” button. Back up the ledger
and retain it across deployments. Run only one HerbyBot reconciler instance.

Discord delivery verifies the destination's category and everyone View Channel
deny before posting. The bot needs role hierarchy access below its own role,
Manage Roles/Channels for setup, and message/history/pinning permissions for
guides. Loyalty roles must have no permissions and must not be integration roles.

## Staging and live enable

Defaults: `SUBSCRIBER_COMMUNITY_ENABLED=0`,
`SUBSCRIBER_COMMUNITY_MODE=dry-run`; HerbyBot area/guides default `off`, and
`HERBYBOT_SUBSCRIBER_WRITES_ENABLED` must explicitly equal `1` for writes.
The website also honors existing read-only preview protection. No credential
or live configuration is changed by these PRs.

Prepare deployment with the existing membership flags/Discord configuration,
enable website community controls with `SUBSCRIBER_COMMUNITY_ENABLED=1`, and
leave its mode `dry-run`. Run HerbyBot area and guides in `dry-run` and inspect
the real guild plan. The supplied fixtures are offline tests, not a live-guild
audit. Resolve any reported legacy-channel conflicts manually before enabling.

The final coordinated live-enable operation after manual merges is:

1. Run HerbyBot area `apply` with writes enabled to reconcile channels and create
   cosmetic roles; use returned IDs as `SUBSCRIBER_LOYALTY_ROLE_3`, `_6`, `_12`
   on the website. Run guides `apply` with writes enabled, then return both
   startup modes to `off` once verified.
2. Set website `SUBSCRIBER_COMMUNITY_MODE=apply` and restart after checking the
   queued post previews. This is the final ongoing-delivery switch. Returning
   it to `dry-run` stops community message and loyalty writes immediately on
   the next invocation; it does not disable existing tier-access reconciliation.

Role creation/ID configuration is a prerequisite, so the entire rollout cannot
truthfully be reduced to one flag across the two repositories. No live-enable
operation above has been executed.

## Verification

`node --test` on subscriber*, membership*, supporter* and discordMembership
tests: **200 passed, zero failed**. Includes HTTP authorization, origin checks,
default-off delivery, exact tier mapping, paid-period expiry, webhook/reward
dedupe, permanent claims/loyalty, vote authority, milestone/post dedupe,
ambiguous-send holds, mention suppression and finance redaction.

`python -m unittest test_subscriber_area test_subscriber_guides test_subscriber_loyalty`:
**12 passed** in the companion repo. Includes idempotency, permissions, legacy
rename, no unrelated mutations, gate enforcement and guide updates in place.

`node scripts/subscriber-community-dry-run.cjs`: fixture month `2026-11`, one
Subscriber Drop, milestones at 50% and 75%, one admin support-update preview,
all `dryRun: true`, **0 Discord writes**.

`python subscriber_dry_run.py`: fresh synthetic guild, category + seven channel
create plans, three cosmetic role create plans, **0 Discord writes**.

API references: [Discord permissions](https://github.com/discord/discord-api-docs/blob/main/developers/topics/permissions.mdx)
and [message nonce semantics](https://github.com/discord/discord-api-docs/blob/main/developers/resources/message.mdx).
