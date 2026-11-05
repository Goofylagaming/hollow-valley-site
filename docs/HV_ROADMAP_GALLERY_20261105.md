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

- Public gallery and account/profile presentation.
- Upload, owner-management and moderation screens with accessible mobile layouts.
- Admin decision-history display and moderation filters.
- Community voting and any separately approved reward rules.
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
