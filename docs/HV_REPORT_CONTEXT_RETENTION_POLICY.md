# Saved report context retention policy

Decision: the user selected **90 days from capture** on 6 November 2026
(Australia/Brisbane). This replaces the previously pending duration decision.

For each explicitly saved chat/combat snapshot, captured_at is the successful
save's server clock and expires_at is captured_at plus 90 times 24 hours. The
incident time, later viewing, exact retries and signing-key rotation do not
restart or extend that period. An exact retry returns the original receipt and
expiry. Existing copies retain their stored expiry; configuration is not a
retroactive rewrite of saved rows.

The configuration example now sets PLAYER_REPORT_CONTEXT_RETENTION_DAYS=90.
The context and preservation rollout flags remain 0 and the review secret remains
empty. A duration setting alone cannot enable saving. This decision does not
authorize a merge, deployment, new live flag or production data operation.

Reads, lists and receipt recovery withhold a snapshot at its fixed expiry.
The separately gated cleanup worker removes expired payload/receipt rows in
bounded hourly batches. Backlogs can delay physical row deletion; database
cleanup does not establish removal from backups or secure erasure of disk pages.
Production rollout must verify the host's deletion and backup-retention behavior
against the approved 90-day policy. Staging, key configuration and host verification
remain required; no production retention claim is verified by local fixtures.
