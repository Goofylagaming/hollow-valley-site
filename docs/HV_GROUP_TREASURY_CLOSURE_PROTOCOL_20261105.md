# Treasury closure protection — accepted policy and implementation contract

On 5 November 2026 the user selected: **Block closing until the funds and pending requests are resolved.** Automatic refunds are not authorized. The protocol below is now implemented locally, with isolated HTTP, concurrency, restart and browser evidence. Production rollout and authenticated staging remain unverified.

## Required behavior

- Guard disbanding and the last member's departure, including direct Groups-store callers. Ordinary departures with remaining members and ownership succession retain their existing behavior outside a pending closure operation.
- Block closure for unresolved donation drafts/submissions, unresolved spending and any positive Treasury balance. A missing/stale/unreachable accounting response is not evidence of a zero balance.
- A balance check followed by a normal group write is insufficient: a donation could commit in between. Closure needs durable website and accounting gates bound to the same immutable website group ID and request ID.
- Preserve all player/group history, donation and purchase receipts, entitlements and financial audits. Do not distribute, refund, burn or reset group funds as part of closing.

## Website gate

Inside a website SQLite transaction, capture the current authorized group, actor and closing action. Reject unresolved local requests. Record an immutable closure ticket before crossing services. New donation preparation/authorization and future spending authorization must reject a closing group. A closure retry reuses its ticket; a delayed request must never act on a replacement group.

Existing groups that have never submitted/confirmed a Treasury donation while rollout is off must retain their established Groups behavior without a new network dependency. This exemption needs a documented, transactionally rechecked local proof that no authorized Treasury operation can be in flight. Groups with financial activity require authoritative clearance even when rollout is disabled.

## Accounting freeze

Under the same `BEGIN IMMEDIATE` lock used for donations and spending, validate zero total balance and no reserved/dispatched funds, then freeze the group against new credits and reservations. If a donation wins the lock first, the nonzero balance blocks closure. If the freeze wins first, a late donation must not debit a player or credit the closing group. Existing receipts remain readable and cancellation of an uncommitted request remains available.

A freeze response must include the group and ticket IDs. A conflicting ticket or ambiguous failure cannot be treated as clearance. No expiry automatically reopens the group.

## Close or cancel

After matching clearance, revalidate current group identity, required authority, unresolved requests and the ticket inside the group-closing transaction. The group history writes, membership closure and local terminal ticket state must commit together. Notify accounting of completion afterward; a lost acknowledgment leaves the remote gate frozen and is recoverable through the same ticket.

Cancellation must first mark the local ticket as cancelling, preventing an older response from closing the group. Accounting then stores an abort outcome under the same ticket, blocking a late freeze request. Only a matching acknowledged abort can reopen website authorization. A local group already closed cannot be reopened by this cancellation path. Cancelling a closure check moves no coins.

Definitive nonzero-fund rejection should safely cancel the closure ticket so the owner can resolve funds. Uncertain transport, process interruption or actor/ownership changes require explicit retry/cancellation and retained diagnostics. The UI must offer those actions without exposing other groups or player wallet data.

## Required evidence

Use actual Groups-store transitions and separate website/accounting databases. Cover disband, sole-owner departure, normal owner succession, unresolved drafts/submissions, funded and fully spent groups, disabled rollout, service outage, stale group ID, owner change, concurrent donation versus freeze, cancellation versus late freeze/clearance, failed group history writes, response loss, process restart, retained historical records and no automatic payouts. Verify desktop/mobile recovery before enabling real donations.

## Current local evidence

`test/groupTreasuryClosure.test.js` exercises both actual website Groups routes and the private accounting routes. It verifies funded and pending-request refusal, last-member closure, ordinary ownership transfer, the never-authorized/offline-rollout exemption, outage cancellation, delayed request and delayed response cancellation, mismatched ticket replies, history-write and terminal-audit rollback, missing completion/abort acknowledgments and retained paid records. A fresh Node process resumes a ticket after a lost freeze response. Independent processes race donation against freeze under the accounting lock.

Groups-store guards recheck a supplied ticket even when rollout is disabled, so a cancelled older request cannot fall through to a legacy close. New donation authorization, membership additions and membership transitions are blocked while a local closure gate is active. The accounting freeze blocks new group credits and spending reservations. Final receipt reads/cancellations remain available. A completed group cannot be reopened through abort.

The full Treasury browser fixture passes at 1440px and 390px for funded-group refusal, visible cancellation/retry controls, withheld new-donation controls while closure is pending and finishing a closed group's accounting check after a lost acknowledgment. Hidden recovery controls remain hidden. These tests use synthetic identities/coins and do not independently validate hosted Steam authentication or production operation.
