# Membership expansion production rollout — 6 November 2026

The verified expansion from PR #324 (`a7d27629f17e1cef7446b65355dec6d1ef24d8f8`) is deployed to the existing website and automation services. Their existing persistent disks, billing credentials, Stripe products, and server automation configuration were retained.

## Enabled configuration

- Website: membership rewards, Collection Book/Passport, daily rewards, subscriber community, community participation, recognition/showcase, growth framework, Valley Arcade.
- Automation: manual daily rewards and reward-only Valley Arcade. Enabling manual daily rewards disables the previous automatic daily bonus to prevent double payment.
- Arcade: enabled, emergency disable off, 250,000 VC per Brisbane day; no subscriber multiplier. `VALLEY_CASINO_WAGERING_ENABLED=0` on both services. No wagering or payment integration was introduced.
- Founding cutoff: 1 October 2026 inclusive in Brisbane (`2026-10-01T23:59:59.999+10:00`), explicitly selected by the owner. Five accounts with verified qualifying paid invoices received the permanent badge and title, idempotently.
- Moonlit Marsh remains a draft. Referrals and gift checkout remain disabled; passes and cosmetic grants remain admin-controlled. The 18/24-month reward framework awaits configured reward names/content.

## Protection and verification

- Created fresh consistent SQLite backups before enabling features: website `/app/data/backups/membership-expansion-before-enable-20261106.sqlite`; automation `/var/data/backups/membership-expansion-before-enable-20261106.sqlite`. Both copies passed integrity checks.
- Website users, wallets, transactions, roster, skins, subscriptions, paid invoices, skin claims, and loyalty records matched the pre-rollout backup after migration and Founding grants. Only additive expansion records were initialized.
- Website and wallet deployed successfully. Live website-to-wallet requests verified daily eligibility, the seven reward amounts, arcade settings and leaderboard availability without submitting player reward claims.
- Live desktop/mobile public pages passed browser checks for the supporter wall, arcade, and admin arcade page; admin settings stayed hidden when signed out. The brief 502 during the persistent-disk restart cleared when the new instance became live.
- Discord live dry-run found the category, six text channels, one voice channel, three permanent loyalty roles, and all guides already correct. Reconciliation in apply mode confirmed zero writes. No unrelated channels or roles were touched; no duplicate posts were sent.
- Pre-merge expansion validation: 1,131 tests passed, plus staging API and synthetic signed-in browser checks. Rollout navigation/roadmap validation: 32 tests passed. A restricted-environment localhost connection failure cleared when rerun with test-server access.
- No real Steam/Discord test account is available. Live verification does not claim a real player completed a signed-in purchase, reward claim, or game payout. Those mutable paths were exercised on isolated synthetic staging data, not production players.

## Entry points

- `/supporter`: membership, Collection Book, Passport, daily rewards and profile preferences.
- `/subscriber-community.html`: suggestions and community participation.
- `/supporter-wall.html`: opt-in supporter credits and moderated showcase.
- `/valley-arcade.html`: six reward-only games.
- `/admin-valley-arcade.html`: enabled state, daily cap/Unlimited, emergency disable.

## Content still requiring an explicit release

Premium skin palettes must pass in-game review and be published before claims open. Moonlit Marsh must be deliberately previewed/published by an admin. Community effects and showcases require approval. Extended milestone content is configurable and has not been invented. Gift checkout remains unavailable pending payment/tax/refund validation; referral tracking remains off by default.

## Recovery

Use the Arcade emergency switch or disable `VALLEY_ARCADE_ENABLED` on both services to stop new rewards. Disable individual website feature flags if a feature needs investigation. Do not restore an older database over current player activity as a routine rollback. Preserve both backups and inspect ledger state before any data repair. Keep wagering disabled through any rollback. Daily-reward changes must be coordinated on website and wallet to avoid unintentionally re-enabling the old automatic bonus.
