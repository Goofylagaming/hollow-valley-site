# Primalbound shared paid Render preview: protected cutover

**Status:** Prepared in a development branch. NOT switched on. The existing `hollow-valley-ui-v2-preview` Render service, its 1 GB disk and Hollow Valley SQLite data remain unchanged until this runbook is completed.

## Known services

- Paid disk service: `hollow-valley-ui-v2-preview` (`srv-davbt13bc2fs73c9ma4g`), Singapore, Node 22, persistent disk `/app/data`.
- Existing deployment: repo `Goofylagaming/hollow-valley-site`, branch `test-ui-v2`, start command `node server/index.js`.
- Primalbound game frontend: `https://hollowvalleyisle.com/primalbound/` remains served via `primalbound-web-preview`; NO frontend migration needed.
- Existing, tested PostgreSQL account backend: `primalbound-cloud-preview`, currently on free Singapore Postgres `dpg-dbbgtm8u01pc73bb0ncg-a` (expires **19 November 2026**).

## Safety guarantees

1. Only `server/index.js` of the paid **UI preview** branch selects cloud mode, and only when `PRIMALBOUND_PAID_CLOUD=1` is explicitly set. No production Hollow Valley website, automation, or HerbyBot entry point changes.
2. The Primalbound SQLite database is a NEW file `/app/data/primalbound-cloud/primalbound.sqlite`; it NEVER reuses `/app/data/hollowvalley.sqlite`.
3. Existing SQLite or recovery files on the paid disk are read, encrypted, uploaded, read back, decrypted and hash-verified off-site **before** switching the service. The marker records verified backup keys and hashes. No source file is deleted or rewritten.
4. Migrating the PostgreSQL users, sessions, cloud saves and ten-revision history creates a temp SQLite DB, checks referential integrity and exact row counts, verifies an encrypted remote snapshot, then atomically creates the final file. Existing targets are never overwritten.
5. Startup on SQLite refuses ALL registration/auth/save endpoints until encrypted off-site backup verification has succeeded. The API health endpoint reports `accountsConfigured:false` otherwise.
6. All source PostgreSQL tables remain available unchanged for rollback.
7. To restore old preview: remove `PRIMALBOUND_PAID_CLOUD` (or set to `0`), redeploy the previous branch/commit, and leave the original disk files untouched.
8. Don't point `hollowvalleyisle.com/primalbound/api` to the paid backend until migration and cross-device login tests pass.

## Required off-site backup destination

Use an S3-compatible bucket with retained access to previous backups (e.g. an object-storage account). It must support PUT and GET, and should have versioning, restricted write access and retention. The paid disk is **not** an off-site backup. Do not place passwords, bucket keys or encryption keys in GitHub, chat messages, URLs, or repository files.

Set these values using the **Render service Environment tab**:
- `PRIMALBOUND_BACKUP_BUCKET`
- `PRIMALBOUND_BACKUP_REGION`
- `PRIMALBOUND_BACKUP_ACCESS_KEY`
- `PRIMALBOUND_BACKUP_SECRET_KEY`
- `PRIMALBOUND_BACKUP_KEY`: base64 representation of a random 32-byte AES-256-GCM encryption key. Keep an offline recovery copy of the encryption key.
- `PRIMALBOUND_BACKUP_ENDPOINT`: HTTPS URL for an S3-compatible provider, if not AWS S3.
- `PRIMALBOUND_BACKUP_PREFIX`: optional object prefix, default `primalbound/sqlite`.
- `PRIMALBOUND_DATA_ROOT=/app/data`.

These aren't configured by the code. Without them the account API remains unavailable.

## Cutover sequence (not performed)

1. Keep the original `test-ui-v2` branch/commit and Render service environment configuration available for rollback. Merge the isolated changes only to `test-ui-v2` after review. With `PRIMALBOUND_PAID_CLOUD` unset the UI preview keeps running its old code.
2. In Render Shell, verify the original persistent disk's expected SQLite and recovery files are present and note `PRAGMA integrity_check`, hashes and sizes.
3. Configure off-site bucket variables above on the paid preview service.
4. **Before activating Primalbound**, run the one-time migration in the paid service's Shell (only when the destination Primalbound .sqlite file does not exist):

   ```sh
   node server/primalbound/sqlite-migration.mjs
   ```

   This requires the current FREE source Postgres `DATABASE_URL` (internal Singapore URL) in the paid service's environment. It backs up original Hollow Valley files off-site FIRST. It will fail without validated off-site backups or if target SQLite already exists.
5. Independently inspect `/app/data/primalbound-cloud/legacy-backup-verified.json` and confirm encrypted S3 objects can be downloaded/decrypted with the key.
6. Switch `PRIMALBOUND_PAID_CLOUD=1`, `PRIMALBOUND_DB_ENGINE=sqlite` and deploy **only** the paid UI-preview service. Check `/api/health`: `{"ok":true,"accountsConfigured":true,"storage":"sqlite"}`.
7. Use a new disposable test account to save a dinosaur collection, refresh/restart, sign back in, verify the same save and inventory; test an intentional revision conflict and history restoration.
8. Update the production Hollow Valley `PRIMALBOUND_CLOUD_API_URL` only after paid backend readiness, transport isolation, and zero-loss import are confirmed. Do not repoint the live game early.
9. Leave PostgreSQL untouched until backup restore rehearsals and a rollback observation window have passed. The free source expires 2026-11-19.

## Recovery / rollback

- For a failed SQLite cutover: disable `PRIMALBOUND_PAID_CLOUD`; this returns the preview to its original Hollow Valley code. Don't delete any SQLite files.
- Cloud users can continue at the unchanged free PostgreSQL preview until expiration; don't blindly point them to an unverified stale database.
- For an off-site restore: download an encrypted `.sqlite.aesgcm` object, decrypt it with the preserved `PRIMALBOUND_BACKUP_KEY`, run `PRAGMA integrity_check`, and restore to a NEW path before changing production.
- No irreversible cleanup actions have been automated. Restores and activation remain deliberate operations.

## Tested

Automated GitHub Actions (Node 22) cover SQLite restart persistence, serialized concurrent saves, refusal to open a Hollow Valley database, encrypted backup roundtrip, tamper detection, complete PostgreSQL migration, no-overwrite guard, and backup fail-closed HTTP behaviour.

