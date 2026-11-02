# HV-UX04 — Hollow Valley Player Support Hub
Development date: 27 October 2026, Australia/Brisbane. **Not deployed.**

Parent dependencies: HV-UX03 PR #241, HV-UX02 PR #240, HV-UX01 PR #239.
Hollow Valley W01.3 Player Reports PR #237 remains a separate unmerged
feature. Do not advertise /reports as live or use unfinished moderation flows.

## Built

- /support — public help cards; Steam-linked private ticket form and
  authenticated ticket history.
- /adminsupport — admin-only ticket queue, player replies, internal staff
  notes, status updates, and append-only audit timeline.
- /api/support-tickets/capabilities — whether new tickets are enabled.
- /api/support-tickets/mine — read only authenticated player's tickets.
- /api/support-tickets/mine/:id — read only own thread.
- /api/support-tickets/mine/:id/replies — author-scoped replies.
- /api/support-tickets/admin — staff-only queue, search and status filters.
- /api/support-tickets/admin/:id — staff-only thread and private audit.
- /api/support-tickets/admin/:id/replies — staff reply or private note.
- /api/support-tickets/admin/:id/status — admin status control.
- All user-supplied message text is rendered as textContent; evidence URLs
  accept exact allowlisted HTTPS media hosts. No raw file upload pipeline.
- Additive database tables hv_support_tickets, hv_support_messages and
  hv_support_audit, on the existing website SQLite persistence disk.
- Per-Steam 3 tickets/day, at least 90 seconds between new tickets;
  nonce-based duplicate suppression for retried create requests.
- Admin-only internal notes never appear in player history, even after
  changing ticket status. Tickets are scoped to authenticated website
  user id and Steam identity; no request body can impersonate the reporter.
- Origin and JSON enforcement on all writes. No explicit ticket deletes.
- Player form and replies default **disabled** until HV_SUPPORT_TICKETS_ENABLED
  is deliberately set true after staff preparation and production approval.
  Existing support history stays readable after a feature pause; staff can
  review and resolve the existing queue.

## Safety

Tickets are a communication workflow only. They do not trigger RCON, Slay,
DinoStorage restoration, compensation, Valley Coin credits, refunds, Stripe,
Discord webhooks, game-server commands or auto-replies.

Website uploads are intentionally limited to links from approved hosts.
Admins should treat every evidence link as untrusted external content.

The /support portal does not replace /reports until independent W01.3
implementation is merged, backed up, signed-in-tested and enabled.
No Discord channels are read or written by support tickets.

## Validation before release

1. Run test/supportTickets.test.js, original baseline comparisons,
   membership/game automation checks, and existing privacy suites.
2. Isolated staging (DB_PATH temp SQLite) browser smoke: guest /support,
   desktop/tablet/phone layout and admin /adminsupport guard.
3. Manually test true Steam session and admin experience against disposable
   staging DB; no live player transactions.
4. Ensure production SQLite backup and post-release restore procedure are
   verified before deploying added tables. Preserve existing WAL and volumes.
5. Ensure staff will answer the queue. Explicitly configure
   HV_SUPPORT_TICKETS_ENABLED=true only when moderated and ready.
6. Review and merge parent PRs in dependency order before this branch;
   rebase against current master, resolve any Home/Nav conflicts.
7. Do not assert this feature is Live, or post to channel
   1550133934871023679, until production deployment and HerbyBot verified
   release integration have been separately approved.
