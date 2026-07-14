-- 2026-07-14  Subscription audit columns: created_by / updated_by
--
-- Stamp the acting admin (JWT-derived) on manual subscription create/update across
-- all four subscription tables. ws_package_course_subscription ALREADY has both
-- columns; the other three need them added. Nullable Int (admin user id), no default
-- — existing rows stay NULL (system/online purchases were never admin-attributed).
--
-- NOTE: this MySQL build does NOT support `ADD COLUMN IF NOT EXISTS`, so these are
-- plain ALTERs. The three columns were verified absent before writing. Apply once:
--   npx prisma db execute --file docs/migration/schema-changes/2026-07-14_subscription_created_by_updated_by_audit.sql --schema prisma/schema.prisma

ALTER TABLE `ws_live_course_subscription`
  ADD COLUMN `created_by` INT NULL AFTER `updated_at`,
  ADD COLUMN `updated_by` INT NULL AFTER `created_by`;

ALTER TABLE `ws_test_series_subscription`
  ADD COLUMN `created_by` INT NULL AFTER `updated_at`,
  ADD COLUMN `updated_by` INT NULL AFTER `created_by`;

ALTER TABLE `ws_ebook_subscription`
  ADD COLUMN `created_by` INT NULL AFTER `updated_at`,
  ADD COLUMN `updated_by` INT NULL AFTER `created_by`;
