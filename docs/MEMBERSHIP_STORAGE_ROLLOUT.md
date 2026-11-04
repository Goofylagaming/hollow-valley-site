# DinoStorage is unlimited for everyone

DinoStorage has no membership quota. Every player can park and redeem dinosaurs
under the same storage rules. Starting, upgrading or ending a subscription does
not change storage capacity, prevent a new deposit or remove a stored dinosaur.

## Membership release settings

Leave `DINOSTORAGE_MEMBERSHIP_CAPACITY_ENABLED` unset or `false`. Do not set a
base slot allowance or a capacity rollout acknowledgement as part of any
membership release. No storage migration, game command or change to park,
redeem, recovery, purchase or transfer behavior is required.

## Why capacity code still exists

The automation service contains an earlier, disabled experiment for finite
per-player capacity. Its service-token endpoint and reservation tests remain in
the repository, but the experiment is not a subscriber benefit or a planned
activation step. Its hypothetical slot values are not player quotas and must
not be used in tier descriptions, membership UI or support guidance.

For work on the dormant code, the local test suite
`automation-platform/test/membershipStorageCapacity.test.js` uses isolated
fixtures. Do not enable capacity on a live server to verify membership rewards.
