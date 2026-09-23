-- 2026-07-14  Subscription audit columns: created_by / updated_by
--
-- Stamp the acting admin (JWT-derived) on manual subscription create/update across
-- all four subscription tables. ws_package_course_subscription ALREADY has both
-- columns; the other three need them added. Nullable Int (admin user id), no default
-- — existing rows stay NULL (system/online purchases were never admin-attributed).
--
-- IDEMPOTENT / re-runnable: MySQL 8 has no `ADD COLUMN IF NOT EXISTS`, so each add
-- is guarded on information_schema and becomes a no-op if already applied (fixes
-- "Duplicate column name" on a re-run).

-- ws_live_course_subscription -------------------------------------------------
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_live_course_subscription' AND COLUMN_NAME = 'created_by');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_live_course_subscription` ADD COLUMN `created_by` INT NULL AFTER `updated_at`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_live_course_subscription' AND COLUMN_NAME = 'updated_by');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_live_course_subscription` ADD COLUMN `updated_by` INT NULL AFTER `created_by`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ws_test_series_subscription -------------------------------------------------
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_test_series_subscription' AND COLUMN_NAME = 'created_by');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_test_series_subscription` ADD COLUMN `created_by` INT NULL AFTER `updated_at`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_test_series_subscription' AND COLUMN_NAME = 'updated_by');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_test_series_subscription` ADD COLUMN `updated_by` INT NULL AFTER `created_by`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

-- ws_ebook_subscription -------------------------------------------------------
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_ebook_subscription' AND COLUMN_NAME = 'created_by');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_ebook_subscription` ADD COLUMN `created_by` INT NULL AFTER `updated_at`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ws_ebook_subscription' AND COLUMN_NAME = 'updated_by');
SET @ddl := IF(@exists = 0,
  'ALTER TABLE `ws_ebook_subscription` ADD COLUMN `updated_by` INT NULL AFTER `created_by`',
  'DO 0');
PREPARE s FROM @ddl; EXECUTE s; DEALLOCATE PREPARE s;
