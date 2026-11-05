# Roadmap #24 — screenshot gallery

Local branch: `feature/hv-roadmap-gallery-20261105`, based on the prepared
achievements branch. The earlier achievements PR approval request still refers
to that separate, unchanged branch.

## Implemented backend

`/api/gallery` is disabled unless `HV_GALLERY_ENABLED=1`. Disabled requests do
not create gallery tables. Uploads require a Steam-linked session, same-origin
request, binary PNG/JPEG/WebP input and a client retry ID. Two image decoders can
run concurrently. Images are limited to 8 MB and 20 megapixels, decoded and
re-encoded to metadata-free WebP, resized within 1920×1920, and capped at 2 MB.
Animation and other formats are rejected. The pinned decoder is sharp 0.35.5.

Submissions start private. Their owner and admins can retrieve pending images;
the public can retrieve approved images only. Public listings omit Steam IDs,
request IDs and moderation history. Every image response uses no-store and
nosniff headers. No arbitrary remote URL fetching or user-named filesystem paths
are involved. Normalized images are stored as bounded blobs in additive SQLite
tables, included in the site's normal database backup responsibilities.

Admins approve/reject or feature approved screenshots with a reason and expected
revision. Review retries are idempotent and decisions are preserved in an audit
table. Owners can withdraw images; this immediately removes their blob and public
visibility, keeps the audit metadata, and prevents an admin restoring that blob.
Limits are 20 retained images per account, five submissions per rolling day, and
2 GiB of active normalized images site-wide. Withdrawal does not reset daily
submission history. Storage capacity and moderator staffing require staging review
before enabling production.

## Remaining milestone work

- Dinosaur-specific association beyond the implemented account gallery.
- Authenticated staging verification of the implemented upload, owner-management and moderation screens.
- Community discovery/navigation polish after rollout approval.
- Any separately approved reward rules and monthly results presentation.
- Linux dependency/decoder validation in CI, authenticated staging and production verification.

No production settings, uploads, rewards, wallets, game commands or existing
player records were changed. Roadmap #24 remains Building / Testing and old votes
are retained without consuming active idea-vote slots.

## Validation

Service and HTTP fixtures use generated images and isolated databases. They cover
metadata removal, resizing, format/size rejection, private/public authorization,
moderation, identity binding, request retries, stale decisions, owner withdrawal,
rollout gating and daily quotas. The decoder uses its documented pixel limit and
metadata-stripping defaults:
[constructor](https://sharp.pixelplumbing.com/api-constructor/) and
[output options](https://sharp.pixelplumbing.com/api-output/).


## Gallery screens — local verification

Added `/gallery` and profile links for community browsing and personal images.
Steam-linked owners can upload, retry an interrupted submission with the same
request ID, and permanently withdraw their own image. The same page exposes
moderation only to admins, with approval/rejection, featuring and decision history;
all admin access is enforced again by the API. Guests can browse approved images.
Images and captions use safe DOM construction, responsive cards and live status
messages. Cursor pagination supports longer galleries.

The browser fixture runs the real image upload, moderation and storage routes
against an isolated database. Desktop (1440px) and mobile (390px) runs passed:
lost acknowledgement/retry without duplicate upload, private pending state,
approval/history, featured public display, guest access, text escaping, withdrawal
and viewport bounds. The mobile screenshot was visually inspected. Moderator
history authorization also has an HTTP regression test. No production flag was
enabled and the achievements review branch is unchanged.


## Filtering and rollout-state checks

Featured-only browsing now selects only approved, featured images server-side.
Admins can filter pending, approved and rejected submissions. Status filters are
validated and cannot expose private submissions through the public list. Cursor
pagination is tested across 60 matching rows with no duplicates.

A public capabilities read reports the rollout state without creating tables.
The page rechecks it when changing views or refreshing, hides uploads and
moderation controls while disabled, and shows a clear not-open-yet message.
Five gallery service/HTTP tests and the real desktop/mobile browser workflows
passed, including filter changes and disabling the rollout during an active page.


## Monthly community voting — local implementation

Each linked Steam account has one changeable vote per Brisbane calendar month.
Eligible entries are currently approved images uploaded during that same month;
own images are excluded. Users can clear their choice. Rejected or withdrawn
images cease contributing to visible tallies, while the private vote record stays
intact. Past months are preserved in storage; this implementation presents the
current month, not an automatically declared winner or historical prize ledger.

The vote endpoint binds identity to the session, checks origin, validates the
expected month and revision, and records idempotency keys. Replaying an old
accepted request never overwrites a newer choice. Ten changes per rolling hour
limit repeated writes; identical retries do not consume extra changes. Vote
storage does not call progression, wallet, rewards or game services.

Fixtures cover UTC-to-Brisbane month/year boundaries, invalid/self/private/old
entries, changed and cleared choices, lost/stale request semantics, withdrawal,
identity spoofing and private voter data. Real desktop/mobile browser flows also
cast and clear a vote against the actual local API. Staging and production remain
unverified and the rollout flag remains disabled outside fixtures.

## Past monthly results

The gallery now has a public Past monthly results view and a read-only
`GET /api/gallery/results?month=YYYY-MM` endpoint behind the existing rollout
flag. The default is the last completed Brisbane calendar month. Current and
future months are rejected. Results show up to 50 voted entries, ranked by votes
with shared ranks for ties and deterministic ordering within each tie.

Only screenshots uploaded during that month and still approved are returned.
Withdrawn or rejected screenshots disappear; their original votes remain stored.
The UI explicitly explains that subsequent moderation can change the visible
rankings. This is a view of past votes, not a frozen prize or winner ledger.
No voter Steam IDs, private moderation data or new rewards are exposed.

Eight gallery service/HTTP tests pass. Desktop (1440px) and mobile (390px)
browser fixtures cover empty and populated historical results, safe title text,
no voting controls on past results and layout bounds, alongside the existing
upload, review, current-month vote and withdrawal checks. Staging and production
verification remain pending.
