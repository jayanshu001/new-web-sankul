-- 2026-07-28 — Per-customer offline-download AES-256 key on ws_customer.
--
-- WHY: the mobile app encrypts downloaded videos/PDFs on device (`*.wsenc`,
--   header magic WSENC001 + 16-byte IV + AES-256-CTR). It mints the 32-byte key
--   ONCE per user and parks it server-side so the same key survives logout /
--   reinstall / local-cache expiry and the user can still read files they had
--   already downloaded. The server never decrypts — it is pure key custody.
--
-- WHY A COLUMN AND NOT A SIDE TABLE: per-customer secrets already live on
--   ws_customer (`password`, `otp`, `device`). One key per account is exactly
--   what the existing PK already guarantees, so a side table would add a join
--   and a second write path to re-enforce an invariant we get for free. Reads
--   also come for free: the auth/profile paths already load the customer row.
--
-- SECURITY: treat `download_key_hex` in the same class as `password` / `otp` —
--   never logged (see the exact-match "key" entry in src/utils/scrub.ts), never
--   placed in a DTO (customer transformers pick fields explicitly, they do not
--   spread the row), and only ever returned to the authenticated owner via
--   GET /api/v1/client/downloads/encryption-key. If this table is granted to a
--   reporting/BI user, exclude this column.
--
-- NULL = this user has never stored a key → the API's documented 404 state.
-- No backfill: every column starts NULL by design and the app PUTs on first 404.
--
-- Rollback: ALTER TABLE `ws_customer` DROP COLUMN `download_key_hex`;
--
-- IDEMPOTENT / re-runnable: MySQL 8 has no `ADD COLUMN IF NOT EXISTS`, so the add is
-- guarded on information_schema and becomes a no-op if already applied (fixes
-- "Duplicate column name" on a re-run).

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_customer' AND COLUMN_NAME = 'download_key_hex');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_customer` ADD COLUMN `download_key_hex` VARCHAR(64) NULL DEFAULT NULL AFTER `device`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- Supersedes an earlier local-only iteration that used a separate
-- `ws_customer_download_key` table. Never deployed beyond local dev; dropped
-- here so a developer machine that applied it does not keep a stale table.
DROP TABLE IF EXISTS `ws_customer_download_key`;
